// T-969 (B-86): OKUT kod çözme sorgusu `resolveFieldScan` (stock.view). Gerçek wms_app bağlantısı + RLS; fikstür yalnızca
// DATABASE_URL_DIRECT ile (sentetik, G-09). Ürün barkodu / ürün kodu / açık teslim / teslim numarası / lokasyon, bilinmeyen kod,
// başka kiracının kodu (görünmez: `unknown`), depo kapsamı ve girdi doğrulaması.
import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import { createWarehouse, setMembershipWarehouseScopes } from "../../../packages/domain/src/warehouse/index.ts";
import { createInboundReceipt, openInboundReceipt, resolveFieldScan } from "../../../packages/domain/src/operations/index.ts";
import type { StockDocCallParams } from "../../../packages/domain/src/stock/index.ts";
import { newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();
let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let B: TenantWorld;

const NO_WAIT = { sleep: async () => undefined } as const;
const hex = (n: number): string => randomUUID().replaceAll("-", "").slice(0, n).toUpperCase();
const owner = (w: TenantWorld) => ({ db: app, principal: { userId: w.ownerUserId, mfaVerified: true }, tenantSlug: w.slug });
const member = (w: TenantWorld) => ({ db: app, principal: { userId: w.memberUserId, mfaVerified: true }, tenantSlug: w.slug });
const cmd = (w: TenantWorld): StockDocCallParams => ({ ...owner(w), clientKey: randomUUID(), retry: NO_WAIT });

async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await adm.query<T>(text, params)).rows;
}
async function mkItem(w: TenantWorld, code = `FS-${hex(10)}`): Promise<string> {
  const id = randomUUID();
  await q("INSERT INTO public.items (tenant_id, id, code, name, base_unit_id, tracking_mode, quantity_scale) VALUES ($1,$2,$3,'T969 urun',$4,'NONE',0)", [w.tenantId, id, code, w.unitId]);
  return id;
}
async function mkBarcode(w: TenantWorld, itemId: string, barcode: string): Promise<void> {
  await q("INSERT INTO public.item_barcodes (tenant_id, id, item_id, barcode) VALUES ($1, gen_random_uuid(), $2, $3)", [w.tenantId, itemId, barcode]);
}
async function mkLoc(w: TenantWorld, warehouseId: string, code: string): Promise<string> {
  const id = randomUUID();
  await q("INSERT INTO public.locations (tenant_id, id, warehouse_id, parent_id, code, name, depth, kind) VALUES ($1,$2,$3,NULL,$4,'T969 raf',0,'STORAGE')", [w.tenantId, id, warehouseId, code]);
  return id;
}
async function mkReceipt(w: TenantWorld, warehouseId: string, itemId: string): Promise<{ id: string; number: string }> {
  const c = await createInboundReceipt(cmd(w), { warehouseId, lines: [{ itemId, unitId: w.unitId, expectedQuantity: "5" }] });
  const id = c.documentId as string;
  await openInboundReceipt(cmd(w), { receiptId: id, expectedVersion: 1 });
  const row = (await q<{ number: string }>("SELECT number FROM public.inbound_receipts WHERE id = $1", [id]))[0];
  return { id, number: row?.number ?? "" };
}
async function failure(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error("expected rejection");
}

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  A = await seedWorld(adm, reg, "A969");
  B = await seedWorld(adm, reg, "B969");
}, 120_000);

afterAll(async () => {
  await adm.end();
  await app.close();
}, 60_000);

