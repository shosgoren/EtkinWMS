// T-1055: ürün listesinin bir sayfası (sunucu). Sayfa bileşeni ilk sayfayı, `loadMoreItemsAction` sonrakileri aynı yoldan okur (aynı domain
// okuyucuları, aynı yetki: `stock.view`; keyset imleç, OFFSET yok). Kural yok; yalnız görünüm şekline çevirme.
import { listItemMainThumbs, listPrimaryBarcodes, searchItems } from "@wms/domain/catalog";
import { listUnits } from "@wms/domain/catalog/units";
import { sumItemsStock } from "@wms/domain/stock";
import type { CardType, ItemListView, ItemStockView } from "./items-view.tsx";

import { domainExtraFilters, type ItemExtraFilters } from "./filters.ts";

export const ITEMS_PAGE_SIZE = 50;

type Call = Parameters<typeof searchItems>[0];

export interface ItemsPageInput extends ItemExtraFilters {
  readonly q: string;
  readonly status: "" | "ACTIVE" | "ARCHIVED" | "REMOVED";
  readonly cardType: "" | CardType;
  readonly after?: string | undefined;
}

export interface ItemsPage {
  readonly rows: ItemListView[];
  readonly stock: Record<string, ItemStockView>;
  readonly nextCursor: string | null;
  readonly total: number | undefined;
  readonly units: Awaited<ReturnType<typeof listUnits>>;
}

export async function loadItemsPage(call: Call, input: ItemsPageInput): Promise<ItemsPage> {
  const first = input.after === undefined || input.after === "";
  const page = await searchItems(call, {
    limit: ITEMS_PAGE_SIZE,
    ...domainExtraFilters(input),
    // T-436: toplam yalnız ilk sayfada (sayfa başına tam COUNT yükü olmasın; güvenlik incelemesi MINOR).
    withTotal: first,
    ...(input.q.trim() === "" ? {} : { q: input.q }),
    // T-1040 (kullanıcı 26 Ekim): arşivli ürün normal listede yok; yalnız "Arşivli" süzgecinde.
    status: input.status === "" ? "ACTIVE" : input.status,
    ...(input.cardType === "" ? {} : { cardType: input.cardType }),
    ...(first ? {} : { after: input.after }),
  });
  const units = await listUnits(call);
  const unitCode = new Map(units.map((u) => [u.id, u.code] as const));
  // T-257: arama ESKİ kodla eşleştiyse sonuç kartında "bu kod X olarak değişti" bilgisi (sunucu `renamedFrom` verir; kural istemcide yok).
  const old = new Map((page.renamedFrom ?? []).map((r) => [r.itemId, r.oldCode] as const));
  const rows = page.items.map((it): ItemListView => {
    const oldCode = old.get(it.id);
    return { id: it.id, code: it.code, name: it.name, status: it.status, sourceDisposition: it.sourceDisposition ?? "NONE", baseUnitCode: unitCode.get(it.baseUnitId) ?? "", cardType: it.cardType, ...(oldCode === undefined ? {} : { oldCode }) };
  });
  // T-968: kart rozeti (kapsamdaki depoların eldeki toplamı + minimum); okunamazsa rozet çizilmez, liste yine açılır.
  // T-1117: ayrılmış + kullanılabilir de (liste "Kullanılabilir" sütunu); "Barkod" sütunu ürün başına ilk barkod. İkisi de okunamazsa
  // sütun boş kalır, liste yine açılır.
  const ids = rows.map((r) => r.id);
  const sums = await sumItemsStock(call, ids).catch(() => []);
  const barcodes = await listPrimaryBarcodes(call, ids).catch(() => []);
  // T-1160: "Görsel" sütunu — kapak küçük resmi (`data:` adresi, ≤ 16 KiB) + görsel sayısı; okunamazsa sütun boş ("+").
  const thumbs = await listItemMainThumbs(call, ids).catch(() => []);
  const thumbOf = new Map(thumbs.map((x) => [x.itemId, { thumb: x.thumb, count: x.count }] as const));
  const stock = Object.fromEntries(sums.map((x) => [x.itemId, { have: x.have, min: x.min, available: x.available }] as const));
  const barcodeOf = new Map(barcodes.map((b) => [b.itemId, b.barcode] as const));
  const withBarcode = rows.map((r): ItemListView => {
    const barcode = barcodeOf.get(r.id);
    const image = thumbOf.get(r.id);
    return { ...r, ...(barcode === undefined ? {} : { barcode }), ...(image === undefined ? {} : { image }) };
  });
  return { rows: withBarcode, stock, nextCursor: page.nextCursor, total: page.total, units };
}
