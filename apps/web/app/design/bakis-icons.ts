// I-18: Bakış kaynağındaki SVG yolları AYNEN (docs/design/source/Bakis.dc.html). Kütüphane ikonu kullanılmaz.
// design-parity.test.ts her değerin kaynakta birebir geçtiğini doğrular.
export const ICON = {
  /** sections(): Giriş */
  giris: "M12 3v12M7 10l5 5 5-5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4",
  /** sections(): Çıkış */
  cikis: "M6 6h15l-1.5 9h-12zM6 6L5 3H2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  /** sections(): Transfer */
  transfer: "M4 8h13M14 5l3 3-3 3M20 16H7M10 13l-3 3 3 3",
  /** sections(): Üretim Transfer */
  uretim: "M3 21V11l6 3v-3l6 3V7l6-3v17zM7 17h2M13 17h2",
  /** sections(): Sayım */
  sayim: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2zM9 13l2 2 4-4",
  /** I.check */
  check: "M4 12l5 5L20 6",
  /** I.warn */
  warn: "M12 9v4M12 17v.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  /** I.list */
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  /** I.cloud (çevrimdışı) */
  cloud: "M3 3l18 18M8.5 8.5A5 5 0 0 0 7 18h10M17.5 13.5A4 4 0 0 0 14 8",
  /** I.bell */
  bell: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4",
  /** whos saat */
  clock: "M12 7v5l3 2M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z",
  /** Tema değiştir */
  theme: "M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18",
  /** .sch ileri */
  chevron: "M9 6l6 6-6 6",
  /** ACİL şimşek */
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
  /** D.scan */
  scan: "M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M7 9v6M10 9v6M13 9v6M17 9v6",
  /** D.scan1 */
  scan1: "M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M8 12h8",
  /** D.back */
  back: "M15 6l-6 6 6 6",
  /** D.undo */
  undo: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  /** D.inn */
  inn: "M12 3v12M7 10l5 5 5-5M4 20h16",
  /** D.out */
  out: "M12 15V3M7 8l5-5 5 5M4 20h16",
  /** D.play */
  play: "M7 4l12 8-12 8z",
  /** Kapat (×) */
  close: "M6 6l12 12M18 6L6 18",
  /** Azalt / artır */
  minus: "M5 12h14",
  plus: "M12 5v14M5 12h14",
  /** Logo yolu (ETKİN WMS işareti) */
  logo: "M32 62H88A28 28 0 1 0 80 82",
} as const;
export type IconKey = keyof typeof ICON;
