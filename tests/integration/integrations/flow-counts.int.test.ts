// T-1136: yön onay penceresinin yerel kayıt sayısı (`countFlowRecords`) — gerçek wms_app bağlantısı. Kanıtlar: sayılar eşitlemenin gördüğü
// kümeyle aynı (ürün/depo ACTIVE, cari arşivsiz; `unlinked` = bu sağlayıcıya eşlemesiz), başka kiracının kaydı sayılmaz (I-01…I-03, negatif),
// başka kiracının adresi ve yetkisiz üye reddedilir, kart dışı akış ve geçersiz sağlayıcı reddedilir.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import { countFlowRecords } from "../../../packages/domain/src/integrations/index.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv, redactErrorChain } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();

let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let B: TenantWorld;

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  try {
    await adm.connect();
  } catch (e) {
    throw new Error(`connect failed: ${redactErrorChain(e, [env.databaseUrl, env.databaseUrlDirect])}`);
  }
  A = await seedWorld(adm, reg, "FCA");
  B = await seedWorld(adm, reg, "FCB");
}, 120_000);

afterAll(async () => {
  await adm.end();
  await app.close();
}, 120_000);

const owner = (w: TenantWorld, slug = w.slug) => ({ db: app, principal: { userId: w.ownerUserId, mfaVerified: true }, tenantSlug: slug });
const picker = (w: TenantWorld) => ({ db: app, principal: { userId: w.memberUserId, mfaVerified: true }, tenantSlug: w.slug });
async function one(text: string, params: unknown[]): Promise<number> {
  return Number((await adm.query<{ n: number }>(text, params)).rows[0]?.n ?? 0);
}
/** Beklenen sayı (yönetici bağlantısı, aynı küme tanımı). */
const truth = async (w: TenantWorld) => ({
  PRODUCTS: {
    total: await one("SELECT count(*)::int AS n FROM public.items WHERE tenant_id=$1 AND status='ACTIVE'", [w.tenantId]),
    unlinked: await one("SELECT count(*)::int AS n FROM public.items i WHERE i.tenant_id=$1 AND i.status='ACTIVE' AND NOT EXISTS (SELECT 1 FROM public.external_refs r WHERE r.tenant_id=i.tenant_id AND r.system='PARASUT' AND r.entity_type='ITEM' AND r.entity_id=i.id)", [w.tenantId]),
  },
  CONTACTS: {
    total: await one("SELECT count(*)::int AS n FROM public.parties WHERE tenant_id=$1 AND archived_at IS NULL", [w.tenantId]),
    unlinked: await one("SELECT count(*)::int AS n FROM public.parties p WHERE p.tenant_id=$1 AND p.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM public.external_refs r WHERE r.tenant_id=p.tenant_id AND r.system='PARASUT' AND r.entity_type='PARTY' AND r.entity_id=p.id)", [w.tenantId]),
  },
  WAREHOUSES: {
    total: await one("SELECT count(*)::int AS n FROM public.warehouses WHERE tenant_id=$1 AND status='ACTIVE'", [w.tenantId]),
    unlinked: await one("SELECT count(*)::int AS n FROM public.warehouses w WHERE w.tenant_id=$1 AND w.status='ACTIVE' AND NOT EXISTS (SELECT 1 FROM public.external_refs r WHERE r.tenant_id=w.tenant_id AND r.system='PARASUT' AND r.entity_type='WAREHOUSE' AND r.entity_id=w.id)", [w.tenantId]),
  },
});
async function fail(p: Promise<unknown>): Promise<AppError> {
  const e = await p.then(() => undefined, (x: unknown) => x);
  expect(e).toBeInstanceOf(AppError);
  return e as AppError;
}
const addItem = async (w: TenantWorld, code: string): Promise<string> =>
  (await adm.query<{ id: string }>("INSERT INTO public.items (tenant_id, id, code, name, base_unit_id) VALUES ($1, gen_random_uuid(), $2, $2, $3) RETURNING id", [w.tenantId, code, w.unitId])).rows[0]?.id as string;

