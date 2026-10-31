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

export { getProductSourceInfo, type ProductSourceInfo } from "./product-info.ts";

export * from "./oauth.ts";

// T-1138: Paraşüt anlık bildirim (webhook) alıcısı, tek kart olayı, kayıt ve kademeli zamanlayıcı.
export { receiveParasutWebhook, runWebhookEvent, parseWebhookBody, verifySignature, matchSignature, signedFields, webhookEventKey, WEBHOOK_BODY_MAX, WEBHOOK_CONSUMER, type ReceiveResult, type WebhookEventResult, type ConsumeOnce } from "./webhook.ts";
export { registerParasutWebhooks, getWebhookStatus, enqueueScheduledIntegrations, parasutWebhookUrl, PARASUT_WEBHOOK_PATH, CADENCE, type WebhookView, type WebhookStatus } from "./webhook-register.ts";
