// T-1095: "Nasıl kullanırım?" adım adım rehberi — veri aktarma işleri (kullanıcı kararı 27 Ekim: önce ürün, depo, cari aktarma; Excel ya da
// Paraşüt). Her adım gerçek ekrandaki bir öğeyi gösterir (`target`) ve kullanıcı o işi yapınca kendiliğinden ilerler (`done`):
// - `sel`: seçici görünür olunca (ör. kutu seçildi, sonraki ekran açıldı),
// - `path`: adres bu yola geçince,
// - `click`: hedefe dokununca (sonucu ekranda ölçülemeyen işler, ör. eşitleme).
// Rehber eylem çağırmaz, yetki vermez: ekranlar kendi yetkisini yine denetler.
export const ADIM_REHBERLERI = ["urun", "depo", "cari"] as const;
export type AdimRehber = (typeof ADIM_REHBERLERI)[number];
export const ADIM_KAYNAKLARI = ["EXCEL", "PARASUT"] as const;
export type AdimKaynak = (typeof ADIM_KAYNAKLARI)[number];

export type AdimBitti = { readonly sel: string } | { readonly path: string } | { readonly click: true };

export interface AdimRehberAdimi {
  /** İpucu metni anahtarı (`operationGuide.adim.steps.<key>`). */
  readonly key: string;
  /** Adımın ekranı (`/t/<alan>` sonrası yol, sorgusuz). */
  readonly path: string;
  /** Ekranı açarken eklenecek sorgu (ör. `tur=urun`). */
  readonly query?: string;
  readonly target: string;
  readonly done: AdimBitti;
}

/** Bağlantılar alan seçimi ve Paraşüt akışı (rehber → ekran kimliği). */
const ALAN: Readonly<Record<AdimRehber, string>> = { urun: "items", depo: "warehouses", cari: "parties" };
const AKIS: Readonly<Record<AdimRehber, string>> = { urun: "PRODUCTS", depo: "WAREHOUSES", cari: "CONTACTS" };

/** Kurulum adımı yetkisiyle aynı kural (`rehber-access.ts`): ürün `cards`, depo `shelves`, cari `parties`. */
export const ADIM_YETKI: Readonly<Record<AdimRehber, "cards" | "shelves" | "parties">> = { urun: "cards", depo: "shelves", cari: "parties" };

export function adimPlani(rehber: AdimRehber, kaynak: AdimKaynak): readonly AdimRehberAdimi[] {
  if (kaynak === "PARASUT") {
    const f = AKIS[rehber];
    return [
      { key: "baglan", path: "/integrations", target: '[data-testid="integrations-connect"], [data-testid="integrations-sync"]', done: { sel: '[data-testid="integrations-sync"]' } },
      { key: `akis_${rehber}`, path: "/integrations", target: `[data-testid="flow-${f}-toggle"]`, done: { sel: `[data-testid="flow-${f}"][data-enabled="true"]` } },
      { key: "esitle", path: "/integrations", target: `[data-testid="flow-${f}-run"]`, done: { click: true } },
    ];
  }
  const a = ALAN[rehber];
  return [
    { key: `alan_${rehber}`, path: "/settings/baglantilar", target: `[data-testid="baglantilar-alan"] [data-option="${a}"]`, done: { sel: `[data-testid="baglantilar-alan"] [data-option="${a}"][aria-checked="true"]` } },
    { key: "iceri", path: "/settings/baglantilar", target: '[data-testid="baglantilar-islem"] [data-option="import"]', done: { sel: '[data-testid="baglantilar-islem"] [data-option="import"][aria-checked="true"]' } },
    { key: "ana", path: "/settings/baglantilar", target: '[data-testid="baglantilar-main"]', done: { path: "/import" } },
    { key: "dosya", path: "/import", target: '[data-testid="aktar-drop"]', done: { sel: '[data-testid="aktar-sheet"]' } },
    { key: "kontrol", path: "/import", target: '[data-testid="aktar-main"]', done: { sel: '[data-testid="aktar-new"], [data-testid="aktar-upd"], [data-testid="aktar-bad"]' } },
    { key: "uygula", path: "/import", target: '[data-testid="aktar-main"]', done: { sel: '[data-testid="aktar-done"]' } },
  ];
}

export function isAdimRehber(v: unknown): v is AdimRehber {
  return typeof v === "string" && (ADIM_REHBERLERI as readonly string[]).includes(v);
}
export function isAdimKaynak(v: unknown): v is AdimKaynak {
  return typeof v === "string" && (ADIM_KAYNAKLARI as readonly string[]).includes(v);
}
