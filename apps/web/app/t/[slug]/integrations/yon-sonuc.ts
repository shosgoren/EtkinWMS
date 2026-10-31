// T-1136: Ayarlar › Entegrasyonlar › Akış — yön seçiminin SONUCU (satır altındaki tek cümle) ve hangi geçişin önce onay istediği. Saf
// işlevler (ekran ve birim testi aynı kuralı kullanır). Kural koddaki gerçek davranıştan gelir (`packages/domain/src/integrations/`):
//  - al (PULL): sağlayıcı kartları gelir (`sync.ts` runFlow → pull → `apply.ts`); hiçbir şey gönderilmez. Ürün, cari ve depo sağlayıcıda
//    silinir/arşivlenirse burada arşive alınır, kullanımdaysa bekler (`product-lifecycle.ts`, T-1140 `card-lifecycle.ts`).
//  - gönder (PUSH): sağlayıcıya EŞLENMEMİŞ yerel kartlar gider (`sync.ts` unlinked/pushCards; aynısı varsa bağlanır) ve T-1140'tan beri
//    bağlı kartlardaki yerel düzeltme de gider (`pushEdited`); sağlayıcıdan hiçbir şey alınmaz.
//  - iki yönlü (BOTH, T-1140): bağlı kartta yalnız değişen taraf öbürüne yansır; iki taraf da değiştiyse son değişen kazanır, zaman
//    bilinmiyorsa sağlayıcı kazanır (`card-sync.ts` decideCardSync; her çakışma audit'li).
// Onay: yeni bir "al" yerel kayıt varken (eşleşme/ekleme olur), yeni bir "gönder" eşlenmemiş yerel kayıt varken (dışarı kart gider) sorulur.
// Kapatmak, aynı yönü yeniden seçmek, boş katalog ve zaten açık olan yönü korumak onay istemez.

export type YonDirection = "PULL" | "PUSH" | "BOTH";
export type YonSecim = YonDirection | "OFF";
export const KART_AKISLARI = ["PRODUCTS", "CONTACTS", "WAREHOUSES"] as const;
export type KartAkisi = (typeof KART_AKISLARI)[number];

export const kartAkisi = (flow: string): flow is KartAkisi => (KART_AKISLARI as readonly string[]).includes(flow);
const alir = (d: YonDirection): boolean => d === "PULL" || d === "BOTH";
const gonderir = (d: YonDirection): boolean => d === "PUSH" || d === "BOTH";

/** Satır altındaki sonuç cümlesinin çeviri anahtarı (`integrations` altında; üç kart akışında kural aynı, satır adı akışı söyler); kart akışı değilse null. */
export function yonSonucAnahtari(flow: string, secim: YonSecim): string | null {
  if (!kartAkisi(flow)) return null;
  return `sonuc.${secim}`;
}

export interface YonDegisimi {
  /** Seçim sağlayıcıdan yeni bir alma başlatıyor (öncesinde alma yoktu). */
  readonly yeniAl: boolean;
  /** Seçim sağlayıcıya yeni bir gönderim başlatıyor (öncesinde gönderim yoktu). */
  readonly yeniGonder: boolean;
}

/** Önceki (ekranda görünen) durumdan seçime geçişte YENİ başlayan yönler; kart akışı değilse, kapatmada ya da yeni bir şey yoksa null. */
export function yonDegisimi(flow: string, onceki: { readonly enabled: boolean; readonly direction: YonDirection }, secim: YonSecim): YonDegisimi | null {
  if (!kartAkisi(flow) || secim === "OFF") return null;
  const yeniAl = alir(secim) && !(onceki.enabled && alir(onceki.direction));
  const yeniGonder = gonderir(secim) && !(onceki.enabled && gonderir(onceki.direction));
  return yeniAl || yeniGonder ? { yeniAl, yeniGonder } : null;
}

/** Sayım sonrası karar: yeni alma + yerel kayıt varsa ya da yeni gönderim + eşlenmemiş yerel kayıt varsa onay penceresi açılır. */
export function yonOnayGerekir(d: YonDegisimi | null, sayi: { readonly total: number; readonly unlinked: number }): boolean {
  if (d === null) return false;
  return (d.yeniAl && sayi.total > 0) || (d.yeniGonder && sayi.unlinked > 0);
}

/** Onay penceresi metninin anahtarı: seçilen yönün akışa özgü cümlesi (`n` yerel, `m` eşlenmemiş sayısıyla). */
export function yonOnayAnahtari(flow: KartAkisi, secim: YonDirection): string {
  return `onay.${flow}.${secim}`;
}
