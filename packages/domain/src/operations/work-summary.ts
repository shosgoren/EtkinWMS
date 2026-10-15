// Akış ana ekranı "Görevlerim" özeti (T-988). Salt okuma (`stock.view`): bölüm başına AÇIK iş + kalem ve BUGÜN biten iş + kalem.
// Uydurma değer yok (G-07): her sayı tablo durumlarından gelir; karşılığı olmayan alan (öncelik, vardiya, sorun) burada üretilmez.
//
// Bölümler ve tanımlar (yerel gün = `tenant_settings.time_zone`; `listMyActionsToday` ile aynı pencere):
// - giris:    açık = OPEN beklenen teslim; kalem = beklenen > alınan+hasarlı satır. Biten = bugün POSTED, kaynağı teslim olan belgelerin farklı teslim sayısı.
// - cikis:    açık = OPEN satış siparişi; kalem = istenen > sevk+iptal satır. Biten = bugün POSTED STOCK_OUT (kaynak sipariş) farklı sipariş sayısı.
// - transfer: açık = DRAFT/APPROVED, kaynaksız STOCK_MOVE belgesi; biten = bugün POSTED kaynaksız STOCK_MOVE + depolar arası (TRANSFER bağlantısı) çiftleri.
// - uretim:   açık iş kavramı yok (0); biten = bugün işlenen üretim bağlantıları (PRODUCTION).
// - sayim:    yalnız sayım iznine (document.create); açık = görünür COUNT görevleri (yönetici: tüm açık; diğer: OPEN + bana atanan), kalem = o raflardaki sayılmamış satırlar; biten = bugün POSTED oturum.
// Depo kapsamı (A-46) depoya bağlı her tabloya uygulanır; satış siparişinin deposu yoktur (sevkiyat listesiyle aynı: tenant geneli sayım).
import { sql } from "drizzle-orm";
import { AppError } from "@wms/shared/errors";
import { runTenantQuery, type TenantAccessParams } from "../identity/access.ts";
import { hasPermission } from "../identity/permissions.ts";
import { pgUuidArray, resolveWarehouseScope } from "../warehouse/scope.ts";

export type WorkSectionKey = "giris" | "cikis" | "transfer" | "uretim" | "sayim";
export const WORK_SECTIONS: readonly WorkSectionKey[] = ["giris", "cikis", "transfer", "uretim", "sayim"];

export interface WorkSection {
  readonly key: WorkSectionKey;
  /** Açık iş (teslim, sipariş, fiş, emir, sayım görevi) sayısı. */
  readonly open: number;
  /** Açık işlerin kalem (satır) sayısı. */
  readonly openLines: number;
  /** Bugün biten iş sayısı. */
  readonly doneToday: number;
  /** Bugün biten işlerin kalem sayısı. */
  readonly doneLines: number;
}
export interface WorkSummary {
  readonly sections: readonly WorkSection[];
  /** Kapsamdaki tek etkin depo adı; birden çoksa null (ekran "tüm depolar" der). */
  readonly warehouseName: string | null;
  /** Tenant yerel saati (0–23): selam metni için. */
  readonly localHour: number;
}

type Params = Omit<TenantAccessParams, "permission" | "recentAuth">;

