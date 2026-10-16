// Deneme aktivasyonu işleri (T-995, ADR-026 §3.3–3.5).
// - `platform.activation.deliver` (PLATFORM işi): belirteç YALNIZCA burada üretilir (yükte yalnız talep kimliği). Sıra davet deseniyle
//   aynı: `processed_events` kontrolü → yeni belirteç + özeti yaz (wms_worker, kendi transaction'ı, commit) → transaction DIŞINDA gönder.
//   Yeniden denemede yeni belirteç ve yeni Idempotency-Key (eski bağlantı geçersiz). Alıcı ve bağlantı loglanmaz (G-09).
// - `trial.welcome` (tenant işi): sahibin e-postası, adres ve deneme bitişi tenant'tan okunur; e-posta sır taşımaz.
import type { AccessDbClient, AccessTx } from "@wms/domain/identity/access";
import { prepareActivationDelivery, readWelcomeMailData } from "@wms/domain/platform/activation";
import { deliverExternalOnce } from "@wms/queue-adapter";
import { MailError, canDeliver, maskRecipient, type MailConfig, type Mailer } from "@wms/shared/mailer";
import type { JobHandler } from "@wms/shared/queue";
import type { Logger } from "../lifecycle.js";
import { renderActivationEmail, renderWelcomeEmail } from "../mail/trial-templates.js";

export interface TrialMailDeps {
  readonly config: MailConfig;
  readonly mailer: Mailer;
  readonly logger: Logger;
  /** Uygulama kökeni (`BETTER_AUTH_URL`); tanımsızsa iş yapılandırma hatasıyla düşer (sahte başarı yok). */
  readonly appBaseUrl: string | undefined;
}

function failName(err: unknown): Record<string, unknown> {
  return { error: err instanceof Error ? err.name : "unknown", ...(err instanceof MailError ? { code: err.code } : {}) };
}

export function createActivationDeliverHandler(deps: TrialMailDeps & { readonly workerDb: AccessDbClient }): JobHandler<"platform.activation.deliver"> {
  return async (ctx) => {
    const { demoRequestId } = ctx.payload;
    try {
      if (ctx.hasTenant) throw new Error("platform.activation.deliver must be a platform job");
      if (deps.appBaseUrl === undefined) throw new Error("BETTER_AUTH_URL is not configured");
      const base = deps.appBaseUrl.replace(/\/+$/, "");
      await deliverExternalOnce(ctx, "platform.activation.deliver", async () => {
        const prepared = await prepareActivationDelivery(deps.workerDb, demoRequestId);
        if (prepared === null) {
          deps.logger.info("platform.activation.deliver skipped", { jobId: ctx.jobId, reason: "not_pending" });
          return;
        }
        if (!canDeliver(deps.config, prepared.email)) {
          throw new MailError("MAIL_DELIVERY_DISABLED", "recipient cannot be delivered in this environment");
        }
        const rendered = renderActivationEmail("tr", `${base}/activate/${prepared.token}`, prepared.company);
        await deps.mailer.send({ to: prepared.email, ...rendered, idempotencyKey: `activation-${prepared.tokenHash}` });
        deps.logger.info("activation email sent", { jobId: ctx.jobId, recipient: maskRecipient(prepared.email) });
      });
    } catch (err) {
      deps.logger.error("platform.activation.deliver failed", { jobId: ctx.jobId, ...failName(err) });
      throw err;
    }
  };
}

export function createTrialWelcomeHandler(deps: TrialMailDeps): JobHandler<"trial.welcome"> {
  return async (ctx) => {
    try {
      if (!ctx.hasTenant) throw new Error("trial.welcome requires a tenant job");
      if (deps.appBaseUrl === undefined) throw new Error("BETTER_AUTH_URL is not configured");
      const appBaseUrl = deps.appBaseUrl;
      await deliverExternalOnce(ctx, "trial.welcome", async (idempotencyKey) => {
        const data = await ctx.inTenant((rawTx) => readWelcomeMailData(rawTx as AccessTx));
        if (data === null) {
          deps.logger.info("trial.welcome skipped", { jobId: ctx.jobId, reason: "no_owner" });
          return;
        }
        if (!canDeliver(deps.config, data.email)) {
          throw new MailError("MAIL_DELIVERY_DISABLED", "recipient cannot be delivered in this environment");
        }
        const rendered = renderWelcomeEmail({
          locale: data.locale,
          appBaseUrl,
          company: data.company,
          slug: data.slug,
          email: data.email,
          trialEndsAt: data.trialEndsAt,
        });
        await deps.mailer.send({ to: data.email, ...rendered, idempotencyKey });
        deps.logger.info("welcome email sent", { jobId: ctx.jobId, recipient: maskRecipient(data.email) });
      });
    } catch (err) {
      deps.logger.error("trial.welcome failed", { jobId: ctx.jobId, ...failName(err) });
      throw err;
    }
  };
}
