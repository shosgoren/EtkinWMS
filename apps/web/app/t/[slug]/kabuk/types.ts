// T-958: Modüller sayfası veri tipleri (istemci bileşeni yalnız bunu içe aktarır; yetki işlevi sunucudaki modules.ts'tedir, AC-28).
export type KabukModuleId =
  | "home" | "urun" | "depo" | "satin" | "satis" | "topla" | "trans" | "uret" | "qr" | "koli"
  | "tara" | "sayim" | "ayin" | "ses" | "abone" | "fis" | "excel" | "etiket" | "cari" | "ekip"
  // T-979c: eski "Tüm ekranlar" menüsünden taşınanlar — görünüm geçişi (Genel bakış ↔ İşlemler) ve yönetim ekranları.
  | "kokpit" | "akis" | "stok" | "ayar" | "kayit";

export interface KabukModule {
  readonly id: KabukModuleId;
  readonly color: string;
  readonly d: string;
  /** Tam bağlantı; `null` = YAKINDA (bağlantı değil). */
  readonly href: string | null;
  /** T-979c: görünüm geçişi kutusu — dokununca `view` çerezi bu değere yazılır ve ana ekran açılır (bağlantı yalnız JS yoksa yedek). */
  readonly view?: "flow" | "cockpit";
}
