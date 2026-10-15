// T-989 (I-18, Görevlerim tasarımı birebir): ana ekranın ACİL rozeti, VARDİYA satırı ve SORUN kartı için komutlar ve okuma.
// Uydurma değer yok: öncelik ve vardiya yönetici girişiyle, sorun sahadan bildirimle oluşur.
//
// - setWorkPriority (document.approve): iş başına ACİL + hedef saat. Konu (teslim / satış siparişi / belge / depo görevi) aynı tenant'ta
//   var ve görünür olmalı (depo kapsamı A-46); yoksa NOT_FOUND. Her değişiklik audit'e yazılır.
// - reportProblem (saha: stock.post ya da document.create; READ_ONLY bildiremez): sebep + isteğe bağlı not ve konu. Konu verilirse aynı
//   doğrulama; depo konudan türetilir (istemcinin verdiği depo yalnız konusuz bildirimde kullanılır ve kapsamda olmalı).
// - resolveProblem (document.approve): OPEN → RESOLVED; kapanmış bildirim değişmez (migration tetikleyicisi de korur).
// - updateWorkShift (settings.manage): vardiya başlangıç/bitiş (SS:DD).
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { runTenantCommand, runTenantQuery, type AccessTx, type Membership, type TenantAccessParams } from "../identity/access.ts";
import { hasPermission } from "../identity/permissions.ts";
import { assertWarehouseVisible, pgUuidArray, resolveWarehouseScope } from "../warehouse/scope.ts";
import { TASK_KIND_PERMISSION } from "./tasks.ts";

export const WORK_SUBJECT_KINDS = ["INBOUND_RECEIPT", "SALES_ORDER", "DOCUMENT", "WAREHOUSE_TASK"] as const;
export type WorkSubjectKind = (typeof WORK_SUBJECT_KINDS)[number];
export const PROBLEM_REASONS = ["DAMAGED", "MISSING", "WRONG_ITEM", "NO_LABEL", "LOCATION", "OTHER"] as const;
export type ProblemReason = (typeof PROBLEM_REASONS)[number];

type Params = Omit<TenantAccessParams, "permission" | "recentAuth">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function uuidOf(v: unknown): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new AppError("VALIDATION_FAILED");
  return v.toLowerCase();
}
function kindOf(v: unknown): WorkSubjectKind {
  if (typeof v !== "string" || !(WORK_SUBJECT_KINDS as readonly string[]).includes(v)) throw new AppError("VALIDATION_FAILED");
  return v as WorkSubjectKind;
}
function noteOf(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new AppError("VALIDATION_FAILED");
  const s = v.trim();
  if (s.length === 0) return null;
  if (s.length > 500) throw new AppError("VALIDATION_FAILED");
  return s;
}
function hhmmOf(v: unknown): string {
  if (typeof v !== "string" || !HHMM.test(v)) throw new AppError("VALIDATION_FAILED");
  return v;
}

/** Çağıranın tür iznine göre görebildiği görev türleri (TASK_KIND_PERMISSION) — Postgres text[] dizgesi. */
function taskKindsFor(m: Membership): string {
  const kinds = (Object.keys(TASK_KIND_PERMISSION) as Array<keyof typeof TASK_KIND_PERMISSION>).filter((k) => hasPermission(m.roles, TASK_KIND_PERMISSION[k]));
  return `{${kinds.join(",")}}`;
}