describe("resolveFieldScan", () => {
  it("ürün barkodu → ürün; bekleyen kabul yoksa teslim null, açık teslim varsa o teslim (kabul işi)", async () => {
    const item = await mkItem(A);
    const barcode = `869${hex(9).replace(/\D/g, "1")}`;
    await mkBarcode(A, item, barcode);
    const before = await resolveFieldScan(member(A), { code: barcode });
    expect(before).toMatchObject({ kind: "item", itemId: item, itemName: "T969 urun", receipt: null });
    const r = await mkReceipt(A, A.warehouseId, item);
    const after = await resolveFieldScan(member(A), { code: ` ${barcode} ` });
    expect(after).toMatchObject({ kind: "item", itemId: item, receipt: { id: r.id, number: r.number } });
  });

  it("ürün kodu (barkodsuz, küçük harfle okutulsa da) → ürün", async () => {
    const code = `FS-${hex(8)}`;
    const item = await mkItem(A, code);
    expect(await resolveFieldScan(member(A), { code: code.toLowerCase() })).toMatchObject({ kind: "item", itemId: item, itemCode: code });
  });

  it("açık teslim numarası → teslim", async () => {
    const item = await mkItem(A);
    const r = await mkReceipt(A, A.warehouseId, item);
    expect(await resolveFieldScan(member(A), { code: r.number })).toEqual({ kind: "receipt", receipt: { id: r.id, number: r.number } });
  });

  it("raf / konum kodu → lokasyon (depo kimliğiyle)", async () => {
    const code = `R-${hex(8)}`;
    const loc = await mkLoc(A, A.warehouseId, code);
    expect(await resolveFieldScan(member(A), { code: code.toLowerCase() })).toEqual({ kind: "location", locationId: loc, warehouseId: A.warehouseId, code, name: "T969 raf" });
  });

  it("bilinmeyen kod → unknown/not_found (hata değil)", async () => {
    expect(await resolveFieldScan(member(A), { code: `YOK-${hex(12)}` })).toEqual({ kind: "unknown", reason: "not_found" });
  });

  it("başka kiracının barkodu, ürün kodu, teslim numarası ve rafı görünmez (unknown)", async () => {
    const itemCode = `FSB-${hex(8)}`;
    const bItem = await mkItem(B, itemCode);
    const bBarcode = `868${hex(9).replace(/\D/g, "2")}`;
    await mkBarcode(B, bItem, bBarcode);
    const bLoc = `RB-${hex(8)}`;
    await mkLoc(B, B.warehouseId, bLoc);
    const bReceipt = await mkReceipt(B, B.warehouseId, bItem);
    // B'nin kendisi görür (fikstür doğru).
    expect((await resolveFieldScan(member(B), { code: bBarcode })).kind).toBe("item");
    expect((await resolveFieldScan(member(B), { code: bLoc })).kind).toBe("location");
    for (const code of [bBarcode, itemCode, bLoc]) {
      expect(await resolveFieldScan(member(A), { code }), code).toEqual({ kind: "unknown", reason: "not_found" });
    }
    // Teslim numarası serisi kiracı başınadır: A'da aynı numara A'nın KENDİ teslimi olabilir; B'nin teslimi asla dönmez.
    const byNumber = await resolveFieldScan(member(A), { code: bReceipt.number });
    expect(byNumber.kind === "receipt" ? byNumber.receipt.id : null).not.toBe(bReceipt.id);
    if (byNumber.kind === "receipt") expect((await q<{ tenant_id: string }>("SELECT tenant_id FROM public.inbound_receipts WHERE id = $1", [byNumber.receipt.id]))[0]?.tenant_id).toBe(A.tenantId);
  });

  it("depo kapsamı: kapsam dışı depodaki raf ve teslim görünmez", async () => {
    const other = (await createWarehouse(owner(A), { code: `s${hex(8).toLowerCase()}`, name: "T969 ikinci depo" })).warehouseId;
    const code = `RO-${hex(8)}`;
    await mkLoc(A, other, code);
    const item = await mkItem(A);
    const r = await mkReceipt(A, other, item);
    await setMembershipWarehouseScopes({ ...owner(A), recentAuth: async () => undefined }, { membershipId: A.memberMembershipId, warehouseIds: [A.warehouseId] });
    const prev = process.env.WAREHOUSE_SCOPE_ENABLED;
    try {
      process.env.WAREHOUSE_SCOPE_ENABLED = "true";
      expect(await resolveFieldScan(member(A), { code })).toEqual({ kind: "unknown", reason: "not_found" });
      expect(await resolveFieldScan(member(A), { code: r.number })).toEqual({ kind: "unknown", reason: "not_found" });
      // Ürünün kendisi katalogdadır; kapsam dışı teslim ona bağlanmaz.
      expect(await resolveFieldScan(member(A), { code: (await q<{ code: string }>("SELECT code FROM public.items WHERE id = $1", [item]))[0]?.code ?? "" })).toMatchObject({ kind: "item", receipt: null });
      // Yönetici kapsamdan muaf.
      expect((await resolveFieldScan(owner(A), { code })).kind).toBe("location");
    } finally {
      if (prev === undefined) delete process.env.WAREHOUSE_SCOPE_ENABLED;
      else process.env.WAREHOUSE_SCOPE_ENABLED = prev;
      await setMembershipWarehouseScopes({ ...owner(A), recentAuth: async () => undefined }, { membershipId: A.memberMembershipId, all: true });
    }
  });

  it("girdi doğrulaması: boş, çok uzun, denetim karakterli kod VALIDATION_FAILED; üye olmayan NOT_FOUND", async () => {
    for (const code of ["", "   ", "x".repeat(257), "AB\u0007C"]) {
      expect((await failure(resolveFieldScan(member(A), { code }))).code, JSON.stringify(code)).toBe("VALIDATION_FAILED");
    }
    const outsider = { db: app, principal: { userId: B.memberUserId, mfaVerified: true }, tenantSlug: A.slug };
    expect((await failure(resolveFieldScan(outsider, { code: "X" }))).code).toBe("NOT_FOUND");
  });
});
