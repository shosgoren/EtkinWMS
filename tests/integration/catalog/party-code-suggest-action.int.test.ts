// T-1093: cari kodu önerisi ve otomatik kodla kaydetme Server Action'ları — GERÇEK yol (gerçek `wms_app`, RLS, eylem sarmalayıcısı, domain).
// Türe göre önek (MUS / TED / CAR), sıra `code_key` üzerinden (küçük harfli eski kod dahil), çakışmada yalnız önerilen biçimde yeniden
// deneme, elle yazılan kod asla değişmez; I-01/I-02 (başka tenant'ın kodları sırayı etkilemez, çapraz slug NOT_FOUND), yetki (settings.manage).
// Mock'lar yalnızca Next çalışma zamanı ve kimlik çözümüdür. Fikstürler sentetik (G-09).
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
let B: TenantWorld;
let actions: Actions;
const saved: Record<string, string | undefined> = {};
const ENV_KEYS = ["BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "WMS_ENV"] as const;

let ipN = 0;
function as(user: string): void {
  h.headers = new Headers({ "fly-client-ip": `198.51.100.${(++ipN % 250) + 1}`, "user-agent": "t1093-qa", origin: ORIGIN, "x-test-user": user });
}

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  Object.assign(process.env, { BETTER_AUTH_URL: ORIGIN, BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), WMS_ENV: "ci" });
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  h.db = app;
  A = await seedWorld(adm, reg, "A1093");
  B = await seedWorld(adm, reg, "B1093");
  actions = (await import(/* @vite-ignore */ path.join(WEB, "app/t/[slug]/parties/actions.ts"))) as Actions;
}, 180_000);

afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await app?.close().catch(() => undefined);
  await adm?.end().catch(() => undefined);
}, 60_000);

const party = (w: TenantWorld, code: string) =>
  adm.query("INSERT INTO public.parties (tenant_id, code, code_key, name, created_by) VALUES ($1, $2, upper($2), $3, $4)", [w.tenantId, code, `Cari ${code}`, w.ownerMembershipId]);
/** Yanıt biçimi (istek kimliği her çağrıda farklıdır). */
const face = (r: Result): string => JSON.stringify(r).replace(/"requestId":"[^"]*"/, "");

describe("cari kodu önerisi ve otomatik kod (T-1093)", () => {
  it("türe göre önek: müşteri MUS-0001, tedarikçi TED-0001, ikisi CAR-0001", async () => {
    for (const [kind, prefix] of [["CUSTOMER", "MUS"], ["SUPPLIER", "TED"], ["BOTH", "CAR"]] as const) {
      as(A.ownerUserId);
      const r = await actions.suggestPartyCodeAction!({ slug: A.slug, kind });
      expect(r, JSON.stringify(r)).toEqual({ ok: true, data: { code: `${prefix}-0001`, prefix } });
    }
  });

  it("sıra code_key üzerinden: küçük harfli eski kod ve sayısal olmayan ekler sayılır/yok sayılır; B'nin kodları A'yı etkilemez (I-01)", async () => {
    for (const code of ["mus-0007", "MUS-ABC", "MUSX-0500", "MUS-12-3"]) await party(A, code);
    await party(B, "MUS-0900");
    as(A.ownerUserId);
    expect(await actions.suggestPartyCodeAction!({ slug: A.slug, kind: "CUSTOMER" })).toEqual({ ok: true, data: { code: "MUS-0008", prefix: "MUS" } });
    as(B.ownerUserId);
    expect(await actions.suggestPartyCodeAction!({ slug: B.slug, kind: "CUSTOMER" })).toEqual({ ok: true, data: { code: "MUS-0901", prefix: "MUS" } });
  });

  it("otomatik kodda çakışma sıradakine geçer; elle yazılan kod değişmez (CODE_TAKEN döner)", async () => {
    await party(A, "TED-0001");
    as(A.ownerUserId);
    const auto = await actions.savePartyAction!({ slug: A.slug, code: "TED-0001", name: "Otomatik tedarikçi", kind: "SUPPLIER", autoCode: true });
    expect(auto, JSON.stringify(auto)).toMatchObject({ ok: true, data: { ok: true } });
    const saved = await adm.query<{ code: string }>("SELECT code FROM public.parties WHERE tenant_id = $1 AND name = 'Otomatik tedarikçi'", [A.tenantId]);
    expect(saved.rows.map((r) => r.code)).toEqual(["TED-0002"]);
    as(A.ownerUserId);
    const manual = await actions.savePartyAction!({ slug: A.slug, code: "TED-0001", name: "Elle yazılan", kind: "SUPPLIER" });
    expect(manual).toEqual({ ok: true, data: { ok: false, issue: "CODE_TAKEN" } });
    as(A.ownerUserId);
    const odd = await actions.savePartyAction!({ slug: A.slug, code: "ted-0001", name: "Biçim dışı", kind: "SUPPLIER", autoCode: true });
    expect(odd).toEqual({ ok: true, data: { ok: false, issue: "CODE_TAKEN" } });
    const n = await adm.query("SELECT 1 FROM public.parties WHERE tenant_id = $1 AND name IN ('Elle yazılan', 'Biçim dışı')", [A.tenantId]);
    expect(n.rowCount).toBe(0);
  });

  it("I-02: A yöneticisi B'nin slug'ıyla NOT_FOUND (var olmayan slug'la aynı yanıt, B sızmaz); B'de kayıt oluşmaz", async () => {
    const before = (await adm.query("SELECT count(*)::int AS n FROM public.parties WHERE tenant_id = $1", [B.tenantId])).rows[0];
    for (const call of [
      (slug: string) => actions.suggestPartyCodeAction!({ slug, kind: "CUSTOMER" }),
      (slug: string) => actions.savePartyAction!({ slug, code: "MUS-7777", name: "Ele geçirme", kind: "CUSTOMER", autoCode: true }),
    ]) {
      as(A.ownerUserId);
      const cross = await call(B.slug);
      as(A.ownerUserId);
      const missing = await call("yok-t1093");
      expect(cross).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
      expect(JSON.stringify(cross)).not.toContain(B.slug);
      expect(face(cross)).toBe(face(missing));
    }
    expect((await adm.query("SELECT count(*)::int AS n FROM public.parties WHERE tenant_id = $1", [B.tenantId])).rows[0]).toEqual(before);
  });

  it("yetki: settings.manage olmayan üye öneri alamaz (FORBIDDEN); oturumsuz istek reddedilir", async () => {
    as(A.memberUserId);
    expect(await actions.suggestPartyCodeAction!({ slug: A.slug, kind: "CUSTOMER" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    h.headers = new Headers({ "fly-client-ip": "198.51.100.250", "user-agent": "t1093-qa", origin: ORIGIN });
    expect(await actions.suggestPartyCodeAction!({ slug: A.slug, kind: "CUSTOMER" })).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
  });
});
