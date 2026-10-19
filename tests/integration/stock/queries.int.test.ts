import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import { listStockOverview, createStockDocument, approveDocument, postDocument, type DocumentLineInput } from "../../../packages/domain/src/stock/index.ts";
import { createWarehouse, setMembershipWarehouseScopes } from "../../../packages/domain/src/warehouse/index.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let B: TenantWorld;
let secondWarehouse: string;
let kgItem: string;
const owner = (w: TenantWorld) => ({ db: app, principal: { userId: w.ownerUserId, mfaVerified: true }, tenantSlug: w.slug });
const picker = () => ({ ...owner(A), principal: { userId: A.memberUserId, mfaVerified: true } });
const cmd = () => ({ ...owner(A), clientKey: randomUUID(), retry: { sleep: async () => undefined } });

async function stock(warehouseId: string, locationId: string, amount: string, stockStatus: DocumentLineInput["stockStatus"] = "AVAILABLE") {
  const unit = (await adm.query<{ base_unit_id: string }>("SELECT base_unit_id FROM public.items WHERE tenant_id=$1 AND id=$2", [A.tenantId, kgItem])).rows[0]?.base_unit_id as string;
  const result = await createStockDocument(cmd(), { kind: "STOCK_IN", warehouseId, lines: [{ itemId: kgItem, unitId: unit, targetLocationId: locationId, quantity: amount, baseQuantity: amount, conversionFactor: "1", stockStatus }] });
  const documentId = result.documentId as string;
  await approveDocument(cmd(), { documentId, expectedVersion: 1 });
  await postDocument(cmd(), { documentId, expectedVersion: 2 });
}

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  const reg = newRegistry();
  A = await seedWorld(adm, reg, "A903");
  B = await seedWorld(adm, reg, "B903");
  secondWarehouse = (await createWarehouse(owner(A), { code: "HAM", name: "Hammadde" })).warehouseId;
  const unit = randomUUID();
  kgItem = randomUUID();
  await adm.query("INSERT INTO public.units (tenant_id,id,code,name) VALUES ($1,$2,'KG','Kilogram')", [A.tenantId, unit]);
  await adm.query("INSERT INTO public.items (tenant_id,id,code,name,base_unit_id,tracking_mode,quantity_scale) VALUES ($1,$2,'K-903','Kauçuk %_',$3,'NONE',6)", [A.tenantId, kgItem, unit]);
  await stock(A.warehouseId, A.rootLocationId, "0.100001");
  await stock(A.warehouseId, A.childLocationId, "0.200002");
  await stock(A.warehouseId, A.rootLocationId, "4", "DAMAGED");
  for (const [kind, blocked, amount] of [["RECEIVING", false, "8"], ["STORAGE", true, "16"], ["STAGING", false, "0.300003"]] as const) {
    const id = randomUUID();
    await adm.query("INSERT INTO public.locations (tenant_id,id,warehouse_id,code,name,depth,kind,pick_blocked) VALUES ($1,$2,$3,$4,'Test',0,$5,$6)", [A.tenantId, id, A.warehouseId, id, kind, blocked]);
    await stock(A.warehouseId, id, amount);
  }
  const id = randomUUID();
  await adm.query("INSERT INTO public.locations (tenant_id,id,warehouse_id,code,name,depth,kind) VALUES ($1,$2,$3,'R1','Raf',0,'STORAGE')", [A.tenantId, id, secondWarehouse]);
  await stock(secondWarehouse, id, "99.000001");
}, 120_000);

afterAll(async () => { await adm.end(); await app.close(); });

