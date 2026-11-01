// T-1201 (inceleme öncesi düzeltme): liste "sonraki sayfa" eylemleri (ürün / cari / depo) Paraşüt bağlılığını ilk sayfayla AYNI okumadan
// döndürür (sayfa başına tek `getSourceLinkedIds`): bölüm "Paraşüt'ten al" iken ikinci sayfadaki bağlı kartlar işaretli gelir (kod / arşiv
// düğmesi kilitli çizilir), iki yönlüde boş. Gerçek sorgu yolu (gerçek `wms_app`, RLS, Server Action + köken/oturum denetimi); mock'lar
// yalnız Next çalışma zamanı ve kimlik çözümü (`x-test-user`). Çapraz kiracı: B'nin eylemi A'nın bağlılığını görmez (I-01).
import { randomBytes, randomUUID } from "node:crypto";
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
import { listParties } from "../../../packages/domain/src/catalog/parties.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
const ORIGIN = "https://app.example.test";
const WEB = path.resolve(import.meta.dirname, "../../../apps/web");
const reg = newRegistry();
const PAGE = 50;
const N = PAGE + 5;

type Result = { ok: true; data: Record<string, unknown> } | { ok: false; error: { code: string; detail?: string } };
type Fn = (arg: unknown) => Promise<Result>;

