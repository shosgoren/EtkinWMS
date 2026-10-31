// T-1137: bağlantı sağlığı sınıflandırıcısı — öncelik sırası, eşikler (tarama / webhook ACTIVE), eski parola yöntemi işareti.
import { describe, expect, it } from "vitest";
import { HEALTH_FAIL_STREAK, HEALTH_STALE_MS, HEALTH_STALE_WEBHOOK_CARDS_MS, HEALTH_STUCK_MS, classifyIntegrationHealth, staleLimitMs, type HealthFlowInput, type HealthInput } from "./health.ts";
import { CADENCE } from "./webhook-register.ts";

const NOW = new Date("2026-10-31T12:00:00Z");
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const flow = (over: Partial<HealthFlowInput> = {}): HealthFlowInput => ({
  flow: "PRODUCTS",
  direction: "PULL",
  enabled: true,
  lastStatus: "SUCCESS",
  errorCount: 0,
  lastErrorCode: null,
  lastSuccessAt: ago(1 * MIN),
  enabledAt: ago(60 * MIN),
  ...over,
});
const base = (over: Partial<HealthInput> = {}): HealthInput => ({
  now: NOW,
  connection: { status: "CONNECTED", lastErrorCode: null },
  legacy: false,
  webhook: "OFF",
  flows: [flow()],
  runs: [],
  ...over,
});

