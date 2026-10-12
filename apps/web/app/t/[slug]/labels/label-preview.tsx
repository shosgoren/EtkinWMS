"use client";
// Etiket önizleme ve yazdırma (T-312, ADR-022 §3). SVG metinleri `@wms/domain/labels` içinde kaçışlanmış olarak üretilir (XSS testleri
// templates.test.ts); burada yalnızca gösterilir. Yazdırma tarayıcıdan (print.css `@page 100mm 50mm`); "ZPL indir" aynı içeriği
// `.zpl` dosyası verir. Yerel köprü yalnızca `LABEL_LOCAL_BRIDGE_ENABLED` açıkken görünür ve henüz çalışmaz (ADR-022; yeni ADR eki ister).
import { useState } from "react";
import { printCss, validPrintSettings, type PaperMode } from "./print-settings.ts";
import { useTranslations } from "next-intl";
import { Button } from "@wms/ui";
import "./print.css";

export interface LabelPreviewProps {
  /** Üretilmiş (kaçışlanmış) SVG sayfaları: etiket başına bir sayfa. */
  readonly pages: readonly string[];
  readonly zpl: string;
  readonly fileName: string;
  readonly templateVersion: string;
  readonly bridgeEnabled: boolean;
}

export function LabelPreview({ pages, zpl, fileName, templateVersion, bridgeEnabled }: LabelPreviewProps) {
  const t = useTranslations("labels");
  const [width, setWidth] = useState(100);
  const [height, setHeight] = useState(50);
  const [mode, setMode] = useState<PaperMode>("a4");
  const settings = { width, height, mode, gap: 3 };
  const valid = validPrintSettings(settings);
  const custom = width !== 100 || height !== 50;


  function downloadZpl(): void {
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
    <section className="flex flex-col gap-4" aria-label={t("preview")}>
      <div className="label-controls rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-lg font-bold">Etiket ve kağıt ayarları</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="text-sm font-semibold">Genişlik (mm)<input className="mt-1 w-full rounded-lg border border-border-strong p-3" type="number" min="20" max="200" value={width} onChange={(e) => setWidth(Number(e.target.value))} /></label>
          <label className="text-sm font-semibold">Yükseklik (mm)<input className="mt-1 w-full rounded-lg border border-border-strong p-3" type="number" min="15" max="280" value={height} onChange={(e) => setHeight(Number(e.target.value))} /></label>
          <label className="col-span-2 text-sm font-semibold sm:col-span-1">Kağıt<select className="mt-1 w-full rounded-lg border border-border-strong p-3" value={mode} onChange={(e) => setMode(e.target.value as PaperMode)}><option value="a4">A4 — normal yazıcı</option><option value="label">Rulo — etiket yazıcı</option></select></label>
        </div>
        <p className="mt-3 text-sm text-ink-muted">Epson gibi normal yazıcılarda A4 seçin. Yazdırma penceresinde ölçeği %100, üstbilgi/altbilgiyi kapalı tutun. Etiket ölçüsü yazıcının kağıdına uygun olmalı.</p>
        {!valid ? <p role="alert" className="mt-2 text-sm text-danger-ink">Ölçü geçersiz veya kağıda sığmıyor. A4 için en çok 190 × 277 mm seçin.</p> : null}
        {custom ? <p className="mt-2 text-sm text-ink-muted">Özel ölçüde içerik oranı korunarak sığdırılır. Barkod okunurluğunu deneme baskısıyla kontrol edin; ZPL çıktısı yalnız 100 × 50 mm destekler.</p> : null}
      </div>
      {valid ? <style>{printCss(settings)}</style> : null}
      <div className="label-controls flex flex-wrap items-center gap-3">
        <Button type="button" disabled={!valid} onClick={() => window.print()}>
          {t("print")}
        </Button>
        <Button type="button" variant="secondary" disabled={custom} onClick={downloadZpl}>
          {t("downloadZpl")}
        </Button>
        {bridgeEnabled ? (
          <Button type="button" variant="secondary" disabled>
            {t("bridge")}
          </Button>
        ) : null}
        <p className="text-sm text-ink-muted">{t("summary", { count: pages.length, version: templateVersion })}</p>
      </div>
      <div className="label-sheet" data-testid="label-sheet">
        {pages.map((svg, i) => (
          // SVG: sunucuda kaçışlanmış, yalnızca svg/rect/text/g öğeleri (templates.test.ts XSS testi).
          <div key={i} className="label-page" style={{ width: `${width}mm`, height: `${height}mm` }} dangerouslySetInnerHTML={{ __html: svg }} />
        ))}
      </div>
    </section>
  );
}
