// Aktivasyon ekranının saf yardımcıları (T-995); bileşenden ayrı ki birim testi sunucu eylemlerini yüklemesin.

/** Kaynaktaki `slugOf` (+ kesimden sonra uçta tire temizliği): Türkçe harfler sadeleşir, küçük harf, diğerleri tire, en çok 30. */
export function slugOf(t: string): string {
  const map: Readonly<Record<string, string>> = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", Ö: "o", Ş: "s", Ü: "u" };
  return String(t || "")
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, (ch) => map[ch] ?? ch)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, ""); // 30. karakterde kesilince sonda tire kalmasın (sunucu kuralı: uçlarda tire yok)
}

/** gg.aa.yyyy (İstanbul saati), kaynaktaki `trialEnd` biçimi. */
export function trialDateLabel(iso: string): string {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(new Date(iso));
  const get = (k: string) => p.find((x) => x.type === k)?.value ?? "";
  return `${get("day")}.${get("month")}.${get("year")}`;
}

/** `otpauth://…?secret=…` → 4'lü gruplar (elle giriş). */
export function totpKeyOf(uri: string): string {
  try {
    const secret = new URL(uri).searchParams.get("secret") ?? "";
    return secret.replace(/(.{4})/g, "$1 ").trim();
  } catch {
    return "";
  }
}
