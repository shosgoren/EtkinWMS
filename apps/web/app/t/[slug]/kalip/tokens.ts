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
 * T-990: ortak seçim/önizleme bileşenleri için renk: önce form, sonra liste/detay kaynağında arar.
 * T-1010: belirteçler kalıp kapsamında tanımlıdır. Başka kalıbın rengi (ör. Hammadde kahvesi) mevcut kapta yoksa
 * doğrulanmış kaynak rengi yedektir; belirteç varsa açık/koyu tema değeri önceliğini korur. Kaynakta olmayan renk yine hata verir.
 */
export function kdzOrtak(hex: string): string {
  for (const s of ["dzf", "dzl", "dzd"] as const) {
    try {
      const token = BY[s](hex);
      const source = hex.includes(",") ? `${hex.split(",").length === 4 ? "rgba" : "rgb"}(${hex})` : `#${hex}`;
      return `${token.slice(0, -1)}, ${source})`;
    } catch {
      // sonraki kap
    }
  }
  return BY.dzf(hex);
}
