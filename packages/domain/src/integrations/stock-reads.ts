// Stok OKUMALARI — yalnız SELECT (T-991; I-04, G-01). Stok tablosu adı yalnız bu dosyadadır (`wms/stock-sql-guard` dosya düzeyinde ad arar;
// kardeş örnek ledger-reads.ts). Yazma ve kilit yoktur: ERP'ye gönderilecek "eldeki miktar" eşlemeli ürün × eşlemeli depo için okunur.
//
// T-1135 — ERP'ye giden toplamın KESİN kümesi (kullanıcı kararı 30 Ekim: stok sahibi Etkin; Paraşüt'e satılabilir eldeki miktar gider):
//   DAHİL: `stock_status = 'AVAILABLE'` boyutların bakiyesi (rezerve dahil: fiziksel eldeki), yalnız `locations.kind IN ('RECEIVING','STORAGE')`
//          raflarda, raf ve depo durumu ne olsun (arşivli raftaki kalan stok da eldedir).
//   HARİÇ: karantina / hasarlı / bloke (`QUARANTINE`, `DAMAGED`, `BLOCKED`) ve yoldaki / sevk sahası (`TRANSIT`, `STAGING`) stok.
// Aynı küme `STOCK_TOTAL_STATUSES` / `STOCK_TOTAL_LOCATION_KINDS` sabitlerindedir (kart + birim testi bu sabitleri okur).
import { sql } from "drizzle-orm";
import type { AccessTx } from "../identity/access.ts";

export const STOCK_TOTAL_STATUSES = Object.freeze(["AVAILABLE"] as const);
export const STOCK_TOTAL_LOCATION_KINDS = Object.freeze(["RECEIVING", "STORAGE"] as const);

export type StockLevelRow = {
  item_id: string;
  warehouse_id: string;
  /** Ondalık metin (I-09). */
  quantity: string;
  product_ext: string;
  warehouse_ext: string;
  /** T-1135: toplamın okunduğu anlık görüntü (`pg_current_snapshot()::text`, aynı ifade); başarılı gönderimde işarete yazılır. */
  snap: string;
};

/**
 * Son gönderimden (integration_stock_marks) farklı olan eşlemeli ürün × depo toplamları; bakiyesi kalmayan eski işaretli çift 0 ile döner.
 * Kesin reddedilmiş (`failed_quantity`) toplam aynı kaldıkça yeniden seçilmez; toplam değişince yine gider. Hiç gönderilmemiş ve 0 olan çift
 * gönderilmez. Sınır `limit` (koşu başına en çok bu kadar satır; kalan sonraki koşuda).
 */
export async function selectChangedStockLevels(tx: AccessTx, tenantId: string, integrationId: string, system: string, limit: number): Promise<StockLevelRow[]> {
  const statuses = sql.join(STOCK_TOTAL_STATUSES.map((s) => sql`${s}`), sql`, `);
  const kinds = sql.join(STOCK_TOTAL_LOCATION_KINDS.map((k) => sql`${k}`), sql`, `);
  return tx.execute<StockLevelRow>(
    sql`WITH it AS (
          SELECT entity_id AS item_id, external_id AS ext FROM public.external_refs WHERE tenant_id = ${tenantId}::uuid AND system = ${system} AND entity_type = 'ITEM'
        ), wh AS (
          SELECT entity_id AS warehouse_id, external_id AS ext FROM public.external_refs WHERE tenant_id = ${tenantId}::uuid AND system = ${system} AND entity_type = 'WAREHOUSE'
        ), totals AS (
          SELECT d.item_id, l.warehouse_id, SUM(b.quantity) AS q
            FROM public.stock_balances b
            JOIN public.stock_dimensions d ON d.tenant_id = b.tenant_id AND d.id = b.stock_dimension_id
            JOIN public.locations l ON l.tenant_id = d.tenant_id AND l.id = d.location_id
           WHERE b.tenant_id = ${tenantId}::uuid
             AND d.stock_status IN (${statuses}) AND l.kind IN (${kinds})
             AND d.item_id IN (SELECT item_id FROM it) AND l.warehouse_id IN (SELECT warehouse_id FROM wh)
           GROUP BY d.item_id, l.warehouse_id
        ), pairs AS (
          SELECT item_id, warehouse_id, q FROM totals
          UNION ALL
          SELECT m.item_id, m.warehouse_id, 0::numeric FROM public.integration_stock_marks m
           WHERE m.tenant_id = ${tenantId}::uuid AND m.integration_id = ${integrationId}::uuid
             AND NOT EXISTS (SELECT 1 FROM totals t WHERE t.item_id = m.item_id AND t.warehouse_id = m.warehouse_id)
        )
        SELECT p.item_id, p.warehouse_id, p.q::text AS quantity, it.ext AS product_ext, wh.ext AS warehouse_ext, pg_current_snapshot()::text AS snap
          FROM pairs p
          JOIN it ON it.item_id = p.item_id
          JOIN wh ON wh.warehouse_id = p.warehouse_id
          LEFT JOIN public.integration_stock_marks m
                 ON m.tenant_id = ${tenantId}::uuid AND m.integration_id = ${integrationId}::uuid AND m.item_id = p.item_id AND m.warehouse_id = p.warehouse_id
         WHERE m.quantity IS DISTINCT FROM p.q AND NOT (m.quantity IS NULL AND p.q = 0)
           AND m.failed_quantity IS DISTINCT FROM p.q
         ORDER BY p.item_id, p.warehouse_id
         LIMIT ${limit}`,
  );
}
