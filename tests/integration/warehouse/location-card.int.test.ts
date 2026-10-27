// T-1082: raf yeri kartı okuyucusu — içerik, yol, son hareketler; tenant / depo kapsamı / depo-lokasyon eşleşmesi (I-01…I-03, negatif).
import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { approveDocument, createStockDocument, postDocument } from "../../../packages/domain/src/stock/index.ts";
import { createWarehouse, getLocationCard, setMembershipWarehouseScopes } from "../../../packages/domain/src/warehouse/index.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let B: TenantWorld;
let secondWarehouse: string;
let secondLocation: string;
let kgItem: string;
let kgUnit: string;
const owner = (w: TenantWorld) => ({ db: app, principal: { userId: w.ownerUserId, mfaVerified: true }, tenantSlug: w.slug });
const picker = () => ({ ...owner(A), principal: { userId: A.memberUserId, mfaVerified: true } });
const cmd = () => ({ ...owner(A), clientKey: randomUUID(), retry: { sleep: async () => undefined } });

async function stockIn(warehouseId: string, locationId: string, amount: string) {
  const result = await createStockDocument(cmd(), { kind: "STOCK_IN", warehouseId, lines: [{ itemId: kgItem, unitId: kgUnit, targetLocationId: locationId, quantity: amount, baseQuantity: amount, conversionFactor: "1", stockStatus: "AVAILABLE" }] });
  const documentId = result.documentId as string;
  await approveDocument(cmd(), { documentId, expectedVersion: 1 });
  await postDocument(cmd(), { documentId, expectedVersion: 2 });
  return documentId;
}

let inDoc: string;

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  const reg = newRegistry();
  A = await seedWorld(adm, reg, "A1082");
  B = await seedWorld(adm, reg, "B1082");
  kgUnit = randomUUID();
  kgItem = randomUUID();
  await adm.query("INSERT INTO public.units (tenant_id,id,code,name) VALUES ($1,$2,'KG','Kilogram')", [A.tenantId, kgUnit]);
  await adm.query("INSERT INTO public.items (tenant_id,id,code,name,base_unit_id,tracking_mode,quantity_scale) VALUES ($1,$2,'K-1082','Kauçuk',$3,'NONE',6)", [A.tenantId, kgItem, kgUnit]);
  inDoc = await stockIn(A.warehouseId, A.childLocationId, "2.500001");
  secondWarehouse = (await createWarehouse(owner(A), { code: "H1082", name: "Hammadde" })).warehouseId;
  secondLocation = randomUUID();
  await adm.query("INSERT INTO public.locations (tenant_id,id,warehouse_id,code,name,depth,kind) VALUES ($1,$2,$3,'R1','Raf',0,'STORAGE')", [A.tenantId, secondLocation, secondWarehouse]);
  await stockIn(secondWarehouse, secondLocation, "7");
}, 120_000);

afterAll(async () => {
  await adm.end();
  await app.close();
});

describe("location card", () => {
  it("returns identity, parent path, exact decimal contents and the last moves of that location only", async () => {
    const card = await getLocationCard(owner(A), { warehouseId: A.warehouseId, locationId: A.childLocationId });
    expect(card.location).toMatchObject({ id: A.childLocationId, warehouseId: A.warehouseId, status: "ACTIVE" });
    expect(card.path.map((p) => p.id)).toEqual([A.rootLocationId]);
    expect(card.contents.find((c) => c.itemId === kgItem)).toEqual({ itemId: kgItem, itemCode: "K-1082", itemName: "Kauçuk", unitCode: "KG", physical: "2.500001", reserved: "0.000000" });
    expect(card.contentsMore).toBe(false);
    const move = card.moves.find((mv) => mv.documentId === inDoc);
    expect(move).toMatchObject({ kind: "STOCK_IN", net: "2.500001", items: "K-1082" });
    // Başka raftaki stok ve hareket bu karta girmez.
    expect(card.contents.every((c) => c.physical !== "7.000000")).toBe(true);
    const root = await getLocationCard(owner(A), { warehouseId: A.warehouseId, locationId: A.rootLocationId });
    expect(root.path).toEqual([]);
    expect(root.moves.some((mv) => mv.documentId === inDoc)).toBe(false);
  });

  it("I-01/I-02: another tenant, a location of another warehouse and unknown ids are all NOT_FOUND", async () => {
    await expect(getLocationCard(owner(B), { warehouseId: A.warehouseId, locationId: A.childLocationId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getLocationCard(owner(A), { warehouseId: B.warehouseId, locationId: B.rootLocationId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getLocationCard(owner(A), { warehouseId: A.warehouseId, locationId: secondLocation })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getLocationCard(owner(A), { warehouseId: A.warehouseId, locationId: B.rootLocationId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getLocationCard(owner(A), { warehouseId: A.warehouseId, locationId: randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("authentication, MFA and malformed ids are rejected", async () => {
    await expect(getLocationCard({ ...owner(A), principal: null }, { warehouseId: A.warehouseId, locationId: A.childLocationId })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(getLocationCard({ ...owner(A), principal: { userId: A.ownerUserId, mfaVerified: false } }, { warehouseId: A.warehouseId, locationId: A.childLocationId })).rejects.toMatchObject({ code: "FORBIDDEN", detail: "MFA_REQUIRED" });
    for (const input of [{ warehouseId: "bad", locationId: A.childLocationId }, { warehouseId: A.warehouseId, locationId: "bad" }, { warehouseId: A.warehouseId, locationId: "" }]) {
      await expect(getLocationCard(owner(A), input)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });

  it("I-03: a warehouse-scoped member cannot open a location outside the scope", async () => {
    await setMembershipWarehouseScopes({ ...owner(A), recentAuth: async () => undefined }, { membershipId: A.memberMembershipId, warehouseIds: [A.warehouseId] });
    const prior = process.env.WAREHOUSE_SCOPE_ENABLED;
    try {
      process.env.WAREHOUSE_SCOPE_ENABLED = "true";
      expect((await getLocationCard(picker(), { warehouseId: A.warehouseId, locationId: A.childLocationId })).location.id).toBe(A.childLocationId);
      await expect(getLocationCard(picker(), { warehouseId: secondWarehouse, locationId: secondLocation })).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect((await getLocationCard(owner(A), { warehouseId: secondWarehouse, locationId: secondLocation })).contents[0]?.physical).toBe("7.000000");
    } finally {
      if (prior === undefined) delete process.env.WAREHOUSE_SCOPE_ENABLED;
      else process.env.WAREHOUSE_SCOPE_ENABLED = prior;
    }
  });
});
