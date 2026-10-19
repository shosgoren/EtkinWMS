// T-422: hesap sahibi / depo yöneticisi panosu — sayılar gerçek tablo durumlarından gelir (satın alma/kritik stok, bekleyen sipariş,
// görev halkası, ekip). GERÇEK roller (wms_app, pooler); fikstür yalnızca DATABASE_URL_DIRECT ile. Fikstürler sentetiktir (G-09).
import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { getBoardAt } from "../../../packages/domain/src/operations/board.ts";
import { createStockDocument, approveDocument, postDocument, type StockDocCallParams } from "../../../packages/domain/src/stock/index.ts";
import { mkMembership, mkUser, newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();
let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let PICKER: { userId: string; membershipId: string };

const uuid = (): string => randomUUID();
const hex = (n: number): string => uuid().replaceAll("-", "").slice(0, n);
const callP = (userId: string): StockDocCallParams => ({ db: app, principal: { userId, mfaVerified: true }, tenantSlug: A.slug, clientKey: uuid(), retry: { sleep: async () => undefined } });
const ownerP = (): StockDocCallParams => callP(A.ownerUserId);
async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await adm.query<T>(text, params)).rows;
}
async function mkItem(name: string): Promise<string> {
  const id = uuid();
  await q("INSERT INTO public.items (tenant_id, id, code, name, base_unit_id, tracking_mode, quantity_scale) VALUES ($1,$2,$3,$4,$5,'NONE',0)", [A.tenantId, id, `I-${hex(10)}`, name, A.unitId]);
  return id;
}
async function mkLoc(): Promise<string> {
  const id = uuid();
  await q("INSERT INTO public.locations (tenant_id, id, warehouse_id, parent_id, code, name, depth, kind) VALUES ($1,$2,$3,NULL,$4,'T422 lok',0,'STORAGE')", [A.tenantId, id, A.warehouseId, `L-${hex(10)}`]);
  return id;
}
async function stockIn(item: string, loc: string, qty: string): Promise<void> {
  const c = await createStockDocument(ownerP(), {
    kind: "STOCK_IN",
    warehouseId: A.warehouseId,
    lines: [{ itemId: item, unitId: A.unitId, quantity: qty, conversionFactor: "1", baseQuantity: qty, targetLocationId: loc, stockStatus: "AVAILABLE" }],
  });
  const id = c.documentId as string;
  await approveDocument(ownerP(), { documentId: id, expectedVersion: 1 });
  const v = (await q<{ version: number }>("SELECT version FROM public.documents WHERE id = $1", [id]))[0] as { version: number };
  await postDocument(ownerP(), { documentId: id, expectedVersion: v.version });
}

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  A = await seedWorld(adm, reg, "A422");
  const p = await mkUser(adm, reg, "A422 picker");
  PICKER = { userId: p, membershipId: await mkMembership(adm, A.tenantId, p, { roles: ["PICKER"] }) };
}, 120_000);

afterAll(async () => {
  await adm.end();
  await app.close();
}, 60_000);

describe("T-422 yönetici panosu", () => {
  it("minimum altı ürünler satın almada, çok altındakiler kritik; bekleyen sipariş ve görev halkası gerçek sayılarla", async () => {
    const before = await getBoardAt(ownerP(), new Date());
    const L = await mkLoc();
    const low = await mkItem("T422 az");
    const crit = await mkItem("T422 kritik");
    const ok = await mkItem("T422 yeterli");
    await stockIn(low, L, "60");
    await stockIn(crit, L, "10");
    await stockIn(ok, L, "500");
    for (const [item, min, max] of [[low, "100", "200"], [crit, "100", "100"], [ok, "100", "300"]] as const) {
      await q("INSERT INTO public.item_stock_policies (tenant_id, id, warehouse_id, item_id, min_quantity, max_quantity) VALUES ($1, gen_random_uuid(), $2, $3, $4, $5)", [A.tenantId, A.warehouseId, item, min, max]);
    }
    // Açık kalemi olan sipariş sayılır; tamamı sevk edilmiş satırı olan sipariş sayılmaz.
    const o1 = uuid();
    const o2 = uuid();
    await q("INSERT INTO public.sales_orders (tenant_id, id, number, customer_ref, created_by, created_at) VALUES ($1,$2,$3,'T422 Müşteri',$4, now() - interval '3 days')", [A.tenantId, o1, `S-${hex(8)}`, A.ownerUserId]);
    await q("INSERT INTO public.sales_order_lines (tenant_id, order_id, line_no, item_id, requested_quantity) VALUES ($1,$2,1,$3,5)", [A.tenantId, o1, low]);
    await q("INSERT INTO public.sales_orders (tenant_id, id, number, created_by) VALUES ($1,$2,$3,$4)", [A.tenantId, o2, `S-${hex(8)}`, A.ownerUserId]);
    await q("INSERT INTO public.sales_order_lines (tenant_id, order_id, line_no, item_id, requested_quantity, shipped_quantity) VALUES ($1,$2,1,$3,5,5)", [A.tenantId, o2, low]);
    // Görevler: biri açık, biri toplayıcıya atanmış.
    await q("INSERT INTO public.warehouse_tasks (tenant_id, warehouse_id, kind, location_id, item_id, quantity) VALUES ($1,$2,'PUTAWAY',$3,$4,2)", [A.tenantId, A.warehouseId, L, low]);
    await q("INSERT INTO public.warehouse_tasks (tenant_id, warehouse_id, kind, status, assigned_membership_id) VALUES ($1,$2,'PICK','ASSIGNED',$3)", [A.tenantId, A.warehouseId, PICKER.membershipId]);

    const b = await getBoardAt(ownerP(), new Date());
    const ids = b.buy.map((x) => x.itemId);
    expect(ids).toContain(low);
    expect(ids).toContain(crit);
    expect(ids).not.toContain(ok);
    expect(b.buyCount - before.buyCount).toBe(2);
    expect(b.criticalCount - before.criticalCount).toBe(1);
    expect(b.buy.find((x) => x.itemId === crit)?.critical).toBe(true);
    expect(b.buy.find((x) => x.itemId === low)).toMatchObject({ have: "60", min: "100", suggest: "140", critical: false });
    expect(b.buy.find((x) => x.itemId === crit)?.suggest).toBe("190"); // max = min → min × 2 − eldeki
    expect(b.orderCount - before.orderCount).toBe(1);
    expect(b.oldestOrderDays).toBeGreaterThanOrEqual(3);
    expect(b.tasks.unassigned - before.tasks.unassigned).toBe(1);
    expect(b.tasks.assigned - before.tasks.assigned).toBe(1);
    expect(b.todo.some((x) => x.kind === "PUTAWAY" && x.itemName === "T422 az")).toBe(true);
    const picker = b.team.find((x) => x.membershipId === PICKER.membershipId);
    expect(picker).toMatchObject({ state: "ASSIGNED", assigned: 1, roles: ["PICKER"] });
    expect(b.localHour).toBeGreaterThanOrEqual(0);
    expect(b.localHour).toBeLessThanOrEqual(23);
  });

  it("geçersiz zaman reddedilir", async () => {
    await expect(getBoardAt(ownerP(), new Date(Number.NaN))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});
