// Entegrasyon alanı: dış referans eşlemesi ve senkron imleçleri (T-252); sağlayıcıdan bağımsız ERP bağlantısı (T-991; ilk sağlayıcı Paraşüt).
export * from "./external-refs.ts";
export * from "./catalog.ts";
export * from "./connections.ts";
export { ParasutClient, ProviderError, resolveParasutBaseUrl, PARASUT_BASE_URL, type ProviderErrorCode, type FetchLike } from "./parasut.ts";
export { runIntegrationSync, SYNC_LIMITS, type SyncDeps, type SyncPayload, type SyncResult, type FlowResult } from "./sync.ts";
export { integrationSealer } from "./secrets.ts";
export { IntegrationStateError } from "./store.ts";
