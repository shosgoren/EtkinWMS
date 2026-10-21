"use client";
// T-1001 (ALTIN-KURAL 5): durum değişkeninden ses. Ekranın hata ya da başarı durumu boşken dolunca bir kez hata / başarı sesi çalar
// (aynı değer tekrar çizilince çalmaz). Kendi balonu olmayan eski ekranlar (kabul, paket akışı) sesi böyle alır.
import { useEffect, useRef } from "react";
import { feedback } from "@wms/ui";

export function useSonucSesi(durum: { readonly hata?: unknown; readonly tamam?: unknown; readonly uyari?: unknown }): void {
  const once = useRef<{ hata: unknown; tamam: unknown; uyari: unknown }>({ hata: null, tamam: null, uyari: null });
  const { hata = null, tamam = null, uyari = null } = durum;
  useEffect(() => {
    const p = once.current;
    if (hata !== null && hata !== false && hata !== p.hata) feedback.error();
    else if (uyari !== null && uyari !== false && uyari !== p.uyari) feedback.warn();
    else if (tamam !== null && tamam !== false && tamam !== p.tamam) feedback.ok();
    once.current = { hata, tamam, uyari };
  }, [hata, tamam, uyari]);
}
