// T-990 (B-97, ALTIN-KURAL "Form doğrulama", kullanıcı 21 Ekim): ortak form doğrulaması — saf işlevler (birim testli: dogrula.test.ts).
// Ekran yalnız alan kurallarını verir; kırmızı çerçeve, sarsılma, alan altı neden, ilk hatalı alana kaydırma/odak, hata balonu ve ses
// `KalipFormEkran` içindedir (form-ekran.tsx). Sunucunun asıl doğrulaması yerinde kalır; bu katman kullanıcıya erken ve net geri bildirimdir.

export type AlanTuru = "text" | "email" | "decimal" | "int";

export interface AlanKurali {
  /** Değer nesnesindeki anahtar ve alanın `data-alan` adı. */
  readonly name: string;
  /** Kullanıcıya görünen ad ("Cari kodu"). */
  readonly label: string;
  readonly required?: boolean;
  readonly kind?: AlanTuru;
  readonly maxLength?: number;
  /** Ek kural: hata metni ya da `null`. */
  readonly check?: (value: unknown, all: Readonly<Record<string, unknown>>) => string | null;
}

export type Hatalar = Readonly<Record<string, string>>;

export interface DogrulamaMetni {
  readonly required: string;
  readonly email: string;
  readonly number: string;
  readonly tooLong: string;
}

// Kaba ama anlaşılır e-posta biçimi (asıl kural sunucuda): bir @, iki yanda boşluksuz metin, alan adında nokta.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DECIMAL_RE = /^\d+([.,]\d+)?$/;
const INT_RE = /^\d+$/;

function bos(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Kurallara göre hatalar (alan adı → tek satırlık neden). Kural sırası korunur (ilk hatalı alan = ilk anahtar). */
export function dogrula(rules: readonly AlanKurali[], values: Readonly<Record<string, unknown>>, msg: DogrulamaMetni): Hatalar {
  const out: Record<string, string> = {};
  for (const r of rules) {
    const v = values[r.name];
    if (bos(v)) {
      if (r.required === true) out[r.name] = msg.required;
      continue;
    }
    const s = typeof v === "string" ? v.trim() : v;
    if (typeof s === "string") {
      if (r.kind === "email" && !EMAIL_RE.test(s)) {
        out[r.name] = msg.email;
        continue;
      }
      if (r.kind === "decimal" && !DECIMAL_RE.test(s)) {
        out[r.name] = msg.number;
        continue;
      }
      if (r.kind === "int" && !INT_RE.test(s)) {
        out[r.name] = msg.number;
        continue;
      }
      if (r.maxLength !== undefined && s.length > r.maxLength) {
        out[r.name] = msg.tooLong;
        continue;
      }
    }
    const extra = r.check?.(v, values) ?? null;
    if (extra !== null) out[r.name] = extra;
  }
  return out;
}

/** Hata balonu metni: "2 alan eksik: Cari kodu, Ünvan" · "1 alan hatalı: E-posta" · ikisi birden " · " ile. */
export function ozet(
  hatalar: Hatalar,
  rules: readonly AlanKurali[],
  requiredText: string,
  fmt: { readonly missing: (n: number, list: string) => string; readonly invalid: (n: number, list: string) => string },
): string {
  const label = (name: string): string => rules.find((r) => r.name === name)?.label ?? name;
  const order = (names: string[]): string[] => {
    const idx = (n: string): number => {
      const i = rules.findIndex((r) => r.name === n);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...names].sort((a, b) => idx(a) - idx(b));
  };
  const missing = order(Object.keys(hatalar).filter((k) => hatalar[k] === requiredText));
  const invalid = order(Object.keys(hatalar).filter((k) => hatalar[k] !== requiredText));
  const parts: string[] = [];
  if (missing.length > 0) parts.push(fmt.missing(missing.length, missing.map(label).join(", ")));
  if (invalid.length > 0) parts.push(fmt.invalid(invalid.length, invalid.map(label).join(", ")));
  return parts.join(" · ");
}

/** İlk hatalı alan (kural sırasıyla; kuralı olmayan sunucu hatası sona). */
export function ilkHatali(hatalar: Hatalar, rules: readonly AlanKurali[]): string | null {
  const keys = Object.keys(hatalar);
  if (keys.length === 0) return null;
  for (const r of rules) if (keys.includes(r.name)) return r.name;
  return keys[0] ?? null;
}

/** Karşılaştırma için normal biçim: metinlerin baş/son boşluğu atılır, `undefined` alan yok sayılır, anahtar sırası önemsiz. */
function normal(v: unknown): unknown {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return v.map(normal);
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort()
        .map((k) => [k, normal(o[k])]),
    );
  }
  return v;
}

/** "Değişiklik var" kararı başlangıç değerleriyle karşılaştırılarak verilir: yazılıp silinen alan değişiklik sayılmaz. */
export function degisti(current: unknown, initial: unknown): boolean {
  return JSON.stringify(normal(current)) !== JSON.stringify(normal(initial));
}
