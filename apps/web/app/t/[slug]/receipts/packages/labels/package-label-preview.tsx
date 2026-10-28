"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { printCss, type PaperMode } from "../../../labels/print-settings.ts";
import { generatePackageQrs, validPackagePrintSettings, type PackageQr, type PackageLabelMetadata } from "./package-labels.ts";
import "../../../labels/print.css";
import { LICON } from "../../../../../design/kalip-icons.ts";
import { kdz } from "../../../kalip/tokens.ts";
import { Ico } from "../../../kalip/ekran.tsx";
import { KalipAlan } from "../../../kalip/form.tsx";
import { KalipUyari } from "../../../kalip/uyari.tsx";

// T-1121: ölçü alanları kalıp alanı (`KalipAlan`), durum / hata satırları kalıp uyarı bandı (`KalipUyari`), Yeniden dene ve Yazdır kalıp
// düğmeleri (`.btn`); eski `@wms/ui` Button ve Tailwind sınıfları kalktı. Ana işlem alt çubuktadır; buradaki Yazdır onun hedefidir.
// T-973: kâğıt seçimi liste kalıbı süzgeç çipleri (`.fchips > .fch`, `labels` ekranındaki A4 / Rulo ile aynı); seçili çip `aria-pressed`.
function PaperChips({ mode, onPick }: { mode: PaperMode; onPick: (m: PaperMode) => void }) {
  const t = useTranslations("packageReceiving.labelPreview");
  const chips: readonly { id: PaperMode; label: string; d: string; color: string }[] = [
    { id: "a4", label: "A4", d: LICON.printer, color: "2F5DA8" },
    { id: "label", label: t("roll"), d: LICON.tag, color: "0E7C7B" },
  ];
  return <div className="fchips" role="group" aria-label={t("paper")}>{chips.map(ch => <button key={ch.id} type="button" className={`fch${mode === ch.id ? " on" : ""}`} aria-pressed={mode === ch.id} onClick={() => onPick(ch.id)} data-chip={ch.id}>
    <i style={{ background: kdz("dzl", ch.color) }}><svg className="ico" width={18} height={18} viewBox="0 0 24 24" aria-hidden="true"><path d={ch.d} /></svg></i>{ch.label}
  </button>)}</div>;
}

export function PackageLabelPages({ packages, qrs, width, height, sheetRef }: {
  readonly packages: readonly PackageLabelMetadata[]; readonly qrs: readonly PackageQr[]; readonly width: number; readonly height: number; readonly sheetRef?: React.Ref<HTMLDivElement>;
}) {
  const t = useTranslations("packageReceiving.labelPreview");
  if (qrs.length !== packages.length || qrs.length === 0 || qrs.some((qr, i) => qr.id !== packages[i]?.id || !qr.path)) return null;
  return <div ref={sheetRef} className="label-sheet" data-testid="package-label-sheet">{packages.map((p, i) => {
    const qr = qrs[i]!;
    return <article key={p.id} className="label-page" style={{ width: `${width}mm`, height: `${height}mm`, background: "var(--color-surface)", color: "var(--color-ink)", padding: "3mm", fontSize: "8pt", lineHeight: 1.25 }}>
      <div style={{ display: "flex", gap: "3mm", alignItems: "start" }}>
        <svg role="img" aria-label={t("qrAria", { no: p.packageNo })} viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" style={{ width: "28mm", height: "28mm", flexShrink: 0 }}><rect width={qr.size} height={qr.size} fill="var(--color-surface)" /><path d={qr.path} fill="var(--color-ink)" /></svg>
        <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          <strong>{p.itemCode}</strong><p title={p.itemName}>{p.itemName}</p>
          <p>{t("packageOf", { no: p.packageNo, total: packages.length, kind: p.kind })}</p>
          <p><strong>{t("quantity", { qty: p.quantity, unit: p.unitCode })}</strong></p>
          <p>{p.stockStatus === "QUARANTINE" ? t("quarantine") : p.stockStatus}</p>
        </div>
      </div>
      <p style={{ overflowWrap: "anywhere", marginTop: "1mm", fontSize: "7pt" }}>{p.id}</p>
      <p style={{ overflowWrap: "anywhere" }} title={p.lotCode ?? undefined}>{t("lot", { lot: p.lotCode ?? "—" })}</p>
      <p>{t("dates", { produced: p.producedOn ?? "—", expires: p.expiresOn ?? "—" })}</p>
    </article>;
  })}</div>;
}

