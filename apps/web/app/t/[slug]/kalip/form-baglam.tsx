"use client";
// T-990 (B-97): ortak form bağlamı — `KalipFormEkran` alan hatalarını ve sarsılmayı alanlara (KalipAlan, KalipSecim…) buradan verir.
// Bağlam yoksa (form ekranı dışı) alanlar hatasız çizilir.
import { createContext, useContext } from "react";
import type { Hatalar } from "./dogrula.ts";

export interface FormBaglam {
  readonly hatalar: Hatalar;
  /** Her geçersiz Kaydet denemesinde artar: alan sarsılması yeniden başlar. */
  readonly salla: number;
}

export const FormBaglamCtx = createContext<FormBaglam | null>(null);

/** Alanın hata metni (yoksa `undefined`). */
export function useAlanHata(name: string | undefined): string | undefined {
  const ctx = useContext(FormBaglamCtx);
  if (name === undefined || ctx === null) return undefined;
  return ctx.hatalar[name];
}

/** Alanın sarsılma anahtarı (`key` olarak verilince animasyon yeniden oynar). */
export function useSalla(): number {
  return useContext(FormBaglamCtx)?.salla ?? 0;
}
