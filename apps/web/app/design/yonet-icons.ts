// I-18: Yönetim paneli kaynağındaki SVG yolları AYNEN (docs/design/source/Yonet.dc.html). Kütüphane ikonu kullanılmaz.
// design-parity.test.ts her değerin kaynakta birebir geçtiğini doğrular.
export const YICON = {
  /** Logo yolu (ETKİN işareti) */
  logo: "M32 62H88A28 28 0 1 0 80 82",
  /** D.req (Demo talepleri) */
  req: "M3 6h18v12H3zM3 7l9 6 9-6",
  /** Operatör kilidi */
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  /** Çıkış */
  signOut: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  /** Açık / koyu görünüm */
  theme: "M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18",
  /** Geri */
  back: "M15 6l-6 6 6 6",
  /** Bağlantı (tek seferlik aktivasyon bağlantısı kutusu, T-995) */
  link: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
} as const;
