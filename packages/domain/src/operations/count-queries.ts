// Sayım ekranları için okumalar (T-987). Komutlar `counting.ts`'tedir; burada stok/oturum YAZILMAZ.
//
// - `getCountWork` (`document.create`): saha sayımcısının bir COUNT görevi (oturum kaynaklı) için gördüğü raf: lokasyon, oturum durumu ve o rafın satırları.
//   Kör sayımda (A-136, varsayılan) referans miktar DÖNMEZ; yalnız sayımcının girdiği değer döner. Başkasına atanmış görev yalnız `document.approve` sahibine görünür.
// - `listCountSessions` / `getCountReview` (`document.approve`): yönetici listesi ve fark incelemesi. Referans miktar yalnız gösterimdir; fark kararı
//   `approveCount`/`postCountAdjustment` içinde kilitli bakiyeye göre verilir (counting.ts başlığı, Supervisor notu 1).
// - Depo kapsamı (A-46) her okumada uygulanır; kapsam dışı/başka tenant kaydı `NOT_FOUND` (varlık sızmaz). `tenant_id` yalnız doğrulanmış üyelikten gelir.
import { sql } from "drizzle-orm";
import { AppError } from "@wms/shared/errors";
import { runTenantQuery, type TenantAccessParams } from "../identity/access.ts";
import { hasPermission } from "../identity/permissions.ts";
import { assertWarehouseVisible, pgUuidArray, resolveWarehouseScope } from "../warehouse/scope.ts";

export type CountQueryParams = Omit<TenantAccessParams, "permission" | "recentAuth">;
export type CountSessionStatus = "COUNTING" | "SUBMITTED" | "APPROVED" | "POSTED" | "CANCELLED";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(v: unknown): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new AppError("VALIDATION_FAILED");
  return v.toLowerCase();
}
/** numeric metni sondaki sıfırlarından arındırır ("12.500000" → "12.5", "3.000000" → "3"). Yalnız gösterim. */
function trimQty(v: string | null): string | null {
  if (v === null) return null;
  return v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v;
}

export interface CountWorkLine {
  readonly lineId: string;
  readonly itemId: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly unitCode: string;
  readonly stockStatus: string;
  /** Sayımcının girdiği değer (henüz sayılmadıysa null). */
  readonly counted: string | null;
  /** Yalnız kör OLMAYAN oturumda; kör sayımda daima null. */
  readonly reference: string | null;
}
export interface CountWork {
  readonly task: { readonly id: string; readonly version: number; readonly status: string; readonly assignedToMe: boolean };
  readonly session: { readonly id: string; readonly status: CountSessionStatus; readonly blind: boolean; readonly warehouseId: string; readonly warehouseName: string };
  readonly location: { readonly id: string; readonly code: string; readonly name: string };
  readonly lines: readonly CountWorkLine[];
  /** Oturumun tüm rafları üzerinden: toplam ve sayılmış satır (gönderme yalnız hepsi sayılınca mümkündür, A-309-3). */
  readonly progress: { readonly total: number; readonly counted: number };
}

