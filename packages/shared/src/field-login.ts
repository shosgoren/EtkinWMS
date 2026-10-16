// Saha girişi ortak kuralları (T-997, ADR-026 §7). Etkinleştirme kodu: 8 karakter, karışmayan alfabe (0/O, 1/I/L yok), gösterimde
// `XXXX-XXXX`; DB'de yalnız normalize edilmiş kodun SHA-256 özeti. Aynı normalize + özet kuralı `packages/auth/src/field.ts`'te de vardır
// (paket bağımlılığı eklenmez); `tests/unit/field-login.test.ts` ikisinin eşitliğini denetler.
import { createHash, randomBytes, randomInt } from "node:crypto";

/** İç e-posta alanı (RFC 2606 `.invalid`): Better Auth e-posta uçları ve posta adaptörü bu alanı reddeder. */
export const FIELD_EMAIL_DOMAIN = "field.invalid";
export const ACTIVATION_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ACTIVATION_TTL_HOURS = 24;
/** Kullanıcı adı: küçük harf, rakam, `.`, `_`, `-`; 3–32 karakter, harf/rakamla başlar (DB CHECK ile aynı). */
export const FIELD_USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export function fieldEmail(userId: string): string {
  return `${userId}@${FIELD_EMAIL_DOMAIN}`;
}

export function isFieldEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${FIELD_EMAIL_DOMAIN}`);
}

/** Kullanıcı adını sadeleştirir (Türkçe harfler ASCII'ye, boşluk yok). Geçersizse `null`. */
export function normalizeFieldUsername(raw: string): string | null {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", Ö: "o", Ş: "s", Ü: "u" };
  const v = raw
    .trim()
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => map[c] ?? c)
    .toLowerCase();
  return FIELD_USERNAME_RE.test(v) ? v : null;
}

/** Yeni kod (gösterim biçimi `XXXX-XXXX`). */
export function generateActivationCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += ACTIVATION_ALPHABET[randomInt(ACTIVATION_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Kullanıcının yazdığı kodu normalize eder (büyük harf, ayraç/boşluk yok); biçimsizse `null`. */
export function normalizeActivationCode(raw: string): string | null {
  const v = raw.toUpperCase().replace(/[\s-]/g, "");
  if (v.length !== 8) return null;
  for (const ch of v) if (!ACTIVATION_ALPHABET.includes(ch)) return null;
  return v;
}

/** Normalize edilmiş kodun özeti (64 hex). */
export function activationCodeHash(normalized: string): string {
  return createHash("sha256").update(`field-activation:${normalized}`).digest("hex");
}

export type PinProblem = "FORMAT" | "OBVIOUS";

/** 6 haneli PIN (Q-128); bariz diziler (tek rakam tekrarı, artan/azalan ardışık) reddedilir. */
export function pinProblem(pin: string): PinProblem | null {
  if (!/^\d{6}$/.test(pin)) return "FORMAT";
  const d = [...pin].map(Number);
  const same = d.every((x) => x === d[0]);
  const up = d.every((x, i) => i === 0 || x === ((d[i - 1] as number) + 1) % 10);
  const down = d.every((x, i) => i === 0 || x === ((d[i - 1] as number) + 9) % 10);
  return same || up || down ? "OBVIOUS" : null;
}

/** Ortak cihaz kayıt belirteci (QR, 5 dk; T-998): 32 bayt base64url. DB'de yalnız özeti. */
export function generateEnrollmentToken(): string {
  return randomBytes(32).toString("base64url");
}

/** `packages/auth/src/field.ts` `enrollmentTokenHash` ile aynı. */
export function enrollmentTokenHash(token: string): string {
  return createHash("sha256").update(`field-enroll:${token}`).digest("hex");
}
