// T-1141: kart bölümü yetkilerinin İSTEMCİ tarafı tipleri. "use client" dosyaları `@wms/domain` içe aktaramaz (T-127b, AC-28); kaynak
// `@wms/domain/identity/permissions` `CardSection` / `CardRights` ile birebir aynıdır (eşlik `kart-yetki.test.ts` içinde derleme zamanında
// denetlenir). Değer sunucu sayfasında `cardRights(...)` ile hesaplanıp prop olarak gelir; yalnız gösterimdir.
export type KartBolum = "items" | "parties" | "warehouses" | "locations";

export interface KartYetki {
  readonly create: boolean;
  readonly edit: boolean;
  readonly archive: boolean;
  readonly import: boolean;
}