/** Saha sayım ekranı: görev → oturum + raf + rafın satırları. */
export async function getCountWork(params: CountQueryParams, input: { readonly taskId: string }): Promise<CountWork> {
  const taskId = uuid(input.taskId);
  return runTenantQuery({ ...params, permission: "document.create" }, async (tx, m) => {
    const tasks = await tx.execute<{ id: string; version: number; status: string; kind: string; warehouse_id: string; location_id: string | null; source_kind: string | null; source_id: string | null; assigned_membership_id: string | null }>(
      sql`SELECT id, version, status, kind, warehouse_id, location_id, source_kind, source_id, assigned_membership_id
            FROM public.warehouse_tasks WHERE tenant_id = ${m.tenantId}::uuid AND id = ${taskId}::uuid`,
    );
    const t = tasks[0];
    if (t === undefined) throw new AppError("NOT_FOUND");
    await assertWarehouseVisible(tx, m, [t.warehouse_id]);
    if (t.kind !== "COUNT" || t.source_kind !== "COUNT_SESSION" || t.source_id === null || t.location_id === null) throw new AppError("VALIDATION_FAILED");
    const assignedToMe = t.assigned_membership_id !== null && t.assigned_membership_id.toLowerCase() === m.membershipId.toLowerCase();
    if (t.status === "ASSIGNED" && !assignedToMe && !hasPermission(m.roles, "document.approve")) throw new AppError("NOT_FOUND");
    const sessions = await tx.execute<{ id: string; status: CountSessionStatus; blind: boolean; warehouse_id: string; warehouse_name: string }>(
      sql`SELECT s.id, s.status, s.blind, s.warehouse_id, w.name AS warehouse_name
            FROM public.count_sessions s JOIN public.warehouses w ON w.tenant_id = s.tenant_id AND w.id = s.warehouse_id
           WHERE s.tenant_id = ${m.tenantId}::uuid AND s.id = ${t.source_id}::uuid`,
    );
    const s = sessions[0];
    if (s === undefined) throw new AppError("NOT_FOUND");
    const locs = await tx.execute<{ id: string; code: string; name: string }>(
      sql`SELECT id, code, name FROM public.locations WHERE tenant_id = ${m.tenantId}::uuid AND id = ${t.location_id}::uuid`,
    );
    const loc = locs[0];
    if (loc === undefined) throw new AppError("NOT_FOUND");
    const rows = await tx.execute<{ id: string; item_id: string; code: string; name: string; unit_code: string; stock_status: string | null; counted: string | null; reference: string }>(
      sql`SELECT l.id, l.item_id, i.code, i.name, u.code AS unit_code, d.stock_status,
                 l.counted_quantity::text AS counted, l.reference_quantity::text AS reference
            FROM public.count_session_lines l
            JOIN public.items i ON i.tenant_id = l.tenant_id AND i.id = l.item_id
            JOIN public.units u ON u.tenant_id = i.tenant_id AND u.id = i.base_unit_id
            LEFT JOIN public.stock_dimensions d ON d.tenant_id = l.tenant_id AND d.id = l.stock_dimension_id
           WHERE l.tenant_id = ${m.tenantId}::uuid AND l.session_id = ${s.id}::uuid AND l.location_id = ${loc.id}::uuid
           ORDER BY i.code, d.stock_status NULLS LAST, l.id`,
    );
    const prog = await tx.execute<{ total: string; counted: string }>(
      sql`SELECT count(*)::text AS total, count(counted_quantity)::text AS counted
            FROM public.count_session_lines WHERE tenant_id = ${m.tenantId}::uuid AND session_id = ${s.id}::uuid`,
    );
    return {
      task: { id: t.id, version: Number(t.version), status: t.status, assignedToMe },
      session: { id: s.id, status: s.status, blind: s.blind, warehouseId: s.warehouse_id, warehouseName: s.warehouse_name },
      location: { id: loc.id, code: loc.code, name: loc.name },
      lines: rows.map((r) => ({
        lineId: r.id,
        itemId: r.item_id,
        itemCode: r.code,
        itemName: r.name,
        unitCode: r.unit_code,
        stockStatus: r.stock_status ?? "AVAILABLE",
        counted: trimQty(r.counted),
        reference: s.blind ? null : trimQty(r.reference),
      })),
      progress: { total: Number(prog[0]?.total ?? 0), counted: Number(prog[0]?.counted ?? 0) },
    };
  });
}

export interface CountSessionSummary {
  readonly id: string;
  readonly status: CountSessionStatus;
  readonly blind: boolean;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly startedAt: Date;
  readonly startedByName: string;
  readonly locationCount: number;
  readonly lineCount: number;
  readonly countedCount: number;
  readonly assignees: readonly string[];
}

export const COUNT_SESSION_LIST_MAX = 100;

