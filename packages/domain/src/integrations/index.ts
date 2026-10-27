// Entegrasyon alanı: dış referans eşlemesi ve senkron imleçleri (T-252); sağlayıcıdan bağımsız ERP bağlantısı (T-991; ilk sağlayıcı Paraşüt).
export * from "./external-refs.ts";
export * from "./catalog.ts";
export * from "./connections.ts";
export { ParasutClient, ProviderError, resolveParasutBaseUrl, PARASUT_BASE_URL, type ProviderErrorCode, type FetchLike } from "./parasut.ts";
export { runIntegrationSync, SYNC_LIMITS, type SyncDeps, type SyncPayload, type SyncResult, type FlowResult } from "./sync.ts";
export { integrationSealer } from "./secrets.ts";
export { IntegrationStateError } from "./store.ts";
export {
  getOpeningStockState,
  setOpeningStockSetting,
  pullOpeningStock,
  providerQuantity,
  OPENING_STOCK_REASON,
  OPENING_MAX_LINES,
  type OpeningStockState,
  type OpeningLocation,
  type OpeningSettingResult,
  type OpeningPullResult,
  type OpeningPullReason,
  type OpeningSkipCounts,
} from "./opening-stock.ts";

export { getProductBarcodeSetting, setProductBarcodeSetting } from "./product-settings.ts";