describe("stock overview", () => {
  it("keeps warehouses and units separate; sums decimal quantities exactly and excludes ineligible stock", async () => {
    const { items } = await listStockOverview(owner(A));
    expect(items.find((r) => r.itemId === kgItem && r.warehouseId === A.warehouseId)).toMatchObject({ physical: "28.600006", reserved: "0.000000", available: "0.600006", unitCode: "KG" });
    expect(items.find((r) => r.itemId === kgItem && r.warehouseId === secondWarehouse)).toMatchObject({ physical: "99.000001", available: "99.000001", unitCode: "KG" });
    expect(items.find((r) => r.itemId === A.itemNoneId)).toMatchObject({ physical: "10.000000", reserved: "4.000000", available: "6.000000", unitCode: "ADET" });
    expect(items.filter((r) => r.itemId === kgItem)).toHaveLength(2);
  });

  it("tenant membership, authentication and MFA cannot be bypassed", async () => {
    await expect(listStockOverview({ ...owner(A), principal: null })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(listStockOverview({ ...owner(A), principal: { userId: B.ownerUserId, mfaVerified: true } })).rejects.toBeInstanceOf(AppError);
    await expect(listStockOverview({ ...owner(A), principal: { userId: A.ownerUserId, mfaVerified: false } })).rejects.toMatchObject({ code: "FORBIDDEN", detail: "MFA_REQUIRED" });
    expect((await listStockOverview(owner(A), { warehouseId: B.warehouseId })).items).toEqual([]);
    expect((await listStockOverview(owner(B))).items.every((r) => r.warehouseId === B.warehouseId)).toBe(true);
  });

  it("warehouse scopes filter every aggregate and cannot be bypassed with an explicit warehouse", async () => {
    await setMembershipWarehouseScopes({ ...owner(A), recentAuth: async () => undefined }, { membershipId: A.memberMembershipId, warehouseIds: [A.warehouseId] });
    const prior = process.env.WAREHOUSE_SCOPE_ENABLED;
    try {
      process.env.WAREHOUSE_SCOPE_ENABLED = "true";
      const page = await listStockOverview(picker());
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.items.every((r) => r.warehouseId === A.warehouseId)).toBe(true);
      expect(page.items.find((r) => r.itemId === kgItem)?.physical).toBe("28.600006");
      expect((await listStockOverview(picker(), { warehouseId: secondWarehouse })).items).toEqual([]);
      expect((await listStockOverview(owner(A), { warehouseId: secondWarehouse })).items).toHaveLength(1);
      process.env.WAREHOUSE_SCOPE_ENABLED = "false";
      expect((await listStockOverview(picker(), { warehouseId: secondWarehouse })).items).toHaveLength(1);
    } finally {
      if (prior === undefined) delete process.env.WAREHOUSE_SCOPE_ENABLED;
      else process.env.WAREHOUSE_SCOPE_ENABLED = prior;
    }
  });

  it("bounded keyset pages cover all rows without duplicates", async () => {
    const all = (await listStockOverview(owner(A))).items;
    const seen: string[] = [];
    let after: string | undefined;
    for (let n = 0; n < 20; n++) {
      const page = await listStockOverview(owner(A), { limit: 1, ...(after ? { after } : {}) });
      expect(page.items).toHaveLength(1);
      seen.push(...page.items.map((r) => `${r.warehouseId}:${r.itemId}`));
      if (page.next === null) break;
      after = page.next;
    }
    expect(seen).toEqual(all.map((r) => `${r.warehouseId}:${r.itemId}`));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("search treats wildcard characters literally and filters item/warehouse names", async () => {
    expect((await listStockOverview(owner(A), { q: "%_" })).items.map((r) => r.itemId)).toEqual([kgItem, kgItem]);
    expect((await listStockOverview(owner(A), { q: "Hammadde" })).items).toHaveLength(1);
    expect((await listStockOverview(owner(A), { q: "missing-903" })).items).toEqual([]);
    expect((await listStockOverview(owner(A), { q: "' OR 1=1 --" })).items).toEqual([]);
  });

  it("rejects malformed cursors, filters and unbounded limits", async () => {
    for (const input of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { after: "bad" }, { after: `${randomUUID()}:bad` }, { warehouseId: "bad" }, { q: "x".repeat(129) }]) {
      await expect(listStockOverview(owner(A), input)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });
});
