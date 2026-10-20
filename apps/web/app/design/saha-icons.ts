// I-18 / T-969: Saha kalıbı (KalipSaha.dc.html: Okut · Doğrula · Miktar) SVG yolları AYNEN. Kaynak dosya henüz depoda değil
// (docs/design/source'a ekleme T-968); eklendiğinde design-parity.test.ts bu sözlüğü de kaynakla karşılaştırmalıdır (T-969 kartı).
export const SICON = {
  /** Uygulama logosu yolu (viewBox 0 0 120 120; daire bu yol üzerinde hareket eder). */
  logo: "M32 62H88A28 28 0 1 0 80 82",
  /** Kabul (aşağı ok + raf çizgisi). */
  kabul: "M12 3v12M7 10l5 5 5-5M4 19h16",
  /** Ürün kutusu (Miktar adımı iş kartı). */
  urun: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  warn: "M12 3 2 20h20zM12 10v4.5M12 17.5v.01",
  micB: "M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21",
  nfc: "M7 8.5a5 5 0 0 1 0 7M10.5 6a8.5 8.5 0 0 1 0 12M14 3.5a12 12 0 0 1 0 17",
  kbd: "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
  check: "m5 12 5 5 9-10",
  close: "M6 6l12 12M18 6 6 18",
  scan: "M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M7 12h10",
  next: "M5 12h14M13 6l6 6-6 6",
  del: "M9 5h11v14H9l-6-7zM12.5 9.5l5 5M17.5 9.5l-5 5",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 11v6M12 7.5v.01",
} as const;
