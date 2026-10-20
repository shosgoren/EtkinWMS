"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@wms/ui";
import { printCss, type PaperMode } from "../../../labels/print-settings.ts";
import { generatePackageQrs, validPackagePrintSettings, type PackageQr, type PackageLabelMetadata } from "./package-labels.ts";
import "../../../labels/print.css";
import { LICON } from "../../../../../design/kalip-icons.ts";
import { kdz } from "../../../kalip/tokens.ts";

// T-973: kâğıt seçimi liste kalıbı süzgeç çipleri (`.fchips > .fch`, `labels` ekranındaki A4 / Rulo ile aynı); seçili çip `aria-pressed`.
function PaperChips({ mode, onPick }: { mode: PaperMode; onPick: (m: PaperMode) => void }) {
  const chips: readonly { id: PaperMode; label: string; d: string; color: string }[] = [
    { id: "a4", label: "A4", d: LICON.printer, color: "2F5DA8" },
    { id: "label", label: "Rulo", d: LICON.tag, color: "0E7C7B" },
  ];
  return <div className="fchips" role="group" aria-label="Kağıt">{chips.map(ch => <button key={ch.id} type="button" className={`fch${mode === ch.id ? " on" : ""}`} aria-pressed={mode === ch.id} onClick={() => onPick(ch.id)} data-chip={ch.id}>
    <i style={{ background: kdz("dzl", ch.color) }}><svg className="ico" width={18} height={18} viewBox="0 0 24 24" aria-hidden="true"><path d={ch.d} /></svg></i>{ch.label}
  </button>)}</div>;
}

export function PackageLabelPages({ packages, qrs, width, height, sheetRef }: {
  readonly packages: readonly PackageLabelMetadata[]; readonly qrs: readonly PackageQr[]; readonly width: number; readonly height: number; readonly sheetRef?: React.Ref<HTMLDivElement>;
}) {
  if (qrs.length !== packages.length || qrs.length === 0 || qrs.some((qr, i) => qr.id !== packages[i]?.id || !qr.path)) return null;
  return <div ref={sheetRef} className="label-sheet" data-testid="package-label-sheet">{packages.map((p, i) => {
    const qr = qrs[i]!;
    return <article key={p.id} className="label-page" style={{ width: `${width}mm`, height: `${height}mm`, background: "var(--color-surface)", color: "var(--color-ink)", padding: "3mm", fontSize: "8pt", lineHeight: 1.25 }}>
      <div style={{ display: "flex", gap: "3mm", alignItems: "start" }}>
        <svg role="img" aria-label={`Paket QR ${p.packageNo}`} viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" style={{ width: "28mm", height: "28mm", flexShrink: 0 }}><rect width={qr.size} height={qr.size} fill="var(--color-surface)" /><path d={qr.path} fill="var(--color-ink)" /></svg>
        <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          <strong>{p.itemCode}</strong><p title={p.itemName}>{p.itemName}</p>
          <p>Paket {p.packageNo} / {packages.length} · {p.kind}</p>
          <p><strong>Paket miktarı: {p.quantity} {p.unitCode}</strong></p>
          <p>{p.stockStatus === "QUARANTINE" ? "⚠ Karantina" : p.stockStatus}</p>
        </div>
      </div>
      <p style={{ overflowWrap: "anywhere", marginTop: "1mm", fontSize: "7pt" }}>{p.id}</p>
      <p style={{ overflowWrap: "anywhere" }} title={p.lotCode ?? undefined}>Lot: {p.lotCode ?? "—"}</p>
      <p>Üretim: {p.producedOn ?? "—"} · SKT: {p.expiresOn ?? "—"}</p>
    </article>;
  })}</div>;
}

export function PackageLabelPreview({ packages }: { readonly packages: readonly PackageLabelMetadata[] }) {
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
  return <section className="flex flex-col gap-4" aria-label="Paket etiket önizlemesi">
    <div className="label-controls pk-card">
      <PaperChips mode={mode} onPick={setMode} />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label>Genişlik (mm)<input className="mt-1 min-h-[48px] w-full rounded-lg border border-border-strong p-3" type="number" min="20" max="200" value={width} onChange={e => setWidth(Number(e.target.value))} /></label>
        <label>Yükseklik (mm)<input className="mt-1 min-h-[48px] w-full rounded-lg border border-border-strong p-3" type="number" min="15" max="280" value={height} onChange={e => setHeight(Number(e.target.value))} /></label>
      </div>
      <p className="my-3 text-sm">{packages.length} paket · Paket miktarı</p>
      <details className="mb-3 text-sm"><summary className="flex min-h-[48px] cursor-pointer items-center">Yazdırma yardımı</summary><p>Yazdırma/PDF penceresinde ölçeği %100, üstbilgi/altbilgiyi kapalı tutun. QR okunurluğunu deneme baskısıyla kontrol edin. Metin veya QR sığmazsa ölçüyü artırın.</p></details>
      {!valid ? <p role="alert">Ölçü geçersiz. A4 için en çok 190 × 277 mm seçin.</p> : null}
      {current === null ? <p role="status">QR kodları hazırlanıyor…</p> : null}
      {current?.qrs === null ? <div role="alert">QR üretilemedi. <Button style={{ minHeight: 48 }} type="button" variant="secondary" onClick={() => setAttempt(v => v + 1)}>Tekrar dene</Button></div> : null}
      {measured && !fit.fits ? <p role="alert">QR veya metin bu ölçüye sığmıyor. Etiket genişliğini veya yüksekliğini artırın.</p> : null}
      <Button style={{ minHeight: 56, width: "100%" }} type="button" data-testid="package-label-print" disabled={!ready} onClick={() => { if (ready) window.print(); }}>Yazdır / PDF</Button>
    </div>
    {ready ? <style>{printCss(settings)}</style> : <style>{"@media print{.label-sheet{display:none!important}}"}</style>}
    {valid && qrs != null ? <PackageLabelPages packages={packages} qrs={qrs} width={width} height={height} sheetRef={sheetRef} /> : null}
  </section>;
}