/** Yönetici listesi: en yeniden eskiye, en çok `limit` (≤ 100). Kapsam dışı depo görünmez. */
export async function listCountSessions(params: CountQueryParams, input: { readonly limit?: number } = {}): Promise<readonly CountSessionSummary[]> {
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > COUNT_SESSION_LIST_MAX) throw new AppError("VALIDATION_FAILED");
  return runTenantQuery({ ...params, permission: "document.approve" }, async (tx, m) => {
    const scope = await resolveWarehouseScope(tx, m);
    const rows = await tx.execute<{
      id: string; status: CountSessionStatus; blind: boolean; warehouse_id: string; warehouse_name: string; started_at: Date | string; started_by_name: string | null;
      location_count: string; line_count: string; counted_count: string; assignees: string[] | null;
    }>(
      sql`SELECT s.id, s.status, s.blind, s.warehouse_id, w.name AS warehouse_name, s.started_at, su.name AS started_by_name,
                 (SELECT count(DISTINCT x.location_id) FROM (
                    SELECT location_id FROM public.count_session_lines WHERE tenant_id = s.tenant_id AND session_id = s.id
                    UNION SELECT location_id FROM public.warehouse_tasks WHERE tenant_id = s.tenant_id AND kind = 'COUNT' AND source_kind = 'COUNT_SESSION' AND source_id = s.id AND location_id IS NOT NULL
                    UNION SELECT location_id FROM public.location_count_locks WHERE tenant_id = s.tenant_id AND count_session_id = s.id) x)::text AS location_count,
                 (SELECT count(*) FROM public.count_session_lines WHERE tenant_id = s.tenant_id AND session_id = s.id)::text AS line_count,
                 (SELECT count(counted_quantity) FROM public.count_session_lines WHERE tenant_id = s.tenant_id AND session_id = s.id)::text AS counted_count,
                 (SELECT array_agg(DISTINCT au.name ORDER BY au.name) FROM public.warehouse_tasks t
                    JOIN public.tenant_memberships am ON am.tenant_id = t.tenant_id AND am.id = t.assigned_membership_id
                    JOIN public.users au ON au.id = am.user_id
                   WHERE t.tenant_id = s.tenant_id AND t.kind = 'COUNT' AND t.source_kind = 'COUNT_SESSION' AND t.source_id = s.id) AS assignees
            FROM public.count_sessions s
            JOIN public.warehouses w ON w.tenant_id = s.tenant_id AND w.id = s.warehouse_id
            LEFT JOIN public.tenant_memberships sm ON sm.tenant_id = s.tenant_id AND sm.id = s.started_by
            LEFT JOIN public.users su ON su.id = sm.user_id
           WHERE s.tenant_id = ${m.tenantId}::uuid
             AND (${scope === null}::boolean OR s.warehouse_id = ANY(${pgUuidArray(scope ?? [])}::uuid[]))
           ORDER BY s.started_at DESC, s.id
           LIMIT ${limit}`,
    );
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      blind: r.blind,
      warehouseId: r.warehouse_id,
      warehouseName: r.warehouse_name,
      startedAt: r.started_at instanceof Date ? r.started_at : new Date(r.started_at),
      startedByName: r.started_by_name ?? "",
      locationCount: Number(r.location_count),
      lineCount: Number(r.line_count),
      countedCount: Number(r.counted_count),
      assignees: r.assignees ?? [],
    }));
  });
}

export interface CountReviewLine {
  readonly locationCode: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly unitCode: string;
  readonly stockStatus: string;
  readonly reference: string;
  readonly counted: string | null;
  /** counted − reference (sayılmadıysa null). Yalnız gösterim. */
  readonly difference: string | null;
}
export interface CountReview {
  readonly session: Omit<CountSessionSummary, "assignees" | "locationCount" | "lineCount" | "countedCount"> & { readonly cancelReason: string | null };
  readonly lines: readonly CountReviewLine[];
  readonly tasks: readonly { readonly id: string; readonly locationCode: string; readonly status: string; readonly assigneeName: string | null }[];
}