export function PackageLabelPreview({ packages }: { readonly packages: readonly PackageLabelMetadata[] }) {
  const t = useTranslations("packageReceiving.labelPreview");
  const [width, setWidth] = useState(100);
  const [height, setHeight] = useState(50);
  const [mode, setMode] = useState<PaperMode>("a4");
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ source: typeof packages; attempt: number; qrs: readonly PackageQr[] | null } | null>(null);
  useEffect(() => {
    let live = true;
    generatePackageQrs(packages).then(qrs => { if (live) setResult({ source: packages, attempt, qrs }); }).catch(() => { if (live) setResult({ source: packages, attempt, qrs: null }); });
    return () => { live = false; };
  }, [packages, attempt]);
  const current = result?.source === packages && result.attempt === attempt ? result : null;
  const settings = { width, height, mode, gap: 3 };
  const valid = validPackagePrintSettings(settings);
  const qrs = current?.qrs;
  const sheetRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ qrs: readonly PackageQr[]; width: number; height: number; fits: boolean } | null>(null);
  useEffect(() => {
    if (!valid || qrs == null || sheetRef.current === null) return;
    const labels = Array.from(sheetRef.current.children);
    const fits = labels.length === packages.length && labels.every(label => label.scrollHeight <= label.clientHeight && label.scrollWidth <= label.clientWidth);
    setFit({ qrs, width, height, fits });
  }, [qrs, width, height, valid, packages.length]);
  const measured = fit?.qrs === qrs && fit?.width === width && fit?.height === height;
  const ready = valid && qrs != null && measured && fit.fits;
  return <section style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }} aria-label={t("previewAria")}>
    <div className="label-controls pk-card" style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <PaperChips mode={mode} onPick={setMode} />
      <div className="kalanlar">
        <KalipAlan label={t("width")} type="number" inputMode="numeric" min="20" max="200" value={width} onChange={e => setWidth(Number(e.target.value))} />
        <KalipAlan label={t("height")} type="number" inputMode="numeric" min="15" max="280" value={height} onChange={e => setHeight(Number(e.target.value))} />
      </div>
      <p className="khint">{t("summary", { count: packages.length })}</p>
      <details><summary style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 48, cursor: "pointer", fontWeight: 700 }}><Ico d={LICON.info} size={20} />{t("helpTitle")}</summary><p className="khint">{t("helpBody")}</p></details>
      {!valid ? <KalipUyari tone="hata"><p>{t("invalid")}</p></KalipUyari> : null}
      {current === null ? <KalipUyari tone="bilgi"><p>{t("preparing")}</p></KalipUyari> : null}
      {current?.qrs === null ? <KalipUyari tone="hata"><p>{t("qrFailed")}</p><button type="button" onClick={() => setAttempt(v => v + 1)}><Ico d={LICON.transfer} size={18} />{t("retry")}</button></KalipUyari> : null}
      {measured && !fit.fits ? <KalipUyari tone="hata"><p>{t("noFit")}</p></KalipUyari> : null}
      <button className="btn n" style={{ minHeight: 56, width: "100%" }} type="button" data-testid="package-label-print" disabled={!ready} onClick={() => { if (ready) window.print(); }}><Ico d={LICON.printer} size={20} />{t("print")}</button>
    </div>
    {ready ? <style>{printCss(settings)}</style> : <style>{"@media print{.label-sheet{display:none!important}}"}</style>}
    {valid && qrs != null ? <PackageLabelPages packages={packages} qrs={qrs} width={width} height={height} sheetRef={sheetRef} /> : null}
  </section>;
}
