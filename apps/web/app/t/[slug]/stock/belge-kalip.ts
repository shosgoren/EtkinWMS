// T-972 (B-63 grup 2): stok / belgeler / kabul / sevk / üretim ekranlarının ortak kalıp yardımcıları (sunucu ve istemci kullanabilir).
// Bölüm çipleri (`.fchips`) bu ekranlar arasında geçiş bağlantısıdır; seçili olan bulunulan ekrandır. Renk ve ikonlar kalıp kaynağından.
import { cookies } from "next/headers";
import { LICON } from "../../../design/kalip-icons.ts";
import { temaKoyu } from "../../../design/theme.ts";
import type { KalipCip } from "../kalip/liste.tsx";

export type Bolum = "stock" | "documents" | "shipping" | "production" | "receipts";

/** Ekran ikonu ve kaynak rengi (üst çubuk `.pgic`, kart `.uic`, kimlik `.hic`). Renkler üç kalıp kabında da tanımlı. */
export const BOLUM_ICON: Record<Bolum, { readonly d: string; readonly color: string }> = {
  stock: { d: LICON.grid, color: "0E7C7B" },
  documents: { d: LICON.clip, color: "6C4BD8" },
  shipping: { d: LICON.moveOut, color: "B85A14" },
  production: { d: LICON.uret, color: "30475A" },
  receipts: { d: LICON.moveIn, color: "2F7D5B" },
};

export interface BolumLabels {
  readonly stock: string;
  readonly documents: string;
  readonly shipping: string;
  readonly production: string;
}

/** Stok ↔ Belgeler ↔ Sevkiyat ↔ Üretim geçiş çipleri (telefonda ilk 4 çip görünür; tam 4 çip). */
export function bolumCipleri(home: string, current: Bolum, labels: BolumLabels): KalipCip[] {
  const order: readonly (keyof BolumLabels)[] = ["stock", "documents", "shipping", "production"];
  const href: Record<keyof BolumLabels, string> = { stock: `${home}/stock`, documents: `${home}/stock/documents`, shipping: `${home}/shipping`, production: `${home}/production` };
  return order.map((k) => ({ id: k, label: labels[k], d: BOLUM_ICON[k].d, color: BOLUM_ICON[k].color, on: k === current, href: href[k] }));
}

/** Kalıp kabının koyu tema kararı (kullanıcı tema çerezi). */
export async function kalipDark(): Promise<boolean> {
  return temaKoyu(await cookies());
}
