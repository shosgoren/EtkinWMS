// Etkin WMS "Rota e" marka işareti (T-981): satış sitesiyle aynı çizim. Renkler globals.css `.brand-mark` belirteçlerinden gelir.
// `moving`: sarı nokta (koli) e harfinin yolunu dolaşır; hareket azaltma tercihinde CSS ile durdurulur.
export const BRAND_E_PATH = "M32 62H88A28 28 0 1 0 80 82";

export function BrandMark({ className, moving = true, framed = true }: { className?: string; moving?: boolean; framed?: boolean }) {
  return (
    <svg className={`brand-mark ${framed ? "brand-mark-framed" : ""} ${className ?? ""}`} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      {framed ? <rect className="brand-mark-bg" x="4" y="4" width="112" height="112" rx="28" /> : null}
      <path className="brand-mark-e" d={BRAND_E_PATH} />
      <circle className="brand-mark-dot" r="12" cx={moving ? undefined : 80} cy={moving ? undefined : 82}>
        {moving ? <animateMotion dur="3.2s" repeatCount="indefinite" path={BRAND_E_PATH} /> : null}
      </circle>
    </svg>
  );
}
