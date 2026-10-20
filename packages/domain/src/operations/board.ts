// T-422: Hesap sahibi / depo yöneticisi ana ekranı (Pano.dc.html `isOwner`, `isManager`) — salt okuma (`stock.view`), depo kapsamı (A-46).
// Uydurma değer yok (G-07); her sayı tablo durumundan gelir. Karşılığı olmayan tasarım alanları için tanımlar:
// - Satın alma: `item_stock_policies` (depo × ürün min/max) olan ve kullanılabilir stoğu min'in altına düşen ürünler; öneri = max − eldeki
//   (max yoksa/min'e eşitse min × 2 − eldeki). Kritik stok: aynı kümede eldeki < min × 0,35 (kaynaktaki kırmızı çubuk eşiği).
// - Bekleyen sipariş: açık kalemi olan OPEN satış siparişi (siparişte sevk tarihi yok: "geciken" yerine bekleme günü = oluşturulmadan bu yana).
// - Devir: son 90 günde çıkış (eksi) hareketi olan belge sayısı ürün başına; hareketsiz = elde stoğu olup 90 günde hiç hareketi olmayan ürün.
// - Sayım farkı: SUBMITTED (onay bekleyen) sayım oturumu. Sorun: açık sorun bildirimi.
// - İş halkası (yönetici): depo görevleri (warehouse_tasks) — bugün biten (yerel gün) / atanmış / atanmamış.
// - Ekip şu an: aktif üyeler; görevde ilerleme kaydı (bugün) → OKUTUYOR, atanmış görevi var → GÖREVDE, bugün işlem kaydı var → BOŞTA (son işlemden
//   bu yana dakika), hiçbiri → BUGÜN GİRİŞ YOK.
import { sql } from "drizzle-orm";
import { AppError } from "@wms/shared/errors";
import { runTenantQuery, type TenantAccessParams } from "../identity/access.ts";
import { pgUuidArray, resolveWarehouseScope } from "../warehouse/scope.ts";

type Params = Omit<TenantAccessParams, "permission" | "recentAuth">;

export interface BoardBuy {
  readonly itemId: string;
  readonly name: string;
  readonly unit: string;
  readonly have: string;
  readonly min: string;
  readonly suggest: string;
  readonly critical: boolean;
}
export interface BoardOrder {
  readonly id: string;
  readonly number: string;
  readonly customer: string;
  readonly lines: number;
  readonly days: number;
  readonly urgent: boolean;
}
export interface BoardTurn {
  readonly itemId: string;
  readonly name: string;
  readonly times: number;
}
export interface BoardTask {
  readonly id: string;
  readonly kind: "PUTAWAY" | "PICK" | "REPUTAWAY" | "COUNT";
  readonly version: number;
  readonly warehouseId: string;
  readonly itemName: string | null;
  readonly locationCode: string | null;
  readonly quantity: string | null;
}
export interface BoardPerson {
  readonly membershipId: string;
  readonly name: string;
  readonly roles: readonly string[];
  readonly state: "SCANNING" | "ASSIGNED" | "IDLE" | "AWAY";
  readonly assigned: number;
  readonly idleMinutes: number | null;
}
export interface Board {
  readonly localHour: number;
  readonly warehouseName: string | null;
  readonly warehouseCount: number;
  readonly buy: readonly BoardBuy[];
  readonly buyCount: number;
  readonly criticalCount: number;
  readonly orders: readonly BoardOrder[];
  readonly orderCount: number;
  readonly oldestOrderDays: number;
  readonly fast: readonly BoardTurn[];
  readonly slow: readonly BoardTurn[];
  readonly idleItems: number;
  readonly countReview: number;
  readonly problems: number;
  readonly lastProblem: { readonly reason: string; readonly minutes: number } | null;
  readonly tasks: { readonly done: number; readonly assigned: number; readonly unassigned: number };
  readonly todo: readonly BoardTask[];
  readonly team: readonly BoardPerson[];
}

const n = (v: string | number | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));
const qty = (v: string): string => v.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

