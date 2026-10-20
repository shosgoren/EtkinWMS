// I-18: Yönetim paneli Destek kaynağındaki SVG yolları AYNEN (docs/design/source/YonetDestek.dc.html, T-967). design-parity.test.ts her
// değerin kaynakta geçtiğini doğrular.
export const YDICON = {
  /** D.help (menüde Destek) */
  help: "M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H5.5A1.5 1.5 0 0 1 4 18.5zM20 14h-3v6h1.5a1.5 1.5 0 0 0 1.5-1.5zM18 20c0 1.2-1.6 2-4 2",
  /** Bilgi bandı zili */
  bell: "M6 9a6 6 0 0 1 12 0c0 6 2 8 2 8H4s2-2 2-8M10 20a2 2 0 0 0 4 0",
  /** Erişim iste / müşteri verisi bandı (göz) */
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  /** Destek erişimi kilidi */
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  /** Kapat (kalın onay) */
  check: "M4 12l5 5L20 6",
  /** Yanıtı gönder */
  send: "M4 12 20 4l-6 16-3-7z",
  /** WhatsApp balonu ve ahize */
  waBubble: "M4 20l1.3-3.9A8 8 0 1 1 8 18.8z",
  waPhone: "M9 9.5c.3 1.8 2.2 3.8 4.5 4.5l1.2-1.2 1.8.8c-.2 1-1 1.8-2 1.8A6 6 0 0 1 8.5 9.4c0-1 .8-1.8 1.8-2l.8 1.8z",
  /** Konu ikonları (kaynak T). */
  tBug: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 8v5M12 16.5v.01",
  tHow: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM9.3 9.4a2.7 2.7 0 1 1 3.9 2.4c-.8.4-1.2 1-1.2 1.8v.4M12 17.2v.01",
  tIdea: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  tOther: "M4 5h16v11H9l-5 4z",
} as const;

/** Kaynak T: konu → ikon ve renk (onaltılık, `#` yok). */
export const YDTOPIC = {
  BUG: { d: YDICON.tBug, color: "C62828" },
  HOWTO: { d: YDICON.tHow, color: "2F5DA8" },
  IDEA: { d: YDICON.tIdea, color: "B07D0B" },
  OTHER: { d: YDICON.tOther, color: "4E6476" },
} as const;