/** Yönetici fark incelemesi: oturum başlığı, satırlar (referans/sayılan/fark) ve raf görevleri. */
export async function getCountReview(params: CountQueryParams, input: { readonly sessionId: string }): Promise<CountReview> {
  const sessionId = uuid(input.sessionId);
  return runTenantQuery({ ...params, permission: "document.approve" }, async (tx, m) => {
    const heads = await tx.execute<{ id: string; status: CountSessionStatus; blind: boolean; warehouse_id: string; warehouse_name: string; started_at: Date | string; started_by_name: string | null; cancel_reason: string | null }>(
      sql`SELECT s.id, s.status, s.blind, s.warehouse_id, w.name AS warehouse_name, s.started_at, su.name AS started_by_name, s.cancel_reason
            FROM public.count_sessions s
            JOIN public.warehouses w ON w.tenant_id = s.tenant_id AND w.id = s.warehouse_id
            LEFT JOIN public.tenant_memberships sm ON sm.tenant_id = s.tenant_id AND sm.id = s.started_by
            LEFT JOIN public.users su ON su.id = sm.user_id
           WHERE s.tenant_id = ${m.tenantId}::uuid AND s.id = ${sessionId}::uuid`,
    );
    const h = heads[0];
    if (h === undefined) throw new AppError("NOT_FOUND");
    await assertWarehouseVisible(tx, m, [h.warehouse_id]);
    const lines = await tx.execute<{ location_code: string; item_code: string; item_name: string; unit_code: string; stock_status: string | null; reference: string; counted: string | null; difference: string | null }>(
      sql`SELECT lo.code AS location_code, i.code AS item_code, i.name AS item_name, u.code AS unit_code, d.stock_status,
                 l.reference_quantity::text AS reference, l.counted_quantity::text AS counted,
                 (l.counted_quantity - l.reference_quantity)::text AS difference
            FROM public.count_session_lines l
            JOIN public.locations lo ON lo.tenant_id = l.tenant_id AND lo.id = l.location_id
            JOIN public.items i ON i.tenant_id = l.tenant_id AND i.id = l.item_id
            JOIN public.units u ON u.tenant_id = i.tenant_id AND u.id = i.base_unit_id
            LEFT JOIN public.stock_dimensions d ON d.tenant_id = l.tenant_id AND d.id = l.stock_dimension_id
           WHERE l.tenant_id = ${m.tenantId}::uuid AND l.session_id = ${sessionId}::uuid
           ORDER BY lo.code, i.code, d.stock_status NULLS LAST, l.id`,
    );
    const tasks = await tx.execute<{ id: string; location_code: string | null; status: string; assignee_name: string | null }>(
      sql`SELECT t.id, lo.code AS location_code, t.status, au.name AS assignee_name
            FROM public.warehouse_tasks t
            LEFT JOIN public.locations lo ON lo.tenant_id = t.tenant_id AND lo.id = t.location_id
            LEFT JOIN public.tenant_memberships am ON am.tenant_id = t.tenant_id AND am.id = t.assigned_membership_id
            LEFT JOIN public.users au ON au.id = am.user_id
           WHERE t.tenant_id = ${m.tenantId}::uuid AND t.kind = 'COUNT' AND t.source_kind = 'COUNT_SESSION' AND t.source_id = ${sessionId}::uuid
           ORDER BY lo.code, t.id`,
    );
    return {
      session: {
        id: h.id,
        status: h.status,
        blind: h.blind,
        warehouseId: h.warehouse_id,
        warehouseName: h.warehouse_name,
        startedAt: h.started_at instanceof Date ? h.started_at : new Date(h.started_at),
        startedByName: h.started_by_name ?? "",
        cancelReason: h.cancel_reason,
      },
      lines: lines.map((r) => ({
        locationCode: r.location_code,
        itemCode: r.item_code,
        itemName: r.item_name,
        unitCode: r.unit_code,
        stockStatus: r.stock_status ?? "AVAILABLE",
        reference: trimQty(r.reference) ?? "0",
        counted: trimQty(r.counted),
        difference: trimQty(r.difference),
      })),
      tasks: tasks.map((r) => ({ id: r.id, locationCode: r.location_code ?? "", status: r.status, assigneeName: r.assignee_name })),
    };
  });
}