let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let B: TenantWorld;
let items: Record<string, Fn>;
let parties: Record<string, Fn>;
let warehouses: Record<string, Fn>;
let itemsPage: { loadItemsPage: (call: unknown, input: unknown) => Promise<{ rows: { id: string; sourceLinked?: true }[]; nextCursor: string | null }> };
let warehousesPage: { loadWarehousesPage: (call: unknown, input: unknown) => Promise<{ rows: { id: string }[]; nextAfter: string | null }> };
const saved: Record<string, string | undefined> = {};
const ENV_KEYS = ["BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "WMS_ENV"] as const;
let ipN = 0;
function as(user: string): void {
  h.headers = new Headers({ "fly-client-ip": `198.51.100.${(++ipN % 250) + 1}`, "user-agent": "t1201-qa", origin: ORIGIN, "x-test-user": user });
}
const call = (w: TenantWorld) => ({ db: app, principal: { userId: w.ownerUserId, mfaVerified: true }, tenantSlug: w.slug });
const ok = (r: Result): Record<string, unknown> => {
  if (!r.ok) throw new Error(`action failed: ${r.error.code}`);
  return r.data;
};

/** Bölüm bazında: önekli N kart (kod sırası = sayfa sırası); son 5'ten 2'si ve ilk sayfadan 1'i Paraşüt'e bağlı. */
interface Seeded {
  readonly prefix: string;
  readonly ids: readonly string[];
  readonly linked: readonly string[];
}
async function seedCards(w: TenantWorld, kind: "ITEM" | "PARTY" | "WAREHOUSE"): Promise<Seeded> {
  const prefix = `SGP${kind[0]}${randomBytes(2).toString("hex")}`.toUpperCase();
  const ids: string[] = [];
  for (let i = 0; i < N; i++) {
    const id = randomUUID();
    const code = `${prefix}-${String(i).padStart(3, "0")}`;
    if (kind === "ITEM") await adm.query("INSERT INTO public.items (tenant_id, id, code, name, base_unit_id) VALUES ($1, $2, $3, $3, $4)", [w.tenantId, id, code, w.unitId]);
    if (kind === "PARTY") await adm.query("INSERT INTO public.parties (tenant_id, id, code, code_key, name, created_by) VALUES ($1, $2, $3, $3, $3, $4)", [w.tenantId, id, code, w.ownerMembershipId]);
    if (kind === "WAREHOUSE") await adm.query("INSERT INTO public.warehouses (tenant_id, id, code, name) VALUES ($1, $2, $3, $3)", [w.tenantId, id, code]);
    ids.push(id);
  }
  const linked = [ids[3]!, ids[N - 1]!, ids[N - 3]!];
  for (const id of linked) await adm.query("INSERT INTO public.external_refs (tenant_id, system, entity_type, entity_id, external_id) VALUES ($1, 'PARASUT', $2, $3, $4)", [w.tenantId, kind, id, randomUUID().slice(0, 12)]);
  return { prefix, ids, linked };
}

async function connect(w: TenantWorld, dir: "PULL" | "BOTH"): Promise<void> {
  const id = randomUUID();
  await adm.query(
    "INSERT INTO public.integrations (tenant_id, id, provider, status, account_ref, connected_by, connected_membership_id, connected_at, credentials) VALUES ($1, $2, 'PARASUT', 'CONNECTED', '115', $3, $4, now(), $5::jsonb)",
    [w.tenantId, id, w.ownerUserId, w.ownerMembershipId, JSON.stringify({ v: 2, kid: "synthetic", iv: "synthetic", tag: "synthetic", ct: "synthetic" })],
  );
  for (const f of ["PRODUCTS", "CONTACTS", "WAREHOUSES"]) await adm.query("INSERT INTO public.integration_flows (tenant_id, integration_id, flow, direction, enabled) VALUES ($1, $2, $3, $4, true)", [w.tenantId, id, f, dir]);
}
const setDir = (w: TenantWorld, dir: "PULL" | "BOTH") => adm.query("UPDATE public.integration_flows SET direction = $2 WHERE tenant_id = $1", [w.tenantId, dir]);

let SI: Seeded;
let SP: Seeded;
let SW: Seeded;

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  Object.assign(process.env, { BETTER_AUTH_URL: ORIGIN, BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), WMS_ENV: "ci" });
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  h.db = app;
  A = await seedWorld(adm, reg, "SGPA");
  B = await seedWorld(adm, reg, "SGPB");
  await connect(A, "PULL");
  await connect(B, "PULL");
  SI = await seedCards(A, "ITEM");
  SP = await seedCards(A, "PARTY");
  SW = await seedCards(A, "WAREHOUSE");
  items = (await import(/* @vite-ignore */ path.join(WEB, "app/t/[slug]/items/actions.ts"))) as Record<string, Fn>;
  parties = (await import(/* @vite-ignore */ path.join(WEB, "app/t/[slug]/parties/actions.ts"))) as Record<string, Fn>;
  warehouses = (await import(/* @vite-ignore */ path.join(WEB, "app/t/[slug]/warehouses/actions.ts"))) as Record<string, Fn>;
  itemsPage = (await import(/* @vite-ignore */ path.join(WEB, "app/t/[slug]/items/list-page.ts"))) as typeof itemsPage;
  warehousesPage = (await import(/* @vite-ignore */ path.join(WEB, "app/t/[slug]/warehouses/list-page.ts"))) as typeof warehousesPage;
}, 180_000);

afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await app?.close().catch(() => undefined);
  await adm?.end().catch(() => undefined);
}, 60_000);

const lower = (xs: readonly string[]): string[] => xs.map((x) => x.toLowerCase()).sort();

