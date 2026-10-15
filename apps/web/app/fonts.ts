// T-988: Görevlerim tasarımının yazı tipleri (kendi sunucumuzdan; CSP `font-src 'self'`). Lisanslar: app/fonts/OFL-*.txt (SIL OFL 1.1).
// `next/font/local` dosyaları derlemede .next/static altına alır. Değişken sınıfları kök `<body>`dadır (sayfa bileşenleri bu modülü içe
// aktarmaz: vitest sayfa yükleyici testleri next/font derleyicisi olmadan koşar). `preload: false`: dosya yalnız `.gv` içinde font-family
// kullanılınca iner; diğer sayfalar bu yazı tiplerini yüklemez.
import localFont from "next/font/local";

export const bricolage = localFont({ src: "./fonts/bricolage-grotesque.woff", weight: "400 800", variable: "--font-bricolage", display: "swap", preload: false });
export const instrument = localFont({ src: "./fonts/instrument-sans.woff", weight: "400 600", variable: "--font-instrument", display: "swap", preload: false });
export const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-500.woff", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-600.woff", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
  preload: false,
});
/** Tasarım kabına verilecek değişken sınıfları. */
export const designFontVars = `${bricolage.variable} ${instrument.variable} ${plexMono.variable}`;
