// T-1055: depo listesinin bir sayfası (sunucu). Sayfa bileşeni ilk sayfayı, `loadMoreWarehousesAction` sonrakileri aynı yoldan okur (aynı
// domain okuyucuları ve yetki; keyset imleç `afterCode`, OFFSET yok). Kural yok; yalnız görünüm şekline çevirme.
import { countLocationsByWarehouse, listWarehouses } from "@wms/domain/warehouse";
import type { WarehouseView } from "./warehouses-view.tsx";

export const WAREHOUSES_PAGE_SIZE = 50;

type Call = Parameters<typeof listWarehouses>[0];

export interface WarehousesPage {
  readonly rows: WarehouseView[];
  readonly nextAfter: string | null;
  readonly total: number | undefined;
}

export async function loadWarehousesPage(call: Call, input: { readonly q: string; readonly archived: boolean; readonly after?: string | undefined }): Promise<WarehousesPage> {
  const first = input.after === undefined || input.after === "";
  const page = await listWarehouses(call, { onlyArchived: input.archived, limit: WAREHOUSES_PAGE_SIZE, q: input.q, withTotal: first, ...(first ? {} : { afterCode: input.after }) });
  // Sayfa en çok 50 depo döndürür → toplu sayım sınırı (100) içinde; boş sayfada sorgu yapılmaz.
  const counts = page.items.length === 0 ? new Map<string, number>() : await countLocationsByWarehouse(call, { warehouseIds: page.items.map((w) => w.id) });
  const rows = page.items.map((w): WarehouseView => ({ id: w.id, code: w.code, name: w.name, status: w.status, locationCount: counts.get(w.id) ?? 0, locationCountCapped: false }));
  return { rows, nextAfter: page.nextAfterCode, total: page.total };
}
