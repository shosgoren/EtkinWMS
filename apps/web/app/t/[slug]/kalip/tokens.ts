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
