// T-991 (I-18): Entegrasyon.dc.html'deki bu ekrana özgü SVG path verileri — birebir, elle çizim yok. Kalıp ortak ikonları `kalip-icons.ts`te.
// design-parity.test.ts her değerin kaynakta aynen geçtiğini denetler.
export const NICON = {
  plug: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4",
  sync: "M20 11a8 8 0 0 0-14.6-4.6L3 9M3 4v5h5M4 13a8 8 0 0 0 14.6 4.6L21 15M21 20v-5h-5",
  pulse: "M3 12h4l3-7 4 14 3-7h4",
  unlink: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1M3 3l18 18",
  pull: "M20 12H8M12 8l-4 4 4 4M4 4v16",
  push: "M4 12h12M12 8l4 4-4 4M20 4v16",
  both: "M4 9h16M16 5l4 4-4 4M20 15H4M8 11l-4 4 4 4",
  truck: "M3 6h11v10H3zM14 9h4l3 3v4h-7M7 19a2 2 0 1 0 0 .01M17 19a2 2 0 1 0 0 .01",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
} as const;
