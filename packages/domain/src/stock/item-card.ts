// T-968 (B-63, KalipDetay / KalipListe): ürün kartı ve ürün listesi için SALT OKUMA stok özeti. Tenant + depo kapsamlı (`stock.view`,
// `resolveWarehouseScope`; kapsam dışı deponun stoğu ve hareketi görünmez). Miktarlar PostgreSQL decimal dizgisidir (kayan nokta yok).
// - `getItemStockCard`: "Nerede?" (depo → lokasyon, eldeki miktar ≠ 0), kapsamdaki minimum toplamı (`item_stock_policies`), son 5 hareket
//   (belge başına: tür, numara, zaman, işleyen, net miktar, lokasyonlar).
// - `sumItemsStock`: liste kartlarının rozeti için ürün başına eldeki toplam ve minimum (en çok 100 ürün). T-1117: ürün listesinin
//   "Kullanılabilir" sütunu için ayrılmış toplam ve kullanılabilir miktar da döner; kullanılabilir tanımı stok özetiyle (`queries.ts`
//   `listStockOverview`) AYNIDIR: AVAILABLE durumdaki, raf/sevk alanında (STORAGE/STAGING) ve toplaması engellenmemiş yerdeki
//   `quantity − reserved_quantity`. Hesap SQL decimal'dir (kayan nokta yok, I-09).
import { sql } from "drizzle-orm";
import { AppError } from "@wms/shared/errors";
import { runTenantQuery, type AccessTx, type TenantAccessParams } from "../identity/access.ts";
import { pgUuidArray, resolveWarehouseScope } from "../warehouse/scope.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new AppError("VALIDATION_FAILED");
  return value.toLowerCase();
}

export type ItemPlaceRow = {
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly locationCode: string;
  readonly quantity: string;
};

export type ItemMoveRow = {
  readonly documentId: string;
  readonly kind: "STOCK_IN" | "STOCK_OUT" | "STOCK_MOVE" | "REVERSAL";
  readonly number: string | null;
  readonly occurredAt: string;
  readonly actorName: string | null;
  /** Belgedeki bu ürüne ait net miktar (transferde 0). */
  readonly net: string;
  /** Artı bacakların toplamı (transferde taşınan miktar). */
  readonly moved: string;
  readonly locations: string;
};

export interface ItemStockCard {
  readonly places: readonly ItemPlaceRow[];
  /** T-1116: kapsamdaki eldeki toplam (fiziksel, her durum), ayrılmış (aktif rezervasyon yansıması) ve kullanılabilir (kural 5:
   * AVAILABLE ∧ STORAGE|STAGING ∧ pick_blocked=false boyutlarda miktar − ayrılmış; `listStockOverview` ile aynı tanım). Decimal dizgi. */
  readonly have: string;
  readonly reserved: string;
  readonly available: string;
  /** Kapsamdaki depoların minimum toplamı; politika yoksa `null`. */
  readonly min: string | null;
  readonly moves: readonly ItemMoveRow[];
}

type Params = Omit<TenantAccessParams, "permission" | "recentAuth">;

