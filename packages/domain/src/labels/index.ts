// Etiket alanı (T-312, ADR-022): Code 128 kodlayıcı + ZPL/SVG şablonları + etiket kaynağı okuma. Stok yazmaz.
// `loadLabelSource` yalnızca mevcut tenant kapsamlı okumaları (`stock.view`, RLS) kullanır: başka tenant'ın ya da olmayan kaynak
// `NOT_FOUND` (aynı yanıt); `stock.view` yoksa `FORBIDDEN`.
import { getItem, listItemBarcodes } from "../catalog/index.ts";
import { searchItems, type SearchItemsInput } from "../catalog/reads.ts";
import { runTenantQuery } from "../identity/access.ts";
import { sql } from "drizzle-orm";
import { listUnits } from "../catalog/units.ts";
import { getLocationTree, type LocationRow } from "../warehouse/index.ts";
import { AppError } from "@wms/shared/errors";
import type { LabelData, LabelTemplate } from "./templates.ts";

export * from "./code128.ts";
export * from "./templates.ts";

type Params = Parameters<typeof listUnits>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TREE_PAGE = 200;
const TREE_MAX_PAGES = 20;

export interface LabelSourceQuery {
  readonly itemId?: string | undefined;
  readonly warehouseId?: string | undefined;
  readonly locationId?: string | undefined;
  /** `locationId` ile birlikte: kök ve tüm alt lokasyonlar. */
  readonly subtree?: boolean | undefined;
}
export interface LabelSource {
  readonly template: LabelTemplate;
  readonly datas: readonly LabelData[];
  /** Dosya adı için güvenli olmayan ham ad; çağıran temizler. */
  readonly name: string;
}

/**
 * Kaynak seçimi (A-T312-5): `itemId` ya da `warehouseId` [+ `locationId` [+ `subtree`]] (kök yoksa depodaki tüm lokasyonlar).
 * Hiçbiri verilmediyse `null`. Geçersiz kimlik `NOT_FOUND` (varlık sızdırılmaz).
 */
export async function loadLabelSource(params: Params, q: LabelSourceQuery): Promise<LabelSource | null> {
  const { itemId, warehouseId, locationId } = q;
  if (itemId !== undefined) {
    if (!UUID_RE.test(itemId)) throw new AppError("NOT_FOUND");
    const item = await getItem(params, { itemId });
    const [barcodes, units] = await Promise.all([listItemBarcodes(params, item.id), listUnits(params)]);
    const base = units.find((u) => u.id === item.baseUnitId);
    // Ürün etiketi tek temel birimi tanımlar: koli/çevrim veya belirsiz barkod seçilmez.
    const primary = barcodes.find((b) => b.unitId === item.baseUnitId && b.quantity === "1" && !b.ambiguous);
    return { template: "product", name: `urun-${item.code}`, datas: [{ code: item.code, name: item.name, unit: base?.code ?? "", barcode: primary?.barcode ?? null }] };
  }
  if (warehouseId === undefined) return null;
  if (!UUID_RE.test(warehouseId) || (locationId !== undefined && !UUID_RE.test(locationId))) throw new AppError("NOT_FOUND");
  const all: LocationRow[] = [];
  let after: { depth: number; code: string; id: string } | undefined;
  for (let p = 0; p < TREE_MAX_PAGES; p++) {
    const page = await getLocationTree(params, { warehouseId, limit: TREE_PAGE, ...(after === undefined ? {} : { after }) });
    all.push(...page.items);
    if (page.next === null) break;
    after = page.next;
  }
  let chosen: readonly LocationRow[] = all;
  if (locationId !== undefined) {
    const root = all.find((l) => l.id === locationId);
    if (root === undefined) throw new AppError("NOT_FOUND");
    if (q.subtree === true) {
      const ids = new Set([root.id]);
      // Ağaç derinlik sıralıdır: ebeveyn her zaman çocuktan önce gelir.
      chosen = all.filter((l) => {
        if (l.id === root.id) return true;
        if (l.parentId !== null && ids.has(l.parentId)) {
          ids.add(l.id);
          return true;
        }
        return false;
      });
    } else chosen = [root];
  }
  if (chosen.length === 0) throw new AppError("NOT_FOUND");
  return { template: "location", name: `lokasyon-${chosen[0]?.code ?? "etiket"}`, datas: chosen.map((l) => ({ code: l.code, name: l.name })) };
}

export interface ProductLabelBatch extends LabelSource {
  readonly template: "product";
  readonly itemIds: readonly string[];
  readonly total: number;
  readonly nextCursor: string | null;
}

/** Filtrelenen ürünler için sınırlı baskı grubu. Liste ve baskı aynı searchItems keyset sözleşmesini kullanır.
 * Sorgu başına en çok 100 ürün; kullanıcı sonraki gruba nextCursor ile geçer. Stok veya barkod yazmaz.
 */
export async function loadProductLabelBatch(params: Params, input: SearchItemsInput = {}): Promise<ProductLabelBatch> {
  const page = await searchItems(params, { ...input, status: input.status ?? "ACTIVE", withTotal: true });
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, actor) => {
    if (page.items.length === 0) return { template: "product", name: "urunler", datas: [], itemIds: [], total: page.total ?? 0, nextCursor: page.nextCursor };
    const ids = page.items.map((item) => sql`${item.id}::uuid`);
    const rows = await tx.execute<{ id: string; code: string; name: string; unit: string; barcode: string | null }>(sql`
      SELECT i.id, i.code, i.name, u.code AS unit, b.barcode
        FROM public.items i
        JOIN public.units u ON u.tenant_id = i.tenant_id AND u.id = i.base_unit_id
        LEFT JOIN LATERAL (
          SELECT ib.barcode FROM public.item_barcodes ib
           WHERE ib.tenant_id = i.tenant_id AND ib.item_id = i.id
             AND COALESCE(ib.unit_id, i.base_unit_id) = i.base_unit_id AND COALESCE(ib.quantity, 1) = 1
             AND NOT EXISTS (
               SELECT 1 FROM public.item_barcodes other_barcode
                 JOIN public.items other_item ON other_item.tenant_id = other_barcode.tenant_id AND other_item.id = other_barcode.item_id
                WHERE other_barcode.tenant_id = i.tenant_id AND other_barcode.barcode = ib.barcode
                  AND other_item.status = 'ACTIVE'
                  AND (other_barcode.item_id <> i.id
                    OR COALESCE(other_barcode.unit_id, other_item.base_unit_id) <> i.base_unit_id
                    OR COALESCE(other_barcode.quantity, 1) <> 1)
             )
           ORDER BY ib.barcode, ib.id LIMIT 1
        ) b ON true
       WHERE i.tenant_id = ${actor.tenantId}::uuid AND i.id IN (${sql.join(ids, sql`, `)})
       ORDER BY i.code, i.id`);
    return { template: "product", name: "urunler", itemIds: rows.map(r => r.id), datas: rows.map(({ code, name, unit, barcode }) => ({ code, name, unit, barcode })), total: page.total ?? 0, nextCursor: page.nextCursor };
  });
}
