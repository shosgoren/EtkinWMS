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
export { classifyIntegrationHealth, staleLimitMs, HEALTH_STALE_WEBHOOK_CARDS_MS, HEALTH_STALE_MS, HEALTH_STUCK_MS, HEALTH_FAIL_STREAK, LEGACY_METHOD_REMOVED, type IntegrationHealth, type HealthCause, type HealthNext, type HealthLevel } from "./health.ts";
export { getIntegrationOutboxIssues, retryIntegrationOutbox, resolveIntegrationOutbox, OUTBOX_ISSUE_LIMIT, type OutboxIssue, type OutboxIssues, type OutboxActionResult, type OutboxResolution } from "./outbox.ts";
export { countFlowRecords, CARD_FLOWS, type CardFlow, type FlowRecordCount } from "./flow-counts.ts";

// T-1138: Paraşüt anlık bildirim (webhook) alıcısı, tek kart olayı, kayıt ve kademeli zamanlayıcı.
export { receiveParasutWebhook, runWebhookEvent, parseWebhookBody, verifySignature, matchSignature, signedFields, webhookEventKey, WEBHOOK_BODY_MAX, WEBHOOK_CONSUMER, type ReceiveResult, type WebhookEventResult, type ConsumeOnce } from "./webhook.ts";
export { registerParasutWebhooks, getWebhookStatus, enqueueScheduledIntegrations, parasutWebhookUrl, PARASUT_WEBHOOK_PATH, CADENCE, type WebhookView, type WebhookStatus } from "./webhook-register.ts";
