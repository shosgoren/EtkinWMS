import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getStockDocument, listStockDocuments } from "@wms/domain/stock";
import { AppError } from "@wms/shared/errors";
import { LICON } from "../../../../design/kalip-icons.ts";
import { KalipBaslik, KalipEkran } from "../../kalip/ekran.tsx";
import { KalipBos, KalipCipler, KalipKilitliEkran } from "../../kalip/liste.tsx";
import { BOLUM_ICON, bolumCipleri, kalipDark } from "../belge-kalip.ts";
import { FormEkran } from "../form-ekran.tsx";
import { KalipKartAkisi } from "../../kalip/akis.tsx";
import { loadMoreDocumentsAction } from "./actions.ts";
import { DocumentCard } from "./document-card.tsx";
import { DocumentForm } from "./document-form.tsx";
import { belgeKartlari } from "./kartlar.ts";
import { YeniIslemSecim } from "./yeni-secim.tsx";

// Stok işlemleri (T-972, B-63 grup 2): liste (KalipListe), belge ayrıntısı (KalipDetay), yeni giriş/çıkış/transfer (KalipForm).
// Veri, yetki ve eylemler değişmedi (stock.view okuma; document.create / document.approve / stock.post yalnız gösterim kararı, eylem
// sunucuda yeniden denetler; I-15 kilitleri eylemdedir). Bilinçli farklar: belge türü süzgeci sunucuda yok → çipler bölüm geçişidir.
export const dynamic = "force-dynamic";
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const KIND_ICON = { in: { d: LICON.moveIn, color: "2F7D5B" }, out: { d: LICON.moveOut, color: "B85A14" } } as const;

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params,
    sp = await searchParams,
    t = await getTranslations("stockDocuments"),
    so = await getTranslations("stockOverview");
  const home = `/t/${encodeURIComponent(slug)}`,
    path = `${home}/stock/documents`,
    id = first(sp.id),
    kind = first(sp.new),
    after = first(sp.after);
  const { getAuthService } = await import("../../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (!principal) redirect(`/login?next=${encodeURIComponent(path)}`);
  const dark = await kalipDark();
  let list: Awaited<ReturnType<typeof listStockDocuments>>, doc: Awaited<ReturnType<typeof getStockDocument>> | null;
  try {
    const context = { db: getAppDb(), principal, tenantSlug: slug };
    list = await listStockDocuments(context, { withTotal: !id && !kind && !after, ...(after ? { after } : {}) });
    doc = id ? await getStockDocument(context, id) : null;
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND" || e.code === "VALIDATION_FAILED") notFound();
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(path)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(path)}`);
      if (e.code === "FORBIDDEN")
        return (
          <main className="flex w-full min-w-0 flex-col">
            <KalipKilitliEkran title={t("title")} icon={BOLUM_ICON.documents} text={t("locked")} hint={t("k.lockedHint")} dark={dark} home={home} />
          </main>
        );
    }
    throw e;
  }
  // T-1037: YENİ → tür seçimi (giriş / çıkış / transfer); listenin üstünde ayrı düğme yok.
  const newMain = { label: t("k.newShort"), aria: t("k.pickLabel"), d: LICON.plus, href: `${path}?new=SEC`, disabled: !list.permissions.create && !list.permissions.post, testId: "documents-new" };

  if (doc) {
    // T-1091: belge kartı (STANDART §3) — ortak `kalip/kart.tsx` parçaları; eylemler (`DocumentControls`) değişmedi.
    return (
      <main className="flex w-full min-w-0 flex-col">
        <KalipEkran kind="detay" dark={dark} title={t("title")} icon={BOLUM_ICON.documents} heading={false} testId="document-detail" bar={{ back: { href: path, aria: t("k.back") }, main: newMain }}>
          <DocumentCard slug={slug} document={doc} permissions={list.permissions} />
        </KalipEkran>
      </main>
    );
  }

  if (kind === "STOCK_IN" || kind === "STOCK_OUT" || kind === "TRANSFER") {
    const title = kind === "STOCK_IN" ? t("in") : kind === "STOCK_OUT" ? t("out") : t("transfer");
    const icon = kind === "STOCK_IN" ? KIND_ICON.in : kind === "STOCK_OUT" ? KIND_ICON.out : { d: LICON.transfer, color: "0E7C7B" };
    const allowed = kind === "TRANSFER" ? list.permissions.post : list.permissions.create;
    if (!allowed)
      return (
        <main className="flex w-full min-w-0 flex-col">
          <KalipKilitliEkran title={title} icon={icon} text={t("locked")} hint={t("k.lockedHint")} dark={dark} home={path} />
        </main>
      );
    return (
      <main className="flex w-full min-w-0 flex-col">
        <FormEkran dark={dark} title={title} icon={icon} back={path} mainLabel={t("k.saveShort")} mainAria={t("k.saveAria")} testId="document-new">
          <DocumentForm slug={slug} kind={kind} />
        </FormEkran>
      </main>
    );
  }

  if (kind === "SEC") {
    const items = [
      { id: "STOCK_IN", label: t("in"), sub: t("k.pickIn"), d: LICON.moveIn, color: "2F7D5B", href: `${path}?new=STOCK_IN`, locked: !list.permissions.create },
      { id: "STOCK_OUT", label: t("out"), sub: t("k.pickOut"), d: LICON.moveOut, color: "B85A14", href: `${path}?new=STOCK_OUT`, locked: !list.permissions.create },
      { id: "TRANSFER", label: t("transfer"), sub: t("k.pickTransfer"), d: LICON.transfer, color: "0E7C7B", href: `${path}?new=TRANSFER`, locked: !list.permissions.post },
    ];
    return (
      <main className="flex w-full min-w-0 flex-col">
        <KalipEkran kind="form" dark={dark} title={t("k.pickTitle")} icon={BOLUM_ICON.documents} testId="documents-pick" bar={{ back: { href: path } }}>
          <KalipBaslik title={t("k.pickLabel")} />
          <YeniIslemSecim items={items} />
        </KalipEkran>
      </main>
    );
  }

  const chips = bolumCipleri(home, "documents", { stock: so("k.chipStock"), documents: so("k.chipDocs"), shipping: so("k.chipShipping"), production: so("k.chipProduction") });
  return (
    <main className="flex w-full min-w-0 flex-col">
      <KalipEkran kind="liste" dark={dark} title={t("title")} icon={BOLUM_ICON.documents} testId="documents" bar={{ back: { href: `${home}/stock` }, main: newMain }}>
        <KalipCipler label={so("k.chips")} chips={chips} />
        {list.items.length === 0 ? (
          <KalipBos
            title={t("empty")}
            hint={list.permissions.create ? t("k.emptyHint") : t("k.lockedHint")}
            iconD={LICON.clip}
            action={list.permissions.create ? { label: t("k.firstIn"), href: `${path}?new=STOCK_IN`, kind: "add" } : { label: t("k.toStock"), href: `${home}/stock`, kind: "go" }}
          />
        ) : (
          <>
            <KalipBaslik title={list.total !== undefined ? t("k.count", { n: list.total }) : list.next === null && after === undefined ? t("k.count", { n: list.items.length }) : t("k.countMore", { n: list.items.length })} hint={t("k.hint")} />
            <KalipKartAkisi
              label={t("title")}
              slug={slug}
              ilk={{ kartlar: await belgeKartlari(list.items, path), devam: list.next }}
              toplam={list.total}
              sayiMetni={t("k.count", { n: "{n}" })}
              sayiFazla={t("k.countMore", { n: "{n}" })}
              yukle={loadMoreDocumentsAction}
              kartTestId="document-card"
              testId="documents-sonsuz"
            />
          </>
        )}
      </KalipEkran>
    </main>
  );
}
