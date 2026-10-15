// T-988: Akış ana ekranı "Görevlerim" özeti — bölüm sayıları gerçek tablo durumlarından gelir, depo kapsamı (A-46) uygulanır.
// GERÇEK roller (wms_app, pooler); fikstür yalnızca DATABASE_URL_DIRECT ile. Fikstürler sentetiktir (G-09).
import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { createCountTasks, listOpenProblems, reportProblem, resolveProblem, setWorkPriority, startCount, updateWorkShift } from "../../../packages/domain/src/operations/index.ts";
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
async function mkReceipt(lines: { item: string; expected: string; received: string }[], warehouseId = A.warehouseId): Promise<string> {
  const id = uuid();
  await q("INSERT INTO public.inbound_receipts (tenant_id, id, warehouse_id, number, created_by, status) VALUES ($1,$2,$3,$4,$5,'OPEN')", [A.tenantId, id, warehouseId, `R-${hex(8)}`, A.ownerUserId]);
  let n = 1;
  for (const l of lines) {
    await q(
      "INSERT INTO public.inbound_receipt_lines (tenant_id, id, receipt_id, line_no, item_id, unit_id, conversion_factor, expected_quantity, received_quantity) VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, 1, $6, $7)",
      [A.tenantId, id, n++, l.item, A.unitId, l.expected, l.received],
    );
  }
  return id;
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
    const bLoc = uuid(); // boş raf: fikstür rafında izlenen (lot/seri) stok var, sayım başlatmaz
    await q("INSERT INTO public.locations (tenant_id, id, warehouse_id, parent_id, code, name, depth, kind) VALUES ($1,$2,$3,NULL,$4,'T988 B lok',0,'STORAGE')", [B.tenantId, bLoc, B.warehouseId, `L-${hex(10)}`]);
    const bSid = (await startCount(bP, { warehouseId: B.warehouseId, locationIds: [bLoc] })).sessionId;
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

  describe("T-989 ACİL / vardiya / sorun", () => {
    const mkRole = async (tag: string, role: string): Promise<string> => {
      const u = await mkUser(adm, reg, `A988 ${tag}`);
      await mkMembership(adm, A.tenantId, u, { roles: [role] });
      return u;
    };

    it("açık teslime sorun: KALAN'dan SORUN'a geçer; çözülünce geri döner; ikinci çözüm VERSION_CONFLICT", async () => {
      const X = await mkItem();
      const before = await getWorkSummaryAt(ownerP(), new Date());
      const rid = await mkReceipt([{ item: X, expected: "4", received: "0" }, { item: X, expected: "2", received: "0" }]);
      const mid = await getWorkSummaryAt(ownerP(), new Date());
      expect(section(mid, "giris")?.open).toBe((section(before, "giris")?.open ?? 0) + 1);
      const { problemId } = await reportProblem(callP(COUNTER.userId), { reason: "DAMAGED", note: "kutu ezik", subjectKind: "INBOUND_RECEIPT", subjectId: rid });
      const prob = await getWorkSummaryAt(ownerP(), new Date());
      expect(section(prob, "giris")?.open).toBe(section(before, "giris")?.open);
      expect(section(prob, "giris")?.problems).toBe((section(before, "giris")?.problems ?? 0) + 1);
      expect(section(prob, "giris")?.problemLines).toBe((section(before, "giris")?.problemLines ?? 0) + 2);
      expect(prob.generalProblems).toBe(before.generalProblems);
      // Not yalnız yöneticiye ve bildirene görünür.
      const other = await mkRole("picker-note", "PICKER");
      const seenByOther = (await listOpenProblems(callP(other))).find((p) => p.id === problemId);
      expect(seenByOther?.note).toBeNull();
      expect((await listOpenProblems(ownerP())).find((p) => p.id === problemId)?.note).toBe("kutu ezik");
      expect((await listOpenProblems(callP(COUNTER.userId))).find((p) => p.id === problemId)?.mine).toBe(true);
      // Kapatma yöneticinin işidir.
      await expect(resolveProblem(callP(COUNTER.userId), { problemId })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await resolveProblem(ownerP(), { problemId, note: "değiştirildi" });
      await expect(resolveProblem(ownerP(), { problemId })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
      expect(section(await getWorkSummaryAt(ownerP(), new Date()), "giris")?.open).toBe((section(before, "giris")?.open ?? 0) + 1);
      const audit = await q<{ action: string }>("SELECT action FROM public.audit_logs WHERE tenant_id = $1 AND entity_id = $2 ORDER BY occurred_at, id", [A.tenantId, problemId]);
      expect(audit.map((a) => a.action)).toEqual(["problem.reported", "problem.resolved"]);
    });

    it("genel bildirim SORUN'a eklenir; salt okuyan bildiremez; kapsam dışı depo NOT_FOUND", async () => {
      const before = await getWorkSummaryAt(ownerP(), new Date());
      await reportProblem(callP(COUNTER.userId), { reason: "OTHER" });
      expect((await getWorkSummaryAt(ownerP(), new Date())).generalProblems).toBe(before.generalProblems + 1);
      const ro = await mkRole("ro-report", "READ_ONLY");
      await expect(reportProblem(callP(ro), { reason: "OTHER" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(reportProblem(callP(COUNTER.userId), { reason: "BAD" as never })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await expect(reportProblem(callP(COUNTER.userId), { reason: "OTHER", note: "x".repeat(501) })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      const WB = uuid();
      await q("INSERT INTO public.warehouses (tenant_id, id, code, name) VALUES ($1,$2,$3,'T989 depo B')", [A.tenantId, WB, `W${hex(6)}`]);
      const u = await mkUser(adm, reg, "A988 scoped report");
      const mm = await mkMembership(adm, A.tenantId, u, { roles: ["COUNTER"] });
      await q("INSERT INTO public.membership_warehouse_scopes (tenant_id, membership_id, warehouse_id) VALUES ($1,$2,$3)", [A.tenantId, mm, A.warehouseId]);
      process.env.WAREHOUSE_SCOPE_ENABLED = "true";
      try {
        await expect(reportProblem(callP(u), { reason: "OTHER", warehouseId: WB })).rejects.toMatchObject({ code: "NOT_FOUND" });
      } finally {
        delete process.env.WAREHOUSE_SCOPE_ENABLED;
      }
    });

    it("ACİL: yalnız yönetici; kalan işte rozet çıkar; başka tenant'ın işi NOT_FOUND", async () => {
      const X = await mkItem();
      const rid = await mkReceipt([{ item: X, expected: "1", received: "0" }]);
      const picker = await mkRole("picker-urgent", "PICKER");
      await expect(setWorkPriority(callP(picker), { subjectKind: "INBOUND_RECEIPT", subjectId: rid, urgent: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await setWorkPriority(ownerP(), { subjectKind: "INBOUND_RECEIPT", subjectId: rid, urgent: true, dueTime: "09:30" });
      expect(section(await getWorkSummaryAt(ownerP(), new Date()), "giris")?.urgent).toBe(true);
      const row = await q<{ urgent: boolean; due: string }>(
        "SELECT urgent, to_char(due_time, 'HH24:MI') AS due FROM public.work_priorities WHERE tenant_id = $1 AND subject_kind = 'INBOUND_RECEIPT' AND subject_id = $2",
        [A.tenantId, rid],
      );
      expect(row[0]).toEqual({ urgent: true, due: "09:30" });
      await expect(setWorkPriority(ownerP(), { subjectKind: "INBOUND_RECEIPT", subjectId: rid, urgent: true, dueTime: "9:30" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await expect(setWorkPriority(ownerP(), { subjectKind: "SALES_ORDER", subjectId: uuid(), urgent: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
      const B = await seedWorld(adm, reg, "B989");
      const bRid = uuid();
      await q("INSERT INTO public.inbound_receipts (tenant_id, id, warehouse_id, number, created_by, status) VALUES ($1,$2,$3,$4,$5,'OPEN')", [B.tenantId, bRid, B.warehouseId, `R-${hex(8)}`, B.ownerUserId]);
      await expect(setWorkPriority(ownerP(), { subjectKind: "INBOUND_RECEIPT", subjectId: bRid, urgent: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(reportProblem(callP(COUNTER.userId), { reason: "OTHER", subjectKind: "INBOUND_RECEIPT", subjectId: bRid })).rejects.toMatchObject({ code: "NOT_FOUND" });
      // Kapatılan iş kalan sayılmaz: acil rozet de düşer.
      await setWorkPriority(ownerP(), { subjectKind: "INBOUND_RECEIPT", subjectId: rid, urgent: false });
    });

    it("vardiya: yalnız ayar yetkisi; SS:DD; özet aynı değeri döner", async () => {
      const mgr = await mkRole("mgr-shift", "WAREHOUSE_MANAGER");
      await expect(updateWorkShift(callP(mgr), { start: "07:00", end: "16:00" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(updateWorkShift(ownerP(), { start: "25:00", end: "16:00" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await expect(updateWorkShift(ownerP(), { start: "08:00", end: "08:00" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await updateWorkShift(ownerP(), { start: "07:30", end: "16:15" });
      expect((await getWorkSummaryAt(ownerP(), new Date())).shift).toEqual({ start: "07:30", end: "16:15" });
      await updateWorkShift(ownerP(), { start: "08:00", end: "17:00" });
    });

    it("manuel: bugün işlenen kaynaksız STOCK_IN BİTEN'e manuel olarak eklenir", async () => {
      await q("UPDATE public.tenant_settings SET time_zone = 'UTC' WHERE tenant_id = $1", [A.tenantId]);
      const before = (await getWorkSummaryAt(ownerP(), new Date())).manualToday;
      const X = await mkItem();
      const L = await mkLoc();
      const d = await createStockDocument(ownerP(), {
        kind: "STOCK_IN",
        warehouseId: A.warehouseId,
        lines: [{ itemId: X, unitId: A.unitId, quantity: "1", conversionFactor: "1", baseQuantity: "1", targetLocationId: L, stockStatus: "AVAILABLE" }],
      });
      await approveDocument(ownerP(), { documentId: d.documentId as string, expectedVersion: 1 });
      const v = (await q<{ version: number }>("SELECT version FROM public.documents WHERE id = $1", [d.documentId]))[0] as { version: number };
      await postDocument(ownerP(), { documentId: d.documentId as string, expectedVersion: v.version });
      expect((await getWorkSummaryAt(ownerP(), new Date())).manualToday).toBe(before + 1);
    });
  });
});