describe("classifyIntegrationHealth", () => {
  it("bağlı değil / kesilmiş → null (bant yok)", () => {
    expect(classifyIntegrationHealth(base({ connection: null }))).toBeNull();
    expect(classifyIntegrationHealth(base({ connection: { status: "DISCONNECTED", lastErrorCode: null } }))).toBeNull();
  });

  it("sağlıklı → ok, adım yok", () => {
    expect(classifyIntegrationHealth(base())).toEqual({ level: "ok", cause: null, next: null, flow: null, since: null, code: null, legacy: false });
  });

  it("bağlantı ERROR (401 / yeniden giriş) → AUTH + Yeniden bağlan; kod korunur, yoksa REAUTH_REQUIRED", () => {
    const h = classifyIntegrationHealth(base({ connection: { status: "ERROR", lastErrorCode: "PROVIDER_AUTH_FAILED" } }));
    expect(h).toMatchObject({ level: "error", cause: "AUTH", next: "RECONNECT", code: "PROVIDER_AUTH_FAILED" });
    expect(classifyIntegrationHealth(base({ connection: { status: "ERROR", lastErrorCode: null } }))?.code).toBe("REAUTH_REQUIRED");
  });

  it("AUTH her şeyden önce gelir (takılı koşu, eski koşu olsa da)", () => {
    const h = classifyIntegrationHealth(base({ connection: { status: "ERROR", lastErrorCode: "REAUTH_REQUIRED" }, runs: [{ flow: "PRODUCTS", status: "RUNNING", startedAt: ago(HEALTH_STUCK_MS + MIN), errorCode: null }] }));
    expect(h?.cause).toBe("AUTH");
  });

  it("eşikten uzun RUNNING → STUCK + Ayrıntı; eşik altı sorun değil", () => {
    const started = ago(HEALTH_STUCK_MS + MIN);
    expect(classifyIntegrationHealth(base({ runs: [{ flow: "CONTACTS", status: "RUNNING", startedAt: started, errorCode: null }] }))).toMatchObject({ level: "warn", cause: "STUCK", next: "DETAIL", flow: "CONTACTS", since: started });
    expect(classifyIntegrationHealth(base({ runs: [{ flow: "CONTACTS", status: "RUNNING", startedAt: ago(HEALTH_STUCK_MS - MIN), errorCode: null }] }))?.cause).toBeNull();
  });

  it("açık akışın son koşusu TIMEOUT → Şimdi çalıştır; daha yeni başarılı koşu varsa sorun değil; kapalı akışta yok sayılır", () => {
    const t = { flow: "PRODUCTS" as const, status: "FAILED" as const, startedAt: ago(50 * MIN), errorCode: "TIMEOUT" };
    expect(classifyIntegrationHealth(base({ runs: [t] }))).toMatchObject({ level: "error", cause: "TIMEOUT", next: "RUN", flow: "PRODUCTS", code: "TIMEOUT" });
    expect(classifyIntegrationHealth(base({ runs: [{ flow: "PRODUCTS", status: "SUCCESS", startedAt: ago(MIN), errorCode: null }, t] }))?.cause).toBeNull();
    expect(classifyIntegrationHealth(base({ flows: [flow({ enabled: false })], runs: [t] }))?.cause).toBeNull();
  });

  it(`art arda ${HEALTH_FAIL_STREAK} FAILED → FAILING + Ayrıntı (kod akıştan); daha az ya da PARTIAL sorun bandı değil`, () => {
    expect(classifyIntegrationHealth(base({ flows: [flow({ lastStatus: "FAILED", errorCount: HEALTH_FAIL_STREAK, lastErrorCode: "PROVIDER_INVALID" })] }))).toMatchObject({ level: "error", cause: "FAILING", next: "DETAIL", flow: "PRODUCTS", code: "PROVIDER_INVALID" });
    expect(classifyIntegrationHealth(base({ flows: [flow({ lastStatus: "FAILED", errorCount: HEALTH_FAIL_STREAK - 1 })] }))?.cause).toBeNull();
    expect(classifyIntegrationHealth(base({ flows: [flow({ lastStatus: "PARTIAL", errorCount: 9 })] }))?.cause).toBeNull();
  });

  it("taramada (webhook OFF/FAILED) son başarı 10 dk'dan eski → STALE + Şimdi çalıştır; en eski akış seçilir", () => {
    const old = ago(HEALTH_STALE_MS + MIN);
    const older = ago(HEALTH_STALE_MS + 5 * MIN);
    const h = classifyIntegrationHealth(base({ flows: [flow({ lastSuccessAt: old }), flow({ flow: "CONTACTS", lastSuccessAt: older })] }));
    expect(h).toMatchObject({ level: "warn", cause: "STALE", next: "RUN", flow: "CONTACTS", since: older });
    expect(classifyIntegrationHealth(base({ webhook: "FAILED", flows: [flow({ lastSuccessAt: old })] }))?.cause).toBe("STALE");
    expect(classifyIntegrationHealth(base({ flows: [flow({ lastSuccessAt: ago(HEALTH_STALE_MS - MIN) })] }))?.cause).toBeNull();
  });

  it("hiç başarı yoksa açılış anı ölçüt; kapalı akış eskimez", () => {
    expect(classifyIntegrationHealth(base({ flows: [flow({ lastSuccessAt: null, enabledAt: ago(HEALTH_STALE_MS + MIN) })] }))?.cause).toBe("STALE");
    expect(classifyIntegrationHealth(base({ flows: [flow({ lastSuccessAt: null, enabledAt: ago(MIN) })] }))?.cause).toBeNull();
    expect(classifyIntegrationHealth(base({ flows: [flow({ enabled: false, lastSuccessAt: ago(999 * MIN) })] }))?.cause).toBeNull();
  });

  it("webhook ACTIVE: ürün/cari çekme 15 dk uzlaştırma + pay; depo ve gönderim taramadaki gibi", () => {
    expect(HEALTH_STALE_WEBHOOK_CARDS_MS).toBe(CADENCE.cardsMs + HEALTH_STALE_MS);
    const mid = ago(HEALTH_STALE_MS + 5 * MIN); // 15 dk: taramada eski, webhook'ta değil
    expect(classifyIntegrationHealth(base({ webhook: "ACTIVE", flows: [flow({ lastSuccessAt: mid })] }))?.cause).toBeNull();
    expect(classifyIntegrationHealth(base({ webhook: "ACTIVE", flows: [flow({ lastSuccessAt: ago(HEALTH_STALE_WEBHOOK_CARDS_MS + MIN) })] }))?.cause).toBe("STALE");
    expect(classifyIntegrationHealth(base({ webhook: "ACTIVE", flows: [flow({ flow: "WAREHOUSES", lastSuccessAt: mid })] }))?.cause).toBe("STALE");
    expect(classifyIntegrationHealth(base({ webhook: "ACTIVE", flows: [flow({ direction: "PUSH", lastSuccessAt: mid })] }))?.cause).toBe("STALE");
    expect(staleLimitMs("CONTACTS", "BOTH", "ACTIVE")).toBe(HEALTH_STALE_WEBHOOK_CARDS_MS);
    expect(staleLimitMs("CONTACTS", "BOTH", "FAILED")).toBe(HEALTH_STALE_MS);
    expect(staleLimitMs("SHIPMENTS", "PUSH", "ACTIVE")).toBe(HEALTH_STALE_MS);
  });

  it("eski parola yöntemi: sorun yoksa ok + legacy; sorun varsa sorun bandı + legacy işareti", () => {
    expect(classifyIntegrationHealth(base({ legacy: true }))).toMatchObject({ level: "ok", legacy: true });
    expect(classifyIntegrationHealth(base({ legacy: true, flows: [flow({ lastSuccessAt: ago(HEALTH_STALE_MS + MIN) })] }))).toMatchObject({ cause: "STALE", legacy: true });
  });

  it("öncelik: STUCK > TIMEOUT > FAILING > STALE", () => {
    const stuck = { flow: "CONTACTS" as const, status: "RUNNING" as const, startedAt: ago(HEALTH_STUCK_MS + MIN), errorCode: null };
    const timeout = { flow: "PRODUCTS" as const, status: "FAILED" as const, startedAt: ago(60 * MIN), errorCode: "TIMEOUT" };
    const failing = flow({ flow: "WAREHOUSES", lastStatus: "FAILED", errorCount: 5, lastSuccessAt: ago(999 * MIN) });
    expect(classifyIntegrationHealth(base({ flows: [flow(), failing], runs: [stuck, timeout] }))?.cause).toBe("STUCK");
    expect(classifyIntegrationHealth(base({ flows: [flow(), failing], runs: [timeout] }))?.cause).toBe("TIMEOUT");
    expect(classifyIntegrationHealth(base({ flows: [flow(), failing] }))?.cause).toBe("FAILING");
  });
});
