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
  /** Başlık eylemi (+) */
  plus: "M12 5v14M5 12h14",
  /** D.ozet */
  ozet: "M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z",
  /** D.cust (Müşteriler) */
  cust: "M4 21V5h10v16M14 9h6v12M8 9h2M8 13h2M8 17h2",
  /** D.pk (Paketler; aynı yol "Paketi değiştir") */
  pk: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
  /** D.pay (Ödemeler) */
  pay: "M3 6h18v12H3zM3 10h18M7 15h4",
  /** D.site (Satış sayfası) */
  site: "M3 5h18v14H3zM3 9h18M7 7h.01M10 7h.01",
  /** D.log (İşlem kaydı) */
  log: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  /** D.clock (bilgi bandı) */
  clock: "M12 7v5l3 2M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z",
  /** D.check (paket satırı işareti, kalın) */
  check: "M4 12l5 5L20 6",
  /** D.warn (Ödemeler · GECİKEN, fatura bandı) */
  warn: "M12 9v4M12 17v.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  /** Arama (Müşteriler araç çubuğu) */
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5",
  /** Askıya al (kalın) */
  pause: "M9 5v14M15 5v14",
  /** Devam ettir (kalın) */
  play: "M7 4l12 8-12 8z",
  /** Destek erişimi iste */
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
} as const;
