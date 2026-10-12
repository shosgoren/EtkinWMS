export type PaperMode = "a4" | "label";
export interface PrintSettings { readonly width: number; readonly height: number; readonly gap: number; readonly mode: PaperMode; }
export function validPrintSettings(s: PrintSettings): boolean {
  return Number.isFinite(s.width) && s.width >= 20 && s.width <= 200 && Number.isFinite(s.height) && s.height >= 15 && s.height <= 280 && Number.isFinite(s.gap) && s.gap >= 0 && s.gap <= 15 && (s.mode === "a4" || s.mode === "label") && (s.mode !== "a4" || s.width <= 190 && s.height <= 277);
}
/** Print stylesheet receives only bounded numeric values, never arbitrary user CSS. */
export function printCss(s: PrintSettings): string {
  if (!validPrintSettings(s)) throw new RangeError("Etiket ölçüsü kağıda sığmıyor veya geçersiz.");
  const size = s.mode === "a4" ? "A4 portrait" : `${s.width}mm ${s.height}mm`;
  const flow = s.mode === "a4" ? "display:flex;flex-wrap:wrap;align-content:flex-start;" : "display:block;";
  return `@media print{@page{size:${size};margin:${s.mode === "a4" ? "10mm" : "0"}}.label-sheet{${flow}gap:${s.gap}mm}.label-page{width:${s.width}mm;height:${s.height}mm;break-inside:avoid;${s.mode === "label" ? "break-after:page;" : "break-after:auto;border:0.2mm dashed var(--color-ink-muted);"}}.label-page:last-child{break-after:auto;}}`;
}
