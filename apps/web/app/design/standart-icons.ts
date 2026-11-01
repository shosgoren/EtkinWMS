// T-1042 (STANDART.md §1, kaynak `docs/design/source/StandartAnaEkran.dc.html`): masaüstü standardı üst çubuk ikon yolları — tuval
// artboard'larından birebir. Elle yazılır (üreteç bu kaynakları henüz okumaz); yeni ikon önce tuvale, sonra buraya.
export const SICON = {
  /** Sorun bildir: bayrak (26 Ekim kullanıcı isteği; üçgen "!" yerine). */
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  /** Canlı saat. */
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  /** Tema: güneş / ay. */
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  /** Ayarlar: dişli. */
  gear: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  /** T-1047 liste kalıbı: Liste görünümü, Sütunlar (ayar sürgüsü), oklar. */
  list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  chevUp: "m6 15 6-6 6 6",
  chevDown: "m6 9 6 6 6-6",
  chevLeft: "m15 5-7 7 7 7",
  /** T-1049 kayıt kartı (kaynak `StandartUrunKarti.dc.html`): sekme, sayı kutusu, bilgi kutucuğu ve hızlı işlem simgeleri. */
  kutu: "M12 2l9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10",
  onay: "M5 12l5 5 9-10",
  yazici: "M6 9V3h12v6M6 18H4v-7h16v7h-2M6 14h12v7H6z",
  sayim: "M9 4h6v3H9zM7 5H5v16h14V5h-2M9 13l2 2 4-4",
  cevrim: "M4 8h14l-3-3M20 16H6l3 3",
  bilgi: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01",
  raf: "M4 3h16v18H4zM4 9h16M4 15h16",
  barkod: "M4 5v14M7 5v14M11 5v14M14 5v14M18 5v14M20 5v14",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2z",
  gecmis: "M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2",
  ad: "M3 12V4h8l10 10-8 8zM7.5 7.5h.01",
  birim: "M4 7h16M4 12h10M4 17h6",
  uyari: "M12 3l10 18H2zM12 10v5M12 18h.01",
  kilit: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  kalem: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  /** T-1112 ayar kalıbı (kaynak `StandartAyarlarEntegrasyon.dc.html`): alt bölüm, akış ve yön simgeleri. */
  baglanti: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  arsiv: "M4 7h16M6 7v13h12V7M9 4h6",
  al: "M20 12H4M10 6l-6 6 6 6",
  gonder: "M4 12h16M14 6l6 6-6 6",
  kisi: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0",
  depo: "M3 21V8l9-5 9 5v13M7 21v-8h10v8",
  grafik: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  kamyon: "M3 6h11v10H3zM14 9h4l3 3v4h-7M7 19a2 2 0 1 0 0-.01M17 19a2 2 0 1 0 0-.01",
  belge: "M6 3h9l4 4v14H6zM14 3v5h5",
  /** T-1115 ana ekran (kaynak `StandartAnaEkran.dc.html` "İşler"): mal girişi, cariler, Excel aktarımı, işlem geçmişi, sürükle tutamacı. */
  indir: "M12 3v12M7 10l5 5 5-5M4 21h16",
  kisiler: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-4-5.7",
  belgeOnay: "M6 3h9l4 4v14H6zM14 3v5h5M9 13l2 2 4-4",
  kalkan: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  tutamac: "M9 4h.01M15 4h.01M9 10h.01M15 10h.01M9 16h.01M15 16h.01M9 22h.01M15 22h.01",
  /** T-1117 form kalıbı (kaynak `StandartYeniCari.dc.html`): cari şerit simgesi ve alan başı simgeleri. */
  bina: "M4 21V5l8-3 8 3v16M9 21v-5h6v5",
  telefon: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2",
  eposta: "M3 6h18v12H3zM3 6l9 7 9-7",
  konum: "M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",

  /** T-1116 ürün kartı (kaynak `StandartUrunKarti.dc.html` / `StandartUrunKartiStok.dc.html`): Takip sekmesi, pivot palet ve açık/kapalı oku. */
  takip: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2",
  palet: "M3 17h18M5 17v3M12 17v3M19 17v3M5 7h14v10H5z",
  chevRight: "M9 6l6 6-6 6",
  chevOpen: "M6 9l6 6 6-6",
  /** T-1145 ürün görseli (kaynak `StandartUrunKarti.dc.html` şerit görseli + "Görsel ekle", `StandartGorselBuyuk.dc.html` büyük görünüm,
   *  `StandartUrunlerListe.dc.html` liste küçük resmi). */
  gorsel: "M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M15 9h.01",
  gorselListe: "M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4",
  gorselEkle: "M4 8h3l2-3h6l2 3h3v12H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  gOnceki: "M15 18l-6-6 6-6",
  gKapat: "M6 6l12 12M18 6L6 18",
  gArti: "M12 5v14M5 12h14",
  gKapak: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  gSil: "M4 7h16M6 7v13h12V7M9 4h6M10 11v6M14 11v6",
  gTamam: "M5 12l5 5 9-10",
} as const;
