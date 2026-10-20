// T-958: Modüller sayfası veri tipleri (istemci bileşeni yalnız bunu içe aktarır; yetki işlevi sunucudaki modules.ts'tedir, AC-28).
export type KabukModuleId =
  | "home" | "urun" | "depo" | "satin" | "satis" | "topla" | "trans" | "uret" | "qr" | "koli"
  | "tara" | "sayim" | "ayin" | "ses" | "abone" | "fis" | "excel" | "etiket" | "cari" | "ekip";

export interface KabukModule {
  readonly id: KabukModuleId;
  readonly color: string;
  readonly d: string;
  /** Tam bağlantı; `null` = YAKINDA (bağlantı değil). */
  readonly href: string | null;
}
