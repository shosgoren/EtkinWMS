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

export { getProductSourceInfo, parseProductSource, type ProductSourceInfo, type ProductSourceWarning } from "./product-info.ts";
export { canonicalDecimal, jsonDecimal } from "./decimal-json.ts";
export { STOCK_TOTAL_STATUSES, STOCK_TOTAL_LOCATION_KINDS } from "./stock-reads.ts";

export * from "./oauth.ts";
export { classifyIntegrationHealth, HEALTH_STALE_MS, HEALTH_STUCK_MS, HEALTH_FAIL_STREAK, type IntegrationHealth, type HealthCause, type HealthNext, type HealthLevel } from "./health.ts";
export { getIntegrationOutboxIssues, retryIntegrationOutbox, resolveIntegrationOutbox, OUTBOX_ISSUE_LIMIT, type OutboxIssue, type OutboxIssues, type OutboxActionResult, type OutboxResolution } from "./outbox.ts";