describe("sonraki sayfa eylemleri Paraşüt bağlılığını ilk sayfayla aynı okumadan döndürür (T-1201)", () => {
  it("ürünler: ilk ve sonraki sayfada bağlı ürünler işaretli (PULL); iki yönlüde işaret yok", async () => {
    const first = await itemsPage.loadItemsPage(call(A), { q: SI.prefix, status: "", cardType: "", after: undefined, category: "", tracking: "", barcode: "" });
    expect(first.rows).toHaveLength(PAGE);
    expect(lower(first.rows.filter((r) => r.sourceLinked === true).map((r) => r.id))).toEqual(lower([SI.linked[0]!]));
    as(A.ownerUserId);
    const more = ok(await items.loadMoreItemsAction!({ slug: A.slug, q: SI.prefix, status: "", cardType: "", after: first.nextCursor, category: "", tracking: "", barcode: "" })) as { rows: { id: string; sourceLinked?: true }[] };
    expect(more.rows).toHaveLength(N - PAGE);
    expect(lower(more.rows.filter((r) => r.sourceLinked === true).map((r) => r.id))).toEqual(lower(SI.linked.slice(1)));
    await setDir(A, "BOTH");
    try {
      as(A.ownerUserId);
      const both = ok(await items.loadMoreItemsAction!({ slug: A.slug, q: SI.prefix, status: "", cardType: "", after: first.nextCursor, category: "", tracking: "", barcode: "" })) as { rows: { sourceLinked?: true }[] };
      expect(both.rows.some((r) => r.sourceLinked === true)).toBe(false);
    } finally {
      await setDir(A, "PULL");
    }
  });

  it("cariler: sonraki sayfa `linkedIds` bağlı carileri verir (PULL); iki yönlüde boş", async () => {
    const first = await listParties(call(A), { q: SP.prefix, archived: false, limit: PAGE });
    expect(first.items).toHaveLength(PAGE);
    expect(first.nextCursor).not.toBeNull();
    as(A.ownerUserId);
    const more = ok(await parties.loadMorePartiesAction!({ slug: A.slug, q: SP.prefix, archived: false, after: first.nextCursor })) as { items: { id: string }[]; linkedIds: string[] };
    expect(more.items).toHaveLength(N - PAGE);
    expect(lower(more.linkedIds)).toEqual(lower(SP.linked.slice(1)));
    await setDir(A, "BOTH");
    try {
      as(A.ownerUserId);
      expect(ok(await parties.loadMorePartiesAction!({ slug: A.slug, q: SP.prefix, archived: false, after: first.nextCursor }))).toMatchObject({ linkedIds: [] });
    } finally {
      await setDir(A, "PULL");
    }
  });

  it("depolar: sonraki sayfa `linkedIds` bağlı depoları verir (PULL); iki yönlüde boş", async () => {
    const first = await warehousesPage.loadWarehousesPage(call(A), { q: SW.prefix, archived: false });
    expect(first.rows).toHaveLength(PAGE);
    as(A.ownerUserId);
    const more = ok(await warehouses.loadMoreWarehousesAction!({ slug: A.slug, q: SW.prefix, archived: false, after: first.nextAfter })) as { rows: { id: string }[]; linkedIds: string[] };
    expect(more.rows).toHaveLength(N - PAGE);
    expect(lower(more.linkedIds)).toEqual(lower(SW.linked.slice(1)));
    await setDir(A, "BOTH");
    try {
      as(A.ownerUserId);
      expect(ok(await warehouses.loadMoreWarehousesAction!({ slug: A.slug, q: SW.prefix, archived: false, after: first.nextAfter }))).toMatchObject({ linkedIds: [] });
    } finally {
      await setDir(A, "PULL");
    }
  });

  it("çapraz kiracı: B'nin sonraki sayfa eylemi A'nın kartlarını ve bağlılığını görmez", async () => {
    const first = await listParties(call(A), { q: SP.prefix, archived: false, limit: PAGE });
    as(B.ownerUserId);
    const r = ok(await parties.loadMorePartiesAction!({ slug: B.slug, q: SP.prefix, archived: false, after: first.nextCursor })) as { items: unknown[]; linkedIds: string[] };
    expect(r.items).toEqual([]);
    expect(r.linkedIds).toEqual([]);
    const w = await warehousesPage.loadWarehousesPage(call(A), { q: SW.prefix, archived: false });
    as(B.ownerUserId);
    const rw = ok(await warehouses.loadMoreWarehousesAction!({ slug: B.slug, q: SW.prefix, archived: false, after: w.nextAfter })) as { rows: unknown[]; linkedIds: string[] };
    expect(rw.rows).toEqual([]);
    expect(rw.linkedIds).toEqual([]);
  });
});