/** Konunun deposunu döner (kapsam denetimi dahil); satış siparişinin deposu yoktur (null). Yoksa/görünmezse NOT_FOUND. */
async function subjectWarehouse(tx: AccessTx, m: Membership, kind: WorkSubjectKind, id: string): Promise<string | null> {
  let rows: Array<{ warehouse_id: string | null }>;
  if (kind === "INBOUND_RECEIPT") {
    rows = await tx.execute<{ warehouse_id: string | null }>(sql`SELECT warehouse_id FROM public.inbound_receipts WHERE tenant_id = ${m.tenantId}::uuid AND id = ${id}::uuid`);
  } else if (kind === "SALES_ORDER") {
    rows = await tx.execute<{ warehouse_id: string | null }>(sql`SELECT NULL::uuid AS warehouse_id FROM public.sales_orders WHERE tenant_id = ${m.tenantId}::uuid AND id = ${id}::uuid`);
  } else if (kind === "DOCUMENT") {
    rows = await tx.execute<{ warehouse_id: string | null }>(sql`SELECT warehouse_id FROM public.documents WHERE tenant_id = ${m.tenantId}::uuid AND id = ${id}::uuid`);
  } else {
    // Görev: yalnız çağıranın görebildiği görev (listMyTasks kuralı): tür izni + (OPEN ya da bana atanmış ya da yönetici).
    const kinds = taskKindsFor(m);
    const manager = hasPermission(m.roles, "document.approve");
    rows = await tx.execute<{ warehouse_id: string | null }>(sql`
      SELECT warehouse_id FROM public.warehouse_tasks
       WHERE tenant_id = ${m.tenantId}::uuid AND id = ${id}::uuid AND kind = ANY(${kinds}::text[])
         AND (status = 'OPEN' OR (status = 'ASSIGNED' AND (${manager}::boolean OR assigned_membership_id = ${m.membershipId}::uuid)))`);
  }
  const r = rows[0];
  if (r === undefined) throw new AppError("NOT_FOUND");
  if (r.warehouse_id !== null) await assertWarehouseVisible(tx, m, [r.warehouse_id]);
  return r.warehouse_id;
}

export interface SetWorkPriorityInput {
  readonly subjectKind: WorkSubjectKind;
  readonly subjectId: string;
  readonly urgent: boolean;
  /** "SS:DD" ya da null (hedef saat yok). */
  readonly dueTime?: string | null;
  readonly requestId?: string | null;
}

export async function setWorkPriority(params: Params, input: SetWorkPriorityInput): Promise<{ readonly urgent: boolean; readonly dueTime: string | null }> {
  const kind = kindOf(input.subjectKind);
  const id = uuidOf(input.subjectId);
  if (typeof input.urgent !== "boolean") throw new AppError("VALIDATION_FAILED");
  const due = input.dueTime === undefined || input.dueTime === null ? null : hhmmOf(input.dueTime);
  return runTenantCommand({ ...params, permission: "document.approve" }, async (tx, m) => {
    await subjectWarehouse(tx, m, kind, id);
    const prev = await tx.execute<{ urgent: boolean; due_time: string | null }>(
      sql`SELECT urgent, to_char(due_time, 'HH24:MI') AS due_time FROM public.work_priorities
           WHERE tenant_id = ${m.tenantId}::uuid AND subject_kind = ${kind} AND subject_id = ${id}::uuid FOR UPDATE`,
    );
    await tx.execute(sql`
      INSERT INTO public.work_priorities (tenant_id, subject_kind, subject_id, urgent, due_time, updated_by)
      VALUES (${m.tenantId}::uuid, ${kind}, ${id}::uuid, ${input.urgent}, ${due}::time, ${m.membershipId}::uuid)
      ON CONFLICT (tenant_id, subject_kind, subject_id)
      DO UPDATE SET urgent = EXCLUDED.urgent, due_time = EXCLUDED.due_time, updated_by = EXCLUDED.updated_by`);
    const before = prev[0];
    await appendAudit(tx, {
      action: "work_priority.set",
      actorUserId: m.userId,
      entityType: "work_priority",
      entityId: `${kind}:${id}`,
      requestId: input.requestId ?? null,
      changeSummary: { from_urgent: before?.urgent ?? false, to_urgent: input.urgent, from_due_time: before?.due_time ?? null, to_due_time: due },
    });
    return { urgent: input.urgent, dueTime: due };
  });
}

export interface ReportProblemInput {
  readonly reason: ProblemReason;
  readonly note?: string | null;
  readonly subjectKind?: WorkSubjectKind | null;
  readonly subjectId?: string | null;
  /** Yalnız konusuz bildirimde; kapsamda olmalı. */
  readonly warehouseId?: string | null;
  readonly requestId?: string | null;
}

