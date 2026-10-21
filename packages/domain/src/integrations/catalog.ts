// ERP entegrasyonu — sağlayıcıdan bağımsız akış kataloğu (T-991). Saf veri + doğrulama; ağ ve DB yoktur.
//
// Her sağlayıcı her akış için desteklediği YÖNLERİ bildirir (boş liste = sağlayıcıda karşılığı yok / doğrulanamadı; satır kilitli gösterilir).
// Kullanıcı kararı (21 Ekim): akışlar tek tek açılır/kapanır, yön akış başına seçilir; varsayılan kartlar ve sipariş ERP -> Etkin, irsaliye ve
// stok Etkin -> ERP. Değişmez kural (I-04): stok ERP'den gelen kartla değişmez; STOCK ve SHIPMENTS yalnız PUSH (DB CHECK'i de aynı).
//
// Paraşüt kaynakları (https://apidocs.parasut.com/swagger.json, 21 Ekim okundu): products / contacts / warehouses GET+POST (sayfa en çok 25,
// `updated_at` süzgeci YOK → tam tarama), shipment_documents POST (irsaliye; stok hareketinde depo alanı yok — depo seçimi belgede doğrulanamadı),
// stock_updates POST (`new_total_inventory`, ürün + depo), stock_movements yalnız GET. Satış SİPARİŞİ kaynağı yoktur (yalnız teklif `sales_offers`
// ve fatura) → SALES_ORDERS Paraşüt'te kapalı. Logo: ürün bilgisi bekleniyor → bütün akışlar kapalı.
import { AppError } from "@wms/shared/errors";

export const PROVIDERS = ["PARASUT", "LOGO"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const FLOWS = ["PRODUCTS", "CONTACTS", "WAREHOUSES", "SALES_ORDERS", "SHIPMENTS", "STOCK"] as const;
export type Flow = (typeof FLOWS)[number];

/** PULL = ERP -> Etkin, PUSH = Etkin -> ERP, BOTH = iki yönlü. */
export const DIRECTIONS = ["PULL", "PUSH", "BOTH"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Kullanıcı kararı (21 Ekim) varsayılan yönleri; sağlayıcı desteklemiyorsa ilk desteklenen yön. */
export const DEFAULT_DIRECTION: Readonly<Record<Flow, Direction>> = Object.freeze({
  PRODUCTS: "PULL",
  CONTACTS: "PULL",
  WAREHOUSES: "PULL",
  SALES_ORDERS: "PULL",
  SHIPMENTS: "PUSH",
  STOCK: "PUSH",
});

/** Değişmez kural (DB `integration_flows_direction_rule_chk` ile aynı): sağlayıcıdan bağımsız izinli yönler. */
const UNIVERSAL: Readonly<Record<Flow, readonly Direction[]>> = Object.freeze({
  PRODUCTS: ["PULL", "PUSH", "BOTH"],
  CONTACTS: ["PULL", "PUSH", "BOTH"],
  WAREHOUSES: ["PULL", "PUSH", "BOTH"],
  SALES_ORDERS: ["PULL"],
  SHIPMENTS: ["PUSH"],
  STOCK: ["PUSH"],
});

export interface ProviderInfo {
  readonly provider: Provider;
  /** Bağlantı kurulabilir mi (Logo: ürün bilgisi bekleniyor). */
  readonly available: boolean;
  /** `external_refs.system` değeri. */
  readonly system: string;
  readonly flows: Readonly<Record<Flow, readonly Direction[]>>;
}

const NONE: readonly Direction[] = Object.freeze([]);

export const PROVIDER_INFO: Readonly<Record<Provider, ProviderInfo>> = Object.freeze({
  PARASUT: Object.freeze({
    provider: "PARASUT",
    available: true,
    system: "PARASUT",
    flows: Object.freeze({
      PRODUCTS: UNIVERSAL.PRODUCTS,
      CONTACTS: UNIVERSAL.CONTACTS,
      WAREHOUSES: UNIVERSAL.WAREHOUSES,
      SALES_ORDERS: NONE, // Paraşüt API v4'te satış siparişi kaynağı yok.
      SHIPMENTS: UNIVERSAL.SHIPMENTS,
      STOCK: UNIVERSAL.STOCK,
    }),
  }),
  LOGO: Object.freeze({
    provider: "LOGO",
    available: false,
    system: "LOGO",
    flows: Object.freeze({ PRODUCTS: NONE, CONTACTS: NONE, WAREHOUSES: NONE, SALES_ORDERS: NONE, SHIPMENTS: NONE, STOCK: NONE }),
  }),
});

export function parseProvider(raw: unknown): Provider {
  if (typeof raw !== "string" || !(PROVIDERS as readonly string[]).includes(raw)) throw new AppError("VALIDATION_FAILED");
  return raw as Provider;
}
export function parseFlow(raw: unknown): Flow {
  if (typeof raw !== "string" || !(FLOWS as readonly string[]).includes(raw)) throw new AppError("VALIDATION_FAILED");
  return raw as Flow;
}
export function parseDirection(raw: unknown): Direction {
  if (typeof raw !== "string" || !(DIRECTIONS as readonly string[]).includes(raw)) throw new AppError("VALIDATION_FAILED");
  return raw as Direction;
}

/** Sağlayıcının bu akış için sunduğu yönler (değişmez kuralla kesişim). */
export function supportedDirections(provider: Provider, flow: Flow): readonly Direction[] {
  const universal = UNIVERSAL[flow];
  return PROVIDER_INFO[provider].flows[flow].filter((d) => universal.includes(d));
}

/** Akış bu sağlayıcıda var mı. */
export function flowSupported(provider: Provider, flow: Flow): boolean {
  return supportedDirections(provider, flow).length > 0;
}

/** Varsayılan yön: kullanıcı kararındaki yön destekleniyorsa o; değilse ilk desteklenen; hiçbiri yoksa değişmez kuralın ilki. */
export function defaultDirection(provider: Provider, flow: Flow): Direction {
  const dirs = supportedDirections(provider, flow);
  if (dirs.includes(DEFAULT_DIRECTION[flow])) return DEFAULT_DIRECTION[flow];
  return dirs[0] ?? (UNIVERSAL[flow][0] as Direction);
}

/** Yön ERP'den Etkin'e veri getiriyor mu / Etkin'den ERP'ye gönderiyor mu. */
export const pulls = (d: Direction): boolean => d === "PULL" || d === "BOTH";
export const pushes = (d: Direction): boolean => d === "PUSH" || d === "BOTH";
