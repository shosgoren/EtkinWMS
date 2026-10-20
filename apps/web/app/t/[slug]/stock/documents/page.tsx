import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getStockDocument, listStockDocuments } from "@wms/domain/stock";
import { AppError } from "@wms/shared/errors";
import { LICON } from "../../../../design/kalip-icons.ts";
import { KalipDetayIzgara, KalipHero, KalipKartBolum, KalipZaman, type KalipOlay } from "../../kalip/detay.tsx";
import { KalipBaslik, KalipEkran } from "../../kalip/ekran.tsx";
import { fmtQty } from "../../kalip/format.ts";
import { KalipBos, KalipCipler, KalipDaha, KalipKart, KalipKartListe, KalipKilitliEkran } from "../../kalip/liste.tsx";
import { BOLUM_ICON, bolumCipleri, kalipDark } from "../belge-kalip.ts";
import { FormEkran } from "../form-ekran.tsx";
import { DocumentControls, DocumentForm } from "./document-form.tsx";

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
    so = await getTranslations("stockOverview"),
    locale = await getLocale();
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
    list = await listStockDocuments(context, after ? { after } : {});
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
  const kindLabel = (k: string) => t(k === "STOCK_IN" ? "in" : "out");
  const kindIcon = (k: string) => (k === "STOCK_IN" ? KIND_ICON.in : KIND_ICON.out);
  const fq = (v: string) => fmtQty(v, locale);
  const newMain = { label: t("k.newShort"), aria: t("in"), d: LICON.plus, href: `${path}?new=STOCK_IN`, disabled: !list.permissions.create, testId: "documents-new" };

  if (doc) {
    const sign = doc.kind === "STOCK_IN" ? "+" : "−";
    const events: KalipOlay[] = doc.lines.map((line) => ({
      key: line.id,
      title: `${line.itemCode} — ${line.itemName}`,
      meta: [line.sourceCode ?? line.targetCode ?? "", line.lotCode ? `${t("lot")}: ${line.lotCode}` : "", line.serialNo ? `${t("serial")}: ${line.serialNo}` : ""].filter((x) => x !== "").join(" · "),
      q: `${sign}${fq(line.quantity)} ${line.unitCode}`,
      d: kindIcon(doc.kind).d,
      color: kindIcon(doc.kind).color,
      qColor: doc.kind === "STOCK_IN" ? "2F7D5B" : "C62828",
    }));
    return (
      <main className="flex w-full min-w-0 flex-col">
        <KalipEkran kind="detay" dark={dark} title={t("title")} icon={BOLUM_ICON.documents} heading={false} testId="document-detail" bar={{ back: { href: path }, main: newMain }}>
          <KalipDetayIzgara
            left={
              <>
                <KalipHero
                  label={t("k.hero")}
                  name={`${doc.number ?? t("draft")} · ${kindLabel(doc.kind)}`}
                  code={`${doc.warehouseName} · ${doc.businessDate}`}
                  tags={doc.reason ? [doc.reason] : []}
                  d={kindIcon(doc.kind).d}
                  color={kindIcon(doc.kind).color}
                  total={{ value: String(doc.lines.length), sub: t("k.lineUnit"), crit: false }}
                  testId="document-hero"
                >
                  <span className="tags">
                    <span className="tag" role="status" data-status={doc.status}>
                      {t(`states.${doc.status}`)}
                    </span>
                  </span>
                </KalipHero>
                <KalipKartBolum title={t("k.lines")} sub={t("k.linesSub", { n: doc.lines.length })} d={LICON.box} color="2F5DA8" testId="document-lines">
                  <KalipZaman items={events} />
                </KalipKartBolum>
              </>
            }
            right={
              <>
                <KalipKartBolum title={t("k.state")} sub={doc.status === "POSTED" ? t("postedHelp") : t("notPosted")} d={LICON.clip} color="6C4BD8" testId="document-state">
                  <DocumentControls key={`${doc.id}:${doc.version}`} slug={slug} document={doc} permissions={list.permissions} />
                </KalipKartBolum>
                {doc.related.length === 0 ? null : (
                  <KalipKartBolum title={t("k.related")} d={LICON.transfer} color="0E7C7B" testId="document-related">
                    {doc.related.map((other) => (
                      <a key={other.id} className="more" href={`${path}?id=${other.id}`}>
                        {t("related")}: {other.number} · {other.warehouseName}
                      </a>
                    ))}
                  </KalipKartBolum>
                )}
              </>
            }
          />
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
        <FormEkran dark={dark} title={title} icon={icon} back={path} mainLabel={t("k.saveShort")} mainAria={kind === "TRANSFER" ? t("transferPost") : t("create")} testId="document-new">
          <DocumentForm slug={slug} kind={kind} />
        </FormEkran>
      </main>
    );
  }

  const chips = bolumCipleri(home, "documents", { stock: so("k.chipStock"), documents: so("k.chipDocs"), shipping: so("k.chipShipping"), production: so("k.chipProduction") });
  return (
    <main className="flex w-full min-w-0 flex-col">
      <KalipEkran kind="liste" dark={dark} title={t("title")} icon={BOLUM_ICON.documents} testId="documents" bar={{ back: { href: `${home}/stock` }, main: newMain }}>
        <KalipCipler label={so("k.chips")} chips={chips} />
        {list.permissions.create ? (
          <KalipDaha href={`${path}?new=STOCK_OUT`} iconD={LICON.moveOut} iconColor="B85A14" testId="documents-new-out">
            {t("out")}
          </KalipDaha>
        ) : null}
        {list.permissions.post ? (
          <KalipDaha href={`${path}?new=TRANSFER`} iconD={LICON.transfer} iconColor="0E7C7B" testId="documents-new-transfer">
            {t("transfer")}
          </KalipDaha>
        ) : null}
        {list.items.length === 0 ? (
          <KalipBos title={t("empty")} hint={list.permissions.create ? t("k.emptyHint") : t("k.lockedHint")} iconD={LICON.clip} />
        ) : (
          <>
            <KalipBaslik title={list.next === null && after === undefined ? t("k.count", { n: list.items.length }) : t("k.countMore", { n: list.items.length })} hint={t("k.hint")} />
            <KalipKartListe label={t("title")}>
              {list.items.map((row, i) => {
                const state = t(`states.${row.status}`);
                const number = row.number ?? t("draft");
                return (
                  <KalipKart
                    key={row.id}
                    index={i}
                    name={`${number} · ${kindLabel(row.kind)}`}
                    code={`${row.warehouseName} · ${row.businessDate} · ${state}`}
                    {...(row.reason ? { meta: row.reason } : {})}
                    d={kindIcon(row.kind).d}
                    color={kindIcon(row.kind).color}
                    href={`${path}?id=${row.id}`}
                    aria={t("k.cardAria", { number, kind: kindLabel(row.kind), warehouse: row.warehouseName, date: row.businessDate, state })}
                    testId="document-card"
                  />
                );
              })}
            </KalipKartListe>
          </>
        )}
        {list.next ? (
          <KalipDaha href={`${path}?after=${encodeURIComponent(list.next)}`} iconD={LICON.plus}>
            {t("next")}
          </KalipDaha>
        ) : null}
        {after ? (
          <KalipDaha href={path} iconD={LICON.chev}>
            {so("first")}
          </KalipDaha>
        ) : null}
      </KalipEkran>
    </main>
  );
}
