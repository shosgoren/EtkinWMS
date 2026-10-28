// T-1116 (B-176): ürün kartı sekme okumaları — kutular (eldeki / ayrılmış / kullanılabilir), Stok ve yer pivotu, Hareketler, Takip ve
// Değişiklik geçmişi (audit kayıt süzgeci). Gerçek PG; stok domain belgesiyle (createStockDocument → onay → işleme) kurulur.
// Negatif: B tenant'ı A ürününün hiçbir satırını görmez (I-01..I-03), kimliksiz / MFA'sız çağrı reddedilir, depo kapsamı süzer,
// audit süzgeci `audit.view` ister ve yarım süzgeç reddedilir.
import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import { listAudit } from "../../../packages/domain/src/audit/audit-query.ts";
import { createItem, createLot, updateItem } from "../../../packages/domain/src/catalog/index.ts";
import {
  approveDocument,
  createStockDocument,
  getItemStockCard,
  getItemStockPivot,
  listItemMoves,
  listItemTracking,
  postDocument,
  type DocumentLineInput,
} from "../../../packages/domain/src/stock/index.ts";
import { createWarehouse, setMembershipWarehouseScopes } from "../../../packages/domain/src/warehouse/index.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let B: TenantWorld;
let lotItem: string;
let lot1: string;
let lot2: string;
let palet: string;
let koli1: string;
let koli2: string;
let second: string;
let secondLoc: string;
const owner = (w: TenantWorld) => ({ db: app, principal: { userId: w.ownerUserId, mfaVerified: true }, tenantSlug: w.slug });
const picker = () => ({ ...owner(A), principal: { userId: A.memberUserId, mfaVerified: true } });
const cmd = () => ({ ...owner(A), clientKey: randomUUID(), retry: { sleep: async () => undefined } });

async function stockIn(warehouseId: string, lines: readonly Omit<DocumentLineInput, "itemId" | "unitId" | "conversionFactor" | "baseQuantity">[]) {
  const result = await createStockDocument(cmd(), {
    kind: "STOCK_IN",
    warehouseId,
    lines: lines.map((l) => ({ ...l, itemId: lotItem, unitId: A.unitId, conversionFactor: "1", baseQuantity: l.quantity })),
  });
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
  A = await seedWorld(adm, reg, "A1116");
  B = await seedWorld(adm, reg, "B1116");
  lotItem = (await createItem(owner(A), { code: "LT-1116", name: "Lotlu 1116", baseUnitId: A.unitId, trackingMode: "LOT", quantityScale: 3 })).itemId;
  await updateItem(owner(A), { itemId: lotItem, name: "Lotlu 1116 b" });
  lot1 = (await createLot(owner(A), { itemId: lotItem, lotCode: "LA-1", productionDate: "2026-01-02", expiryDate: "2027-03-04" })).lotId;
  lot2 = (await createLot(owner(A), { itemId: lotItem, lotCode: "LA-2" })).lotId;
  palet = randomUUID();
  koli1 = randomUUID();
  koli2 = randomUUID();
  await adm.query("INSERT INTO public.handling_units (tenant_id, id, kind, code, location_id) VALUES ($1, $2, 'PALET', 'PLT-1116', $3)", [A.tenantId, palet, A.rootLocationId]);
  await adm.query(
    "INSERT INTO public.handling_units (tenant_id, id, kind, code, parent_id, location_id) VALUES ($1, $2, 'KOLI', 'KOL-1116-A', $4, $5), ($1, $3, 'KOLI', 'KOL-1116-B', NULL, $5)",
    [A.tenantId, koli1, koli2, palet, A.rootLocationId],
  );
  second = (await createWarehouse(owner(A), { code: "S1116", name: "Şube 1116" })).warehouseId;
  secondLoc = randomUUID();
  await adm.query("INSERT INTO public.locations (tenant_id,id,warehouse_id,code,name,depth,kind) VALUES ($1,$2,$3,'S-1','Raf',0,'STORAGE')", [A.tenantId, secondLoc, second]);
  await stockIn(A.warehouseId, [
    { targetLocationId: A.rootLocationId, lotId: lot1, handlingUnitId: koli1, quantity: "5.5" },
    { targetLocationId: A.rootLocationId, lotId: lot1, handlingUnitId: palet, quantity: "2" },
    { targetLocationId: A.rootLocationId, lotId: lot1, handlingUnitId: koli2, quantity: "0.125" },
    { targetLocationId: A.childLocationId, lotId: lot2, quantity: "1.25", stockStatus: "QUARANTINE" },
  ]);
  await stockIn(second, [{ targetLocationId: secondLoc, lotId: lot2, quantity: "3" }]);
}, 180_000);

