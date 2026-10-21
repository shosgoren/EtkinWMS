"use client";
// T-436 (ALTIN-KURAL 5): "Sessiz" tercihi (cihazda saklanır; @wms/ui ses kaynağı okur). Hesap menüsü bu kancayı kullanır.
import { useCallback, useEffect, useState } from "react";
import { SESSIZ_OLAY, sessizMi, sessizYap } from "@wms/ui";

export function useSessiz(): readonly [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(sessizMi());
    const sync = (): void => setOn(sessizMi());
    window.addEventListener(SESSIZ_OLAY, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SESSIZ_OLAY, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const set = useCallback((v: boolean) => sessizYap(v), []);
  return [on, set] as const;
}
