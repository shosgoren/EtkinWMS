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
} as const;
export type GIconKey = keyof typeof GICON;
