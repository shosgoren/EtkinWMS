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
} as const;