export async function reportProblem(params: Params, input: ReportProblemInput): Promise<{ readonly problemId: string }> {
  if (typeof input.reason !== "string" || !(PROBLEM_REASONS as readonly string[]).includes(input.reason)) throw new AppError("VALIDATION_FAILED");
  const note = noteOf(input.note);
  const hasSubject = input.subjectKind !== undefined && input.subjectKind !== null;
  if (hasSubject !== (input.subjectId !== undefined && input.subjectId !== null)) throw new AppError("VALIDATION_FAILED");
  const kind = hasSubject ? kindOf(input.subjectKind) : null;
  const subjectId = hasSubject ? uuidOf(input.subjectId) : null;
  const askedWarehouse = input.warehouseId === undefined || input.warehouseId === null ? null : uuidOf(input.warehouseId);
  if (hasSubject && askedWarehouse !== null) throw new AppError("VALIDATION_FAILED");
  return runTenantCommand({ ...params, permission: "stock.view" }, async (tx, m) => {
    // Bildirim saha işidir: işlem yapabilen roller (stock.post / document.create). Salt okuyan rol bildiremez.
    if (!hasPermission(m.roles, "stock.post") && !hasPermission(m.roles, "document.create")) throw new AppError("FORBIDDEN");
    let warehouseId: string | null;
    if (kind !== null && subjectId !== null) warehouseId = await subjectWarehouse(tx, m, kind, subjectId);
    else {
      warehouseId = askedWarehouse;
      if (warehouseId !== null) {
        const w = await tx.execute(sql`SELECT 1 FROM public.warehouses WHERE tenant_id = ${m.tenantId}::uuid AND id = ${warehouseId}::uuid`);
        if (w.length === 0) throw new AppError("NOT_FOUND");
        await assertWarehouseVisible(tx, m, [warehouseId]);
      }
    }
    const rows = await tx.execute<{ id: string }>(sql`
      INSERT INTO public.problem_reports (tenant_id, warehouse_id, subject_kind, subject_id, reason, note, reported_by)
      VALUES (${m.tenantId}::uuid, ${warehouseId}::uuid, ${kind}, ${subjectId}::uuid, ${input.reason}, ${note}, ${m.membershipId}::uuid)
      RETURNING id`);
    const id = rows[0]?.id;
    if (id === undefined) throw new AppError("INTERNAL");
    await appendAudit(tx, {
      action: "problem.reported",
      actorUserId: m.userId,
      entityType: "problem_report",
      entityId: id,
      requestId: input.requestId ?? null,
      // Serbest not audit'e yazılmaz (yalnız var/yok): kişisel veri taşıyabilir.
      changeSummary: { reason: input.reason, subject_kind: kind, subject_id: subjectId, warehouse_id: warehouseId, has_note: note !== null },
    });
    return { problemId: id };
  });
}

export async function resolveProblem(params: Params, input: { readonly problemId: string; readonly note?: string | null; readonly requestId?: string | null }): Promise<void> {
  const id = uuidOf(input.problemId);
  const note = noteOf(input.note);
  await runTenantCommand({ ...params, permission: "document.approve" }, async (tx, m) => {
    const rows = await tx.execute<{ status: string; warehouse_id: string | null }>(
      sql`SELECT status, warehouse_id FROM public.problem_reports WHERE tenant_id = ${m.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`,
    );
    const r = rows[0];
    if (r === undefined) throw new AppError("NOT_FOUND");
    if (r.warehouse_id !== null) await assertWarehouseVisible(tx, m, [r.warehouse_id]);
    if (r.status !== "OPEN") throw new AppError("VERSION_CONFLICT");
    await tx.execute(sql`
      UPDATE public.problem_reports SET status = 'RESOLVED', resolved_by = ${m.membershipId}::uuid, resolution_note = ${note}
       WHERE tenant_id = ${m.tenantId}::uuid AND id = ${id}::uuid`);
    await appendAudit(tx, {
      action: "problem.resolved",
      actorUserId: m.userId,
      entityType: "problem_report",
      entityId: id,
      requestId: input.requestId ?? null,
      changeSummary: { from_status: "OPEN", to_status: "RESOLVED", has_note: note !== null },
    });
  });
}