/** İç: `now` yalnız testten enjekte edilir. */
export async function getWorkSummaryAt(params: Params, now: Date): Promise<WorkSummary> {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new AppError("VALIDATION_FAILED");
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, m) => {
    const tzRows = await tx.execute<{ time_zone: string }>(sql`SELECT time_zone FROM public.tenant_settings WHERE tenant_id = ${m.tenantId}::uuid`);
    const tz = tzRows[0]?.time_zone;
    if (tz === undefined) throw new AppError("NOT_FOUND");
    const allowed = await resolveWarehouseScope(tx, m);
    const scope = allowed === null ? null : pgUuidArray(allowed);
    const manager = hasPermission(m.roles, "document.approve");
    // Sayım görevleri yalnız sayım iznine (TASK_KIND_PERMISSION.COUNT = document.create) görünür; diğer rollere sayım bölümü 0'dır (listMyTasks ile aynı kural).
    const canCount = hasPermission(m.roles, "document.create");
    const nowIso = now.toISOString();
    const rows = await tx.execute<{
      local_hour: string;
      g_open: string; g_lines: string; g_done: string; g_done_lines: string;
      c_open: string; c_lines: string; c_done: string; c_done_lines: string;
      t_open: string; t_lines: string; t_done: string; t_done_lines: string;
      u_done: string; u_done_lines: string;
      s_open: string; s_lines: string; s_done: string; s_done_lines: string;
    }>(sql`
      WITH d AS (SELECT (${nowIso}::timestamptz AT TIME ZONE ${tz})::date AS today,
                        date_trunc('day', ${nowIso}::timestamptz AT TIME ZONE ${tz}) AS local_start,
                        extract(hour FROM ${nowIso}::timestamptz AT TIME ZONE ${tz}) AS local_hour),
      rcp AS (SELECT r.id FROM public.inbound_receipts r
               WHERE r.tenant_id = ${m.tenantId}::uuid AND r.status = 'OPEN'
                 AND (${scope}::uuid[] IS NULL OR r.warehouse_id = ANY(${scope}::uuid[]))),
      ord AS (SELECT o.id FROM public.sales_orders o WHERE o.tenant_id = ${m.tenantId}::uuid AND o.status = 'OPEN'),
      posted AS (SELECT doc.id, doc.kind, doc.source_kind, doc.source_id FROM public.documents doc, d
                  WHERE doc.tenant_id = ${m.tenantId}::uuid AND doc.status = 'POSTED' AND doc.business_date = d.today
                    AND (${scope}::uuid[] IS NULL OR doc.warehouse_id = ANY(${scope}::uuid[]))),
      moves AS (SELECT doc.id FROM public.documents doc
                 WHERE doc.tenant_id = ${m.tenantId}::uuid AND doc.kind = 'STOCK_MOVE' AND doc.source_kind IS NULL AND doc.status IN ('DRAFT', 'APPROVED')
                   AND (${scope}::uuid[] IS NULL OR doc.warehouse_id = ANY(${scope}::uuid[]))),
      links AS (SELECT DISTINCT k.kind, k.target_document_id FROM public.stock_document_links k
                 JOIN posted p ON p.id = k.target_document_id
                WHERE k.tenant_id = ${m.tenantId}::uuid),
      ctask AS (SELECT t.source_id, t.location_id FROM public.warehouse_tasks t
                 WHERE t.tenant_id = ${m.tenantId}::uuid AND ${canCount}::boolean AND t.kind = 'COUNT' AND t.source_kind = 'COUNT_SESSION' AND t.location_id IS NOT NULL
                   AND (t.status = 'OPEN' OR (t.status = 'ASSIGNED' AND (${manager}::boolean OR t.assigned_membership_id = ${m.membershipId}::uuid)))
                   AND (${scope}::uuid[] IS NULL OR t.warehouse_id = ANY(${scope}::uuid[]))),
      sdone AS (SELECT s.id FROM public.count_sessions s, d
                 WHERE s.tenant_id = ${m.tenantId}::uuid AND ${canCount}::boolean AND s.status = 'POSTED' AND s.approved_at >= (d.local_start AT TIME ZONE ${tz})
                   AND s.approved_at < ((d.local_start + interval '1 day') AT TIME ZONE ${tz})
                   AND (${scope}::uuid[] IS NULL OR s.warehouse_id = ANY(${scope}::uuid[])))
      SELECT (SELECT local_hour FROM d)::int::text AS local_hour,
        (SELECT count(*) FROM rcp)::text AS g_open,
        (SELECT count(*) FROM public.inbound_receipt_lines l JOIN rcp ON rcp.id = l.receipt_id
          WHERE l.tenant_id = ${m.tenantId}::uuid AND l.expected_quantity > l.received_quantity + l.damaged_quantity)::text AS g_lines,
        (SELECT count(DISTINCT source_id) FROM posted WHERE source_kind = 'INBOUND_RECEIPT')::text AS g_done,
        (SELECT count(*) FROM public.document_lines dl JOIN posted p ON p.id = dl.document_id
          WHERE dl.tenant_id = ${m.tenantId}::uuid AND p.source_kind = 'INBOUND_RECEIPT')::text AS g_done_lines,
        (SELECT count(*) FROM ord)::text AS c_open,
        (SELECT count(*) FROM public.sales_order_lines l JOIN ord ON ord.id = l.order_id
          WHERE l.tenant_id = ${m.tenantId}::uuid AND l.requested_quantity > l.shipped_quantity + l.cancelled_quantity)::text AS c_lines,
        (SELECT count(DISTINCT source_id) FROM posted WHERE source_kind = 'SALES_ORDER' AND kind = 'STOCK_OUT')::text AS c_done,
        (SELECT count(*) FROM public.document_lines dl JOIN posted p ON p.id = dl.document_id
          WHERE dl.tenant_id = ${m.tenantId}::uuid AND p.source_kind = 'SALES_ORDER' AND p.kind = 'STOCK_OUT')::text AS c_done_lines,
        (SELECT count(*) FROM moves)::text AS t_open,
        (SELECT count(*) FROM public.document_lines dl JOIN moves ON moves.id = dl.document_id WHERE dl.tenant_id = ${m.tenantId}::uuid)::text AS t_lines,
        ((SELECT count(*) FROM posted WHERE kind = 'STOCK_MOVE' AND source_kind IS NULL)
          + (SELECT count(*) FROM links WHERE kind = 'TRANSFER'))::text AS t_done,
        ((SELECT count(*) FROM public.document_lines dl JOIN posted p ON p.id = dl.document_id
           WHERE dl.tenant_id = ${m.tenantId}::uuid AND p.kind = 'STOCK_MOVE' AND p.source_kind IS NULL)
          + (SELECT count(*) FROM public.document_lines dl JOIN links k ON k.target_document_id = dl.document_id
              WHERE dl.tenant_id = ${m.tenantId}::uuid AND k.kind = 'TRANSFER'))::text AS t_done_lines,
        (SELECT count(*) FROM links WHERE kind = 'PRODUCTION')::text AS u_done,
        (SELECT count(*) FROM public.document_lines dl JOIN links k ON k.target_document_id = dl.document_id
          WHERE dl.tenant_id = ${m.tenantId}::uuid AND k.kind = 'PRODUCTION')::text AS u_done_lines,
        (SELECT count(*) FROM ctask)::text AS s_open,
        (SELECT count(*) FROM public.count_session_lines l JOIN ctask ON ctask.source_id = l.session_id AND ctask.location_id = l.location_id
          WHERE l.tenant_id = ${m.tenantId}::uuid AND l.counted_quantity IS NULL)::text AS s_lines,
        (SELECT count(*) FROM sdone)::text AS s_done,
        (SELECT count(*) FROM public.count_session_lines l JOIN sdone ON sdone.id = l.session_id WHERE l.tenant_id = ${m.tenantId}::uuid)::text AS s_done_lines`);
    const r = rows[0];
    if (r === undefined) throw new AppError("INTERNAL");
    const n = (v: string): number => Number(v);
    const whRows = await tx.execute<{ name: string }>(
      sql`SELECT name FROM public.warehouses
           WHERE tenant_id = ${m.tenantId}::uuid AND status = 'ACTIVE' AND (${scope}::uuid[] IS NULL OR id = ANY(${scope}::uuid[]))
           ORDER BY code LIMIT 2`,
    );
    return {
      localHour: n(r.local_hour),
      warehouseName: whRows.length === 1 ? (whRows[0]?.name ?? null) : null,
      sections: [
        { key: "giris", open: n(r.g_open), openLines: n(r.g_lines), doneToday: n(r.g_done), doneLines: n(r.g_done_lines) },
        { key: "cikis", open: n(r.c_open), openLines: n(r.c_lines), doneToday: n(r.c_done), doneLines: n(r.c_done_lines) },
        { key: "transfer", open: n(r.t_open), openLines: n(r.t_lines), doneToday: n(r.t_done), doneLines: n(r.t_done_lines) },
        { key: "uretim", open: 0, openLines: 0, doneToday: n(r.u_done), doneLines: n(r.u_done_lines) },
        { key: "sayim", open: n(r.s_open), openLines: n(r.s_lines), doneToday: n(r.s_done), doneLines: n(r.s_done_lines) },
      ],
    };
  });
}

/** Akış ana ekranı özeti (`stock.view`). */
export async function getWorkSummary(params: Params): Promise<WorkSummary> {
  return getWorkSummaryAt(params, new Date());
}
