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
import { runTenantQuery, type TenantAccessParams } from "../identity/access.ts";
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
    return { places, min: minRows[0]?.min ?? null, moves };
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
