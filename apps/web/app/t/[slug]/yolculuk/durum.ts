"use client";
// T-1054: kurulum yolculuğunun son okunan durumu (düzendeki `YolculukKatman` yazar). Ürünler / Depolar ekranındaki giriş kartı bunu okur:
// ayrı sunucu çağrısı yok, katmanla aynı veri. Yolculuğu göremeyen rolde katman çizilmez → durum `null` kalır, kart çıkmaz.
import { useSyncExternalStore } from "react";
import type { JourneyData } from "./steps.ts";

let current: JourneyData | null = null;
const subs = new Set<() => void>();

export function setYolDurum(data: JourneyData | null): void {
  if (current === data) return;
  current = data;
  for (const f of subs) f();
}

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

export function useYolDurum(): JourneyData | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
