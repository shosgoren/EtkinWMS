// T-987: yönetici atamalı sayım — oturum görevleri (`createCountTasks`), iptalde görev kapanışı ve sayım ekranı okumaları
// (`getCountWork`, `listCountSessions`, `getCountReview`). GERÇEK roller (wms_app, pooler); fikstür/gözlem yalnızca DATABASE_URL_DIRECT ile. Fikstürler sentetiktir (G-09).
import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import {
  approveCount,
  cancelCount,
  createCountTasks,
  getCountReview,
  getCountWork,
  listCountSessions,
  postCountAdjustment,
  recordCount,
  startCount,
  submitCount,
} from "../../../packages/domain/src/operations/index.ts";
import { approveDocument, createStockDocument, postDocument, type StockDocCallParams } from "../../../packages/domain/src/stock/index.ts";
import { mkMembership, mkUser, newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();
let app: DbClient;
let adm: pg.Client;
let A: TenantWorld;
let MGR: { userId: string; membershipId: string };
let COUNTER: { userId: string; membershipId: string };
let OTHER_COUNTER: { userId: string; membershipId: string };
let B: TenantWorld;

const NO_WAIT = { sleep: async () => undefined } as const;
const uuid = (): string => randomUUID();
const hex = (n: number): string => uuid().replaceAll("-", "").slice(0, n);
const callP = (userId: string, slug: string = A.slug): StockDocCallParams => ({
  db: app,
  principal: { userId, mfaVerified: true },
  tenantSlug: slug,
  clientKey: uuid(),
  retry: NO_WAIT,
});
const ownerP = (): StockDocCallParams => callP(A.ownerUserId);
const mgrP = (): StockDocCallParams => callP(MGR.userId);
const counterP = (): StockDocCallParams => callP(COUNTER.userId);
const otherP = (): StockDocCallParams => callP(OTHER_COUNTER.userId);
const pickerP = (): StockDocCallParams => callP(A.memberUserId);

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
const codeOf = (e: AppError): string => (e.detail === undefined ? e.code : `${e.code}/${e.detail}`);

async function mkItem(): Promise<string> {
  const id = uuid();
  await q("INSERT INTO public.items (tenant_id, id, code, name, base_unit_id, tracking_mode, quantity_scale) VALUES ($1,$2,$3,'T987 urun',$4,'NONE',0)", [
    A.tenantId, id, `I-${hex(10)}`, A.unitId,
  ]);
  return id;
}
async function mkLoc(): Promise<{ id: string; code: string }> {
  const id = uuid();
  const code = `L-${hex(10)}`;
  await q("INSERT INTO public.locations (tenant_id, id, warehouse_id, parent_id, code, name, depth, kind) VALUES ($1,$2,$3,NULL,$4,'T987 lok',0,'STORAGE')", [
    A.tenantId, id, A.warehouseId, code,
  ]);
  return { id, code };
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
const tasksOf = (sid: string) =>
  q<{ id: string; status: string; location_id: string; assigned_membership_id: string | null; source_kind: string }>(
    "SELECT id, status, location_id, assigned_membership_id, source_kind FROM public.warehouse_tasks WHERE tenant_id = $1 AND source_id = $2 ORDER BY location_id, id",
    [A.tenantId, sid],
  );
const auditCount = async (action: string, ids: readonly string[]): Promise<number> =>
  Number((await q<{ c: string }>("SELECT count(*)::text AS c FROM public.audit_logs WHERE tenant_id = $1 AND action = $2 AND entity_id = ANY($3::text[])", [A.tenantId, action, ids]))[0]?.c);

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  A = await seedWorld(adm, reg, "A987");
  const m = await mkUser(adm, reg, "A987 manager");
  MGR = { userId: m, membershipId: await mkMembership(adm, A.tenantId, m, { roles: ["WAREHOUSE_MANAGER"] }) };
  const c = await mkUser(adm, reg, "A987 counter");
  COUNTER = { userId: c, membershipId: await mkMembership(adm, A.tenantId, c, { roles: ["COUNTER"] }) };
  const o = await mkUser(adm, reg, "A987 other counter");
  OTHER_COUNTER = { userId: o, membershipId: await mkMembership(adm, A.tenantId, o, { roles: ["COUNTER"] }) };
  B = await seedWorld(adm, reg, "B987");
}, 120_000);

afterAll(async () => {
  await adm.end();
  await app.close();
}, 60_000);

