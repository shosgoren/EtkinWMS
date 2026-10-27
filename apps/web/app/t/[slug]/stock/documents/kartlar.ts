// T-1059: stok belgesi kartlarının görünüm verisi (sunucu). Sayfa ilk sayfayı, `loadMoreDocumentsAction` sonrakileri aynı biçimle üretir.
import { getLocale, getTranslations } from "next-intl/server";
import type { listStockDocuments } from "@wms/domain/stock";
import { LICON } from "../../../../design/kalip-icons.ts";
import type { KalipKartVeri } from "../../kalip/akis.tsx";
import { fmtGun } from "../../kalip/format.ts";

type Row = Awaited<ReturnType<typeof listStockDocuments>>["items"][number];
const KIND_ICON = { in: { d: LICON.moveIn, color: "2F7D5B" }, out: { d: LICON.moveOut, color: "B85A14" } } as const;

export async function belgeKartlari(rows: readonly Row[], path: string): Promise<KalipKartVeri[]> {
  const t = await getTranslations("stockDocuments");
  const locale = await getLocale();
  return rows.map((row) => {
    const kind = t(row.kind === "STOCK_IN" ? "in" : "out");
    const icon = row.kind === "STOCK_IN" ? KIND_ICON.in : KIND_ICON.out;
    const state = t(`states.${row.status}`);
    const number = row.number ?? t("draft");
    const date = fmtGun(row.businessDate, locale);
    return {
      key: row.id,
      name: `${number} · ${kind}`,
      code: `${row.warehouseName} · ${date} · ${state}`,
      ...(row.reason ? { meta: row.reason } : {}),
      d: icon.d,
      color: icon.color,
      href: `${path}?id=${row.id}`,
      aria: t("k.cardAria", { number, kind, warehouse: row.warehouseName, date, state }),
    };
  });
}
