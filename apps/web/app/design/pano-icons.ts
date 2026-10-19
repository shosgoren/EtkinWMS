// I-18: Pano kaynağındaki SVG yolları AYNEN (docs/design/source/Pano.dc.html). Kütüphane ikonu kullanılmaz.
// design-parity.test.ts her değerin kaynakta birebir geçtiğini doğrular.
export const PICON = {
  /** Logo yolu (sitedeki animateMotion ile aynı) */
  logo: "M32 62H88A28 28 0 1 0 80 82",
  /** Bildirim zili */
  bell: "M6 9a6 6 0 0 1 12 0c0 6 2 8 2 8H4s2-2 2-8",
  bellFoot: "M10 20a2 2 0 0 0 4 0",
  /** Ekip / Hesap (menüdeki birleşik yol) */
  team: "M9 8a3.5 3.5 0 1 0 0 .01M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.6a3.5 3.5 0 0 1 0 6.8",
  /** Ayarlar dişlisi */
  gear: "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  /** Mikrofon (Etkin) */
  mic: "M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21",
  /** Sorun "?" */
  qmark: "M9.3 9.4a2.7 2.7 0 1 1 3.9 2.4c-.8.4-1.2 1-1.2 1.8v.4",
  qdot: "M12 17.2v.01",
  /** OKUT çerçevesi + çizgi */
  scanFrame: "M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3",
  scanLine: "M7 12h10",
  scan: "M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M7 12h10",
  /** Görev kartları */
  giris: "M12 3v12M7 10l5 5 5-5M4 19h16",
  cikis: "M3 4h2.5l2.2 11h10.6L21 7H7M9.5 19.5h.01M17.5 19.5h.01",
  transfer: "M4 8h14l-3-3M20 16H6l3 3",
  uretim: "M12 21V9M7 14l5-5 5 5M4 5h16",
  sayim: "M6 4h12v17H6zM9 13l2 2 4-4",
  chevron: "m9 5 7 7-7 7",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
  shield: "M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z",
  /** Kısayol / menü öğeleri */
  problem: "M12 3 2 20h20zM12 10v4.5M12 17.5v.01",
  plus: "M12 5v14M5 12h14",
  label: "M7 9V3h10v6M3 9h18v8H3zM7 14h10v7H7z",
  clock: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18",
  shieldCheck: "M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6zM9 12l2 2 4-4",
  signOut: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  switchUser: "M17 3l4 4-4 4M21 7H9M7 21l-4-4 4-4M3 17h12",
  reports: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  list: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  check: "m5 12 5 5 9-10",
  back: "M15 5l-7 7 7 7",
  close: "M6 6l12 12M18 6 6 18",
} as const;
export type PanoIcon = keyof typeof PICON;
