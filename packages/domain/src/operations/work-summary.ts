// Akış ana ekranı "Görevlerim" özeti (T-988). Salt okuma (`stock.view`): bölüm başına AÇIK iş + kalem ve BUGÜN biten iş + kalem.
// Uydurma değer yok (G-07): her sayı tablo durumlarından gelir; karşılığı olmayan alan (öncelik, vardiya, sorun) burada üretilmez.
//
// Bölümler ve tanımlar (yerel gün = `tenant_settings.time_zone`; `listMyActionsToday` ile aynı pencere):
// - giris:    açık = OPEN beklenen teslim; kalem = beklenen > alınan+hasarlı satır. Biten = bugün POSTED, kaynağı teslim olan belgelerin farklı teslim sayısı.
// - cikis:    açık = OPEN satış siparişi; kalem = istenen > sevk+iptal satır. Biten = bugün POSTED STOCK_OUT (kaynak sipariş) farklı sipariş sayısı.
// - transfer: açık = DRAFT/APPROVED, kaynaksız STOCK_MOVE belgesi; biten = bugün POSTED kaynaksız STOCK_MOVE + depolar arası (TRANSFER bağlantısı) çiftleri.
// - uretim:   açık iş kavramı yok (0); biten = bugün işlenen üretim bağlantıları (PRODUCTION).
// - sayim:    yalnız sayım iznine (document.create); açık = görünür COUNT görevleri (yönetici: tüm açık; diğer: OPEN + bana atanan), kalem = o raflardaki sayılmamış satırlar; biten = bugün POSTED oturum.
// T-989 (I-18 tasarım birebir, kaynak renderVals):
// - Sorunlu iş: açık sorun bildirimi (problem_reports OPEN) olan açık iş KALAN'dan çıkar, bölümün `problems`'ine girer (kaynak: st === 'prob').
//   Açık bir işe bağlı olmayan açık bildirimler (genel ya da kapanmış işe ait) `generalProblems` olarak SORUN kartına eklenir.
// - ACİL: bölümde kalan (sorunsuz açık) işlerden en az biri work_priorities.urgent ise.
// - Vardiya: tenant_settings.shift_start/shift_end. Manuel: bugün işlenen, kaynaksız ve bağlantısız STOCK_IN/STOCK_OUT (kaynak mlog).
// Depo kapsamı (A-46) depoya bağlı her tabloya uygulanır; satış siparişinin deposu yoktur (sevkiyat listesiyle aynı: tenant geneli sayım).
import { sql } from "drizzle-orm";
import { AppError } from "@wms/shared/errors";
import { runTenantQuery, type TenantAccessParams } from "../identity/access.ts";
import { hasPermission } from "../identity/permissions.ts";
import { pgUuidArray, resolveWarehouseScope } from "../warehouse/scope.ts";
import { TASK_KIND_PERMISSION } from "./tasks.ts";

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
  /** Açık sorun bildirimi olan açık iş sayısı (KALAN'a girmez). */
  readonly problems: number;
  /** Sorunlu işlerin kalem sayısı. */
  readonly problemLines: number;
  /** Kalan işlerden en az biri ACİL. */
  readonly urgent: boolean;
}
export interface WorkSummary {
  readonly sections: readonly WorkSection[];
  /** Kapsamdaki tek etkin depo adı; birden çoksa null (ekran "tüm depolar" der). */
  readonly warehouseName: string | null;
  /** Tenant yerel saati (0–23): selam metni için. */
  readonly localHour: number;
  /** Çalışma vardiyası "SS:DD". */
  readonly shift: { readonly start: string; readonly end: string };
  /** Açık bir işe bağlı olmayan açık sorun bildirimleri. */
  readonly generalProblems: number;
  /** Bugün işlenen manuel (siparişsiz) giriş/çıkış belgesi sayısı. */
  readonly manualToday: number;
}

type Params = Omit<TenantAccessParams, "permission" | "recentAuth">;

