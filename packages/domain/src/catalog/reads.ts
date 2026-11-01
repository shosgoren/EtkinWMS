// Katalog okuma komutları (T-240; A-69, I-14). Hepsi `runTenantQuery` + `stock.view`: güncel üyelik + izin, tenant bağlamı
// `set_config(..., true)` ile transaction içinde; RLS + açık `tenant_id` filtresi. Yazmaz, stok tablolarını yalnızca okur (G-01).
// - `searchItems`: keyset `(code, id)`, OFFSET yok (I-14); imleç opaktır (base64url JSON) ve sunucuda sıkı doğrulanır.
// - Barkod belirsizliği (A-69): aynı barkod tenant içinde BAŞKA bir ACTIVE üründe de kayıtlıysa `ambiguous` (çözümleme arşivli
//   ürünleri hiç görmez, bu yüzden arşivli ürünler belirsizlik sayılmaz).
// - `itemInUse` tanımı `archiveItem` ile aynıdır (pozitif bakiye/rezerve miktar ya da ACTIVE rezervasyon). Not: tanım
//   items.ts'te satır içidir; ortak yardımcıya çıkarma kart dosya listesi dışında olduğundan T-240 raporunda önerilir.
import { sql } from "drizzle-orm";
import type { ItemCardType, PickPolicy, TrackingMode } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { runTenantQuery, type AccessTx } from "../identity/access.ts";
import { parseCardType, type ItemRow } from "./items.ts";
import { loadItem, parseText, parseUuid, type CatalogCommandParams, type ConversionUsage, type ItemHeader } from "./units.ts";

export type CatalogReadParams = Omit<CatalogCommandParams, "requestId">;

/** `limit` üst sınırı (kart: ≤ 100). */
export const SEARCH_MAX_LIMIT = 100;
export const SEARCH_DEFAULT_LIMIT = 50;
const SEARCH_Q_MAX = 128;
const CODE_MAX = 64; // parseCode ile aynı üst sınır
const CHILD_LIST_MAX = 200;

export type ItemStatusFilter = "ACTIVE" | "ARCHIVED" | "REMOVED";

export interface SearchItemsInput {
  /** Kod/ad öneki (büyük-küçük harf duyarsız) ya da barkod TAM eşleşmesi. Boş/yok: filtre yok. */
  readonly q?: string;
  readonly status?: ItemStatusFilter;
  /** T-968: kart türü süzgeci (HM / YM / MM / TM); yok: hepsi. */
  readonly cardType?: ItemCardType;
  /** T-1063: mevcut WMS takip politikası. Kaynak ERP bayrakları bu kararı değiştirmez. */
  readonly trackingMode?: TrackingMode;
  /** Kaynak kategori adı (tam eşleşme, harf duyarsız); kullanıcıya gösterilen adla süzülür. */
  readonly category?: string;
  readonly barcode?: "PRESENT" | "MISSING";
  /** Önceki sayfanın `nextCursor` değeri (opak). */
  readonly after?: string;
  /** 1..100; varsayılan 50. */
  readonly limit?: number;
  /** Toplam sayıyı da döndür (aynı işlem, aynı süzgeç/arama; imleç hariç — ALTIN-KURAL 15). */
  readonly withTotal?: boolean;
}

