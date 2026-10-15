// T-988: Akış ana ekranı "Görevlerim" özeti — bölüm sayıları gerçek tablo durumlarından gelir, depo kapsamı (A-46) uygulanır.
// GERÇEK roller (wms_app, pooler); fikstür yalnızca DATABASE_URL_DIRECT ile. Fikstürler sentetiktir (G-09).
import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { createCountTasks, startCount } from "../../../packages/domain/src/operations/index.ts";
import { getWorkSummaryAt, type WorkSummary } from "../../../packages/domain/src/operations/work-summary.ts";
import { approveDocument, createStockDocument, postDocument, type StockDocCallParams } from "../../../packages/domain/src/stock/index.ts";
import { mkMembership, mkUser, newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();
let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let COUNTER: { userId: string; membershipId: string };

const uuid = (): string => randomUUID();
const hex = (n: number): string => uuid().replaceAll("-", "").slice(0, n);
const callP = (userId: string): StockDocCallParams => ({ db: app, principal: { userId, mfaVerified: true }, tenantSlug: A.slug, clientKey: uuid(), retry: { sleep: async () => undefined } });
const ownerP = (): StockDocCallParams => callP(A.ownerUserId);
async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await adm.query<T>(text, params)).rows;
}
const section = (s: WorkSummary, key: string) => s.sections.find((x) => x.key === key);

