"use client";
// Etiket önizleme ve yazdırma (T-312, ADR-022 §3). SVG metinleri `@wms/domain/labels` içinde kaçışlanmış olarak üretilir (XSS testleri
// templates.test.ts); burada yalnızca gösterilir. Yazdırma tarayıcıdan (print.css + `printCss` ayarları); "ZPL indir" aynı içeriği
// `.zpl` dosyası verir. Yerel köprü yalnızca `LABEL_LOCAL_BRIDGE_ENABLED` açıkken görünür ve henüz çalışmaz (ADR-022; yeni ADR eki ister).
// T-971 (B-63, I-18): LİSTE kalıbı kabuğu (KalipListe.dc.html): kâğıt seçimi çip (A4 / Rulo), ölçü alanları, ZPL indir satırı, etiket
// sayfaları; ana işlem alt cam çubukta YAZDIR. Yazdırırken kalıp üst çubuğu ve alt çubuk basılmaz (print.css).
// Bilinçli farklar (DESIGN-PARITY, T-971): arama / kart listesi yok (ekran tek kaynağın etiketlerini gösterir; kaynak adresle gelir).
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { LICON } from "../../../design/kalip-icons.ts";
import { KalipBaslik, KalipEkran, tone } from "../kalip/ekran.tsx";
import { KalipBos, KalipCipler, KalipDaha } from "../kalip/liste.tsx";
import { printCss, validPrintSettings, type PaperMode } from "./print-settings.ts";
import "./print.css";

export interface LabelPreviewProps {
  readonly dark: boolean;
  /** Geri hedefi (kaynağın ekranı ya da ana ekran). */
  readonly back: string;
  /** Üretilmiş (kaçışlanmış) SVG sayfaları: etiket başına bir sayfa. */
  readonly pages: readonly string[];
  readonly zpl: string;
  readonly fileName: string;
  readonly templateVersion: string;
  readonly bridgeEnabled: boolean;
}

const FIELD_CLS =
  "min-h-12 w-full min-w-0 rounded-card border-2 border-border-strong bg-surface px-4 text-base text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus";
const ICON = { d: LICON.printer, color: "172E42" } as const;

/** Etiket ekranının kalıp kabı (önizleme yoksa: kaynak yok / hata durumları). Sunucu sayfası da kullanır. */
export function LabelShell({ dark, back, title, children }: { dark: boolean; back: string; title: string; children: ReactNode }) {
  return (
    <KalipEkran kind="liste" dark={dark} title={title} icon={ICON} testId="labels" bar={{ back: { href: back }, main: { label: "", d: LICON.printer, disabled: true } }}>
      {children}
    </KalipEkran>
  );
}

/** Önizleme dışı durum kutusu (kaynak `.nomatch`). */
export function LabelNotice({ title, hint }: { title: string; hint?: string }) {
  return <KalipBos title={title} {...(hint === undefined ? {} : { hint })} iconD={LICON.tag} testId="labels-notice" />;
}

export function LabelPreview({ dark, back, pages, zpl, fileName, templateVersion, bridgeEnabled }: LabelPreviewProps) {
  const t = useTranslations("labels");
  const [width, setWidth] = useState(100);
  const [height, setHeight] = useState(50);
  const [mode, setMode] = useState<PaperMode>("a4");
  const settings = { width, height, mode, gap: 3 };
  const valid = validPrintSettings(settings);
  const custom = width !== 100 || height !== 50;

  function downloadZpl(): void {
    tone("tap");
    const url = URL.createObjectURL(new Blob([zpl], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <KalipEkran
      kind="liste"
      dark={dark}
      title={t("title")}
      icon={ICON}
      testId="labels"
      bar={{
        back: { href: back },
        main: {
          label: t("printShort"),
          aria: t("print"),
          d: LICON.printer,
          disabled: !valid,
          onClick: () => {
            tone("tap");
            window.print();
          },
          testId: "labels-print",
        },
      }}
    >
      <section className="label-controls" aria-label={t("settingsTitle")} style={{ display: "flex", flexDirection: "column", gap: 10, flex: "none" }}>
        <KalipBaslik title={t("settingsTitle")} hint={t("summary", { count: pages.length, version: templateVersion })} />
        <KalipCipler
          label={t("paper")}
          chips={[
            { id: "a4", label: t("paperA4"), d: LICON.printer, color: "2F5DA8", on: mode === "a4", onClick: () => setMode("a4") },
            { id: "label", label: t("paperLabel"), d: LICON.tag, color: "0E7C7B", on: mode === "label", onClick: () => setMode("label") },
          ]}
        />
        <div className="grid min-w-0 grid-cols-2 gap-3">
          <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold">
            {t("width")}
            <input className={FIELD_CLS} type="number" min="20" max="200" value={width} onChange={(e) => setWidth(Number(e.target.value))} />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold">
            {t("height")}
            <input className={FIELD_CLS} type="number" min="15" max="280" value={height} onChange={(e) => setHeight(Number(e.target.value))} />
          </label>
        </div>
        <p style={{ margin: 0, fontSize: 13 }}>{t("paperHint")}</p>
        {!valid ? (
          <p role="alert" className="pill warn" style={{ margin: 0, alignSelf: "flex-start", whiteSpace: "normal" }}>
            {t("invalid")}
          </p>
        ) : null}
        {custom ? <p style={{ margin: 0, fontSize: 13 }}>{t("customHint")}</p> : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {custom ? null : (
            <KalipDaha onClick={downloadZpl} iconD={LICON.moveIn} testId="labels-zpl">
              {t("downloadZpl")}
            </KalipDaha>
          )}
          {bridgeEnabled ? (
            <button type="button" className="btn n" disabled>
              {t("bridge")}
            </button>
          ) : null}
        </div>
      </section>
      {valid ? <style>{printCss(settings)}</style> : null}
      <section aria-label={t("preview")} className="label-sheet" data-testid="label-sheet">
        {pages.map((svg, i) => (
          // SVG: sunucuda kaçışlanmış, yalnızca svg/rect/text/g öğeleri (templates.test.ts XSS testi).
          <div key={i} className="label-page" style={{ width: `${width}mm`, height: `${height}mm` }} dangerouslySetInnerHTML={{ __html: svg }} />
        ))}
      </section>
    </KalipEkran>
  );
}