export interface SearchItemsResult {
  readonly items: readonly ItemRow[];
  /** Sonraki sayfa yoksa `null`. */
  readonly nextCursor: string | null;
  /** `withTotal: true` istendiğinde süzgece uyan toplam ürün sayısı. */
  readonly total?: number;
  /**
   * T-251: `q` bir kartın ESKİ koduyla tam eşleştiyse (kod değişmiş) o kart `items` içinde döner ve burada "bu kod X olarak değişti"
   * bilgisi yer alır. Eski kod eşleşmesi yoksa alan hiç bulunmaz.
   */
  readonly renamedFrom?: readonly { readonly oldCode: string; readonly itemId: string; readonly currentCode: string }[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function encodeCursor(code: string, id: string): string {
  return Buffer.from(JSON.stringify([code, id]), "utf8").toString("base64url");
}

function decodeCursor(raw: unknown): { readonly code: string; readonly id: string } {
  if (typeof raw !== "string" || raw === "" || raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new AppError("VALIDATION_FAILED");
  let v: unknown;
  try {
    v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new AppError("VALIDATION_FAILED");
  }
  if (!Array.isArray(v) || v.length !== 2) throw new AppError("VALIDATION_FAILED");
  const [code, id] = v as unknown[];
  if (typeof code !== "string" || code === "" || code.length > CODE_MAX || /[\u0000-\u001f\u007f]/.test(code)) throw new AppError("VALIDATION_FAILED");
  if (typeof id !== "string" || !UUID_RE.test(id)) throw new AppError("VALIDATION_FAILED");
  return { code, id };
}

function parseLimit(raw: unknown): number {
  if (raw === undefined) return SEARCH_DEFAULT_LIMIT;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > SEARCH_MAX_LIMIT) throw new AppError("VALIDATION_FAILED");
  return raw;
}

function parseStatus(raw: unknown): ItemStatusFilter | undefined {
  if (raw === undefined) return undefined;
  if (raw !== "ACTIVE" && raw !== "ARCHIVED" && raw !== "REMOVED") throw new AppError("VALIDATION_FAILED");
  return raw;
}

function toItemRow(r: ItemHeader & {source_disposition?:ItemRow["sourceDisposition"]}): ItemRow {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    baseUnitId: r.base_unit_id,
    trackingMode: r.tracking_mode as TrackingMode,
    quantityScale: r.quantity_scale,
    pickPolicy: r.pick_policy as PickPolicy,
    status: r.status,
    cardType: r.card_type as ItemCardType,
    ...(r.source_disposition===undefined?{}:{sourceDisposition:r.source_disposition}),
  };
}

/** `numeric(20,6)` metni (`"12.000000"`) → kanonik (`"12"`); boş miktar `"1"` (barcodes.ts ile aynı biçim). */
function canonical(q: string | null): string {
  if (q === null) return "1";
  return q.includes(".") ? q.replace(/0+$/, "").replace(/\.$/, "") : q;
}

/**
 * Ürün arama (keyset). Sıra `(code, id)`; `limit + 1` satır okunur, fazlası `nextCursor` üretir. Barkod eşleşmesi tam eşleşmedir;
 * kod/ad önek eşleşmesi `starts_with(lower(..), lower(..))` ile yapılır (LIKE joker karakteri sorunu yok).
 */
export async function searchItems(params: CatalogReadParams, input: SearchItemsInput = {}): Promise<SearchItemsResult> {
  if (input.q !== undefined && typeof input.q !== "string") throw new AppError("VALIDATION_FAILED");
  const qTrim = input.q === undefined ? "" : input.q.trim();
  const q = qTrim === "" ? undefined : parseText(qTrim, SEARCH_Q_MAX);
  const status = parseStatus(input.status);
  const cardType = input.cardType === undefined ? undefined : parseCardType(input.cardType);
  const trackingMode = input.trackingMode;
  if (trackingMode !== undefined && !["NONE", "LOT", "SERIAL", "LOT_AND_SERIAL"].includes(trackingMode)) throw new AppError("VALIDATION_FAILED");
  const category = input.category === undefined ? undefined : parseText(input.category, 200);
  if (input.barcode !== undefined && input.barcode !== "PRESENT" && input.barcode !== "MISSING") throw new AppError("VALIDATION_FAILED");
  const after = input.after === undefined ? undefined : decodeCursor(input.after);
  const limit = parseLimit(input.limit);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, actor) => {
    const tenant = actor.tenantId;
    const filters = [sql`i.tenant_id = ${tenant}::uuid`];
    if (status === "REMOVED") filters.push(sql`i.source_disposition='REMOVED'`);
    else { filters.push(sql`i.source_disposition<>'REMOVED'`); if(status!==undefined)filters.push(sql`i.status=${status}`); }
    if (cardType !== undefined) filters.push(sql`i.card_type = ${cardType}`);
    if (trackingMode !== undefined) filters.push(sql`i.tracking_mode = ${trackingMode}`);
    if (category !== undefined) filters.push(sql`EXISTS (
      SELECT 1 FROM jsonb_each(i.source_product_info) AS source(provider, info)
       WHERE lower(source.info->>'categoryName') = lower(${category})
    )`);
    if (input.barcode !== undefined) {
      const exists = sql`EXISTS (SELECT 1 FROM public.item_barcodes b WHERE b.tenant_id = i.tenant_id AND b.item_id = i.id)`;
      filters.push(input.barcode === "PRESENT" ? exists : sql`NOT ${exists}`);
    }
    if (q !== undefined) {
      filters.push(
        sql`(starts_with(lower(i.code), lower(${q})) OR starts_with(lower(i.name), lower(${q}))
             OR EXISTS (SELECT 1 FROM public.item_barcodes b WHERE b.tenant_id = i.tenant_id AND b.item_id = i.id AND b.barcode = ${q})
             OR EXISTS (SELECT 1 FROM public.code_history h WHERE h.tenant_id = i.tenant_id AND h.entity_type = 'item' AND h.entity_id = i.id
                                AND lower(h.old_code) = lower(${q})))`,
      );
    }
    const total =
      input.withTotal === true
        ? Number((await tx.execute<{ n: number | string }>(sql`SELECT count(*)::int AS n FROM public.items i WHERE ${sql.join(filters, sql` AND `)}`))[0]?.n ?? 0)
        : undefined;
    if (after !== undefined) filters.push(sql`(i.code, i.id) > (${after.code}, ${after.id}::uuid)`);
    const rows = await tx.execute<ItemHeader & {source_disposition:NonNullable<ItemRow["sourceDisposition"]>}>(
      sql`SELECT i.id, i.code, i.name, i.base_unit_id, i.tracking_mode, i.quantity_scale, i.pick_policy, i.status, i.card_type, i.source_disposition
            FROM public.items i
           WHERE ${sql.join(filters, sql` AND `)}
           ORDER BY i.code, i.id
           LIMIT ${limit + 1}`,
    );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > limit && last !== undefined ? encodeCursor(last.code, last.id) : null;
    const items = page.map(toItemRow);
    const counted = total === undefined ? {} : { total };
    if (q === undefined || items.length === 0) return { items, nextCursor, ...counted };
    const ids = items.map((r) => r.id);
    const hist = await tx.execute<{ old_code: string; item_id: string; current_code: string }>(
      sql`SELECT DISTINCT ON (h.entity_id) h.old_code, h.entity_id AS item_id, i.code AS current_code
            FROM public.code_history h JOIN public.items i ON i.tenant_id = h.tenant_id AND i.id = h.entity_id
           WHERE h.tenant_id = ${tenant}::uuid AND h.entity_type = 'item' AND lower(h.old_code) = lower(${q})
             AND lower(i.code) <> lower(${q}) AND h.entity_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
           ORDER BY h.entity_id, h.changed_at DESC, h.id DESC`,
    );
    if (hist.length === 0) return { items, nextCursor, ...counted };
    return { items, nextCursor, ...counted, renamedFrom: hist.map((h) => ({ oldCode: h.old_code, itemId: h.item_id, currentCode: h.current_code })) };
  });
}

