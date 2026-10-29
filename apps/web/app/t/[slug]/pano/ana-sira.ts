// T-1115 (tuval `StandartAnaEkran.dc.html` "Düzenle · sürükle bırak"): ana ekran İşler kutularının kişisel sırası — saf işlevler
// (istemci bileşeni kullanır; birim testli). Sıra cihazda hatırlanan kolaylıktır (yetki değildir): kayıtta olmayan ya da artık görünmeyen
// kutu sessizce düşer, kayıtta olmayan yeni kutu sona eklenir. Tipler burada (istemci bileşeni sunucu modülünü içe aktarmasın).
// T-1128 (kullanıcı 29 Ekim: "Düzenle'de yetkisi olan modülü getiremiyor"): kullanıcı kutu ekler / çıkarır. Kayıt yeni biçimde seçimin
// kendisidir (`{ secim: [...] }`; çıkarılan varsayılan kutu geri gelmez); eski kayıt (dizi) yalnız varsayılanların sırasıdır.

export type AnaIsKey = "giris" | "satis" | "stok" | "urun" | "cari" | "depo" | "excel" | "kayit";

export interface AnaIs {
  readonly key: AnaIsKey;
  readonly href: string;
}

/**
 * T-1128: Düzenle'de eklenebilir kutu — tuval kutusu (`mod` yok; `key` bir `AnaIsKey`) ya da Modüller sayfasındaki modül (`key` modül
 * kimliği; `mod` kaynak rengi ve ikon yolu). Sunucuda yetkiyle süzülür (`ana-ekran.ts` `anaIsAdaylari`).
 */
export interface AnaAday {
  readonly key: string;
  readonly href: string;
  readonly mod?: { readonly color: string; readonly d: string };
}

/** T-1128: cihazda saklanan seçim (yeni biçim). */
export interface AnaSecimKaydi {
  readonly secim: readonly string[];
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

/**
 * T-1128: kayıtlı seçimi (güvenilmeyen `unknown`) uygular. `varsayilan`: hiç kayıt yokken görünen kutular (tuval sırası); `izinli`: üyenin
 * ekleyebileceği bütün kutular. Yeni biçim (`{ secim }`) olduğu gibi uygulanır — izni kalmayan, bilinmeyen ve tekrar eden kutu sessizce
 * düşer, eksik kutu eklenmez (kullanıcı çıkarmıştır). Eski biçim (dizi) varsayılanların sırasıdır (`siraUygula`). Diğer her şey varsayılan.
 */
export function secimUygula(varsayilan: readonly string[], izinli: readonly string[], saved: unknown): string[] {
  if (Array.isArray(saved)) return siraUygula(varsayilan, saved);
  if (saved === null || typeof saved !== "object") return [...varsayilan];
  const secim = (saved as { secim?: unknown }).secim;
  if (!Array.isArray(secim)) return [...varsayilan];
  const out: string[] = [];
  for (const k of secim) if (typeof k === "string" && izinli.includes(k) && !out.includes(k)) out.push(k);
  return out;
}

/** T-1128: cihaza yazılacak kayıt (yeni biçim). */
export function secimKaydi(order: readonly string[]): AnaSecimKaydi {
  return { secim: [...order] };
}

/** T-1128: kutuyu sona ekler (zaten varsa sıra değişmez). */
export function ekle(order: readonly string[], key: string): string[] {
  return order.includes(key) ? [...order] : [...order, key];
}

/** T-1128: kutuyu çıkarır. */
export function cikar(order: readonly string[], key: string): string[] {
  return order.filter((k) => k !== key);
}

/** T-1128: ızgarada olmayan izinli kutular (izinli sırasıyla) — "Ekle" seçim sayfasının seçenekleri. */
export function eklenebilir(izinli: readonly string[], order: readonly string[]): string[] {
  return izinli.filter((k) => !order.includes(k));
}