afterAll(async () => {
  await adm.end();
  await app.close();
});

describe("T-1116 ürün kartı kutuları", () => {
  it("eldeki, ayrılmış ve kullanılabilir decimal kesin; kullanılabilir yalnız kural 5 boyutları", async () => {
    // Fikstür: takipsiz ürün 10 adet, 4'ü rezerve (Z1, STORAGE, AVAILABLE).
    const none = await getItemStockCard(owner(A), A.itemNoneId);
    expect(none).toMatchObject({ have: "10.000000", reserved: "4.000000", available: "6.000000" });
    const lots = await getItemStockCard(owner(A), lotItem);
    // 5.5 + 2 + 0.125 + 1.25 (karantina) + 3 (şube) = 11.875; karantina kullanılabilir değildir.
    expect(lots).toMatchObject({ have: "11.875000", reserved: "0.000000", available: "10.625000" });
  });

  it("B tenant'ı A ürününü göremez; kimliksiz ve MFA'sız çağrı reddedilir", async () => {
    expect(await getItemStockCard(owner(B), lotItem)).toMatchObject({ have: "0", reserved: "0", available: "0", places: [], moves: [] });
    await expect(getItemStockCard({ ...owner(A), principal: null }, lotItem)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(getItemStockCard({ ...owner(A), principal: { userId: A.ownerUserId, mfaVerified: false } }, lotItem)).rejects.toMatchObject({ code: "FORBIDDEN", detail: "MFA_REQUIRED" });
    await expect(getItemStockCard({ ...owner(A), principal: { userId: B.ownerUserId, mfaVerified: true } }, lotItem)).rejects.toBeInstanceOf(AppError);
  });
});

describe("T-1116 Stok ve yer pivotu", () => {
  it("depo › raf yeri › lot › palet › koli satırları SKT ve durumla; decimal dizgi", async () => {
    const { rows, truncated } = await getItemStockPivot(owner(A), lotItem);
    expect(truncated).toBe(false);
    expect(rows).toHaveLength(5);
    const k1 = rows.find((r) => r.unitId === koli1);
    expect(k1).toMatchObject({
      warehouseId: A.warehouseId,
      locationId: A.rootLocationId,
      lotId: lot1,
      lotCode: "LA-1",
      productionDate: "2026-01-02",
      expiryDate: "2027-03-04",
      unitKind: "KOLI",
      parentId: palet,
      parentCode: "PLT-1116",
      parentKind: "PALET",
      status: "AVAILABLE",
      quantity: "5.500000",
      reserved: "0.000000",
    });
    expect(rows.find((r) => r.unitId === palet)).toMatchObject({ unitKind: "PALET", parentId: null, quantity: "2.000000" });
    expect(rows.find((r) => r.unitId === koli2)).toMatchObject({ unitKind: "KOLI", parentId: null, quantity: "0.125000" });
    expect(rows.find((r) => r.locationId === A.childLocationId)).toMatchObject({ lotId: lot2, unitId: null, status: "QUARANTINE", quantity: "1.250000" });
    expect(rows.find((r) => r.warehouseId === second)).toMatchObject({ warehouseName: "Şube 1116", lotCode: "LA-2", quantity: "3.000000" });
  });

  it("B tenant'ı ve kimliksiz çağrı A pivotuna erişemez; geçersiz kimlik reddedilir", async () => {
    expect((await getItemStockPivot(owner(B), lotItem)).rows).toEqual([]);
    await expect(getItemStockPivot({ ...owner(A), principal: null }, lotItem)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(getItemStockPivot(owner(A), "bad")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("depo kapsamı pivotu, kutuları, hareketleri ve lot miktarlarını süzer", async () => {
    await setMembershipWarehouseScopes({ ...owner(A), recentAuth: async () => undefined }, { membershipId: A.memberMembershipId, warehouseIds: [A.warehouseId] });
    const prior = process.env.WAREHOUSE_SCOPE_ENABLED;
    try {
      process.env.WAREHOUSE_SCOPE_ENABLED = "true";
      const pivot = await getItemStockPivot(picker(), lotItem);
      expect(pivot.rows.length).toBe(4);
      expect(pivot.rows.every((r) => r.warehouseId === A.warehouseId)).toBe(true);
      expect(await getItemStockCard(picker(), lotItem)).toMatchObject({ have: "8.875000", available: "7.625000" });
      const moves = await listItemMoves(picker(), lotItem);
      expect(moves.total).toBe(1);
      const tr = await listItemTracking(picker(), lotItem);
      expect(tr.lots.find((l) => l.id === lot2)?.quantity).toBe("1.250000");
    } finally {
      if (prior === undefined) delete process.env.WAREHOUSE_SCOPE_ENABLED;
      else process.env.WAREHOUSE_SCOPE_ENABLED = prior;
    }
  });
});

describe("T-1116 Hareketler ve Takip", () => {
  it("hareketler belge başına en yeni önce, toplam sayıyla; sınır doğrulanır", async () => {
    const page = await listItemMoves(owner(A), lotItem);
    expect(page.total).toBe(2);
    expect(page.moves).toHaveLength(2);
    expect(page.moves[0]).toMatchObject({ kind: "STOCK_IN", net: "3.000000" });
    expect(page.moves[1]).toMatchObject({ kind: "STOCK_IN", net: "8.875000" });
    expect((await listItemMoves(owner(A), lotItem, { limit: 1 })).moves).toHaveLength(1);
    for (const limit of [0, 101, 1.5]) await expect(listItemMoves(owner(A), lotItem, { limit })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("B tenant'ı A ürününün hareket ve lotlarını görmez", async () => {
    expect(await listItemMoves(owner(B), lotItem)).toEqual({ moves: [], total: 0 });
    expect(await listItemTracking(owner(B), lotItem)).toEqual({ lots: [], serials: [], lotTotal: 0, serialTotal: 0 });
    await expect(listItemTracking({ ...owner(A), principal: null }, lotItem)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("lotlar SKT'si yakın önce, eldeki miktarla; seriler raf yeriyle", async () => {
    const tr = await listItemTracking(owner(A), lotItem);
    expect(tr.lotTotal).toBe(2);
    expect(tr.lots.map((l) => l.lotCode)).toEqual(["LA-1", "LA-2"]);
    expect(tr.lots[0]).toMatchObject({ expiryDate: "2027-03-04", productionDate: "2026-01-02", quantity: "7.625000" });
    expect(tr.lots[1]).toMatchObject({ expiryDate: null, quantity: "4.250000" });
    // Fikstür: seri ürünü (LOT_AND_SERIAL) SN1, Z1-R1'de 1 adet.
    const sn = await listItemTracking(owner(A), A.itemId);
    expect(sn.serialTotal).toBe(1);
    expect(sn.serials[0]).toMatchObject({ serialNo: "SN1", lotCode: "L1", locationCode: "Z1-R1" });
  });
});

describe("T-1116 Değişiklik geçmişi (audit kayıt süzgeci)", () => {
  it("yalnız bu ürünün kayıtları; yetki ve tenant sınırı aynı", async () => {
    const page = await listAudit(owner(A), { filters: { entityType: "item", entityId: lotItem } });
    expect(page.items.map((r) => r.action)).toEqual(["item.updated", "item.created"]);
    expect(page.items.every((r) => r.entityType === "item" && r.entityId === lotItem)).toBe(true);
    expect((await listAudit(owner(B), { filters: { entityType: "item", entityId: lotItem } })).items).toEqual([]);
    await expect(listAudit(picker(), { filters: { entityType: "item", entityId: lotItem } })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("yarım ya da bozuk süzgeç reddedilir", async () => {
    for (const filters of [{ entityType: "item" }, { entityId: lotItem }, { entityType: "Item;", entityId: lotItem }, { entityType: "item", entityId: "" }, { entityType: "item", entityId: "x".repeat(129) }]) {
      await expect(listAudit(owner(A), { filters })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });
});