export async function updateWorkShift(params: Params, input: { readonly start: string; readonly end: string; readonly requestId?: string | null }): Promise<void> {
  const start = hhmmOf(input.start);
  const end = hhmmOf(input.end);
  if (start === end) throw new AppError("VALIDATION_FAILED");
  await runTenantCommand({ ...params, permission: "settings.manage" }, async (tx, m) => {
    const prev = await tx.execute<{ s: string; e: string }>(
      sql`SELECT to_char(shift_start, 'HH24:MI') AS s, to_char(shift_end, 'HH24:MI') AS e FROM public.tenant_settings WHERE tenant_id = ${m.tenantId}::uuid FOR UPDATE`,
    );
    const p = prev[0];
    if (p === undefined) throw new AppError("NOT_FOUND");
    await tx.execute(sql`UPDATE public.tenant_settings SET shift_start = ${start}::time, shift_end = ${end}::time WHERE tenant_id = ${m.tenantId}::uuid`);
    await appendAudit(tx, {
      action: "settings.shift_updated",
      actorUserId: m.userId,
      entityType: "tenant_settings",
      entityId: m.tenantId,
      requestId: input.requestId ?? null,
      changeSummary: { from_start: p.s, from_end: p.e, to_start: start, to_end: end },
    });
  });
}

export interface OpenProblemView {
  readonly id: string;
  readonly reason: ProblemReason;
  readonly note: string | null;
  readonly subjectKind: WorkSubjectKind | null;
  readonly subjectId: string | null;
  readonly warehouseId: string | null;
  readonly reportedAt: string;
  readonly mine: boolean;
}

/** Açık sorunlar (stock.view; depo kapsamı; görev konulu bildirim yalnız görevi görebilen role — tür izni, başkasına atanmışsa yönetici). Not yalnız yöneticiye (document.approve) ve bildirene görünür. En yeni önce, en çok 100. */
export async function listOpenProblems(params: Params): Promise<readonly OpenProblemView[]> {
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, m) => {
    const allowed = await resolveWarehouseScope(tx, m);
    const scope = allowed === null ? null : pgUuidArray(allowed);
    const manager = hasPermission(m.roles, "document.approve");
    const kinds = taskKindsFor(m);
    const rows = await tx.execute<{ id: string; reason: ProblemReason; note: string | null; subject_kind: WorkSubjectKind | null; subject_id: string | null; warehouse_id: string | null; reported_at: Date | string; reported_by: string }>(
      sql`SELECT id, reason, note, subject_kind, subject_id, warehouse_id, reported_at, reported_by FROM public.problem_reports problem_reports
           WHERE tenant_id = ${m.tenantId}::uuid AND status = 'OPEN'
             AND (${scope}::uuid[] IS NULL OR warehouse_id IS NULL OR warehouse_id = ANY(${scope}::uuid[]))
             AND (subject_kind IS DISTINCT FROM 'WAREHOUSE_TASK' OR EXISTS (
                   SELECT 1 FROM public.warehouse_tasks t
                    WHERE t.tenant_id = problem_reports.tenant_id AND t.id = problem_reports.subject_id AND t.kind = ANY(${kinds}::text[])
                      AND (${manager}::boolean OR t.assigned_membership_id IS NULL OR t.assigned_membership_id = ${m.membershipId}::uuid)))
           ORDER BY reported_at DESC, id LIMIT 100`,
    );
    return rows.map((r) => {
      const mine = r.reported_by.toLowerCase() === m.membershipId.toLowerCase();
      return {
        id: r.id,
        reason: r.reason,
        note: manager || mine ? r.note : null,
        subjectKind: r.subject_kind,
        subjectId: r.subject_id,
        warehouseId: r.warehouse_id,
        reportedAt: new Date(r.reported_at).toISOString(),
        mine,
      };
    });
  });
}
