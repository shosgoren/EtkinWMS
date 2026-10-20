// T-977: saha toplama / sayım okumaları `getPickWork` ve `findFieldWork` (salt okuma). Gerçek wms_app bağlantısı + RLS; fikstür DATABASE_URL_DIRECT
// (sentetik, G-09). Kapsam: kart alanları ve sıradaki toplama, izin süzgeci (PICK → stock.post, COUNT → document.create), atama görünürlüğü (başkasına
// atanmış görev yalnız onay yetkisine), başka kiracı (görünmez), depo kapsamı (A-46), oturum durumu (iptal edilen sayım görünmez), çift gönderim (aynı
// anahtarla toplama tekrarı tek etki; ardından iş yönlendirmesi kapanır), okumaların stok/görev yazmadığı ve girdi doğrulaması.
import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import { addBarcode } from "../../../packages/domain/src/catalog/index.ts";
import {
  assignTask,
  cancelCount,
  confirmPick,
  createCountTasks,
  createPickAssignment,
  createSalesOrder,
  findFieldWork,
  getPickWork,
  reserveOrder,
  startCount,
} from "../../../packages/domain/src/operations/index.ts";
import { approveDocument, createStockDocument, postDocument, type StockDocCallParams } from "../../../packages/domain/src/stock/index.ts";
import { createLocation, createWarehouse, setMembershipWarehouseScopes } from "../../../packages/domain/src/warehouse/index.ts";
import { mkMembership, mkUser, newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();
let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let B: TenantWorld;
let MGR: string;
let COUNTER: string;
let PICKER2: { userId: string; membershipId: string };

const NO_WAIT = { sleep: async () => undefined } as const;
const hex = (n: number): string => randomUUID().replaceAll("-", "").slice(0, n).toUpperCase();
const as = (userId: string, w: TenantWorld = A) => ({ db: app, principal: { userId, mfaVerified: true }, tenantSlug: w.slug });
const cmd = (userId: string, w: TenantWorld = A, clientKey: string = randomUUID()): StockDocCallParams => ({ ...as(userId, w), clientKey, retry: NO_WAIT });
const owner = () => as(A.ownerUserId);
const picker = () => as(A.memberUserId);

async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await adm.query<T>(text, params)).rows;
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
async function mkItem(): Promise<string> {
  const id = randomUUID();
  await q("INSERT INTO public.items (tenant_id, id, code, name, base_unit_id, tracking_mode, quantity_scale) VALUES ($1,$2,$3,'T977 urun',$4,'NONE',0)", [A.tenantId, id, `FW-${hex(10)}`, A.unitId]);
  return id;
}
async function mkLoc(code: string, kind: "STORAGE" | "STAGING" = "STORAGE", warehouseId = A.warehouseId): Promise<string> {
  return (await createLocation(owner(), { warehouseId, code, name: `T977 ${code}`, kind })).locationId;
}
async function stockIn(item: string, loc: string, qty: string, warehouseId = A.warehouseId): Promise<void> {
  const c = await createStockDocument(cmd(A.ownerUserId), {
    kind: "STOCK_IN",
    warehouseId,
    lines: [{ itemId: item, unitId: A.unitId, quantity: qty, conversionFactor: "1", baseQuantity: qty, targetLocationId: loc, stockStatus: "AVAILABLE" }],
  });
  const id = c.documentId as string;
  await approveDocument(cmd(A.ownerUserId), { documentId: id, expectedVersion: 1 });
  const v = (await q<{ version: number }>("SELECT version FROM public.documents WHERE id = $1", [id]))[0] as { version: number };
  await postDocument(cmd(A.ownerUserId), { documentId: id, expectedVersion: v.version });
}
/** Sipariş → stok ayır → toplama görevi; görev kimliklerini lokasyon kodu sırasıyla döndürür. */
async function pickTasks(item: string, qty: string): Promise<{ orderId: string; taskIds: string[] }> {
  const orderId = (await createSalesOrder(cmd(A.ownerUserId), { customerRef: `T977 ${hex(4)}`, lines: [{ itemId: item, unitId: A.unitId, quantity: qty }] })).documentId as string;
  await reserveOrder(cmd(A.ownerUserId), { orderId });
  await createPickAssignment(cmd(A.ownerUserId), { orderIds: [orderId] });
  const rows = await q<{ id: string }>(
    "SELECT t.id FROM public.warehouse_tasks t JOIN public.locations l ON l.id = t.location_id WHERE t.tenant_id = $1 AND t.kind = 'PICK' AND t.source_id = $2 ORDER BY l.code, t.id",
    [A.tenantId, orderId],
  );
  return { orderId, taskIds: rows.map((r) => r.id) };
}
const versionOf = async (taskId: string): Promise<number> => Number((await q<{ version: number }>("SELECT version FROM public.warehouse_tasks WHERE id = $1", [taskId]))[0]?.version);

