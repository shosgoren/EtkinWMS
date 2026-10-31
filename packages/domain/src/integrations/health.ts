// T-1137: ERP bağlantı sağlığı — saf sınıflandırıcı (birim testli). Girdi sunucuda, tenant kapsamında `integration_flows` +
// `integration_runs` + bağlantı satırından okunur (`getIntegrationOverview`); saat DB'nin `now()`'ıdır (istemci saati değil).
// Çıktı ekranda tek bant: simge + renk + tek cümle + TEK sonraki adım (Yeniden bağlan · Şimdi çalıştır · Ayrıntı).
//
// Öncelik (ilk eşleşen kazanır):
//  1. AUTH     — bağlantı ERROR (401 / yeniden giriş / anahtar okunamadı / bağlayanın yetkisi kalktı) → Yeniden bağlan.
//  2. STUCK    — bir koşu `HEALTH_STUCK_MS`'den uzun süredir RUNNING (worker 40 dk'da TIMEOUT'a çevirir) → Ayrıntı.
//  3. TIMEOUT  — açık akışın en son koşusu FAILED/TIMEOUT (yarıda kaldı) → Şimdi çalıştır.
//  4. FAILING  — açık akış art arda `HEALTH_FAIL_STREAK` kez hata verdi (son durum FAILED) → Ayrıntı.
//  5. STALE    — açık akışın son BAŞARILI eşitlemesi eşikten eski (hiç başarı yoksa açılış anından beri) → Şimdi çalıştır.
// Sorun yoksa ve bağlantı eski e-posta + parola yöntemiyle kurulmuşsa yalnız `legacy` işareti (nazik "Yeni yönteme geç").
// Eşik: zamanlayıcı 30 sn'de bir koşar; 10 dk = ~20 kaçırılmış koşu. Anlık bildirim (webhook) geldiğinde eşik çağıran tarafından
// büyütülebilir (`staleAfterMs`).
import type { Flow } from "./catalog.ts";

export const HEALTH_STALE_MS = 10 * 60_000;
export const HEALTH_STUCK_MS = 15 * 60_000;
export const HEALTH_FAIL_STREAK = 3;

export type HealthCause = "AUTH" | "STUCK" | "TIMEOUT" | "FAILING" | "STALE";
export type HealthNext = "RECONNECT" | "RUN" | "DETAIL";
export type HealthLevel = "ok" | "warn" | "error";

export interface HealthFlowInput {
  readonly flow: Flow;
  readonly enabled: boolean;
  readonly lastStatus: "SUCCESS" | "PARTIAL" | "FAILED" | null;
  readonly errorCount: number;
  readonly lastErrorCode: string | null;
  /** Son başarılı (SUCCESS ya da PARTIAL) eşitleme. */
  readonly lastSuccessAt: Date | null;
  /** Akışın şu anki açılış anı (kapalıysa null). */
  readonly enabledAt: Date | null;
}
export interface HealthRunInput {
  readonly flow: Flow;
  readonly status: "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";
  readonly startedAt: Date;
  readonly errorCode: string | null;
}
export interface HealthInput {
  readonly now: Date;
  readonly connection: { readonly status: "CONNECTED" | "ERROR" | "DISCONNECTED"; readonly lastErrorCode: string | null } | null;
  /** Bağlantı OAuth olmadan (eski e-posta + parola) kuruldu. */
  readonly legacy: boolean;
  readonly flows: readonly HealthFlowInput[];
  /** En yeni önce. */
  readonly runs: readonly HealthRunInput[];
  readonly staleAfterMs?: number;
}
export interface IntegrationHealth {
  readonly level: HealthLevel;
  readonly cause: HealthCause | null;
  readonly next: HealthNext | null;
  readonly flow: Flow | null;
  /** STALE: son başarı (ya da açılış) anı; STUCK/TIMEOUT: koşunun başladığı an. */
  readonly since: Date | null;
  /** Ekranda nedeni söyleyen sabit kod (bağlantı/akış hata kodu); sır içermez. */
  readonly code: string | null;
  readonly legacy: boolean;
}

const ok = (legacy: boolean): IntegrationHealth => ({ level: "ok", cause: null, next: null, flow: null, since: null, code: null, legacy });

export function classifyIntegrationHealth(input: HealthInput): IntegrationHealth | null {
  const c = input.connection;
  if (c === null || c.status === "DISCONNECTED") return null;
  const legacy = input.legacy;
  if (c.status === "ERROR") return { level: "error", cause: "AUTH", next: "RECONNECT", flow: null, since: null, code: c.lastErrorCode ?? "REAUTH_REQUIRED", legacy };
  const now = input.now.getTime();
  const on = input.flows.filter((f) => f.enabled);
  const stuck = input.runs.find((r) => r.status === "RUNNING" && now - r.startedAt.getTime() > HEALTH_STUCK_MS);
  if (stuck !== undefined) return { level: "warn", cause: "STUCK", next: "DETAIL", flow: stuck.flow, since: stuck.startedAt, code: null, legacy };
  for (const f of on) {
    const last = input.runs.find((r) => r.flow === f.flow);
    if (last !== undefined && last.status === "FAILED" && last.errorCode === "TIMEOUT") return { level: "error", cause: "TIMEOUT", next: "RUN", flow: f.flow, since: last.startedAt, code: "TIMEOUT", legacy };
  }
  const failing = on.find((f) => f.lastStatus === "FAILED" && f.errorCount >= HEALTH_FAIL_STREAK);
  if (failing !== undefined) return { level: "error", cause: "FAILING", next: "DETAIL", flow: failing.flow, since: null, code: failing.lastErrorCode, legacy };
  const limit = input.staleAfterMs ?? HEALTH_STALE_MS;
  let oldest: { flow: Flow; at: Date } | null = null;
  for (const f of on) {
    const at = f.lastSuccessAt ?? f.enabledAt;
    if (at === null || now - at.getTime() <= limit) continue;
    if (oldest === null || at.getTime() < oldest.at.getTime()) oldest = { flow: f.flow, at };
  }
  if (oldest !== null) return { level: "warn", cause: "STALE", next: "RUN", flow: oldest.flow, since: oldest.at, code: null, legacy };
  return ok(legacy);
}