/** İç: `now` yalnız testten enjekte edilir. */
export async function getBoardAt(params: Params, now: Date): Promise<Board> {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new AppError("VALIDATION_FAILED");
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, m) => {
    const tzRows = await tx.execute<{ time_zone: string }>(sql`SELECT time_zone FROM public.tenant_settings WHERE tenant_id = ${m.tenantId}::uuid`);
    const tz = tzRows[0]?.time_zone;
    if (tz === undefined) throw new AppError("NOT_FOUND");
    const allowed = await resolveWarehouseScope(tx, m);
    const scope = allowed === null ? null : pgUuidArray(allowed);
    const nowIso = now.toISOString();
    const t = m.tenantId;

    const head = await tx.execute<{ local_hour: string; count_review: string; problems: string; last_reason: string | null; last_min: string | null; done: string; assigned: string; unassigned: string; idle_items: string }>(sql`
      WITH d AS (SELECT date_trunc('day', ${nowIso}::timestamptz AT TIME ZONE ${tz}) AS local_start),
      bounds AS (SELECT (local_start AT TIME ZONE ${tz}) AS s, ((local_start + interval '1 day') AT TIME ZONE ${tz}) AS e FROM d),
      lastp AS (SELECT p.reason, p.reported_at FROM public.problem_reports p
                 WHERE p.tenant_id = ${t}::uuid AND p.status = 'OPEN' AND (${scope}::uuid[] IS NULL OR p.warehouse_id IS NULL OR p.warehouse_id = ANY(${scope}::uuid[]))
                 ORDER BY p.reported_at DESC LIMIT 1),
      onhand AS (SELECT sd.item_id FROM public.stock_balances b
                   JOIN public.stock_dimensions sd ON sd.tenant_id = b.tenant_id AND sd.id = b.stock_dimension_id
                   JOIN public.locations l ON l.tenant_id = sd.tenant_id AND l.id = sd.location_id
                  WHERE b.tenant_id = ${t}::uuid AND b.quantity > 0 AND (${scope}::uuid[] IS NULL OR l.warehouse_id = ANY(${scope}::uuid[]))
                  GROUP BY sd.item_id)
      SELECT extract(hour FROM ${nowIso}::timestamptz AT TIME ZONE ${tz})::int::text AS local_hour,
        (SELECT count(*) FROM public.count_sessions s WHERE s.tenant_id = ${t}::uuid AND s.status = 'SUBMITTED'
           AND (${scope}::uuid[] IS NULL OR s.warehouse_id = ANY(${scope}::uuid[])))::text AS count_review,
        (SELECT count(*) FROM public.problem_reports p WHERE p.tenant_id = ${t}::uuid AND p.status = 'OPEN'
           AND (${scope}::uuid[] IS NULL OR p.warehouse_id IS NULL OR p.warehouse_id = ANY(${scope}::uuid[])))::text AS problems,
        (SELECT reason FROM lastp) AS last_reason,
        (SELECT floor(extract(epoch FROM (${nowIso}::timestamptz - reported_at)) / 60)::int::text FROM lastp) AS last_min,
        (SELECT count(*) FROM public.warehouse_tasks w, bounds WHERE w.tenant_id = ${t}::uuid AND w.status = 'DONE'
           AND w.completed_at >= bounds.s AND w.completed_at < bounds.e AND (${scope}::uuid[] IS NULL OR w.warehouse_id = ANY(${scope}::uuid[])))::text AS done,
        (SELECT count(*) FROM public.warehouse_tasks w WHERE w.tenant_id = ${t}::uuid AND w.status = 'ASSIGNED'
           AND (${scope}::uuid[] IS NULL OR w.warehouse_id = ANY(${scope}::uuid[])))::text AS assigned,
        (SELECT count(*) FROM public.warehouse_tasks w WHERE w.tenant_id = ${t}::uuid AND w.status = 'OPEN'
           AND (${scope}::uuid[] IS NULL OR w.warehouse_id = ANY(${scope}::uuid[])))::text AS unassigned,
        (SELECT count(*) FROM onhand o WHERE NOT EXISTS (
           SELECT 1 FROM public.stock_ledger g WHERE g.tenant_id = ${t}::uuid AND g.item_id = o.item_id
              AND g.occurred_at >= ${nowIso}::timestamptz - interval '90 days'
              AND (${scope}::uuid[] IS NULL OR EXISTS (
                SELECT 1 FROM public.stock_dimensions sd JOIN public.locations l ON l.tenant_id = sd.tenant_id AND l.id = sd.location_id
                 WHERE sd.tenant_id = g.tenant_id AND sd.id = g.stock_dimension_id AND l.warehouse_id = ANY(${scope}::uuid[])))))::text AS idle_items`);
    const h = head[0];
    if (h === undefined) throw new AppError("INTERNAL");

    // Satın alma / kritik stok: politika başına kullanılabilir stok (AVAILABLE, depo içi).
    const buyRows = await tx.execute<{ item_id: string; name: string; unit: string; have: string; min: string; max: string }>(sql`
      SELECT p.item_id, i.name, u.code AS unit, h.have::text AS have, p.min_quantity::text AS min, p.max_quantity::text AS max
        FROM public.item_stock_policies p
        JOIN public.items i ON i.tenant_id = p.tenant_id AND i.id = p.item_id AND i.status = 'ACTIVE'
        JOIN public.units u ON u.tenant_id = i.tenant_id AND u.id = i.base_unit_id
        CROSS JOIN LATERAL (
          SELECT coalesce(sum(b.quantity - b.reserved_quantity), 0) AS have
            FROM public.stock_balances b
            JOIN public.stock_dimensions sd ON sd.tenant_id = b.tenant_id AND sd.id = b.stock_dimension_id
            JOIN public.locations l ON l.tenant_id = sd.tenant_id AND l.id = sd.location_id
           WHERE b.tenant_id = p.tenant_id AND sd.item_id = p.item_id AND sd.stock_status = 'AVAILABLE' AND l.warehouse_id = p.warehouse_id) h
       WHERE p.tenant_id = ${t}::uuid AND p.min_quantity > 0 AND h.have < p.min_quantity
         AND (${scope}::uuid[] IS NULL OR p.warehouse_id = ANY(${scope}::uuid[]))
       ORDER BY h.have / p.min_quantity, i.name, p.id
       LIMIT 200`);
    const buyAll = buyRows.map((r) => {
      const have = Number(r.have);
      const min = Number(r.min);
      const max = Number(r.max);
      const target = max > min ? max : min * 2;
      return {
        itemId: r.item_id,
        name: r.name,
        unit: r.unit,
        have: qty(r.have),
        min: qty(r.min),
        suggest: qty(String(Math.max(0, target - have))),
        critical: have < min * 0.35,
      } satisfies BoardBuy;
    });

    const orderRows = await tx.execute<{ id: string; number: string; customer_ref: string | null; lines: string; days: string; urgent: boolean; total: string }>(sql`
      WITH o AS (
        SELECT so.id, so.number, so.customer_ref, so.created_at,
               (SELECT count(*) FROM public.sales_order_lines l WHERE l.tenant_id = so.tenant_id AND l.order_id = so.id
                  AND l.requested_quantity > l.shipped_quantity + l.cancelled_quantity) AS lines
          FROM public.sales_orders so WHERE so.tenant_id = ${t}::uuid AND so.status = 'OPEN')
      SELECT o.id, o.number, o.customer_ref, o.lines::text,
             floor(extract(epoch FROM (${nowIso}::timestamptz - o.created_at)) / 86400)::int::text AS days,
             EXISTS (SELECT 1 FROM public.work_priorities w WHERE w.tenant_id = ${t}::uuid AND w.subject_kind = 'SALES_ORDER' AND w.subject_id = o.id AND w.urgent) AS urgent,
             count(*) OVER ()::text AS total
        FROM o WHERE o.lines > 0 ORDER BY o.created_at, o.id LIMIT 5`);

    const turnRows = await tx.execute<{ item_id: string; name: string; times: string }>(sql`
      SELECT g.item_id, i.name, count(DISTINCT g.document_id)::text AS times
        FROM public.stock_ledger g
        JOIN public.items i ON i.tenant_id = g.tenant_id AND i.id = g.item_id
        JOIN public.stock_dimensions sd ON sd.tenant_id = g.tenant_id AND sd.id = g.stock_dimension_id
        JOIN public.locations l ON l.tenant_id = sd.tenant_id AND l.id = sd.location_id
       WHERE g.tenant_id = ${t}::uuid AND g.quantity < 0 AND g.occurred_at >= ${nowIso}::timestamptz - interval '90 days'
         AND (${scope}::uuid[] IS NULL OR l.warehouse_id = ANY(${scope}::uuid[]))
       GROUP BY g.item_id, i.name ORDER BY count(DISTINCT g.document_id) DESC, i.name LIMIT 500`);
    const turns = turnRows.map((r) => ({ itemId: r.item_id, name: r.name, times: Number(r.times) }));
    const fast = turns.slice(0, 4);
    const slow = turns.length > 4 ? [...turns].slice(4).reverse().slice(0, 3) : [];

    const todoRows = await tx.execute<{ id: string; kind: BoardTask["kind"]; version: number; warehouse_id: string; item_name: string | null; location_code: string | null; quantity: string | null }>(sql`
      SELECT w.id, w.kind, w.version, w.warehouse_id, i.name AS item_name, l.code AS location_code, w.quantity::text AS quantity
        FROM public.warehouse_tasks w
        LEFT JOIN public.items i ON i.tenant_id = w.tenant_id AND i.id = w.item_id
        LEFT JOIN public.locations l ON l.tenant_id = w.tenant_id AND l.id = w.location_id
       WHERE w.tenant_id = ${t}::uuid AND w.status = 'OPEN' AND (${scope}::uuid[] IS NULL OR w.warehouse_id = ANY(${scope}::uuid[]))
       ORDER BY w.created_at, w.id LIMIT 4`);

    // T-920 (BACKLOG B-13): depo kapsamı kısıtlı izleyici yalnız kendi depolarında çalışabilen üyeleri görür (kapsamı kesişen, kapsam
    // satırı olmayan ya da TENANT_ADMIN — üye listesi ve görev atamasıyla aynı kural); görev/okutma sayıları ve son etkinlik yalnız
    // kapsamdaki depolardan (görev ilerlemesi + tamamlanan görev), depodan bağımsız işlem kaydı kullanılmaz. Kısıtsızda davranış aynı.
    const teamRows = await tx.execute<{ membership_id: string; name: string; roles: string[]; scanning: boolean; assigned: string; last_at: string | null }>(sql`
      WITH d AS (SELECT (date_trunc('day', ${nowIso}::timestamptz AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AS s)
      SELECT tm.id AS membership_id, u.name,
             coalesce((SELECT array_agg(r.role_key ORDER BY r.role_key) FROM public.membership_roles r WHERE r.tenant_id = tm.tenant_id AND r.membership_id = tm.id), '{}') AS roles,
             EXISTS (SELECT 1 FROM public.warehouse_task_progress p
                       JOIN public.warehouse_tasks w ON w.tenant_id = p.tenant_id AND w.id = p.task_id, d
                      WHERE p.tenant_id = tm.tenant_id AND p.membership_id = tm.id AND p.updated_at >= d.s
                        AND (${scope}::uuid[] IS NULL OR w.warehouse_id = ANY(${scope}::uuid[]))) AS scanning,
             (SELECT count(*) FROM public.warehouse_tasks w WHERE w.tenant_id = tm.tenant_id AND w.assigned_membership_id = tm.id AND w.status = 'ASSIGNED'
                AND (${scope}::uuid[] IS NULL OR w.warehouse_id = ANY(${scope}::uuid[])))::text AS assigned,
             CASE WHEN ${scope}::uuid[] IS NULL
               THEN (SELECT max(a.occurred_at) FROM public.audit_logs a, d WHERE a.tenant_id = tm.tenant_id AND a.actor_user_id = tm.user_id AND a.occurred_at >= d.s)
               ELSE GREATEST(
                 (SELECT max(p.updated_at) FROM public.warehouse_task_progress p
                    JOIN public.warehouse_tasks w ON w.tenant_id = p.tenant_id AND w.id = p.task_id, d
                   WHERE p.tenant_id = tm.tenant_id AND p.membership_id = tm.id AND p.updated_at >= d.s AND w.warehouse_id = ANY(${scope}::uuid[])),
                 (SELECT max(w.completed_at) FROM public.warehouse_tasks w, d
                   WHERE w.tenant_id = tm.tenant_id AND w.assigned_membership_id = tm.id AND w.completed_at >= d.s AND w.warehouse_id = ANY(${scope}::uuid[])))
             END::text AS last_at
        FROM public.tenant_memberships tm
        JOIN public.users u ON u.id = tm.user_id
       WHERE tm.tenant_id = ${t}::uuid AND tm.status = 'ACTIVE'
         AND (${scope}::uuid[] IS NULL
              OR EXISTS (SELECT 1 FROM public.membership_roles r WHERE r.tenant_id = tm.tenant_id AND r.membership_id = tm.id AND r.role_key = 'TENANT_ADMIN')
              OR NOT EXISTS (SELECT 1 FROM public.membership_warehouse_scopes ws WHERE ws.tenant_id = tm.tenant_id AND ws.membership_id = tm.id)
              OR EXISTS (SELECT 1 FROM public.membership_warehouse_scopes ws WHERE ws.tenant_id = tm.tenant_id AND ws.membership_id = tm.id
                           AND ws.warehouse_id = ANY(${scope}::uuid[])))
       ORDER BY u.name, tm.id LIMIT 50`);
    const team = teamRows.map((r): BoardPerson => {
      const assigned = n(r.assigned);
      const idle = r.last_at === null ? null : Math.max(0, Math.floor((now.getTime() - new Date(r.last_at).getTime()) / 60000));
      const state: BoardPerson["state"] = r.scanning ? "SCANNING" : assigned > 0 ? "ASSIGNED" : idle !== null ? "IDLE" : "AWAY";
      return { membershipId: r.membership_id, name: r.name, roles: r.roles, state, assigned, idleMinutes: idle };
    });

    const whRows = await tx.execute<{ name: string; total: string }>(
      sql`SELECT name, count(*) OVER ()::text AS total FROM public.warehouses
           WHERE tenant_id = ${t}::uuid AND status = 'ACTIVE' AND (${scope}::uuid[] IS NULL OR id = ANY(${scope}::uuid[]))
           ORDER BY code LIMIT 2`,
    );

    const firstOrder = orderRows[0];
    return {
      localHour: n(h.local_hour),
      warehouseName: whRows.length === 1 ? (whRows[0]?.name ?? null) : null,
      warehouseCount: n(whRows[0]?.total),
      buy: buyAll.slice(0, 5),
      buyCount: buyAll.length,
      criticalCount: buyAll.filter((b) => b.critical).length,
      orders: orderRows.map((r) => ({ id: r.id, number: r.number, customer: r.customer_ref ?? "", lines: n(r.lines), days: n(r.days), urgent: r.urgent === true })),
      orderCount: n(firstOrder?.total),
      oldestOrderDays: n(firstOrder?.days),
      fast,
      slow,
      idleItems: n(h.idle_items),
      countReview: n(h.count_review),
      problems: n(h.problems),
      lastProblem: h.last_reason === null ? null : { reason: h.last_reason, minutes: n(h.last_min) },
      tasks: { done: n(h.done), assigned: n(h.assigned), unassigned: n(h.unassigned) },
      todo: todoRows.map((r) => ({ id: r.id, kind: r.kind, version: Number(r.version), warehouseId: r.warehouse_id, itemName: r.item_name, locationCode: r.location_code, quantity: r.quantity === null ? null : qty(r.quantity) })),
      team,
    };
  });
}

/** Hesap sahibi / depo yöneticisi panosu (`stock.view`; ekran yalnız yönetici rollerine çizilir). */
export async function getBoard(params: Params): Promise<Board> {
  return getBoardAt(params, new Date());
}
