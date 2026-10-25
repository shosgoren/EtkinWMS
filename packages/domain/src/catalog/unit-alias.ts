// T-1035: saf (DB yok) birim eş adı tablosu — Excel içe aktarma kullanır. Paraşüt eşitlemesinin kendi tablosu (`integrations/apply.ts`) ayrıdır.

/**
 * Serbest birim metni (Excel, ERP) → standart birim kodu; tanınmazsa `null` (T-1035). "Ad.", "adt", "PCS" → ADET; "Kilo" → KG; "Mt", "M" → MT …
 * Yalnız eşleştirme ipucudur: birim yine kiracının birim tablosunda (kod ile) aranır.
 */
export function standardUnitCode(raw: string | null): string | null {
  const k = (raw ?? "")
    .toLocaleUpperCase("tr")
    .replace(/[ÇĞİÖŞÜ]/g, (ch) => ({ Ç: "C", Ğ: "G", İ: "I", Ö: "O", Ş: "S", Ü: "U" })[ch] ?? ch)
    .replace(/[^A-Z0-9]/g, "");
  const map: Record<string, string> = {
    ADET: "ADET", AD: "ADET", ADT: "ADET", ADED: "ADET", TANE: "ADET", PCS: "ADET", PC: "ADET", PIECE: "ADET", EA: "ADET", NIU: "ADET", C62: "ADET",
    KG: "KG", KILOGRAM: "KG", KILO: "KG", KGM: "KG", GR: "GR", GRAM: "GR", G: "GR", GRM: "GR",
    MT: "MT", M: "MT", METRE: "MT", MTR: "MT", CM: "CM", SANTIMETRE: "CM", CMT: "CM",
    LT: "LT", L: "LT", LITRE: "LT", LTR: "LT", M2: "M2", METREKARE: "M2", MTK: "M2", M3: "M3", METREKUP: "M3", MTQ: "M3",
    KOLI: "KOLI", PALET: "PALET",
  };
  return map[k] ?? null;
}