export async function getItemStockCard(params: Params, itemId: string): Promise<ItemStockCard> {
  const item = uuid(itemId);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, member) => {
    const allowed = await resolveWarehouseScope(tx, member);
    const scope = allowed === null ? null : pgUuidArray(allowed);
    const t = member.tenantId;
    const places = await tx.execute<ItemPlaceRow>(sql`
      SELECT w.id AS "warehouseId", w.name AS "warehouseName", l.code AS "locationCode", sum(b.quantity)::text AS quantity
        FROM public.stock_balances b
        JOIN public.stock_dimensions d ON d.tenant_id = b.tenant_id AND d.id = b.stock_dimension_id
        JOIN public.locations l ON l.tenant_id = d.tenant_id AND l.id = d.location_id
        JOIN public.warehouses w ON w.tenant_id = l.tenant_id AND w.id = l.warehouse_id
       WHERE b.tenant_id = ${t}::uuid AND d.item_id = ${item}::uuid
         AND (${scope}::uuid[] IS NULL OR w.id = ANY(${scope}::uuid[]))
       GROUP BY w.id, w.name, w.code, l.id, l.code
      HAVING sum(b.quantity) <> 0
       ORDER BY w.code, w.id, sum(b.quantity) DESC, l.code
       LIMIT 60`);
    const minRows = await tx.execute<{ min: string | null }>(sql`
      SELECT sum(p.min_quantity)::text AS min
        FROM public.item_stock_policies p
       WHERE p.tenant_id = ${t}::uuid AND p.item_id = ${item}::uuid AND p.min_quantity > 0
         AND (${scope}::uuid[] IS NULL OR p.warehouse_id = ANY(${scope}::uuid[]))`);
    const moves = await tx.execute<ItemMoveRow>(sql`
      SELECT g.document_id AS "documentId", doc.kind, doc.number, to_json(max(g.occurred_at)) #>> '{}' AS "occurredAt", u.name AS "actorName",
             sum(g.quantity)::text AS net, coalesce(sum(g.quantity) FILTER (WHERE g.quantity > 0), 0)::text AS moved,
             string_agg(DISTINCT l.code, ', ') AS locations
        FROM public.stock_ledger g
        JOIN public.documents doc ON doc.tenant_id = g.tenant_id AND doc.id = g.document_id
        JOIN public.stock_dimensions d ON d.tenant_id = g.tenant_id AND d.id = g.stock_dimension_id
        JOIN public.locations l ON l.tenant_id = d.tenant_id AND l.id = d.location_id
        LEFT JOIN public.users u ON u.id = g.actor_user_id
       WHERE g.tenant_id = ${t}::uuid AND g.item_id = ${item}::uuid
         AND (${scope}::uuid[] IS NULL OR l.warehouse_id = ANY(${scope}::uuid[]))
       GROUP BY g.document_id, doc.kind, doc.number, u.name
       ORDER BY max(g.occurred_at) DESC, g.document_id
       LIMIT 5`);
    const sums = await tx.execute<{ have: string; reserved: string; available: string }>(sql`
      SELECT coalesce(sum(b.quantity), 0)::text AS have, coalesce(sum(b.reserved_quantity), 0)::text AS reserved,
             coalesce(sum(b.quantity - b.reserved_quantity) FILTER (
               WHERE d.stock_status = 'AVAILABLE' AND l.kind IN ('STORAGE', 'STAGING') AND l.pick_blocked = false
             ), 0)::text AS available
        FROM public.stock_balances b
        JOIN public.stock_dimensions d ON d.tenant_id = b.tenant_id AND d.id = b.stock_dimension_id
        JOIN public.locations l ON l.tenant_id = d.tenant_id AND l.id = d.location_id
       WHERE b.tenant_id = ${t}::uuid AND d.item_id = ${item}::uuid
         AND (${scope}::uuid[] IS NULL OR l.warehouse_id = ANY(${scope}::uuid[]))`);
    const sum = sums[0] ?? { have: "0", reserved: "0", available: "0" };
    return { places, min: minRows[0]?.min ?? null, moves, have: sum.have, reserved: sum.reserved, available: sum.available };
  });
}

export type ItemStockSum = {
  readonly itemId: string;
  readonly have: string;
  readonly min: string | null;
  /** T-1117: kapsamdaki ayrılmış (rezerve) toplam. */
  readonly reserved: string;
  /** T-1117: kullanılabilir miktar (stok özetiyle aynı tanım). */
  readonly available: string;
};

export async function sumItemsStock(params: Params, itemIds: readonly string[]): Promise<readonly ItemStockSum[]> {
  if (itemIds.length > 100) throw new AppError("VALIDATION_FAILED");
  const ids = itemIds.map(uuid);
  if (ids.length === 0) return [];
  const list = pgUuidArray(ids);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, member) => {
    const allowed = await resolveWarehouseScope(tx, member);
    const scope = allowed === null ? null : pgUuidArray(allowed);
    const t = member.tenantId;
    // T-1117: eldeki / ayrılmış / kullanılabilir tek geçişte (ürün başına bir alt sorgu yerine tek GROUP BY).
    return tx.execute<ItemStockSum>(sql`
      SELECT x.id AS "itemId",
             coalesce(s.have, 0)::text AS have,
             (SELECT sum(p.min_quantity)
                FROM public.item_stock_policies p
               WHERE p.tenant_id = ${t}::uuid AND p.item_id = x.id AND p.min_quantity > 0
                 AND (${scope}::uuid[] IS NULL OR p.warehouse_id = ANY(${scope}::uuid[])))::text AS min,
             coalesce(s.reserved, 0)::text AS reserved,
             coalesce(s.available, 0)::text AS available
        FROM unnest(${list}::uuid[]) AS x(id)
        LEFT JOIN (
          SELECT d.item_id,
                 sum(b.quantity) AS have,
                 sum(b.reserved_quantity) AS reserved,
                 sum(b.quantity - b.reserved_quantity) FILTER (
                   WHERE d.stock_status = 'AVAILABLE' AND l.kind IN ('STORAGE', 'STAGING') AND l.pick_blocked = false
                 ) AS available
            FROM public.stock_balances b
            JOIN public.stock_dimensions d ON d.tenant_id = b.tenant_id AND d.id = b.stock_dimension_id
            JOIN public.locations l ON l.tenant_id = d.tenant_id AND l.id = d.location_id
           WHERE b.tenant_id = ${t}::uuid AND d.item_id = ANY(${list}::uuid[])
             AND (${scope}::uuid[] IS NULL OR l.warehouse_id = ANY(${scope}::uuid[]))
           GROUP BY d.item_id
        ) s ON s.item_id = x.id`);
  });
}

