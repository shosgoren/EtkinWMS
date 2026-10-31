// T-1137: ERP bağlantı sağlığı — saf sınıflandırıcı (birim testli). Girdi sunucuda, tenant kapsamında `integration_flows` +
// `integration_runs` + bağlantı satırından okunur (`getIntegrationOverview`); saat DB'nin `now()`'ıdır (istemci saati değil).
// Çıktı ekranda tek bant: simge + renk + tek cümle + TEK sonraki adım (Yeniden bağlan · Şimdi çalıştır · Ayrıntı).
//
// Öncelik (ilk eşleşen kazanır):
//  1. AUTH     — bağlantı ERROR (401 / yeniden giriş / anahtar okunamadı / bağlayanın yetkisi kalktı) → Yeniden bağlan.
//  2. STUCK    — bir koşu `HEALTH_STUCK_MS`'den uzun süredir RUNNING (worker 40 dk'da TIMEOUT'a çevirir) → Ayrıntı.
//  3. TIMEOUT  — açık akışın en son koşusu FAILED/TIMEOUT (yarıda kaldı) → Şimdi çalıştır.
//  4. FAILING  — açık akış art arda `HEALTH_FAIL_STREAK` kez hata verdi (son durum FAILED) → Ayrıntı. Akış satırının kendi durumudur:
//     başarılı (boş da olsa) her koşu `last_status`'u SUCCESS, sayacı 0 yapar → kendiliğinden kalkar.
//  STUCK ve TIMEOUT koşu günlüğünden gelir; o koşudan sonra akışta başarı (`last_success_at`) varsa sayılmaz (boş başarılı koşu satır bırakmaz).
//  5. STALE    — açık akışın son BAŞARILI eşitlemesi eşikten eski (hiç başarı yoksa açılış anından beri) → Şimdi çalıştır.
// Sorun yoksa ve bağlantı eski e-posta + parola yöntemiyle kurulmuşsa yalnız `legacy` işareti (nazik "Yeni yönteme geç").
// Eşik (T-1138 kademeli zamanlayıcı ile uyumlu): taramada (webhook OFF / FAILED) her akış 30 sn'de bir koşar → 10 dk (~20 kaçırılmış koşu).
// Webhook ACTIVE iken ürün/cari ÇEKME akışları 15 dk'lık uzlaştırma taramasıyla koşar (anlık değişiklik bildirimle gelir) → eşik 15 dk + 10 dk
// pay; öteki akışlar (depo 3 dk, gönderimler 30 sn) 10 dk. Webhook FAILED yalnız eşiği taramaya döndürür (veri akmaya devam eder; durum
// satırı T-1138'de ayrıca görünür), ayrı uyarı üretmez.
import type { Direction, Flow } from "./catalog.ts";

export const HEALTH_STALE_MS = 10 * 60_000;
/** Webhook ACTIVE iken ürün/cari çekme akışının eşiği: 15 dk uzlaştırma (`CADENCE.cardsMs`) + pay. */
export const HEALTH_STALE_WEBHOOK_CARDS_MS = 15 * 60_000 + HEALTH_STALE_MS;
export const HEALTH_STUCK_MS = 15 * 60_000;
export const HEALTH_FAIL_STREAK = 3;

export type HealthCause = "AUTH" | "STUCK" | "TIMEOUT" | "FAILING" | "STALE";
export type HealthNext = "RECONNECT" | "RUN" | "DETAIL";
export type HealthLevel = "ok" | "warn" | "error";

export interface HealthFlowInput {
  readonly flow: Flow;
  readonly direction: Direction;
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
  /** T-1138 anlık bildirim durumu (bilinmiyorsa OFF: tarama). */
  readonly webhook: "OFF" | "ACTIVE" | "FAILED";
  readonly flows: readonly HealthFlowInput[];
  /** En yeni önce. */
  readonly runs: readonly HealthRunInput[];
}

/** Akışın "eşitlenmedi" eşiği (yukarıdaki kademe kuralı). */
export function staleLimitMs(flow: Flow, direction: Direction, webhook: HealthInput["webhook"]): number {
  const pulls = direction === "PULL" || direction === "BOTH";
  return webhook === "ACTIVE" && pulls && (flow === "PRODUCTS" || flow === "CONTACTS") ? HEALTH_STALE_WEBHOOK_CARDS_MS : HEALTH_STALE_MS;
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
  // Değişiklik getirmeyen başarılı zamanlı koşu kendi koşu satırını siler, yalnız akışın `last_success_at`'ini yazar (T-1135): koşu
  // günlüğündeki en yeni satır eski bir TIMEOUT / RUNNING olarak kalabilir. Bu yüzden koşu sorunu yalnız ondan SONRA başarı yoksa sayılır.
  const healedAfter = (flow: Flow, startedAt: Date): boolean => {
    const ok = input.flows.find((f) => f.flow === flow)?.lastSuccessAt ?? null;
    return ok !== null && ok.getTime() >= startedAt.getTime();
  };
  const stuck = input.runs.find((r) => r.status === "RUNNING" && now - r.startedAt.getTime() > HEALTH_STUCK_MS && !healedAfter(r.flow, r.startedAt));
  if (stuck !== undefined) return { level: "warn", cause: "STUCK", next: "DETAIL", flow: stuck.flow, since: stuck.startedAt, code: null, legacy };
  for (const f of on) {
    const last = input.runs.find((r) => r.flow === f.flow);
    if (last !== undefined && last.status === "FAILED" && last.errorCode === "TIMEOUT" && !healedAfter(f.flow, last.startedAt)) return { level: "error", cause: "TIMEOUT", next: "RUN", flow: f.flow, since: last.startedAt, code: "TIMEOUT", legacy };
  }
  const failing = on.find((f) => f.lastStatus === "FAILED" && f.errorCount >= HEALTH_FAIL_STREAK);
  if (failing !== undefined) return { level: "error", cause: "FAILING", next: "DETAIL", flow: failing.flow, since: null, code: failing.lastErrorCode, legacy };
  let oldest: { flow: Flow; at: Date } | null = null;
  for (const f of on) {
    const at = f.lastSuccessAt ?? f.enabledAt;
    if (at === null || now - at.getTime() <= staleLimitMs(f.flow, f.direction, input.webhook)) continue;
    if (oldest === null || at.getTime() < oldest.at.getTime()) oldest = { flow: f.flow, at };
  }
  if (oldest !== null) return { level: "warn", cause: "STALE", next: "RUN", flow: oldest.flow, since: oldest.at, code: null, legacy };
  return ok(legacy);
}
