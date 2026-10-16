"use server";
// Deneme aktivasyonu eylemleri (T-995, ADR-026 §3.3–3.5). Oturumsuz; Origin + hız sınırı + hata maskeleme `createProductionGuard`'da,
// bağlantı/ad/parola kuralları ve tek transaction domain'de (`@wms/domain/platform/activation`). Yalnız müşteri kipinde.
// Parola yalnız hesap açmaya gider (wms_auth); yanıta, loga ya da kuyruğa girmez.
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";
import { activateTrial, checkWorkspaceName, type ActivateTrialDeps } from "@wms/domain/platform/activation";
import { getAppDb } from "@wms/db";
import { assertMailModeAllowed, loadMailConfig } from "@wms/shared/mailer";
import { createProductionGuard } from "../../../lib/action-guard.ts";
import { createActivatedAccount } from "../../../lib/auth-service.ts";
import { getSenderQueue } from "../../../lib/queue.ts";
import { appSurface } from "../../../lib/surface.ts";

const guardedAction = createProductionGuard(() => headers());
const token = z.string().min(1).max(64);
const checkSchema = z.object({ token, name: z.string().max(80) }).strict();
const activateSchema = z
  .object({
    token,
    company: z.string().min(1).max(120),
    workspaceName: z.string().min(1).max(30),
    sample: z.boolean(),
    password: z.string().min(1).max(128),
  })
  .strict();

const unavailableQueue: ActivateTrialDeps["queue"] = {
  enqueue: () => Promise.reject(new Error("job queue is not available in the web process")),
};

function log(entry: Readonly<Record<string, unknown>>): void {
  console.error(JSON.stringify(entry));
}

export async function checkWorkspaceNameAction(raw: unknown) {
  if (appSurface() === "panel") notFound();
  return guardedAction({ schema: checkSchema, requireAuth: false }, async (input) =>
    checkWorkspaceName({ db: getAppDb(), token: input.token, name: input.name }),
  )(raw);
}

export async function activateTrialAction(raw: unknown) {
  if (appSurface() === "panel") notFound();
  return guardedAction({ schema: activateSchema, requireAuth: false }, async (input) => {
    const mailConfig = loadMailConfig(process.env);
    assertMailModeAllowed(mailConfig, process.env.WMS_ENV?.trim());
    const queue = (await getSenderQueue()) ?? unavailableQueue; // transaction dışında başlatılır
    const r = await activateTrial(
      {
        db: getAppDb(),
        token: input.token,
        company: input.company,
        workspaceName: input.workspaceName,
        sample: input.sample,
        password: input.password,
      },
      { createActivatedAccount, mailConfig, queue, log },
    );
    return { slug: r.tenantSlug, email: r.email, trialEndsAt: r.trialEndsAt.toISOString(), welcomeQueued: r.welcomeQueued };
  })(raw);
}