// ---------------------------------------------------------------------------------------------
// T-1116 (B-176; STANDART §3 "Stok ve yer", "Hareketler", "Takip"): ürün kartı sekmeleri için SALT OKUMA sorguları. Hepsi aynı
// sözleşme: `stock.view`, tenant bağlamı (RLS + açık `tenant_id` koşulu), depo kapsamı (`resolveWarehouseScope`), sınırlı satır.
// ---------------------------------------------------------------------------------------------

/** Pivot satırı: depo › raf yeri › lot › paket (palet › koli) › stok durumu başına miktar ve ayrılmış. */
export type ItemPivotRow = {
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly warehouseName: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly lotId: string | null;
  readonly lotCode: string | null;
  readonly productionDate: string | null;
  readonly expiryDate: string | null;
  /** Boyutun taşıma birimi (palet ya da koli). */
  readonly unitId: string | null;
  readonly unitCode: string | null;
  readonly unitKind: "PALET" | "KOLI" | null;
  /** Taşıma biriminin bir üst birimi (ör. koli → palet); yalnız bir düzey. */
  readonly parentId: string | null;
  readonly parentCode: string | null;
  readonly parentKind: "PALET" | "KOLI" | null;
  readonly status: "AVAILABLE" | "QUARANTINE" | "DAMAGED" | "BLOCKED";
  readonly quantity: string;
  readonly reserved: string;
};

export const ITEM_PIVOT_MAX_ROWS = 500;

export interface ItemStockPivot {
  readonly rows: readonly ItemPivotRow[];
  /** Satır sınırı aşıldı: ekran "daha fazla" uyarısı gösterir (toplamlar yine `getItemStockCard`'dan). */
  readonly truncated: boolean;
}

export async function getItemStockPivot(params: Params, itemId: string): Promise<ItemStockPivot> {
  const item = uuid(itemId);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, member) => {
    const allowed = await resolveWarehouseScope(tx, member);
    const scope = allowed === null ? null : pgUuidArray(allowed);
    const t = member.tenantId;
    const rows = await tx.execute<ItemPivotRow>(sql`
      SELECT w.id AS "warehouseId", w.code AS "warehouseCode", w.name AS "warehouseName", l.id AS "locationId", l.code AS "locationCode",
             lo.id AS "lotId", lo.lot_code AS "lotCode", lo.production_date::text AS "productionDate", lo.expiry_date::text AS "expiryDate",
             h.id AS "unitId", h.code AS "unitCode", h.kind AS "unitKind", p.id AS "parentId", p.code AS "parentCode", p.kind AS "parentKind",
             d.stock_status AS status, sum(b.quantity)::text AS quantity, sum(b.reserved_quantity)::text AS reserved
        FROM public.stock_balances b
        JOIN public.stock_dimensions d ON d.tenant_id = b.tenant_id AND d.id = b.stock_dimension_id
        JOIN public.locations l ON l.tenant_id = d.tenant_id AND l.id = d.location_id
        JOIN public.warehouses w ON w.tenant_id = l.tenant_id AND w.id = l.warehouse_id
        LEFT JOIN public.lots lo ON lo.tenant_id = d.tenant_id AND lo.id = d.lot_id
        LEFT JOIN public.handling_units h ON h.tenant_id = d.tenant_id AND h.id = d.handling_unit_id
        LEFT JOIN public.handling_units p ON p.tenant_id = h.tenant_id AND p.id = h.parent_id
       WHERE b.tenant_id = ${t}::uuid AND d.item_id = ${item}::uuid
         AND (${scope}::uuid[] IS NULL OR w.id = ANY(${scope}::uuid[]))
       GROUP BY w.id, w.code, w.name, l.id, l.code, lo.id, lo.lot_code, lo.production_date, lo.expiry_date, h.id, h.code, h.kind, p.id, p.code, p.kind, d.stock_status
      HAVING sum(b.quantity) <> 0 OR sum(b.reserved_quantity) <> 0
       ORDER BY w.code, w.id, l.code, l.id, lo.lot_code NULLS FIRST, lo.id, p.code NULLS FIRST, h.code NULLS FIRST, h.id, d.stock_status
       LIMIT ${ITEM_PIVOT_MAX_ROWS + 1}`);
    return { rows: rows.slice(0, ITEM_PIVOT_MAX_ROWS), truncated: rows.length > ITEM_PIVOT_MAX_ROWS };
  });
}