async function mkItem(): Promise<string> {
  const id = uuid();
  await q("INSERT INTO public.items (tenant_id, id, code, name, base_unit_id, tracking_mode, quantity_scale) VALUES ($1,$2,$3,'T988 urun',$4,'NONE',0)", [A.tenantId, id, `I-${hex(10)}`, A.unitId]);
  return id;
}
async function mkLoc(warehouseId = A.warehouseId): Promise<string> {
  const id = uuid();
  await q("INSERT INTO public.locations (tenant_id, id, warehouse_id, parent_id, code, name, depth, kind) VALUES ($1,$2,$3,NULL,$4,'T988 lok',0,'STORAGE')", [A.tenantId, id, warehouseId, `L-${hex(10)}`]);
  return id;
}
async function mkReceipt(lines: { item: string; expected: string; received: string }[], warehouseId = A.warehouseId): Promise<void> {
  const id = uuid();
  await q("INSERT INTO public.inbound_receipts (tenant_id, id, warehouse_id, number, created_by, status) VALUES ($1,$2,$3,$4,$5,'OPEN')", [A.tenantId, id, warehouseId, `R-${hex(8)}`, A.ownerUserId]);
  let n = 1;
  for (const l of lines) {
    await q(
      "INSERT INTO public.inbound_receipt_lines (tenant_id, id, receipt_id, line_no, item_id, unit_id, conversion_factor, expected_quantity, received_quantity) VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, 1, $6, $7)",
      [A.tenantId, id, n++, l.item, A.unitId, l.expected, l.received],
    );
  }
}
async function postMove(item: string, from: string, to: string): Promise<void> {
  const c = await createStockDocument(ownerP(), {
    kind: "STOCK_MOVE",
    warehouseId: A.warehouseId,
    lines: [{ itemId: item, unitId: A.unitId, quantity: "1", conversionFactor: "1", baseQuantity: "1", sourceLocationId: from, targetLocationId: to }],
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
  A = await seedWorld(adm, reg, "A988");
  const c = await mkUser(adm, reg, "A988 counter");
  COUNTER = { userId: c, membershipId: await mkMembership(adm, A.tenantId, c, { roles: ["COUNTER"] }) };
}, 120_000);

afterAll(async () => {
  delete process.env.WAREHOUSE_SCOPE_ENABLED;
  await adm.end();
  await app.close();
}, 60_000);

describe("T-988 Görevlerim özeti", () => {
  it("açık teslim/kalem, bugün biten transfer ve sayım görevleri gerçek sayılarla; yerel saat ve tek depo adı döner", async () => {
    const before = await getWorkSummaryAt(ownerP(), new Date());
    const X = await mkItem();
    const Y = await mkItem();
    await mkReceipt([{ item: X, expected: "10", received: "0" }, { item: Y, expected: "5", received: "5" }]);
    const R1 = await mkLoc();
    const R2 = await mkLoc();
    // Sayım: iki raf, biri sayımcıya atanır, biri açık kalır.
    const sid = (await startCount(ownerP(), { warehouseId: A.warehouseId, locationIds: [R1] })).sessionId;
    await createCountTasks(ownerP(), { sessionId: sid, assigneeMembershipId: COUNTER.membershipId });
    const sid2 = (await startCount(ownerP(), { warehouseId: A.warehouseId, locationIds: [R2] })).sessionId;
    await createCountTasks(ownerP(), { sessionId: sid2 });

    const after = await getWorkSummaryAt(ownerP(), new Date());
    expect(section(after, "giris")?.open).toBe((section(before, "giris")?.open ?? 0) + 1);
    expect(section(after, "giris")?.openLines).toBe((section(before, "giris")?.openLines ?? 0) + 1); // yalnız eksik gelen satır
    expect(section(after, "sayim")?.open).toBe((section(before, "sayim")?.open ?? 0) + 2); // yönetici tüm açıkları görür
    expect(section(after, "uretim")?.open).toBe(0);
    expect(after.sections.map((s) => s.key)).toEqual(["giris", "cikis", "transfer", "uretim", "sayim"]);
    expect(after.localHour).toBeGreaterThanOrEqual(0);
    expect(after.localHour).toBeLessThanOrEqual(23);

    // Sayımcı: OPEN + kendisine atanan (ikisi de) görünür; başkasına atanmış görev sayılmaz.
    const other = await mkUser(adm, reg, "A988 other");
    const otherM = await mkMembership(adm, A.tenantId, other, { roles: ["COUNTER"] });
    const mine = await getWorkSummaryAt(callP(COUNTER.userId), new Date());
    const theirs = await getWorkSummaryAt(callP(other), new Date());
    expect((section(mine, "sayim")?.open ?? 0) - (section(theirs, "sayim")?.open ?? 0)).toBe(1);
    expect(otherM).toBeTruthy();

    // Bugün işlenen raf transferi (kaynaksız STOCK_MOVE) transfer bitenine yazılır.
    await q("UPDATE public.tenant_settings SET time_zone = 'UTC' WHERE tenant_id = $1", [A.tenantId]);
    const t0 = section(await getWorkSummaryAt(ownerP(), new Date()), "transfer")?.doneToday ?? 0;
    const src = await mkLoc();
    const dst = await mkLoc();
    const stockDoc = await createStockDocument(ownerP(), {
      kind: "STOCK_IN",
      warehouseId: A.warehouseId,
      lines: [{ itemId: X, unitId: A.unitId, quantity: "3", conversionFactor: "1", baseQuantity: "3", targetLocationId: src, stockStatus: "AVAILABLE" }],
    });
    await approveDocument(ownerP(), { documentId: stockDoc.documentId as string, expectedVersion: 1 });
    const v = (await q<{ version: number }>("SELECT version FROM public.documents WHERE id = $1", [stockDoc.documentId]))[0] as { version: number };
    await postDocument(ownerP(), { documentId: stockDoc.documentId as string, expectedVersion: v.version });
    await postMove(X, src, dst);
    const t1 = section(await getWorkSummaryAt(ownerP(), new Date()), "transfer");
    expect(t1?.doneToday).toBe(t0 + 1);
    expect(t1?.doneLines).toBeGreaterThanOrEqual(1);
  });

  it("kiracı yalıtımı: B'nin açık teslimi/sayımı A'ya yansımaz; B sahibi A slug'ıyla NOT_FOUND alır", async () => {
    const B = await seedWorld(adm, reg, "B988");
    const before = await getWorkSummaryAt(ownerP(), new Date());
    const bItem = uuid();
    await q("INSERT INTO public.items (tenant_id, id, code, name, base_unit_id, tracking_mode, quantity_scale) VALUES ($1,$2,$3,'T988 B urun',$4,'NONE',0)", [B.tenantId, bItem, `I-${hex(10)}`, B.unitId]);
    const rid = uuid();
    await q("INSERT INTO public.inbound_receipts (tenant_id, id, warehouse_id, number, created_by, status) VALUES ($1,$2,$3,$4,$5,'OPEN')", [B.tenantId, rid, B.warehouseId, `R-${hex(8)}`, B.ownerUserId]);
    await q("INSERT INTO public.inbound_receipt_lines (tenant_id, id, receipt_id, line_no, item_id, unit_id, conversion_factor, expected_quantity, received_quantity) VALUES ($1, gen_random_uuid(), $2, 1, $3, $4, 1, 4, 0)", [B.tenantId, rid, bItem, B.unitId]);
    const bP: StockDocCallParams = { ...callP(B.ownerUserId), tenantSlug: B.slug };
    const bSid = (await startCount(bP, { warehouseId: B.warehouseId, locationIds: [B.childLocationId] })).sessionId;
    await createCountTasks(bP, { sessionId: bSid });
    const after = await getWorkSummaryAt(ownerP(), new Date());
    for (const k of ["giris", "sayim"]) expect(section(after, k)?.open).toBe(section(before, k)?.open);
    expect(section(await getWorkSummaryAt(bP, new Date()), "giris")?.open).toBeGreaterThanOrEqual(1);
    await expect(getWorkSummaryAt(callP(B.ownerUserId), new Date())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("sayım sayıları yalnız document.create yetkisiyle: READ_ONLY açık sayım görevi varken 0 görür", async () => {
    const R = await mkLoc();
    const sid = (await startCount(ownerP(), { warehouseId: A.warehouseId, locationIds: [R] })).sessionId;
    await createCountTasks(ownerP(), { sessionId: sid });
    const ro = await mkUser(adm, reg, "A988 readonly");
    await mkMembership(adm, A.tenantId, ro, { roles: ["READ_ONLY"] });
    const s = await getWorkSummaryAt(callP(ro), new Date());
    expect(section(s, "sayim")?.open).toBe(0);
    expect(section(s, "sayim")?.doneToday).toBe(0);
    expect(section(await getWorkSummaryAt(ownerP(), new Date()), "sayim")?.open).toBeGreaterThanOrEqual(1);
  });

  it("depo kapsamı: kapsam dışı depodaki açık teslim sayılmaz; kapsamdaki tek depo adı döner", async () => {
    const WB = uuid();
    await q("INSERT INTO public.warehouses (tenant_id, id, code, name) VALUES ($1,$2,$3,'T988 depo B')", [A.tenantId, WB, `W${hex(6)}`]);
    const X = await mkItem();
    await mkReceipt([{ item: X, expected: "1", received: "0" }], WB);
    const LB = await mkLoc(WB);
    const sidB = (await startCount(ownerP(), { warehouseId: WB, locationIds: [LB] })).sessionId;
    await createCountTasks(ownerP(), { sessionId: sidB });
    const u = await mkUser(adm, reg, "A988 scoped");
    const mm = await mkMembership(adm, A.tenantId, u, { roles: ["WAREHOUSE_MANAGER"] });
    await q("INSERT INTO public.membership_warehouse_scopes (tenant_id, membership_id, warehouse_id) VALUES ($1,$2,$3)", [A.tenantId, mm, A.warehouseId]);
    const all = await getWorkSummaryAt(ownerP(), new Date());
    process.env.WAREHOUSE_SCOPE_ENABLED = "true";
    try {
      const scoped = await getWorkSummaryAt(callP(u), new Date());
      expect((section(all, "giris")?.open ?? 0) - (section(scoped, "giris")?.open ?? 0)).toBe(1);
      expect((section(all, "sayim")?.open ?? 0) - (section(scoped, "sayim")?.open ?? 0)).toBe(1); // kapsam dışı depodaki sayım
      expect(section(scoped, "transfer")?.open ?? 0).toBeLessThanOrEqual(section(all, "transfer")?.open ?? 0);
      const name = (await q<{ name: string }>("SELECT name FROM public.warehouses WHERE id = $1", [A.warehouseId]))[0]?.name;
      expect(scoped.warehouseName).toBe(name);
    } finally {
      delete process.env.WAREHOUSE_SCOPE_ENABLED;
      await q("DELETE FROM public.membership_warehouse_scopes WHERE tenant_id = $1 AND membership_id = $2", [A.tenantId, mm]);
    }
    expect(all.warehouseName).toBeNull(); // iki etkin depo
  });
});