export interface ItemConversionRow {
  readonly unitId: string;
  readonly unitCode: string;
  readonly unitName: string;
  /** 1 birim = `factor` temel birim; kanonik decimal metin (I-09). */
  readonly factor: string;
  /** T-1145: kaldırma kilidi — belge / mal kabul satırı ya da birimli barkod bu birimi kullanıyorsa nedeni; yoksa `null`. */
  readonly usage: ConversionUsage | null;
}

export interface ItemBarcodeRow {
  readonly id: string;
  readonly barcode: string;
  /** Barkodda birim yoksa ürünün temel birimi. */
  readonly unitId: string;
  readonly unitCode: string;
  /** Okutma başına miktar (kanonik); barkodda yoksa `"1"`. */
  readonly quantity: string;
  /** Aynı barkod başka ACTIVE ürüne veya aynı ürünün farklı etkin birim/miktarına da çözülüyor (A-69). */
  readonly ambiguous: boolean;
}

async function ensureItem(tx: AccessTx, tenantId: string, itemId: string): Promise<ItemHeader> {
  const item = await loadItem(tx, tenantId, itemId);
  if (item === undefined) throw new AppError("NOT_FOUND");
  return item;
}

/** Tek ürünün birim dönüşümleri (en çok 200; birim başına tek satır). Başka tenant/olmayan ürün: `NOT_FOUND`. */
export async function listItemConversions(params: CatalogReadParams, itemIdRaw: string): Promise<readonly ItemConversionRow[]> {
  const itemId = parseUuid(itemIdRaw);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, actor) => {
    await ensureItem(tx, actor.tenantId, itemId);
    const rows = await tx.execute<{ unit_id: string; unit_code: string; unit_name: string; factor: string; doc: boolean; bc: boolean }>(
      sql`SELECT c.unit_id, u.code AS unit_code, u.name AS unit_name, c.to_base_factor::text AS factor,
                 (EXISTS (SELECT 1 FROM public.document_lines x WHERE x.tenant_id = c.tenant_id AND x.item_id = c.item_id AND x.unit_id = c.unit_id)
                  OR EXISTS (SELECT 1 FROM public.inbound_receipt_lines x WHERE x.tenant_id = c.tenant_id AND x.item_id = c.item_id AND x.unit_id = c.unit_id)) AS doc,
                 EXISTS (SELECT 1 FROM public.item_barcodes x WHERE x.tenant_id = c.tenant_id AND x.item_id = c.item_id AND x.unit_id = c.unit_id) AS bc
            FROM public.unit_conversions c
            JOIN public.units u ON u.tenant_id = c.tenant_id AND u.id = c.unit_id
           WHERE c.tenant_id = ${actor.tenantId}::uuid AND c.item_id = ${itemId}::uuid
           ORDER BY u.code, c.id
           LIMIT ${CHILD_LIST_MAX}`,
    );
    // Kullanım tanımı `conversionUsage` (units.ts) ve 0072 silme bekçisiyle aynı.
    return rows.map((r) => ({ unitId: r.unit_id, unitCode: r.unit_code, unitName: r.unit_name, factor: canonical(r.factor), usage: r.doc ? "DOCUMENT" : r.bc ? "BARCODE" : null }));
  });
}

