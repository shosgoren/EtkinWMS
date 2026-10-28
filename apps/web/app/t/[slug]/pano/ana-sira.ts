// T-1115 (tuval `StandartAnaEkran.dc.html` "Düzenle · sürükle bırak"): ana ekran İşler kutularının kişisel sırası — saf işlevler
// (istemci bileşeni kullanır; birim testli). Sıra cihazda hatırlanan kolaylıktır (yetki değildir): kayıtta olmayan ya da artık görünmeyen
// kutu sessizce düşer, kayıtta olmayan yeni kutu sona eklenir. Tipler burada (istemci bileşeni sunucu modülünü içe aktarmasın).

export type AnaIsKey = "giris" | "satis" | "stok" | "urun" | "cari" | "depo" | "excel" | "kayit";

export interface AnaIs {
  readonly key: AnaIsKey;
  readonly href: string;
}

/** Kayıtlı sırayı (güvenilmeyen `unknown`) görünür kutulara uygular. */
export function siraUygula(keys: readonly string[], saved: unknown): string[] {
  if (!Array.isArray(saved)) return [...keys];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of saved) {
    if (typeof k !== "string" || seen.has(k) || !keys.includes(k)) continue;
    seen.add(k);
    out.push(k);
  }
  for (const k of keys) if (!seen.has(k)) out.push(k);
  return out;
}

/** `key` kutusunu `to` konumuna taşır (sürükle bırak). Bilinmeyen kutu ya da aynı yer: sıra değişmez. */
export function tasi(order: readonly string[], key: string, to: number): string[] {
  const from = order.indexOf(key);
  if (from < 0) return [...order];
  const at = Math.max(0, Math.min(order.length - 1, to));
  if (at === from) return [...order];
  const next = order.filter((k) => k !== key);
  next.splice(at, 0, key);
  return next;
}

/** Klavye / dokunma: kutuyu bir öne (-1) ya da bir sona (+1) alır. */
export function kaydir(order: readonly string[], key: string, delta: -1 | 1): string[] {
  const from = order.indexOf(key);
  return from < 0 ? [...order] : tasi(order, key, from + delta);
}
