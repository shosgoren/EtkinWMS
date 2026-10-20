// I-18: Destek kaynağındaki SVG yolları AYNEN (docs/design/source/Destek.dc.html, T-967). design-parity.test.ts her değerin kaynakta
// geçtiğini doğrular.
export const DICON = {
  // Üst çubuk: Sorun bildir (üçgen + ünlem) ve Destek (kulaklık: bant, kulaklıklar, mikrofon).
  issueTri: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  issueMark: "M12 9v4M12 17v.01",
  helpBand: "M4 14v-2a8 8 0 0 1 16 0v2",
  helpCups: "M4 14h3v6H5.5A1.5 1.5 0 0 1 4 18.5zM20 14h-3v6h1.5a1.5 1.5 0 0 0 1.5-1.5z",
  helpMic: "M18 20c0 1.2-1.6 2-4 2",
  person: "M5 20c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5",
  // Yüzen kısayol (B-87 öneri 1: şimşek).
  zap: "M13 2 4.5 13.5H11L10 22l8.5-11.5H12z",
  back: "M15 5l-7 7 7 7",
  close: "M6 6l12 12M18 6 6 18",
  pen: "M4 20h4L19 9l-4-4L4 16z",
  penTip: "m13.5 6.5 4 4",
  micB: "M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21",
  guideQ: "M9.3 9.4a2.7 2.7 0 1 1 3.9 2.4c-.8.4-1.2 1-1.2 1.8v.4",
  guideDot: "M12 17.2v.01",
  send: "M4 12 20 4l-6 16-3-7z",
  check: "m5 12 5 5 9-10",
  reply: "M4 5h16v11H9l-5 4z",
  speaker: "M4 9v6h4l5 4V5L8 9z",
  plus: "M12 5v14M5 12h14",
  // Konu çipleri (kaynak renderVals T_BUG / T_HOW / T_IDEA / T_OTHER).
  tBug: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 8v5M12 16.5v.01",
  tHow: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM9.3 9.4a2.7 2.7 0 1 1 3.9 2.4c-.8.4-1.2 1-1.2 1.8v.4M12 17.2v.01",
  tIdea: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  tOther: "M4 5h16v11H9l-5 4z",
} as const;

export type SupportSubjectKind = "BUG" | "HOWTO" | "IDEA" | "OTHER";

/** Kaynak TOPICS: konu → renk (onaltılık, `#` yok) ve ikon. */
export const DTOPIC: Readonly<Record<SupportSubjectKind, { readonly color: string; readonly d: string }>> = {
  BUG: { color: "C62828", d: DICON.tBug },
  HOWTO: { color: "2F5DA8", d: DICON.tHow },
  IDEA: { color: "B07D0B", d: DICON.tIdea },
  OTHER: { color: "4E6476", d: DICON.tOther },
};