/** Tek ürünün barkodları (en çok 200) + belirsizlik bayrağı. Başka tenant/olmayan ürün: `NOT_FOUND`. */
export async function listItemBarcodes(params: CatalogReadParams, itemIdRaw: string): Promise<readonly ItemBarcodeRow[]> {
  const itemId = parseUuid(itemIdRaw);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, actor) => {
    await ensureItem(tx, actor.tenantId, itemId);
    const rows = await tx.execute<{ id: string; barcode: string; unit_id: string; unit_code: string; quantity: string | null; ambiguous: boolean }>(
      sql`SELECT b.id, b.barcode, COALESCE(b.unit_id, i.base_unit_id) AS unit_id, u.code AS unit_code, b.quantity::text AS quantity,
                 EXISTS (SELECT 1 FROM public.item_barcodes o
                           JOIN public.items oi ON oi.tenant_id = o.tenant_id AND oi.id = o.item_id
                          WHERE o.tenant_id = b.tenant_id AND o.barcode = b.barcode AND oi.status = 'ACTIVE'
                            AND (o.item_id <> b.item_id OR COALESCE(o.unit_id, oi.base_unit_id) <> COALESCE(b.unit_id, i.base_unit_id)
                                 OR COALESCE(o.quantity, 1) <> COALESCE(b.quantity, 1))) AS ambiguous
            FROM public.item_barcodes b
            JOIN public.items i ON i.tenant_id = b.tenant_id AND i.id = b.item_id
            JOIN public.units u ON u.tenant_id = i.tenant_id AND u.id = COALESCE(b.unit_id, i.base_unit_id)
           WHERE b.tenant_id = ${actor.tenantId}::uuid AND b.item_id = ${itemId}::uuid
           ORDER BY b.barcode, u.code, b.id
           LIMIT ${CHILD_LIST_MAX}`,
    );
    return rows.map((r) => ({ id: r.id, barcode: r.barcode, unitId: r.unit_id, unitCode: r.unit_code, quantity: canonical(r.quantity), ambiguous: r.ambiguous }));
  });
}

