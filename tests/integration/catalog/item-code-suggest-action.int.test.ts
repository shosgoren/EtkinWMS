// T-990 (B-97): ürün kodu önerisi Server Action'ı — GERÇEK yol (gerçek `wms_app`, RLS, eylem sarmalayıcısı, domain). Canlıda yeni ürün
// formunda "Kod önerisi alınamadı" görünüyordu; bu dosya eylemin yönetici için kart türü önekiyle başarılı döndüğünü ve formun kullandığı
// otomatik kodla oluşturmanın çalıştığını kanıtlar. Mock'lar yalnızca Next çalışma zamanı ve kimlik çözümüdür. Fikstürler sentetik (G-09).
import { randomBytes } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ db: undefined as unknown, headers: new Headers() }));

vi.mock("../../../apps/web/node_modules/next/headers.js", () => ({
  headers: () => Promise.resolve(h.headers),
  cookies: () => Promise.resolve({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("../../../packages/db/src/index.ts", async (orig) => ({ ...(await orig<Record<string, unknown>>()), getAppDb: () => h.db }));
vi.mock("../../../apps/web/lib/auth-service.ts", () => ({
  getAuthService: () => ({
    getPrincipal: (headers: Headers) => {
      const u = headers.get("x-test-user");
      return Promise.resolve(u === null ? null : { userId: u, mfaVerified: true });
    },
  }),
}));

import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
const ORIGIN = "https://app.example.test";
const WEB = path.resolve(import.meta.dirname, "../../../apps/web");
const reg = newRegistry();

type Result = { ok: true; data: Record<string, unknown> } | { ok: false; error: { code: string; detail?: string } };
type Actions = Record<string, (arg: unknown) => Promise<Result>>;

let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let actions: Actions;
const saved: Record<string, string | undefined> = {};
const ENV_KEYS = ["BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "WMS_ENV"] as const;

let ipN = 0;
function as(user: string): void {
  h.headers = new Headers({ "fly-client-ip": `198.51.100.${(++ipN % 250) + 1}`, "user-agent": "t990-qa", origin: ORIGIN, "x-test-user": user });
}

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  Object.assign(process.env, { BETTER_AUTH_URL: ORIGIN, BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), WMS_ENV: "ci" });
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  h.db = app;
  A = await seedWorld(adm, reg, "A990");
  actions = (await import(/* @vite-ignore */ path.join(WEB, "app/t/[slug]/items/actions.ts"))) as Actions;
}, 180_000);

afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await app?.close().catch(() => undefined);
  await adm?.end().catch(() => undefined);
}, 60_000);

describe("ürün kodu önerisi eylemi (T-990)", () => {
  it("yönetici: dört kart türünün her biri kendi önekiyle öneri alır", async () => {
    for (const prefix of ["HM", "YM", "MM", "TM"]) {
      as(A.ownerUserId);
      const r = await actions.suggestItemCodeAction!({ slug: A.slug, prefix });
      expect(r, JSON.stringify(r)).toMatchObject({ ok: true, data: { prefix } });
      if (r.ok) expect(String(r.data.code)).toMatch(new RegExp(`^${prefix}-\\d{6}$`));
    }
  });

  it("var olan kodlar (öneki taşıyan ama sayısal olmayan, uzun ve önek benzeri kodlar dahil) öneriyi bozmaz", async () => {
    const codes = ["HM-000041", "HM-ABC", "HM-0000000000000000000099", "HMX-000500", "HM-12-3", "hm-000900"];
    for (const code of codes) {
      await adm.query("INSERT INTO public.items (tenant_id, id, code, name, base_unit_id) VALUES ($1, gen_random_uuid(), $2, $3, $4)", [A.tenantId, code, `Ürün ${code}`, A.unitId]);
    }
    as(A.ownerUserId);
    const r = await actions.suggestItemCodeAction!({ slug: A.slug, prefix: "HM" });
    expect(r, JSON.stringify(r)).toEqual({ ok: true, data: { code: "HM-000042", prefix: "HM" } });
  });

  it("formun yolu: öneriyle (autoCode) ürün oluşturulur, sonraki öneri bir ilerler", async () => {
    as(A.ownerUserId);
    const s = await actions.suggestItemCodeAction!({ slug: A.slug, prefix: "YM" });
    expect(s.ok, JSON.stringify(s)).toBe(true);
    if (!s.ok) return;
    as(A.ownerUserId);
    const c = await actions.createItemAction!({ slug: A.slug, code: s.data.code, name: "Öneri ürünü", baseUnitId: A.unitId, cardType: "YM", autoCode: true });
    expect(c.ok, JSON.stringify(c)).toBe(true);
    as(A.ownerUserId);
    const n = await actions.suggestItemCodeAction!({ slug: A.slug, prefix: "YM" });
    expect(n, JSON.stringify(n)).toMatchObject({ ok: true, data: { code: "YM-000002" } });
  });
});