export const ITEM_MOVES_DEFAULT_LIMIT = 50;
export const ITEM_MOVES_MAX_LIMIT = 100;

export interface ItemMovesPage {
  readonly moves: readonly ItemMoveRow[];
  /** Kapsamdaki toplam belge sayısı (ALTIN-KURAL 15: toplam gösterilir). */
  readonly total: number;
}

/** Ürünün defter hareketleri belge başına, en yeni önce (`getItemStockCard` son 5 hareketiyle aynı biçim), en çok `limit` belge. */
export async function listItemMoves(params: Params, itemId: string, options: { readonly limit?: number } = {}): Promise<ItemMovesPage> {
  const item = uuid(itemId);
  const limit = options.limit ?? ITEM_MOVES_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > ITEM_MOVES_MAX_LIMIT) throw new AppError("VALIDATION_FAILED");
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, member) => {
    const allowed = await resolveWarehouseScope(tx, member);
    const scope = allowed === null ? null : pgUuidArray(allowed);
    const t = member.tenantId;
    const moves = await tx.execute<ItemMoveRow>(sql`
      SELECT g.document_id AS "documentId", doc.kind, doc.number, to_json(max(g.occurred_at)) #>> '{}' AS "occurredAt", u.name AS "actorName",
             sum(g.quantity)::text AS net, coalesce(sum(g.quantity) FILTER (WHERE g.quantity > 0), 0)::text AS moved,
             string_agg(DISTINCT l.code, ', ') AS locations
        FROM public.stock_ledger g
        JOIN public.documents doc ON doc.tenant_id = g.tenant_id AND doc.id = g.document_id
        JOIN public.stock_dimensions d ON d.tenant_id = g.tenant_id AND d.id = g.stock_dimension_id
        JOIN public.locations l ON l.tenant_id = d.tenant_id AND l.id = d.location_id
        LEFT JOIN public.users u ON u.id = g.actor_user_id
       WHERE g.tenant_id = ${t}::uuid AND g.item_id = ${item}::uuid
         AND (${scope}::uuid[] IS NULL OR l.warehouse_id = ANY(${scope}::uuid[]))
       GROUP BY g.document_id, doc.kind, doc.number, u.name
       ORDER BY max(g.occurred_at) DESC, g.document_id
       LIMIT ${limit}`);
    const count = await tx.execute<{ n: number }>(sql`
      SELECT count(DISTINCT g.document_id)::int AS n
        FROM public.stock_ledger g
        JOIN public.stock_dimensions d ON d.tenant_id = g.tenant_id AND d.id = g.stock_dimension_id
        JOIN public.locations l ON l.tenant_id = d.tenant_id AND l.id = d.location_id
       WHERE g.tenant_id = ${t}::uuid AND g.item_id = ${item}::uuid
         AND (${scope}::uuid[] IS NULL OR l.warehouse_id = ANY(${scope}::uuid[]))`);
    return { moves, total: Number(count[0]?.n ?? 0) };
  });
}

export type ItemLotRow = {
  readonly id: string;
  readonly lotCode: string;
  readonly productionDate: string | null;
  readonly expiryDate: string | null;
  readonly supplierLot: string | null;
  /** Kapsamdaki depolarda eldeki miktar (decimal dizgi; stoğu yoksa "0"). */
  readonly quantity: string;
};
export type ItemSerialRow = {
  readonly id: string;
  readonly serialNo: string;
  readonly lotCode: string | null;
  /** Serinin bulunduğu raf yeri (kapsamdaki depoda ve eldeyse); yoksa `null`. */
  readonly locationCode: string | null;
  readonly warehouseName: string | null;
};
export const ITEM_TRACKING_DEFAULT_LIMIT = 100;
export const ITEM_TRACKING_MAX_ROWS = 100;