let STAGING_CODE = "";
beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  A = await seedWorld(adm, reg, "A977");
  B = await seedWorld(adm, reg, "B977");
  const m = await mkUser(adm, reg, "A977 manager");
  await mkMembership(adm, A.tenantId, m, { roles: ["WAREHOUSE_MANAGER"] });
  MGR = m;
  const c = await mkUser(adm, reg, "A977 counter");
  await mkMembership(adm, A.tenantId, c, { roles: ["COUNTER"] });
  COUNTER = c;
  const p = await mkUser(adm, reg, "A977 picker2");
  PICKER2 = { userId: p, membershipId: await mkMembership(adm, A.tenantId, p, { roles: ["PICKER"] }) };
  STAGING_CODE = `AA-SEVK-${hex(4)}`; // kodu en küçük STAGING (A-307-1): seçilen sevk alanı bu olur
  await mkLoc(STAGING_CODE, "STAGING");
}, 120_000);

afterAll(async () => {
  await adm.end();
  await app.close();
}, 60_000);

describe("getPickWork / findFieldWork (T-977)", () => {
  it("toplama kartı: ürün, raf, sevk alanı, sipariş ve sıradaki toplama; okuma stok ve görev yazmaz", async () => {
    const X = await mkItem();
    const r1 = `FW1-${hex(6)}`;
    const r2 = `FW2-${hex(6)}`;
    const R1 = await mkLoc(r1);
    const R2 = await mkLoc(r2);
    await stockIn(X, R1, "3");
    await stockIn(X, R2, "3");
    const { orderId, taskIds } = await pickTasks(X, "5");
    expect(taskIds).toHaveLength(2);
    const [t1, t2] = taskIds as [string, string];
    const v1 = await versionOf(t1);
    const before = await q("SELECT stock_dimension_id, quantity::text, reserved_quantity::text FROM public.stock_balances WHERE tenant_id = $1 ORDER BY stock_dimension_id", [A.tenantId]);
    const w = await getPickWork(picker(), { taskId: t1.toUpperCase() });
    expect(w).toMatchObject({
      task: { id: t1, status: "OPEN", assignedToMe: false },
      item: { id: X, name: "T977 urun" },
      location: { id: R1, code: r1 },
      staging: { code: STAGING_CODE },
      warehouse: { id: A.warehouseId },
      order: { id: orderId, status: "OPEN" },
      remaining: 1,
      nextTaskId: t2,
    });
    expect((await getPickWork(picker(), { taskId: t2 })).nextTaskId).toBe(t1);
    expect(await versionOf(t1)).toBe(v1);
    expect(await q("SELECT stock_dimension_id, quantity::text, reserved_quantity::text FROM public.stock_balances WHERE tenant_id = $1 ORDER BY stock_dimension_id", [A.tenantId])).toEqual(before);

    // OKUT yönlendirmesi: raf → o raftaki toplama; ürün → ürünün toplaması (bana atanmış yok: üstlenilebilir, mine=false).
    expect(await findFieldWork(picker(), { locationId: R1 })).toEqual({ pick: { taskId: t1, mine: false }, count: null });
    expect(taskIds).toContain((await findFieldWork(picker(), { itemId: X })).pick?.taskId);
  });

  it("atama görünürlüğü: başkasına atanmış görev toplayıcıya görünmez, atanan kişiye 'mine', yöneticiye (onay yetkisi) okunur", async () => {
    const X = await mkItem();
    const R = await mkLoc(`FWA-${hex(6)}`);
    await stockIn(X, R, "2");
    const { taskIds } = await pickTasks(X, "2");
    const t = taskIds[0] as string;
    await assignTask(owner(), { taskId: t, membershipId: PICKER2.membershipId, expectedVersion: await versionOf(t) });
    expect((await failure(getPickWork(picker(), { taskId: t }))).code).toBe("NOT_FOUND");
    expect(await findFieldWork(picker(), { locationId: R })).toEqual({ pick: null, count: null });
    expect((await getPickWork(as(PICKER2.userId), { taskId: t })).task).toMatchObject({ status: "ASSIGNED", assignedToMe: true });
    expect((await findFieldWork(as(PICKER2.userId), { itemId: X })).pick).toEqual({ taskId: t, mine: true });
    expect((await getPickWork(as(MGR), { taskId: t })).task.assignedToMe).toBe(false);
  });

  it("başka kiracı ve depo kapsamı: görev/raf/ürün görünmez (NOT_FOUND / boş)", async () => {
    const X = await mkItem();
    const R = await mkLoc(`FWS-${hex(6)}`);
    await stockIn(X, R, "1");
    const { taskIds } = await pickTasks(X, "1");
    const t = taskIds[0] as string;
    expect((await failure(getPickWork(as(B.ownerUserId, B), { taskId: t }))).code).toBe("NOT_FOUND");
    expect(await findFieldWork(as(B.ownerUserId, B), { locationId: R })).toEqual({ pick: null, count: null });
    expect(await findFieldWork(as(B.memberUserId, B), { itemId: X })).toEqual({ pick: null, count: null });

    const other = (await createWarehouse(owner(), { code: `w${hex(8).toLowerCase()}`, name: "T977 ikinci depo" })).warehouseId;
    await setMembershipWarehouseScopes({ ...owner(), recentAuth: async () => undefined }, { membershipId: A.memberMembershipId, warehouseIds: [other] });
    const prev = process.env.WAREHOUSE_SCOPE_ENABLED;
    try {
      process.env.WAREHOUSE_SCOPE_ENABLED = "true";
      expect((await failure(getPickWork(picker(), { taskId: t }))).code).toBe("NOT_FOUND");
      expect(await findFieldWork(picker(), { locationId: R })).toEqual({ pick: null, count: null });
      expect(await findFieldWork(picker(), { itemId: X })).toEqual({ pick: null, count: null });
    } finally {
      if (prev === undefined) delete process.env.WAREHOUSE_SCOPE_ENABLED;
      else process.env.WAREHOUSE_SCOPE_ENABLED = prev;
      await setMembershipWarehouseScopes({ ...owner(), recentAuth: async () => undefined }, { membershipId: A.memberMembershipId, all: true });
    }
  });

  it("çift gönderim: aynı anahtarla toplama tekrarı tek etki (replayed); görev kapanınca kart DONE, yönlendirme boşalır", async () => {
    const X = await mkItem();
    const code = `FWD-${hex(6)}`;
    const R = await mkLoc(code);
    await stockIn(X, R, "2");
    const barcode = `977${hex(9).replace(/\D/g, "7")}`;
    await addBarcode(owner(), { itemId: X, barcode, quantity: "1" });
    const { taskIds } = await pickTasks(X, "2");
    const t = taskIds[0] as string;
    const key = randomUUID();
    const input = { taskId: t, foundQuantity: "2", scannedLocationCode: code.toLowerCase(), scannedItemBarcode: barcode };
    const first = await confirmPick(cmd(A.memberUserId, A, key), input);
    const again = await confirmPick(cmd(A.memberUserId, A, key), input);
    expect(first.replayed).toBe(false);
    expect(again.replayed).toBe(true);
    expect(again.documentId).toBe(first.documentId);
    const moves = await q<{ c: string }>("SELECT count(*)::text AS c FROM public.documents WHERE tenant_id = $1 AND source_kind = 'TASK' AND source_id = $2", [A.tenantId, t]);
    expect(moves[0]?.c).toBe("1");
    expect((await getPickWork(picker(), { taskId: t })).task.status).toBe("DONE");
    expect(await findFieldWork(picker(), { locationId: R })).toEqual({ pick: null, count: null });
  });

  it("sayım: oturumlu açık COUNT görevi yalnız document.create sahibine döner; iptal edilen oturum görünmez", async () => {
    const Y = await mkItem();
    const R = await mkLoc(`FWC-${hex(6)}`);
    await stockIn(Y, R, "4");
    const sid = (await startCount(cmd(A.ownerUserId), { warehouseId: A.warehouseId, locationIds: [R] })).sessionId;
    const created = await createCountTasks(as(MGR), { sessionId: sid });
    const c = created.taskIds[0] as string;
    expect(await findFieldWork(as(COUNTER), { locationId: R })).toEqual({ pick: null, count: { taskId: c, mine: false } });
    // Toplayıcının (PICKER) sayım izni yok: sayım görevi hiç sorgulanmaz.
    expect((await findFieldWork(picker(), { locationId: R })).count).toBeNull();
    // Ürün okutmak sayıma yönlendirmez (sayım raf işidir).
    expect((await findFieldWork(as(COUNTER), { itemId: Y })).count).toBeNull();
    // Sayım görevi toplama kartı değildir.
    expect((await failure(getPickWork(as(MGR), { taskId: c }))).code).toBe("VALIDATION_FAILED");
    await cancelCount(cmd(A.ownerUserId), { sessionId: sid, reason: "T977 test" });
    expect((await findFieldWork(as(COUNTER), { locationId: R })).count).toBeNull();
  });

  it("girdi doğrulaması ve MFA: geçersiz kimlik VALIDATION_FAILED, MFA'sız sahip FORBIDDEN", async () => {
    expect((await failure(getPickWork(picker(), { taskId: "x" }))).code).toBe("VALIDATION_FAILED");
    expect((await failure(findFieldWork(picker(), { locationId: "x" }))).code).toBe("VALIDATION_FAILED");
    expect((await failure(findFieldWork(picker(), { itemId: "' OR 1=1 --" }))).code).toBe("VALIDATION_FAILED");
    expect((await failure(getPickWork(picker(), { taskId: randomUUID() }))).code).toBe("NOT_FOUND");
    const noMfa = { ...owner(), principal: { userId: A.ownerUserId, mfaVerified: false } };
    expect((await failure(findFieldWork(noMfa, { locationId: randomUUID() }))).code).toBe("FORBIDDEN");
  });
});