/** İç: `now` yalnız testten enjekte edilir. */
export async function getWorkSummaryAt(params: Params, now: Date): Promise<WorkSummary> {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new AppError("VALIDATION_FAILED");
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, m) => {
    const tzRows = await tx.execute<{ time_zone: string; shift_start: string; shift_end: string }>(
      sql`SELECT time_zone, to_char(shift_start, 'HH24:MI') AS shift_start, to_char(shift_end, 'HH24:MI') AS shift_end FROM public.tenant_settings WHERE tenant_id = ${m.tenantId}::uuid`,
    );
    const settings = tzRows[0];
    if (settings === undefined) throw new AppError("NOT_FOUND");
    const tz = settings.time_zone;
    const allowed = await resolveWarehouseScope(tx, m);
    const scope = allowed === null ? null : pgUuidArray(allowed);
    const manager = hasPermission(m.roles, "document.approve");
    // Sayım görevleri yalnız sayım iznine (TASK_KIND_PERMISSION.COUNT = document.create) görünür; diğer rollere sayım bölümü 0'dır (listMyTasks ile aynı kural).
    const canCount = hasPermission(m.roles, "document.create");
    // Görev konulu sorun bildirimi yalnız görevi görebilen role sayılır (work-signals listOpenProblems ile aynı kural).
    const kinds = `{${(Object.keys(TASK_KIND_PERMISSION) as Array<keyof typeof TASK_KIND_PERMISSION>).filter((k) => hasPermission(m.roles, TASK_KIND_PERMISSION[k])).join(",")}}`;
    const nowIso = now.toISOString();
    const rows = await tx.execute<{
      local_hour: string;
      g_open: string; g_lines: string; g_done: string; g_done_lines: string;
      c_open: string; c_lines: string; c_done: string; c_done_lines: string;
      t_open: string; t_lines: string; t_done: string; t_done_lines: string;
      u_done: string; u_done_lines: string;
      s_open: string; s_lines: string; s_done: string; s_done_lines: string;
      g_prob: string; g_prob_lines: string; g_urgent: boolean;
      c_prob: string; c_prob_lines: string; c_urgent: boolean;
      t_prob: string; t_prob_lines: string; t_urgent: boolean;
      s_prob: string; s_prob_lines: string; s_urgent: boolean;
      p_all: string; manual: string;
    }>(sql`
      WITH d AS (SELECT (${nowIso}::timestamptz AT TIME ZONE ${tz})::date AS today,
                        date_trunc('day', ${nowIso}::timestamptz AT TIME ZONE ${tz}) AS local_start,
                        extract(hour FROM ${nowIso}::timestamptz AT TIME ZONE ${tz}) AS local_hour),
      prob AS (SELECT p.id, p.subject_kind, p.subject_id FROM public.problem_reports p
                WHERE p.tenant_id = ${m.tenantId}::uuid AND p.status = 'OPEN'
                  AND (${scope}::uuid[] IS NULL OR p.warehouse_id IS NULL OR p.warehouse_id = ANY(${scope}::uuid[]))
                  AND (p.subject_kind IS DISTINCT FROM 'WAREHOUSE_TASK' OR EXISTS (
                        SELECT 1 FROM public.warehouse_tasks t
                         WHERE t.tenant_id = p.tenant_id AND t.id = p.subject_id AND t.kind = ANY(${kinds}::text[])
                           AND (${manager}::boolean OR t.assigned_membership_id IS NULL OR t.assigned_membership_id = ${m.membershipId}::uuid)))),
      urg AS (SELECT w.subject_kind, w.subject_id FROM public.work_priorities w WHERE w.tenant_id = ${m.tenantId}::uuid AND w.urgent),
      rcp_all AS (SELECT r.id FROM public.inbound_receipts r
               WHERE r.tenant_id = ${m.tenantId}::uuid AND r.status = 'OPEN'
                 AND (${scope}::uuid[] IS NULL OR r.warehouse_id = ANY(${scope}::uuid[]))),
      ord_all AS (SELECT o.id FROM public.sales_orders o WHERE o.tenant_id = ${m.tenantId}::uuid AND o.status = 'OPEN'),
      posted AS (SELECT doc.id, doc.kind, doc.source_kind, doc.source_id FROM public.documents doc, d
                  WHERE doc.tenant_id = ${m.tenantId}::uuid AND doc.status = 'POSTED' AND doc.business_date = d.today
                    AND (${scope}::uuid[] IS NULL OR doc.warehouse_id = ANY(${scope}::uuid[]))),
      moves_all AS (SELECT doc.id FROM public.documents doc
                 WHERE doc.tenant_id = ${m.tenantId}::uuid AND doc.kind = 'STOCK_MOVE' AND doc.source_kind IS NULL AND doc.status IN ('DRAFT', 'APPROVED')
                   AND (${scope}::uuid[] IS NULL OR doc.warehouse_id = ANY(${scope}::uuid[]))),
      links AS (SELECT DISTINCT k.kind, k.target_document_id FROM public.stock_document_links k
                 JOIN posted p ON p.id = k.target_document_id
                WHERE k.tenant_id = ${m.tenantId}::uuid),
      ctask_all AS (SELECT t.id, t.source_id, t.location_id FROM public.warehouse_tasks t
                 WHERE t.tenant_id = ${m.tenantId}::uuid AND ${canCount}::boolean AND t.kind = 'COUNT' AND t.source_kind = 'COUNT_SESSION' AND t.location_id IS NOT NULL
                   AND (t.status = 'OPEN' OR (t.status = 'ASSIGNED' AND (${manager}::boolean OR t.assigned_membership_id = ${m.membershipId}::uuid)))
                   AND (${scope}::uuid[] IS NULL OR t.warehouse_id = ANY(${scope}::uuid[]))),
      g_p AS (SELECT * FROM rcp_all x WHERE EXISTS (SELECT 1 FROM prob WHERE subject_kind = 'INBOUND_RECEIPT' AND subject_id = x.id)),
      rcp AS (SELECT * FROM rcp_all x WHERE NOT EXISTS (SELECT 1 FROM g_p WHERE g_p.id = x.id)),
      c_p AS (SELECT * FROM ord_all x WHERE EXISTS (SELECT 1 FROM prob WHERE subject_kind = 'SALES_ORDER' AND subject_id = x.id)),
      ord AS (SELECT * FROM ord_all x WHERE NOT EXISTS (SELECT 1 FROM c_p WHERE c_p.id = x.id)),
      t_p AS (SELECT * FROM moves_all x WHERE EXISTS (SELECT 1 FROM prob WHERE subject_kind = 'DOCUMENT' AND subject_id = x.id)),
      moves AS (SELECT * FROM moves_all x WHERE NOT EXISTS (SELECT 1 FROM t_p WHERE t_p.id = x.id)),
      s_p AS (SELECT * FROM ctask_all x WHERE EXISTS (SELECT 1 FROM prob WHERE subject_kind = 'WAREHOUSE_TASK' AND subject_id = x.id)),
      ctask AS (SELECT * FROM ctask_all x WHERE NOT EXISTS (SELECT 1 FROM s_p WHERE s_p.id = x.id)),
      manual AS (SELECT doc.id FROM public.documents doc, d
                  WHERE doc.tenant_id = ${m.tenantId}::uuid AND doc.status = 'POSTED' AND doc.business_date = d.today
                    AND doc.kind IN ('STOCK_IN', 'STOCK_OUT') AND doc.source_kind IS NULL AND doc.reversal_of_document_id IS NULL
                    AND (${scope}::uuid[] IS NULL OR doc.warehouse_id = ANY(${scope}::uuid[]))
                    AND NOT EXISTS (SELECT 1 FROM public.stock_document_links k WHERE k.tenant_id = doc.tenant_id
                                     AND (k.source_document_id = doc.id OR k.target_document_id = doc.id))),
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
        (SELECT count(*) FROM public.count_session_lines l JOIN sdone ON sdone.id = l.session_id WHERE l.tenant_id = ${m.tenantId}::uuid)::text AS s_done_lines,
        (SELECT count(*) FROM g_p)::text AS g_prob,
        (SELECT count(*) FROM public.inbound_receipt_lines l JOIN g_p ON g_p.id = l.receipt_id
          WHERE l.tenant_id = ${m.tenantId}::uuid AND l.expected_quantity > l.received_quantity + l.damaged_quantity)::text AS g_prob_lines,
        EXISTS (SELECT 1 FROM rcp JOIN urg ON urg.subject_kind = 'INBOUND_RECEIPT' AND urg.subject_id = rcp.id) AS g_urgent,
        (SELECT count(*) FROM c_p)::text AS c_prob,
        (SELECT count(*) FROM public.sales_order_lines l JOIN c_p ON c_p.id = l.order_id
          WHERE l.tenant_id = ${m.tenantId}::uuid AND l.requested_quantity > l.shipped_quantity + l.cancelled_quantity)::text AS c_prob_lines,
        EXISTS (SELECT 1 FROM ord JOIN urg ON urg.subject_kind = 'SALES_ORDER' AND urg.subject_id = ord.id) AS c_urgent,
        (SELECT count(*) FROM t_p)::text AS t_prob,
        (SELECT count(*) FROM public.document_lines dl JOIN t_p ON t_p.id = dl.document_id WHERE dl.tenant_id = ${m.tenantId}::uuid)::text AS t_prob_lines,
        EXISTS (SELECT 1 FROM moves JOIN urg ON urg.subject_kind = 'DOCUMENT' AND urg.subject_id = moves.id) AS t_urgent,
        (SELECT count(*) FROM s_p)::text AS s_prob,
        (SELECT count(*) FROM public.count_session_lines l JOIN s_p ON s_p.source_id = l.session_id AND s_p.location_id = l.location_id
          WHERE l.tenant_id = ${m.tenantId}::uuid AND l.counted_quantity IS NULL)::text AS s_prob_lines,
        EXISTS (SELECT 1 FROM ctask JOIN urg ON urg.subject_kind = 'WAREHOUSE_TASK' AND urg.subject_id = ctask.id) AS s_urgent,
        (SELECT count(*) FROM prob)::text AS p_all,
        (SELECT count(*) FROM manual)::text AS manual`);
    const r = rows[0];
    if (r === undefined) throw new AppError("INTERNAL");
    const n = (v: string): number => Number(v);
    const whRows = await tx.execute<{ name: string }>(
      sql`SELECT name FROM public.warehouses
           WHERE tenant_id = ${m.tenantId}::uuid AND status = 'ACTIVE' AND (${scope}::uuid[] IS NULL OR id = ANY(${scope}::uuid[]))
           ORDER BY code LIMIT 2`,
    );
    // Bir iş birden çok açık bildirim taşıyabilir: bölüm sayıları iş başınadır; bağlı olmayanlar bildirim başınadır.
    const linked = await tx.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM public.problem_reports p
       WHERE p.tenant_id = ${m.tenantId}::uuid AND p.status = 'OPEN' AND p.subject_id IS NOT NULL
         AND (${scope}::uuid[] IS NULL OR p.warehouse_id IS NULL OR p.warehouse_id = ANY(${scope}::uuid[]))
         AND (
           (p.subject_kind = 'INBOUND_RECEIPT' AND EXISTS (SELECT 1 FROM public.inbound_receipts r WHERE r.tenant_id = p.tenant_id AND r.id = p.subject_id AND r.status = 'OPEN'))
           OR (p.subject_kind = 'SALES_ORDER' AND EXISTS (SELECT 1 FROM public.sales_orders o WHERE o.tenant_id = p.tenant_id AND o.id = p.subject_id AND o.status = 'OPEN'))
           OR (p.subject_kind = 'DOCUMENT' AND EXISTS (SELECT 1 FROM public.documents x WHERE x.tenant_id = p.tenant_id AND x.id = p.subject_id
                 AND x.kind = 'STOCK_MOVE' AND x.source_kind IS NULL AND x.status IN ('DRAFT', 'APPROVED')))
           OR (p.subject_kind = 'WAREHOUSE_TASK' AND ${canCount}::boolean AND EXISTS (SELECT 1 FROM public.warehouse_tasks t WHERE t.tenant_id = p.tenant_id AND t.id = p.subject_id
                 AND t.kind = 'COUNT' AND t.source_kind = 'COUNT_SESSION'
                 AND (t.status = 'OPEN' OR (t.status = 'ASSIGNED' AND (${manager}::boolean OR t.assigned_membership_id = ${m.membershipId}::uuid)))))
         )`);
    return {
      localHour: n(r.local_hour),
      warehouseName: whRows.length === 1 ? (whRows[0]?.name ?? null) : null,
      shift: { start: settings.shift_start, end: settings.shift_end },
      generalProblems: Math.max(0, n(r.p_all) - n(linked[0]?.n ?? "0")),
      manualToday: n(r.manual),
      sections: [
        { key: "giris", open: n(r.g_open), openLines: n(r.g_lines), doneToday: n(r.g_done), doneLines: n(r.g_done_lines), problems: n(r.g_prob), problemLines: n(r.g_prob_lines), urgent: r.g_urgent === true },
        { key: "cikis", open: n(r.c_open), openLines: n(r.c_lines), doneToday: n(r.c_done), doneLines: n(r.c_done_lines), problems: n(r.c_prob), problemLines: n(r.c_prob_lines), urgent: r.c_urgent === true },
        { key: "transfer", open: n(r.t_open), openLines: n(r.t_lines), doneToday: n(r.t_done), doneLines: n(r.t_done_lines), problems: n(r.t_prob), problemLines: n(r.t_prob_lines), urgent: r.t_urgent === true },
        { key: "uretim", open: 0, openLines: 0, doneToday: n(r.u_done), doneLines: n(r.u_done_lines), problems: 0, problemLines: 0, urgent: false },
        { key: "sayim", open: n(r.s_open), openLines: n(r.s_lines), doneToday: n(r.s_done), doneLines: n(r.s_done_lines), problems: n(r.s_prob), problemLines: n(r.s_prob_lines), urgent: r.s_urgent === true },
      ],
    };
  });
}

/** Akış ana ekranı özeti (`stock.view`). */
export async function getWorkSummary(params: Params): Promise<WorkSummary> {
  return getWorkSummaryAt(params, new Date());
}
