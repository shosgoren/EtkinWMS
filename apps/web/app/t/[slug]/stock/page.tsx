import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { listStockOverview } from "@wms/domain/stock";
import { AppError } from "@wms/shared/errors";
import { LICON } from "../../../design/kalip-icons.ts";
import { KalipBaslik, KalipEkran } from "../kalip/ekran.tsx";
import { fmtQty } from "../kalip/format.ts";
import { KalipAra, KalipBos, KalipCipler, KalipDaha, KalipKart, KalipKartListe, KalipKilitliEkran } from "../kalip/liste.tsx";
import { BOLUM_ICON, bolumCipleri, kalipDark } from "./belge-kalip.ts";

// Stok durumu (T-972, B-63 grup 2): liste kalıbı (KalipListe.dc.html). Veri ve yetki değişmedi: `listStockOverview` (stock.view, keyset).
// Kart: ürün + depo; rozet kullanılabilir miktar (decimal dizgisi kayan noktasız biçimlenir); ek satır fiziksel / ayrılmış. Karta dokununca
// ürün kartı açılır. Bilinçli farklar (DESIGN-PARITY): minimum politikası bu sorguda yok → trafik ışığı yok; sesle arama Etkin (B-62) ile.
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("stockOverview");
  return { title: t("title") };
}
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function StockPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const q = first(sp.q) ?? "";
  const after = first(sp.after);
  const warehouseId = first(sp.warehouse);
  const home = `/t/${encodeURIComponent(slug)}`;
  const path = `${home}/stock`;
  const t = await getTranslations("stockOverview");
  const tk = await getTranslations("kural");
  const locale = await getLocale();
  const { getAuthService } = await import("../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(path)}`);
  const dark = await kalipDark();
  let data: Awaited<ReturnType<typeof listStockOverview>>;
  try {
    data = await listStockOverview({ db: getAppDb(), principal, tenantSlug: slug }, { q, withTotal: true, ...(after ? { after } : {}), ...(warehouseId ? { warehouseId } : {}) });
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND" || e.code === "VALIDATION_FAILED") notFound();
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(path)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(path)}`);
      if (e.code === "FORBIDDEN")
        return (
          <main className="flex w-full min-w-0 flex-col">
            <KalipKilitliEkran title={t("title")} icon={BOLUM_ICON.stock} text={t("locked")} hint={t("k.lockedHint")} dark={dark} home={home} />
          </main>
        );
    }
    throw e;
  }
  const nextParams = new URLSearchParams({ q });
  if (warehouseId) nextParams.set("warehouse", warehouseId);
  if (data.next) nextParams.set("after", data.next);
  const filtered = q !== "" || after !== undefined || warehouseId !== undefined;
  const fq = (v: string): string => fmtQty(v, locale);
  const chips = bolumCipleri(home, "stock", { stock: t("k.chipStock"), documents: t("k.chipDocs"), shipping: t("k.chipShipping"), production: t("k.chipProduction") });
  return (
    <main className="flex w-full min-w-0 flex-col">
      <KalipEkran
        kind="liste"
        dark={dark}
        title={t("title")}
        icon={BOLUM_ICON.stock}
        testId="stock"
        bar={{ back: { href: home }, main: { label: t("k.newShort"), aria: t("k.newAria"), d: LICON.plus, href: `${path}/documents?new=STOCK_IN`, testId: "stock-new" } }}
      >
        <KalipAra
          label={t("search")}
          placeholder={t("k.searchPh")}
          action={path}
          defaultValue={q}
          below={warehouseId ? <input type="hidden" name="warehouse" value={warehouseId} /> : undefined}
        />
        <KalipCipler label={t("k.chips")} chips={chips} />
        <details className="more" data-testid="stock-help">
          <summary style={{ cursor: "pointer", listStyle: "none" }}>{t("help")}</summary>
          <p style={{ margin: "8px 0 0" }}>{t("explanation")}</p>
        </details>
        {data.items.length === 0 ? (
          <KalipBos
            title={filtered ? tk("notFoundSearch") : t("empty")}
            hint={t("emptyAction")}
            action={filtered ? { label: t("reset"), href: path, kind: "clear" } : { label: t("k.firstIn"), href: `${path}/documents?new=STOCK_IN`, kind: "add" }}
          />
        ) : (
          <>
            <KalipBaslik title={data.total !== undefined ? t("k.count", { n: data.total }) : data.next === null && after === undefined ? t("k.count", { n: data.items.length }) : t("k.countMore", { n: data.items.length })} hint={t("k.hint")} />
            <KalipKartListe label={t("title")}>
              {data.items.map((row, i) => {
                const qty = fq(row.available);
                return (
                  <KalipKart
                    key={`${row.warehouseId}:${row.itemId}`}
                    index={i}
                    name={row.itemName}
                    code={row.itemCode}
                    meta={t("k.meta", { warehouse: row.warehouseName, code: row.warehouseCode, physical: fq(row.physical), reserved: fq(row.reserved), unit: row.unitCode })}
                    d={LICON.box}
                    color="2F5DA8"
                    badge={{ value: qty, sub: `${row.unitCode} · ${t("available")}` }}
                    href={`${home}/items/${encodeURIComponent(row.itemId)}`}
                    aria={t("k.cardAria", { name: row.itemName, code: row.itemCode, warehouse: row.warehouseName, qty, unit: row.unitCode })}
                    testId="stock-card"
                  />
                );
              })}
            </KalipKartListe>
          </>
        )}
        {after || data.next ? (
          <nav aria-label={t("pages")} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {after ? (
              <KalipDaha href={`${path}?${new URLSearchParams({ q, ...(warehouseId ? { warehouse: warehouseId } : {}) })}`} iconD={LICON.chev}>
                {t("first")}
              </KalipDaha>
            ) : null}
            {data.next ? (
              <KalipDaha href={`${path}?${nextParams}`} iconD={LICON.plus}>
                {t("next")}
              </KalipDaha>
            ) : null}
          </nav>
        ) : null}
      </KalipEkran>
    </main>
  );
}