export interface ItemTracking {
  readonly lots: readonly ItemLotRow[];
  readonly serials: readonly ItemSerialRow[];
  readonly lotTotal: number;
  readonly serialTotal: number;
  /** Opak keyset imleçleri (sonraki sayfa yoksa `null`); `listItemLots` / `listItemSerials` `after` olarak alır. */
  readonly lotNext: string | null;
  readonly serialNext: string | null;
}
export interface ItemTrackingPage<T> {
  readonly rows: readonly T[];
  readonly next: string | null;
}
export interface ItemTrackingPageOptions {
  readonly after?: string;
  readonly limit?: number;
}

// T-1116 (Codex P2): lot ve seri listeleri ayrı ayrı keyset sayfalanır (OFFSET yok, I-14). Lot sırası SKT (boşlar sonda) › kod › kimlik;
// seri sırası numara › kimlik. İmleç opak base64url JSON; biçim dışı imleç `VALIDATION_FAILED`.
type LotCursor = { readonly e: string | null; readonly c: string; readonly i: string };
type SerialCursor = { readonly c: string; readonly i: string };
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const enc = (v: object): string => Buffer.from(JSON.stringify(v), "utf8").toString("base64url");
function dec(raw: string): Record<string, unknown> {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new AppError("VALIDATION_FAILED");
  try {
    const o: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof o !== "object" || o === null) throw new AppError("VALIDATION_FAILED");
    return o as Record<string, unknown>;
  } catch {
    throw new AppError("VALIDATION_FAILED");
  }
}
const okText = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 512;
function lotCursor(raw: string): LotCursor {
  const o = dec(raw);
  if (!(o.e === null || (typeof o.e === "string" && DAY_RE.test(o.e))) || !okText(o.c) || typeof o.i !== "string" || !UUID.test(o.i)) throw new AppError("VALIDATION_FAILED");
  return { e: o.e as string | null, c: o.c, i: o.i.toLowerCase() };
}
function serialCursor(raw: string): SerialCursor {
  const o = dec(raw);
  if (!okText(o.c) || typeof o.i !== "string" || !UUID.test(o.i)) throw new AppError("VALIDATION_FAILED");
  return { c: o.c, i: o.i.toLowerCase() };
}
function pageLimit(limit: number | undefined): number {
  const n = limit ?? ITEM_TRACKING_DEFAULT_LIMIT;
  if (!Number.isInteger(n) || n < 1 || n > ITEM_TRACKING_MAX_ROWS) throw new AppError("VALIDATION_FAILED");
  return n;
}

async function lotsPage(tx: AccessTx, t: string, item: string, scope: string | null, after: LotCursor | null, limit: number): Promise<ItemTrackingPage<ItemLotRow>> {
  const cond =
    after === null
      ? sql``
      : after.e === null
        ? sql`AND lo.expiry_date IS NULL AND (lo.lot_code, lo.id) > (${after.c}, ${after.i}::uuid)`
        : sql`AND (lo.expiry_date IS NULL OR lo.expiry_date > ${after.e}::date
                   OR (lo.expiry_date = ${after.e}::date AND (lo.lot_code, lo.id) > (${after.c}, ${after.i}::uuid)))`;
  const rows = await tx.execute<ItemLotRow>(sql`
      SELECT lo.id, lo.lot_code AS "lotCode", lo.production_date::text AS "productionDate", lo.expiry_date::text AS "expiryDate",
             lo.supplier_lot AS "supplierLot",
             coalesce((SELECT sum(b.quantity)
                         FROM public.stock_dimensions d
                         JOIN public.stock_balances b ON b.tenant_id = d.tenant_id AND b.stock_dimension_id = d.id
                         JOIN public.locations l ON l.tenant_id = d.tenant_id AND l.id = d.location_id
                        WHERE d.tenant_id = lo.tenant_id AND d.item_id = lo.item_id AND d.lot_id = lo.id
                          AND (${scope}::uuid[] IS NULL OR l.warehouse_id = ANY(${scope}::uuid[]))), 0)::text AS quantity
        FROM public.lots lo
       WHERE lo.tenant_id = ${t}::uuid AND lo.item_id = ${item}::uuid ${cond}
       ORDER BY lo.expiry_date NULLS LAST, lo.lot_code, lo.id
       LIMIT ${limit + 1}`);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { rows: page, next: rows.length > limit && last !== undefined ? enc({ e: last.expiryDate, c: last.lotCode, i: last.id }) : null };
}

