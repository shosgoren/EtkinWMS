// T-436 (ALTIN-KURAL 16): ortak sayı / tarih / büyük-küçük harf biçimi. Sabit dil ("tr-TR") yazılmaz: çağıran kullanıcının
// dilini verir (istemcide `useLocale()`, sunucuda `getLocale()`; dil okuma T-984'ün işidir). ESLint `wms/no-fixed-locale` bekçisi
// biçim çağrılarında sabit dil etiketini yakalar. Bilinmeyen/boş dil Türkçe kabul edilir (ürünün varsayılan dili).

const ETIKET: Readonly<Record<string, string>> = { tr: "tr-TR", en: "en-GB" };

/** Uygulama dili ("tr", "en", "tr-TR"…) → Intl dil etiketi. */
export function intlDil(locale: string | null | undefined): string {
  const l = (locale ?? "").trim();
  if (l === "") return ETIKET.tr!;
  const kok = l.split(/[-_]/)[0]!.toLowerCase();
  return l.includes("-") ? l : (ETIKET[kok] ?? l);
}

/** Tam sayı / ondalık sayı (binlik ayırıcı dile göre). */
export function sayi(n: number, locale: string | null | undefined, opts?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(intlDil(locale), opts);
}

/** Tarih/saat biçimleyicisi (tekrar kullanım için). */
export function tarihBicimi(locale: string | null | undefined, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(intlDil(locale), opts);
}

/** Tek tarih/saat değeri. */
export function tarih(d: Date, locale: string | null | undefined, opts: Intl.DateTimeFormatOptions): string {
  return tarihBicimi(locale, opts).format(d);
}

/** Dile duyarlı büyük harf (Türkçede i → İ). */
export function buyukHarf(s: string, locale: string | null | undefined): string {
  return s.toLocaleUpperCase(intlDil(locale));
}

/** Dile duyarlı küçük harf (Türkçede I → ı). */
export function kucukHarf(s: string, locale: string | null | undefined): string {
  return s.toLocaleLowerCase(intlDil(locale));
}