describe("T-987 yönetici atamalı sayım akışı", () => {
  it("görevler raf başına açılır ve atanır; tekrar çağrı yeni görev açmaz; sayımcı kör görür; inceleme ve liste gerçek değerleri verir; işleme görevleri kapatır", async () => {
    const X = await mkItem();
    const R1 = await mkLoc();
    const R2 = await mkLoc();
    await stockIn(X, R1.id, "7");
    const sid = (await startCount(ownerP(), { warehouseId: A.warehouseId, locationIds: [R1.id, R2.id] })).sessionId;

    const first = await createCountTasks(mgrP(), { sessionId: sid, assigneeMembershipId: COUNTER.membershipId });
    expect(first.created).toBe(2);
    const tasks = await tasksOf(sid);
    expect(tasks.map((t) => [t.location_id, t.status, t.assigned_membership_id, t.source_kind])).toEqual(
      [R1.id, R2.id].sort().map((l) => [l, "ASSIGNED", COUNTER.membershipId, "COUNT_SESSION"]),
    );
    expect(await auditCount("warehouse_task.created", tasks.map((t) => t.id))).toBe(2);
    expect(await auditCount("warehouse_task.assigned", tasks.map((t) => t.id))).toBe(2);

    const again = await createCountTasks(mgrP(), { sessionId: sid, assigneeMembershipId: COUNTER.membershipId });
    expect(again.created).toBe(0);
    expect([...again.taskIds].sort()).toEqual(tasks.map((t) => t.id).sort());
    expect(await tasksOf(sid)).toHaveLength(2);

    const t1 = tasks.find((t) => t.location_id === R1.id);
    if (t1 === undefined) throw new Error("R1 görevi yok");
    const work = await getCountWork(counterP(), { taskId: t1.id });
    expect(work.task).toMatchObject({ id: t1.id, status: "ASSIGNED", assignedToMe: true });
    expect(work.session).toMatchObject({ id: sid, status: "COUNTING", blind: true, warehouseId: A.warehouseId });
    expect(work.location).toMatchObject({ id: R1.id, code: R1.code });
    expect(work.lines).toHaveLength(1);
    expect(work.lines[0]).toMatchObject({ itemId: X, counted: null, reference: null, stockStatus: "AVAILABLE" });
    expect(work.progress).toEqual({ total: 1, counted: 0 });
    // Başka sayımcıya atanmış görev görünmez; sayım izni olmayan rol okuyamaz.
    expect(codeOf(await failure(getCountWork(otherP(), { taskId: t1.id })))).toBe("NOT_FOUND");
    expect(codeOf(await failure(getCountWork(pickerP(), { taskId: t1.id })))).toBe("FORBIDDEN");

    await recordCount(counterP(), { sessionId: sid, lines: [{ locationId: R1.id, itemId: X, countedQuantity: "6" }] });
    const after = await getCountWork(counterP(), { taskId: t1.id });
    expect(after.lines[0]?.counted).toBe("6");
    expect(after.lines[0]?.reference).toBeNull();
    expect(after.progress).toEqual({ total: 1, counted: 1 });
    await submitCount(counterP(), { sessionId: sid });

    const review = await getCountReview(mgrP(), { sessionId: sid });
    expect(review.session).toMatchObject({ id: sid, status: "SUBMITTED", warehouseId: A.warehouseId, cancelReason: null });
    expect(review.lines.map((l) => [l.locationCode, l.reference, l.counted, l.difference])).toEqual([[R1.code, "7", "6", "-1"]]);
    expect(review.tasks).toHaveLength(2);
    expect(review.tasks.every((t) => t.status === "ASSIGNED" && t.assigneeName === "T104 A987 counter")).toBe(true);

    const listed = (await listCountSessions(mgrP())).find((s) => s.id === sid);
    expect(listed).toMatchObject({ status: "SUBMITTED", locationCount: 2, lineCount: 1, countedCount: 1, assignees: ["T104 A987 counter"] });
    // Liste ve inceleme yalnız onay yetkisine açıktır.
    expect(codeOf(await failure(listCountSessions(counterP())))).toBe("FORBIDDEN");
    expect(codeOf(await failure(getCountReview(counterP(), { sessionId: sid })))).toBe("FORBIDDEN");
    // Gönderilmiş oturuma yeni görev açılmaz.
    expect(codeOf(await failure(createCountTasks(mgrP(), { sessionId: sid })))).toBe("VALIDATION_FAILED/DOCUMENT_STATE");

    await approveCount(mgrP(), { sessionId: sid });
    await postCountAdjustment(mgrP(), { sessionId: sid });
    expect((await tasksOf(sid)).map((t) => t.status)).toEqual(["DONE", "DONE"]);
    // Sonlanmış ama başkasına atanmış görev de yalnız onay yetkisine görünür.
    expect(codeOf(await failure(getCountWork(otherP(), { taskId: t1.id })))).toBe("NOT_FOUND");
    expect((await getCountWork(mgrP(), { taskId: t1.id })).task).toMatchObject({ status: "DONE", assignedToMe: false });
  });

  it("atanan doğrulaması: sayım izni olmayan üye VALIDATION_FAILED, bilinmeyen üye NOT_FOUND; sayımcı görev açamaz (FORBIDDEN); hiçbir görev yazılmaz", async () => {
    const R = await mkLoc();
    const sid = (await startCount(ownerP(), { warehouseId: A.warehouseId, locationIds: [R.id] })).sessionId;
    expect(codeOf(await failure(createCountTasks(mgrP(), { sessionId: sid, assigneeMembershipId: A.memberMembershipId })))).toBe("VALIDATION_FAILED");
    expect(codeOf(await failure(createCountTasks(mgrP(), { sessionId: sid, assigneeMembershipId: uuid() })))).toBe("NOT_FOUND");
    expect(codeOf(await failure(createCountTasks(counterP(), { sessionId: sid })))).toBe("FORBIDDEN");
    expect(codeOf(await failure(createCountTasks(mgrP(), { sessionId: uuid() })))).toBe("NOT_FOUND");
    expect(await tasksOf(sid)).toHaveLength(0);
    await cancelCount(ownerP(), { sessionId: sid, reason: "T987 temizlik" });
  });

  it("oturum iptali kendi açık görevlerini CANCELLED yapar (audit gerekçeli); görev atanmamışsa OPEN doğar ve üstlenilebilir", async () => {
    const R1 = await mkLoc();
    const R2 = await mkLoc();
    const sid = (await startCount(ownerP(), { warehouseId: A.warehouseId, locationIds: [R1.id, R2.id] })).sessionId;
    const res = await createCountTasks(mgrP(), { sessionId: sid });
    expect(res.created).toBe(2);
    expect((await tasksOf(sid)).map((t) => [t.status, t.assigned_membership_id])).toEqual([["OPEN", null], ["OPEN", null]]);
    await cancelCount(ownerP(), { sessionId: sid, reason: "T987 iptal" });
    const after = await tasksOf(sid);
    expect(after.map((t) => t.status)).toEqual(["CANCELLED", "CANCELLED"]);
    const reasons = await q<{ reason: string | null }>(
      "SELECT reason FROM public.audit_logs WHERE tenant_id = $1 AND action = 'warehouse_task.cancelled' AND entity_id = ANY($2::text[])",
      [A.tenantId, after.map((t) => t.id)],
    );
    expect(reasons.map((r) => r.reason)).toEqual(["T987 iptal", "T987 iptal"]);
    // İptal edilmiş oturuma görev açılmaz.
    expect(codeOf(await failure(createCountTasks(mgrP(), { sessionId: sid })))).toBe("VALIDATION_FAILED/DOCUMENT_STATE");
  });

  it("kör olmayan oturumda sayımcı referansı görür; toplama eksiğinden doğan COUNT görevi oturum iptalinde dokunulmaz", async () => {
    const X = await mkItem();
    const R = await mkLoc();
    await stockIn(X, R.id, "4");
    const sid = (await startCount(ownerP(), { warehouseId: A.warehouseId, locationIds: [R.id], blind: false })).sessionId;
    const shortfall = uuid();
    await q(
      "INSERT INTO public.warehouse_tasks (tenant_id, id, warehouse_id, kind, source_kind, source_id, location_id) VALUES ($1,$2,$3,'COUNT','SALES_ORDER',$4,$5)",
      [A.tenantId, shortfall, A.warehouseId, uuid(), R.id],
    );
    const own = (await createCountTasks(mgrP(), { sessionId: sid, assigneeMembershipId: COUNTER.membershipId })).taskIds[0] as string;
    const work = await getCountWork(counterP(), { taskId: own });
    expect(work.session.blind).toBe(false);
    expect(work.lines.map((l) => [l.itemId, l.reference])).toEqual([[X, "4"]]);
    await cancelCount(ownerP(), { sessionId: sid, reason: "T987 kör değil" });
    const rows = await q<{ id: string; status: string }>("SELECT id, status FROM public.warehouse_tasks WHERE id = ANY($1::uuid[]) ORDER BY id", [[own, shortfall]]);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({ [own]: "CANCELLED", [shortfall]: "OPEN" });
    const audit = await q<{ change_summary: { from_status?: string; assigned_membership_id?: string } }>(
      "SELECT change_summary FROM public.audit_logs WHERE tenant_id = $1 AND action = 'warehouse_task.cancelled' AND entity_id = $2", [A.tenantId, own]);
    expect(audit.map((a) => [a.change_summary.from_status, a.change_summary.assigned_membership_id])).toEqual([["ASSIGNED", COUNTER.membershipId]]);
  });

  it("başka tenant kimlikleri NOT_FOUND; ayrılmış (REMOVED) üye atanamaz; eşzamanlı iki çağrı her rafa tek görev açar", async () => {
    const R1 = await mkLoc();
    const R2 = await mkLoc();
    const sid = (await startCount(ownerP(), { warehouseId: A.warehouseId, locationIds: [R1.id, R2.id] })).sessionId;
    const bOwner = (): StockDocCallParams => callP(B.ownerUserId, B.slug);
    expect(codeOf(await failure(createCountTasks(bOwner(), { sessionId: sid })))).toBe("NOT_FOUND");
    expect(codeOf(await failure(getCountReview(bOwner(), { sessionId: sid })))).toBe("NOT_FOUND");
    expect((await listCountSessions(bOwner())).some((x) => x.id === sid)).toBe(false);
    const gone = await mkUser(adm, reg, "A987 removed");
    const goneM = await mkMembership(adm, A.tenantId, gone, { roles: ["COUNTER"] });
    await q("UPDATE public.tenant_memberships SET status = 'REMOVED' WHERE tenant_id = $1 AND id = $2", [A.tenantId, goneM]);
    expect(codeOf(await failure(createCountTasks(mgrP(), { sessionId: sid, assigneeMembershipId: goneM })))).toBe("NOT_FOUND");
    expect(codeOf(await failure(createCountTasks(mgrP(), { sessionId: sid, assigneeMembershipId: B.memberMembershipId })))).toBe("NOT_FOUND");
    const both = await Promise.allSettled([createCountTasks(mgrP(), { sessionId: sid }), createCountTasks(mgrP(), { sessionId: sid })]);
    expect(both.every((r) => r.status === "fulfilled")).toBe(true);
    const created = both.map((r) => (r.status === "fulfilled" ? r.value.created : -1)).sort();
    expect(created).toEqual([0, 2]);
    const tasks = await tasksOf(sid);
    expect(tasks.map((t) => t.location_id)).toEqual([R1.id, R2.id].sort());
    expect(codeOf(await failure(getCountWork(bOwner(), { taskId: tasks[0]?.id as string })))).toBe("NOT_FOUND");
    await cancelCount(ownerP(), { sessionId: sid, reason: "T987 temizlik" });
  });

  describe("depo kapsamı (A-46; WAREHOUSE_SCOPE_ENABLED)", () => {
    afterAll(async () => {
      delete process.env.WAREHOUSE_SCOPE_ENABLED;
      await adm.query("DELETE FROM public.membership_warehouse_scopes WHERE tenant_id = $1 AND membership_id <> $2", [A.tenantId, A.ownerMembershipId]);
    });
    it("kapsamı depoyu içermeyen sayımcı atanamaz (görev/audit yazılmaz); kapsam dışı yönetici oturumu göremez ve görev açamaz", async () => {
      const WB = uuid();
      await q("INSERT INTO public.warehouses (tenant_id, id, code, name) VALUES ($1,$2,$3,'T987 depo B')", [A.tenantId, WB, `W${hex(6)}`]);
      const R = await mkLoc();
      const sid = (await startCount(ownerP(), { warehouseId: A.warehouseId, locationIds: [R.id] })).sessionId;
      const cu = await mkUser(adm, reg, "A987 scoped counter");
      const cm = await mkMembership(adm, A.tenantId, cu, { roles: ["COUNTER"] });
      const mu = await mkUser(adm, reg, "A987 scoped manager");
      const mm = await mkMembership(adm, A.tenantId, mu, { roles: ["WAREHOUSE_MANAGER"] });
      await q("INSERT INTO public.membership_warehouse_scopes (tenant_id, membership_id, warehouse_id) VALUES ($1,$2,$3),($1,$4,$3)", [A.tenantId, cm, WB, mm]);
      process.env.WAREHOUSE_SCOPE_ENABLED = "true";
      expect(codeOf(await failure(createCountTasks(mgrP(), { sessionId: sid, assigneeMembershipId: cm })))).toBe("VALIDATION_FAILED");
      expect(await tasksOf(sid)).toHaveLength(0);
      const scopedMgr = (): StockDocCallParams => callP(mu);
      expect(codeOf(await failure(createCountTasks(scopedMgr(), { sessionId: sid })))).toBe("NOT_FOUND");
      expect(codeOf(await failure(getCountReview(scopedMgr(), { sessionId: sid })))).toBe("NOT_FOUND");
      expect((await listCountSessions(scopedMgr())).some((x) => x.id === sid)).toBe(false);
      const t = (await createCountTasks(mgrP(), { sessionId: sid })).taskIds[0] as string;
      expect(codeOf(await failure(getCountWork(callP(cu), { taskId: t })))).toBe("NOT_FOUND");
      delete process.env.WAREHOUSE_SCOPE_ENABLED;
      await cancelCount(ownerP(), { sessionId: sid, reason: "T987 temizlik" });
    });
  });
});