async function serialsPage(tx: AccessTx, t: string, item: string, scope: string | null, after: SerialCursor | null, limit: number): Promise<ItemTrackingPage<ItemSerialRow>> {
  const cond = after === null ? sql`` : sql`AND (s.serial_no, s.id) > (${after.c}, ${after.i}::uuid)`;
  const rows = await tx.execute<ItemSerialRow>(sql`
      SELECT s.id, s.serial_no AS "serialNo", lo.lot_code AS "lotCode", pos.code AS "locationCode", pos.wname AS "warehouseName"
        FROM public.serials s
        LEFT JOIN public.lots lo ON lo.tenant_id = s.tenant_id AND lo.id = s.lot_id
        LEFT JOIN LATERAL (
          SELECT l.code, w.name AS wname
            FROM public.stock_dimensions d
            JOIN public.stock_balances b ON b.tenant_id = d.tenant_id AND b.stock_dimension_id = d.id AND b.quantity > 0
            JOIN public.locations l ON l.tenant_id = d.tenant_id AND l.id = d.location_id
            JOIN public.warehouses w ON w.tenant_id = l.tenant_id AND w.id = l.warehouse_id
           WHERE d.tenant_id = s.tenant_id AND d.item_id = s.item_id AND d.serial_id = s.id
             AND (${scope}::uuid[] IS NULL OR w.id = ANY(${scope}::uuid[]))
           ORDER BY l.code
           LIMIT 1) pos ON true
       WHERE s.tenant_id = ${t}::uuid AND s.item_id = ${item}::uuid ${cond}
       ORDER BY s.serial_no, s.id
       LIMIT ${limit + 1}`);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { rows: page, next: rows.length > limit && last !== undefined ? enc({ c: last.serialNo, i: last.id }) : null };
}

/**
 * Ürünün lotları ve serileri — ilk sayfalar + toplam sayılar. Lot/seri kartı katalog verisidir (depodan bağımsız); miktar ve yer yalnız
 * kapsamdaki depolardan gelir (kapsam dışı deponun stoğu görünmez). Sonraki sayfalar `listItemLots` / `listItemSerials` ile.
 */
export async function listItemTracking(params: Params, itemId: string, options: { readonly limit?: number } = {}): Promise<ItemTracking> {
  const item = uuid(itemId);
  const limit = pageLimit(options.limit);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, member) => {
    const allowed = await resolveWarehouseScope(tx, member);
    const scope = allowed === null ? null : pgUuidArray(allowed);
    const t = member.tenantId;
    const lots = await lotsPage(tx, t, item, scope, null, limit);
    const serials = await serialsPage(tx, t, item, scope, null, limit);
    const totals = await tx.execute<{ lots: number; serials: number }>(sql`
      SELECT (SELECT count(*)::int FROM public.lots WHERE tenant_id = ${t}::uuid AND item_id = ${item}::uuid) AS lots,
             (SELECT count(*)::int FROM public.serials WHERE tenant_id = ${t}::uuid AND item_id = ${item}::uuid) AS serials`);
    return {
      lots: lots.rows,
      serials: serials.rows,
      lotTotal: Number(totals[0]?.lots ?? 0),
      serialTotal: Number(totals[0]?.serials ?? 0),
      lotNext: lots.next,
      serialNext: serials.next,
    };
  });
}

/** Lotların sonraki sayfası (`after` = önceki sayfanın `lotNext`'i). */
export async function listItemLots(params: Params, itemId: string, options: ItemTrackingPageOptions = {}): Promise<ItemTrackingPage<ItemLotRow>> {
  const item = uuid(itemId);
  const limit = pageLimit(options.limit);
  const after = options.after === undefined ? null : lotCursor(options.after);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, member) => {
    const allowed = await resolveWarehouseScope(tx, member);
    return lotsPage(tx, member.tenantId, item, allowed === null ? null : pgUuidArray(allowed), after, limit);
  });
}

/** Serilerin sonraki sayfası (`after` = önceki sayfanın `serialNext`'i). */
export async function listItemSerials(params: Params, itemId: string, options: ItemTrackingPageOptions = {}): Promise<ItemTrackingPage<ItemSerialRow>> {
  const item = uuid(itemId);
  const limit = pageLimit(options.limit);
  const after = options.after === undefined ? null : serialCursor(options.after);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, member) => {
    const allowed = await resolveWarehouseScope(tx, member);
    return serialsPage(tx, member.tenantId, item, allowed === null ? null : pgUuidArray(allowed), after, limit);
  });
}
