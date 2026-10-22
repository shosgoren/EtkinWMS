"use client";
// T-1006: yolculuk ipucu kartı açıkken alt çubuğun parlayacak yuvası (KabukBar mevcut `spot` kancası, kaynak `.touring` + `.spot`).
// Ekran kendi `spot` değerini vermediyse KabukBar bu küçük ortak durumu okur; ipucu kartı kapanınca `null`.
import { useSyncExternalStore } from "react";

type Slot = "geri" | "home" | "center" | "mods" | "etkin";
let current: Slot | null = null;
const subs = new Set<() => void>();

export function setYolSpot(slot: Slot | null): void {
  if (current === slot) return;
  current = slot;
  for (const f of subs) f();
}

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

export function useYolSpot(): Slot | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
