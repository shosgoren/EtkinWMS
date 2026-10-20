"use client";
// Kurulum ilerlemesi (T-250): depo → raf → ürün. Görünüm kalıbın `KalipKurulum` bileşenindedir (T-971); eski `SetupGuide` kutusu T-978'de
// kaldırıldı. İlerleme sunucudan okunur (`getSetupProgressAction`); iş kuralı (neyin "tamam" sayıldığı) domain'dedir.
import { useEffect, useState } from "react";
import { getSetupProgressAction } from "../warehouses/actions.ts";

export interface SetupProgressView {
  readonly hasWarehouse: boolean;
  readonly hasLocation: boolean;
  readonly hasItem: boolean;
  readonly nextWarehouseId: string | null;
}

/** İlerlemeyi yükler; `version` değişince yeniden okur. Hata durumunda `null` (rehber gösterilmez, sayfa çalışır). */
export function useSetupProgress(slug: string, enabled: boolean, version: number): SetupProgressView | null {
  const [progress, setProgress] = useState<SetupProgressView | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void getSetupProgressAction({ slug }).then((r) => {
      if (live && r.ok) setProgress(r.data);
    });
    return () => {
      live = false;
    };
  }, [slug, enabled, version]);
  return progress;
}

export function isSetupComplete(p: SetupProgressView): boolean {
  return p.hasWarehouse && p.hasLocation && p.hasItem;
}
