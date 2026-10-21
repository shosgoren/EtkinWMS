"use client";
// T-436 (ALTIN-KURAL 6, 9): sunucuya giden işlemin ortak sarmalı. Aynı işlem sürerken ikinci kez gönderilmez (`busy` anında
// `true`, düğme `aria-busy` + kapalı); 1 sn'den uzun sürerse düğmedeki dönen gösterge (`.kyuk`, CSS gecikmesiyle) görünür.
// Çevrimdışıyken işlem başlamaz: "Bağlantı yok · bağlanınca tekrar dene" balonu + uyarı sesi (çevrimdışı kuyruk yok).
import { useCallback, useRef, useState } from "react";
import { cevrimdisiEngel } from "./cevrimdisi.ts";

export interface TekGonderim {
  /** İşlem sürüyor (düğmeyi kapat, `aria-busy` ver). */
  readonly busy: boolean;
  /**
   * İşlemi çalıştırır. Zaten sürüyorsa ya da çevrimdışıysa çalıştırmaz ve `undefined` döner.
   * Hata çağırana aynen fırlatılır (ekran kendi hata metnini gösterir).
   */
  readonly run: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
}

export function useTekGonderim(): TekGonderim {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (lock.current) return undefined;
    if (cevrimdisiEngel()) return undefined;
    lock.current = true;
    setBusy(true);
    try {
      return await fn();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, run };
}
