// T-1138: `integration.webhook` işi — REGISTER (Paraşüt webhook kaydı kur/uzlaştır) ve EVENT (tek kart olayı). İş kuralı
// `@wms/domain/integrations` (webhook.ts, webhook-register.ts); burada bağlama, sağlayıcı istemcisi ve günlük. Günlüğe sır/adres/şirket/
// kart adı/anahtar yazılmaz: yalnız iş kimliği, tür ve sabit kodlar (G-09).
import { ParasutClient, integrationSealer, parasutWebhookUrl, registerParasutWebhooks, resolveParasutBaseUrl, runWebhookEvent, type ConsumeOnce, type FetchLike } from "@wms/domain/integrations";
import type { AccessTx } from "@wms/domain/identity/access";
import type { Logger } from "@wms/shared/log";
import type { JobHandler } from "@wms/shared/queue";

export interface IntegrationWebhookDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly logger: Logger;
  readonly consumeOnce: ConsumeOnce;
  /** Test: sahte HTTP ve bekleme. */
  readonly fetch?: FetchLike;
  readonly sleep?: (ms: number) => Promise<void>;
}

const errName = (e: unknown): string => (e instanceof Error ? e.name : "unknown");

export function createIntegrationWebhookHandler(deps: IntegrationWebhookDeps): JobHandler<"integration.webhook"> {
  return async (ctx) => {
    const p = ctx.payload;
    const inTenant = <T>(fn: (tx: AccessTx) => Promise<T>): Promise<T> => ctx.inTenant((tx) => fn(tx as AccessTx));
    try {
      const sealer = integrationSealer(deps.env);
      const client = new ParasutClient({ baseUrl: resolveParasutBaseUrl(deps.env), ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }) });
      if (p.kind === "REGISTER") {
        const r = await registerParasutWebhooks({ inTenant, client, sealer, callbackUrl: parasutWebhookUrl(deps.env) }, p.integrationId);
        deps.logger.info("integration.webhook register", { jobId: ctx.jobId, result: r.kind, ...(r.kind === "skipped" ? { reason: r.reason } : r.kind === "failed" ? { reason: r.code } : { created: r.created, kept: r.kept }) });
        return;
      }
      if (p.resource === undefined || p.externalId === undefined || p.eventKey === undefined) {
        deps.logger.info("integration.webhook skipped", { jobId: ctx.jobId, reason: "BAD_PAYLOAD" });
        return;
      }
      const r = await runWebhookEvent(
        { inTenant, client, sealer, consumeOnce: deps.consumeOnce, ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }) },
        { integrationId: p.integrationId, resource: p.resource, action: p.action, externalId: p.externalId, eventKey: p.eventKey },
      );
      deps.logger.info("integration.webhook event", { jobId: ctx.jobId, resource: p.resource, ...(p.action === undefined ? {} : { action: p.action }), result: r.kind, ...(r.kind === "skipped" ? { reason: r.reason } : r.kind === "applied" ? { outcome: r.outcome } : {}) });
    } catch (e) {
      deps.logger.error("integration.webhook failed", { jobId: ctx.jobId, kind: p.kind, error: errName(e) });
      throw e;
    }
  };
}
