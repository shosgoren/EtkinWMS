"use client";
// I-18: tasarım kökü (kaynak `.wrap > .appzone > .app`). Önizleme çubuğu ve cihaz çerçevesi yoktur (DESIGN-PARITY §5).
// Tema (açık/koyu) kaynaktaki `cycleTheme` ile aynı: `.dz-dark` (belirteçler) + `.wrap.dk` + `.app.dkm` (kurallar). Tercih çerezde
// tutulur (sunucu ilk çizimde doğru temayı verir; kaynak localStorage kullanır, SSR'de yanıp sönmesin diye çerez).
// Açılır kutu ve pencereler (`overlay`) kaynaktaki gibi `.app` içinde çizilir.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { temaYaz } from "./theme.ts";

interface DzCtx {
  readonly dark: boolean;
  readonly toggleTheme: () => void;
  readonly overlay: string | null;
  readonly setOverlay: (key: string | null) => void;
}
const Ctx = createContext<DzCtx | null>(null);

export function useDz(): DzCtx {
  const c = useContext(Ctx);
  if (c === null) throw new Error("useDz: DzRoot dışında");
  return c;
}

/** `scope`: tasarım kaynağının CSS kabı (`dz` = Bakış, `dzg` = Giriş ve hesap, `dzy` = Yönetim paneli; scripts/design/port.mjs SOURCES). */
export function DzRoot({ dark: initial, testId, children, overlays, scope = "dz" }: { dark: boolean; testId?: string; children: ReactNode; overlays?: ReactNode; scope?: "dz" | "dzg" | "dzy" }) {
  const [dark, setDark] = useState(initial);
  const [overlay, setOverlay] = useState<string | null>(null);
  const toggleTheme = useCallback(() => {
    setDark((d) => {
      const n = !d;
      temaYaz(n ? "koyu" : "acik");
      return n;
    });
  }, []);
  useEffect(() => {
    if (overlay === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOverlay(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay]);
  const value = useMemo(() => ({ dark, toggleTheme, overlay, setOverlay }), [dark, toggleTheme, overlay]);
  return (
    <Ctx.Provider value={value}>
      <div className={`${scope}${dark ? " dz-dark" : ""}`} data-testid={testId}>
        <div className={`wrap${dark ? " dk" : ""}`}>
          <div className="appzone">
            <div className={`app${dark ? " dkm" : ""}`}>
              {children}
              {overlays}
            </div>
          </div>
        </div>
      </div>
    </Ctx.Provider>
  );
}
