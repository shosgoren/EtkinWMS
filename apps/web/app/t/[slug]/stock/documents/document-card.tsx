"use client";
// T-1091: belge kartı — STANDART §3 kayıt kartı kalıbı (ürün / depo / raf yeri / cari kartıyla aynı parçalar: şerit, bilgi kutucukları,
// satırlar; sağ sütunda durum ve işlemler). Veri sunucuda okunur (`getStockDocument`); onay / stoka işle / iptal eylemleri değişmedi.
// T-1119 (B-123): bölüm düzeni Tailwind yerine ortak `.kbolum` (standart.css).
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { LICON } from "../../../../design/kalip-icons.ts";
import { SICON } from "../../../../design/standart-icons.ts";
import { fmtGun, fmtQty } from "../../kalip/format.ts";
import { KalipBilgiIzgara, KalipKartSerit, KalipKayitKart, type KalipBilgi, type KalipEtiket, type StTon } from "../../kalip/kart.tsx";
import { DocumentControls } from "./document-form.tsx";

export interface DocumentCardView {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly version: number;
  readonly number: string | null;
  readonly warehouseName: string;
  readonly businessDate: string;
  readonly reason: string | null;
  readonly processing: boolean;
  readonly lines: readonly {
    readonly id: string;
    readonly itemCode: string;
    readonly itemName: string;
    readonly quantity: string;
    readonly unitCode: string;
    readonly sourceCode: string | null;
    readonly targetCode: string | null;
    readonly lotCode: string | null;
    readonly serialNo: string | null;
  }[];
  readonly related: readonly { readonly id: string; readonly number: string | null; readonly warehouseName: string }[];
}

const STATUS_TON: Readonly<Record<string, KalipEtiket["ton"]>> = { APPROVED: "amber", POSTED: "ok", CANCELLED: "kirmizi" };

export function DocumentCard({ slug, document: doc, permissions }: { slug: string; document: DocumentCardView; permissions: { create: boolean; approve: boolean; post: boolean } }) {
  const t = useTranslations("stockDocuments");
  const locale = useLocale();
  const path = `/t/${encodeURIComponent(slug)}/stock/documents`;
  const giris = doc.kind === "STOCK_IN";
  const kindLabel = t(giris ? "in" : "out");
  const d = giris ? LICON.moveIn : LICON.moveOut;
  const tur: StTon = giris ? "yesil" : "turuncu";
  const sign = giris ? "+" : "−";
  const etiketler: KalipEtiket[] = [
    { metin: kindLabel },
    { metin: t(`states.${doc.status}`), ...(STATUS_TON[doc.status] === undefined ? {} : { ton: STATUS_TON[doc.status] }), testId: "document-status", durum: true },
  ];
  const bilgiler: KalipBilgi[] = [
    { key: "kind", etiket: t("k.kindL"), deger: kindLabel, d, ton: tur },
    { key: "warehouse", etiket: t("warehouse"), deger: doc.warehouseName, d: LICON.depo, ton: "lacivert" },
    { key: "date", etiket: t("k.date"), deger: fmtGun(doc.businessDate, locale), d: LICON.clip, ton: "camgobegi" },
    ...(doc.reason === null || doc.reason === "" ? [] : [{ key: "reason", etiket: t("reason"), deger: doc.reason, d: SICON.bilgi, ton: "gri" as const }]),
  ];

  return (
    <KalipKayitKart
      testId="document-kart"
      serit={
        <KalipKartSerit
          etiket={t("k.hero")}
          ad={`${doc.number ?? t("draft")} · ${kindLabel}`}
          d={d}
          tur={doc.status === "CANCELLED" ? "gri" : tur}
          etiketler={etiketler}
          kutular={[{ key: "lines", etiket: t("k.boxLines"), deger: String(doc.lines.length), d: LICON.box, ton: "mavi", testId: "kalip-total" }]}
          islemler={[]}
          islemEtiket={t("k.state")}
        />
      }
      ana={
        <>
          <KalipBilgiIzgara baslik={t("k.info")} bilgiler={bilgiler} kilitD={SICON.kilit} />
          <div data-testid="document-lines" className="kbolum">
            <b className="stkbas">{t("k.lines")}</b>
            <ul className="whl" style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {doc.lines.map((line) => (
                <li key={line.id} className="whr" data-testid="document-line">
                  <span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <b>{line.itemName}</b>
                    <small className="mono">
                      {[line.itemCode, line.sourceCode ?? line.targetCode ?? "", line.lotCode ? `${t("lot")}: ${line.lotCode}` : "", line.serialNo ? `${t("serial")}: ${line.serialNo}` : ""].filter((x) => x !== "").join(" · ")}
                    </small>
                  </span>
                  <span className={`pill ${giris ? "ok" : "warn"}`}>
                    {sign}
                    {fmtQty(line.quantity, locale)} {line.unitCode}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      }
      yan={
        <>
          <div data-testid="document-state" data-status={doc.status} className="kbolum">
            <b className="stkbas">{t("k.state")}</b>
            <DocumentControls key={`${doc.id}:${doc.version}`} slug={slug} document={doc} permissions={permissions} />
          </div>
          {doc.related.length === 0 ? null : (
            <div data-testid="document-related" className="kbolum">
              <b className="stkbas">{t("k.related")}</b>
              {doc.related.map((other) => (
                <Link key={other.id} className="more" href={`${path}?id=${encodeURIComponent(other.id)}`}>
                  {t("related")}: {other.number} · {other.warehouseName}
                </Link>
              ))}
            </div>
          )}
        </>
      }
    />
  );
}
