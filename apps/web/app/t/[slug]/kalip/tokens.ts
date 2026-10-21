// T-968: kalıp kabına göre kaynak renk belirteci. Her kalıp kendi kabındadır (`.dzl` / `.dzf` / `.dzd`); satır içi renk o kabın
// kaynağında geçen renkten olmalıdır (aksi hâlde belirteç tanımsız kalır) — kaynakta olmayan renk hata verir (port.mjs `dz()`).
import { dz as dzListe } from "../../../design/kalip-liste-tokens.ts";
import { dz as dzForm } from "../../../design/kalip-form-tokens.ts";
import { dz as dzDetay } from "../../../design/kalip-detay-tokens.ts";

export type KalipScope = "dzl" | "dzf" | "dzd";
const BY: Record<KalipScope, (hex: string) => string> = { dzl: dzListe, dzf: dzForm, dzd: dzDetay };

export function kdz(scope: KalipScope, hex: string): string {
  return BY[scope](hex);
}

/**
 * T-990: ortak seçim/önizleme bileşenleri için renk: önce form kabı, yoksa liste/detay/saha kabının kaynağında geçen renk (belirteçler
 * genel CSS değişkenidir; kaynakta hiç olmayan renk yine hata verir). Ör. Hammadde kahvesi yalnız liste kaynağında geçer.
 */
export function kdzOrtak(hex: string): string {
  for (const s of ["dzf", "dzl", "dzd"] as const) {
    try {
      return BY[s](hex);
    } catch {
      // sonraki kap
    }
  }
  return BY.dzf(hex);
}