describe("T-1136 countFlowRecords", () => {
  it("üç kart akışında sayı, eşitlemenin gördüğü kümeyle aynı", async () => {
    const t = await truth(A);
    for (const flow of ["PRODUCTS", "CONTACTS", "WAREHOUSES"] as const) {
      expect(await countFlowRecords(owner(A), { provider: "PARASUT", flow }), flow).toEqual(t[flow]);
    }
    expect(t.PRODUCTS.total).toBeGreaterThan(0);
    expect(t.WAREHOUSES.total).toBeGreaterThan(0);
  });

  it("yeni ürün sayıya girer; Paraşüt'e eşlenen ürün 'eşlenmemiş'ten düşer (başka sağlayıcının eşlemesi düşürmez)", async () => {
    const before = await countFlowRecords(owner(A), { provider: "PARASUT", flow: "PRODUCTS" });
    const id = await addItem(A, `FC-${randomUUID().slice(0, 8)}`);
    expect(await countFlowRecords(owner(A), { provider: "PARASUT", flow: "PRODUCTS" })).toEqual({ total: before.total + 1, unlinked: before.unlinked + 1 });
    await adm.query("INSERT INTO public.external_refs (tenant_id, system, entity_type, entity_id, external_id) VALUES ($1, 'LOGO', 'ITEM', $2, $3)", [A.tenantId, id, `l-${randomUUID()}`]);
    expect(await countFlowRecords(owner(A), { provider: "PARASUT", flow: "PRODUCTS" })).toEqual({ total: before.total + 1, unlinked: before.unlinked + 1 });
    await adm.query("INSERT INTO public.external_refs (tenant_id, system, entity_type, entity_id, external_id) VALUES ($1, 'PARASUT', 'ITEM', $2, $3)", [A.tenantId, id, `p-${randomUUID()}`]);
    expect(await countFlowRecords(owner(A), { provider: "PARASUT", flow: "PRODUCTS" })).toEqual({ total: before.total + 1, unlinked: before.unlinked });
  });

  it("negatif (tenant izolasyonu): B'ye eklenen kayıt A'nın sayısını değiştirmez; A sahibi B'nin adresiyle sayamaz", async () => {
    const a0 = await countFlowRecords(owner(A), { provider: "PARASUT", flow: "PRODUCTS" });
    const b0 = await countFlowRecords(owner(B), { provider: "PARASUT", flow: "PRODUCTS" });
    await addItem(B, `FCB-${randomUUID().slice(0, 8)}`);
    expect(await countFlowRecords(owner(A), { provider: "PARASUT", flow: "PRODUCTS" })).toEqual(a0);
    expect(await countFlowRecords(owner(B), { provider: "PARASUT", flow: "PRODUCTS" })).toEqual({ total: b0.total + 1, unlinked: b0.unlinked + 1 });
    expect((await truth(B)).PRODUCTS).toEqual({ total: b0.total + 1, unlinked: b0.unlinked + 1 });
    // Üye olmadığı alan: varlık sızdırılmaz (NOT_FOUND).
    expect((await fail(countFlowRecords(owner(A, B.slug), { provider: "PARASUT", flow: "PRODUCTS" }))).code).toBe("NOT_FOUND");
  });

  it("yetki: settings.manage olmayan üye reddedilir; oturum yoksa giriş istenir", async () => {
    expect((await fail(countFlowRecords(picker(A), { provider: "PARASUT", flow: "PRODUCTS" }))).code).toBe("FORBIDDEN");
    expect((await fail(countFlowRecords({ db: app, principal: null, tenantSlug: A.slug }, { provider: "PARASUT", flow: "PRODUCTS" }))).code).toBe("UNAUTHENTICATED");
  });

  it("kart dışı akış ve geçersiz sağlayıcı/akış doğrulamada reddedilir", async () => {
    for (const flow of ["STOCK", "SHIPMENTS", "SALES_ORDERS", "NOPE"]) {
      expect((await fail(countFlowRecords(owner(A), { provider: "PARASUT", flow }))).code, flow).toBe("VALIDATION_FAILED");
    }
    expect((await fail(countFlowRecords(owner(A), { provider: "SAP", flow: "PRODUCTS" }))).code).toBe("VALIDATION_FAILED");
  });
});
