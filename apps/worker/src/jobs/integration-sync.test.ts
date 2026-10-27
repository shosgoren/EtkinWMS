// T-991: `integration.sync` işi ve 30 saniyelik zamanlayıcı — bağlama, günlük (sır/adres yok) ve zamanlama sayıları. İş kuralı domain testlerinde
// (tests/integration/integrations/erp-integration.int.test.ts).
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Logger } from "@wms/shared/log";
import { createIntegrationSyncHandler, runIntegrationSchedule, startIntegrationSchedule } from "./integration-sync.js";

function memLogger(): Logger & { lines: { level: string; msg: string; fields?: Record<string, unknown> }[] } {
  const lines: { level: string; msg: string; fields?: Record<string, unknown> }[] = [];
  return {
    lines,
    info: (msg: string, fields?: Record<string, unknown>) => void lines.push({ level: "info", msg, ...(fields === undefined ? {} : { fields }) }),
    error: (msg: string, fields?: Record<string, unknown>) => void lines.push({ level: "error", msg, ...(fields === undefined ? {} : { fields }) }),
  } as unknown as Logger & { lines: { level: string; msg: string; fields?: Record<string, unknown> }[] };
}

const ctx = (tenant: string | null) =>
  ({
    jobId: "job-1",
    type: "integration.sync",
    hasTenant: true,
    actorUserId: null,
    payload: { integrationId: "00000000-0000-4000-8000-000000000001", trigger: "SCHEDULE" },
    // Sahte transaction: tenant ayarı sorgusu `tenant` döndürür, diğer sorgular boş.
    inTenant: async <R>(fn: (tx: unknown) => Promise<R>) =>
      fn({
        execute: async (q: unknown) => {
          let text = "";
          try {
            text = JSON.stringify(q);
          } catch {
            text = "";
          }
          return text.includes("current_setting") && tenant !== null ? [{ tenant_id: tenant }] : [];
        },
      }),
    inPlatform: async () => {
      throw new Error("platform yok");
    },
  }) as never;

describe("integration.sync işi", () => {
  it("bağlantı yoksa sessiz başarı değil, 'skipped' + neden günlüğe", async () => {
    const logger = memLogger();
    const h = createIntegrationSyncHandler({ env: { QUEUE_SEAL_KEY: randomBytes(32).toString("hex") }, logger });
    await h(ctx("00000000-0000-4000-8000-0000000000aa"));
    expect(logger.lines).toEqual([{ level: "info", msg: "integration.sync skipped", fields: { jobId: "job-1", reason: "NOT_CONNECTED" } }]);
  });

  it("şifreleme anahtarı yoksa iş düşer (yeniden denenir); günlükte yalnız hata adı", async () => {
    const logger = memLogger();
    const h = createIntegrationSyncHandler({ env: {}, logger });
    await expect(h(ctx("00000000-0000-4000-8000-0000000000aa"))).rejects.toThrow();
    expect(logger.lines).toEqual([{ level: "error", msg: "integration.sync failed", fields: { jobId: "job-1", error: "SealConfigError" } }]);
  });

  it("sahte sağlayıcı adresi geri döngü dışıysa iş düşer; adres günlüğe girmez", async () => {
    const logger = memLogger();
    const h = createIntegrationSyncHandler({ env: { QUEUE_SEAL_KEY: randomBytes(32).toString("hex"), PARASUT_BASE_URL: "https://evil.example/steal" }, logger });
    await expect(h(ctx("00000000-0000-4000-8000-0000000000aa"))).rejects.toThrow();
    expect(JSON.stringify(logger.lines)).not.toContain("evil.example");
    expect(logger.lines[0]).toMatchObject({ msg: "integration.sync failed", fields: { code: "CONFIG" } });
  });
});

describe("zamanlayıcı", () => {
  it("ACTIVE tenant sayfaları; askıdaki tenant hata sayılmaz; sayılar günlüğe", async () => {
    const logger = memLogger();
    const ids = Array.from({ length: 3 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);
    const r = await runIntegrationSchedule({
      listActiveTenantIds: async (after) => (after === "00000000-0000-0000-0000-000000000000" ? ids : []),
      enqueueFor: async (id) => {
        if (id === ids[1]) throw Object.assign(new Error("x"), { code: "TENANT_SUSPENDED" });
        if (id === ids[2]) throw new Error("db");
        return 2;
      },
      logger,
    });
    expect(r).toEqual({ tenants: 3, queued: 2, failed: 1 });
    expect(logger.lines.map((l) => l.msg)).toEqual(["integration.schedule_enqueue_failed", "integration.scheduled"]);
  });

  it("açılışta bir kez + aralıkla; durdurulunca zamanlayıcı temizlenir", async () => {
    const logger = memLogger();
    let calls = 0;
    let cleared = false;
    const s = startIntegrationSchedule({
      listActiveTenantIds: async () => {
        calls += 1;
        return [];
      },
      enqueueFor: async () => 0,
      logger,
      setTimer: (_tick, ms) => { expect(ms).toBe(30_000); return "h"; },
      clearTimer: (t) => {
        cleared = t === "h";
      },
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toBe(1);
    s.stop();
    expect(cleared).toBe(true);
  });
  it("slow scheduling does not overlap ticks and stopped timers cannot enqueue", async () => {
    let tick: (() => void) | undefined;
    let release: (() => void) | undefined;
    let calls = 0;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const schedule = startIntegrationSchedule({
      listActiveTenantIds: async () => { calls += 1; await pending; return []; },
      enqueueFor: async () => 0,
      logger: memLogger(),
      setTimer: fn => { tick = fn; return "timer"; },
      clearTimer: () => undefined,
    });
    tick?.(); tick?.();
    expect(calls).toBe(1);
    release?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    tick?.();
    expect(calls).toBe(2);
    schedule.stop();
    tick?.();
    expect(calls).toBe(2);
  });

});
