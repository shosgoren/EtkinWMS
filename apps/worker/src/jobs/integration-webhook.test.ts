// T-1138: `integration.webhook` işi — bağlama ve günlük (sır/adres yok). İş kuralı tests/integration/integrations/parasut-webhook.int.test.ts.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Logger } from "@wms/shared/log";
import { createIntegrationWebhookHandler } from "./integration-webhook.js";

function memLogger() {
  const lines: { level: string; msg: string; fields?: Record<string, unknown> }[] = [];
  const logger = {
    info: (msg: string, fields?: Record<string, unknown>) => void lines.push({ level: "info", msg, ...(fields === undefined ? {} : { fields }) }),
    error: (msg: string, fields?: Record<string, unknown>) => void lines.push({ level: "error", msg, ...(fields === undefined ? {} : { fields }) }),
  } as unknown as Logger;
  return { logger, lines };
}
const ctx = (payload: Record<string, unknown>) =>
  ({
    jobId: "job-1",
    type: "integration.webhook",
    hasTenant: true,
    actorUserId: null,
    payload: { integrationId: "00000000-0000-4000-8000-000000000001", ...payload },
    inTenant: async <R>(fn: (tx: unknown) => Promise<R>) => fn({ execute: async (q: unknown) => (JSON.stringify(q).includes("current_setting") ? [{ tenant_id: "00000000-0000-4000-8000-0000000000aa" }] : []) }),
    inPlatform: async () => {
      throw new Error("platform yok");
    },
  }) as never;
const consumeOnce = (async () => ({ applied: false })) as never;

describe("integration.webhook işi", () => {
  it("eksik olay yükü: sessiz başarı değil, nedeni günlükte", async () => {
    const { logger, lines } = memLogger();
    await createIntegrationWebhookHandler({ env: { QUEUE_SEAL_KEY: randomBytes(32).toString("hex") }, logger, consumeOnce })(ctx({ kind: "EVENT" }));
    expect(lines).toEqual([{ level: "info", msg: "integration.webhook skipped", fields: { jobId: "job-1", reason: "BAD_PAYLOAD" } }]);
  });
  it("bağlantı yoksa kayıt atlanır; adres/anahtar günlüğe girmez", async () => {
    const { logger, lines } = memLogger();
    await createIntegrationWebhookHandler({ env: { QUEUE_SEAL_KEY: randomBytes(32).toString("hex"), BETTER_AUTH_URL: "https://wms.example.test" }, logger, consumeOnce })(ctx({ kind: "REGISTER" }));
    expect(lines).toEqual([{ level: "info", msg: "integration.webhook register", fields: { jobId: "job-1", result: "skipped", reason: "NOT_CONNECTED" } }]);
    expect(JSON.stringify(lines)).not.toContain("example.test");
  });
  it("şifreleme anahtarı yoksa iş düşer (yeniden denenir); günlükte yalnız hata adı", async () => {
    const { logger, lines } = memLogger();
    await expect(createIntegrationWebhookHandler({ env: {}, logger, consumeOnce })(ctx({ kind: "REGISTER" }))).rejects.toThrow();
    expect(lines).toEqual([{ level: "error", msg: "integration.webhook failed", fields: { jobId: "job-1", kind: "REGISTER", error: "SealConfigError" } }]);
  });
});
