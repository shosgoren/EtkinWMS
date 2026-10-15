"use client";
// I-18: bant sağındaki açık/koyu düğmesi (Giris.dc.html `toggleTheme`), DzRoot temasını değiştirir.
import { useDz } from "../../design/dz-root.tsx";
import { GICON } from "../../design/giris-icons.ts";

export function ThemeButton({ label }: { label: string }) {
  const { toggleTheme } = useDz();
  return (
    <button type="button" className="wb" onClick={toggleTheme} aria-label={label}>
      <svg className="ico" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <path d={GICON.theme} />
      </svg>
    </button>
  );
}
