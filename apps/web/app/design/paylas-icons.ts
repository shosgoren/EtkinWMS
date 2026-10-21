// T-986b (I-18): Paylaş kaynağındaki SVG yolları AYNEN (docs/design/source/Paylas.dc.html). design-parity.test.ts her değerin kaynakta geçtiğini doğrular.
export const SHICON = {
  waA: "M3.5 20.5l1.4-4.3A8.5 8.5 0 1 1 8 19.3z",
  waB: "M9 8.6c.2 3.4 3 6.2 6.4 6.4l1.1-1.5-2.1-1.1-1 .9a5 5 0 0 1-2.6-2.6l.9-1-1.1-2.1z",
  copyA: "M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z",
  copyB: "M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  downA: "M12 4v11M7 10l5 5 5-5",
  downB: "M5 20h14",
  print: "M7 9V3h10v6M3 9h18v8H3zM7 14h10v7H7z",
  check: "m5 12 5 5 9-10",
  lock: "M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  shareA: "M12 15V3M7 8l5-5 5 5",
  shareB: "M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6",
} as const;