/**
 * T-1117: ürün listesinin "Barkod" sütunu — ürün başına İLK barkod (en çok 100 ürün). Birincil işareti yoktur (şemada yok); sıra:
 * temel birimdeki barkod önce (birimsiz ya da temel birim), sonra en eski kayıt. Yalnız bağlamdaki tenant'ın satırları; başka tenant'ın
 * ürün kimliği verilirse o ürün sonuçta yer almaz (I-01). Barkodu olmayan ürün sonuçta yoktur.
 */
export async function listPrimaryBarcodes(params: CatalogReadParams, itemIdsRaw: readonly string[]): Promise<readonly { readonly itemId: string; readonly barcode: string }[]> {
  if (!Array.isArray(itemIdsRaw) || itemIdsRaw.length > 100) throw new AppError("VALIDATION_FAILED");
  const ids = itemIdsRaw.map((x) => parseUuid(x));
  if (ids.length === 0) return [];
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, actor) => {
    const rows = await tx.execute<{ item_id: string; barcode: string }>(
      sql`SELECT DISTINCT ON (b.item_id) b.item_id, b.barcode
            FROM public.item_barcodes b
            JOIN public.items i ON i.tenant_id = b.tenant_id AND i.id = b.item_id
           WHERE b.tenant_id = ${actor.tenantId}::uuid AND b.item_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
           ORDER BY b.item_id, (b.unit_id IS NULL OR b.unit_id = i.base_unit_id) DESC, b.created_at, b.id`,
    );
    return rows.map((r) => ({ itemId: r.item_id, barcode: r.barcode }));
  });
}

/** `archiveItem` ile aynı tanım: pozitif bakiye/rezerve miktar ya da ACTIVE rezervasyon varsa `true`. */
export async function itemInUse(params: CatalogReadParams, itemIdRaw: string): Promise<boolean> {
  const itemId = parseUuid(itemIdRaw);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, actor) => {
    await ensureItem(tx, actor.tenantId, itemId);
    const positive = await tx.execute<{ x: number }>(
      sql`SELECT 1 AS x FROM public.stock_balances b
            JOIN public.stock_dimensions d ON d.tenant_id = b.tenant_id AND d.id = b.stock_dimension_id
           WHERE d.tenant_id = ${actor.tenantId}::uuid AND d.item_id = ${itemId}::uuid AND (b.quantity > 0 OR b.reserved_quantity > 0)
           LIMIT 1`,
    );
    if (positive[0] !== undefined) return true;
    const open = await tx.execute<{ x: number }>(
      sql`SELECT 1 AS x FROM public.reservations
           WHERE tenant_id = ${actor.tenantId}::uuid AND item_id = ${itemId}::uuid AND status = 'ACTIVE' LIMIT 1`,
    );
    return open[0] !== undefined;
  });
}
