// T-1119: kaynak simge parçaları (`ekran.tsx`'ten taşındı; ekran kabının bağımlılıklarını çekmeden kullanılır). Davranış aynı.
import { LICON } from "../../../design/kalip-icons.ts";

/** Kaynak `.ico` SVG (tek ya da çok yol). */
export function Ico({ d, size, className = "ico" }: { d: string | readonly string[]; size: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {(typeof d === "string" ? [d] : d).map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

/** Kaynak mikrofon ikonu (`rect` + yol). */
export function MicIco({ size }: { size: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d={LICON.micB} />
    </svg>
  );
}

