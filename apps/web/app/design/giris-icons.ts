// I-18: Giriş ve hesap kaynağındaki SVG yolları AYNEN (docs/design/source/Giris.dc.html). Kütüphane ikonu kullanılmaz.
// design-parity.test.ts her değerin kaynakta birebir geçtiğini doğrular.
export const GICON = {
  /** Geri (bant `.wb`) */
  back: "M15 6l-6 6 6 6",
  /** Açık / koyu görünüm */
  theme: "M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18",
  /** Kilit (D.lock) */
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  /** Reddet / iptal (×) */
  close: "M6 6l12 12M18 6L6 18",
  /** Onay (D.check) */
  check: "M4 12l5 5L20 6",
  /** Logo yolu (ETKİN işareti) — T-995 aktivasyon */
  logo: "M32 62H88A28 28 0 1 0 80 82",
  /** İleri (büyük düğme) */
  next: "M9 6l6 6-6 6",
  /** Firma (aktivasyon 1. adım) */
  company: "M4 21V5h10v16M14 9h6v12M8 9h2M8 13h2M8 17h2",
  /** D.box (örnek veri) */
  box: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
  /** D.empty (boş başla) */
  empty: "M4 4h16v16H4zM9 12h6",
  /** D.term (el terminali) */
  term: "M6 2h12v20H6zM9 6h6v5H9zM9 15h.01M12 15h.01M15 15h.01M9 18h.01M12 18h.01M15 18h.01",
  /** D.mail */
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  /** D.eye / D.eyeOff (parola göster/gizle) */
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeOff: "M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.1 3.7M6.6 6.6C3.8 8.4 2 12 2 12s4 6 10 6a9.6 9.6 0 0 0 4.4-1.1",
  /** D.clock (bant: örnek verileri sonra temizleme) */
  clock: "M12 7v5l3 2M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z",
  /** Uyarı (hata satırı) */
  warn: "M12 9v4M12 17v.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  /** D.user (kullanıcı adı) — T-997 saha girişi */
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  /** D.phone (kişisel telefon) */
  phone: "M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2",
  /** D.cikis (toplayıcı rolü) */
  cikis: "M6 6h15l-1.5 9h-12zM6 6L5 3H2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  /** D.sayim (sayımcı rolü) */
  sayim: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2zM9 13l2 2 4-4",
  /** Ekle (PERSONELİ EKLE) */
  plus: "M12 5v14M5 12h14",
  /** Yazdır (etkinleştirme kartı) */
  print: "M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z",
  /** Yeni kod (saha personeli satırı) */
  renew: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
} as const;
export type GIconKey = keyof typeof GICON;
