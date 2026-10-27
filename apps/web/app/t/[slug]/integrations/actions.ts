"use server";
// T-991: ERP entegrasyonu — ince giriş katmanı. Kural (settings.manage, demo reddi, yakın zamanda doğrulama, audit, sır mühürü) domain'dedir
// (`@wms/domain/integrations`); burada Origin + hız sınırı + hata maskeleme (`createProductionGuard`), tenant sayacı ve kuyruk istemcisi vardır.
// Kullanıcının girdiği Paraşüt bilgisi yalnız bu isteğin belleğinde yaşar: loga, dönüşe, hata gövdesine girmez; dönüşte yalnız şirket adı.
import { headers } from "next/headers";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { checkIntegration, connectParasut, disconnectIntegration, pullOpeningStock, requestIntegrationRun, setIntegrationFlow, setOpeningStockSetting, setProductBarcodeSetting, FLOWS, DIRECTIONS } from "@wms/domain/integrations";
import { createProductionGuard, limitVerifiedTenant, type ActionContext } from "../../../../lib/action-guard.ts";
import { getSenderQueue } from "../../../../lib/queue.ts";

const guardedAction = createProductionGuard(() => headers());
const slug = z.string().min(1).max(63);
const provider = z.enum(["PARASUT", "LOGO"]);

const connectSchema = z
  .object({
    slug,
    companyId: z.string().regex(/^\s*[0-9]{1,12}\s*$/),
    clientId: z.string().min(1).max(200),
    clientSecret: z.string().min(1).max(200),
    username: z.string().min(3).max(254),
    password: z.string().min(1).max(200),
  })
  .strict();
const providerSchema = z.object({ slug, provider }).strict();
const flowSchema = z.object({ slug, provider, flow: z.enum(FLOWS), enabled: z.boolean(), direction: z.enum(DIRECTIONS) }).strict();
const runSchema = z.object({ slug, provider, flow: z.enum(FLOWS).optional() }).strict();
const openingSchema = z.object({ slug, provider, enabled: z.boolean(), via: z.literal("journey").optional() }).strict();
const pullSchema = z.object({ slug, provider, locationId: z.string().uuid() }).strict();

async function access(tenantSlug: string, ctx: ActionContext) {
  if (ctx.principal === null) throw new Error("unreachable: principal required");
  const a = { db: getAppDb(), principal: ctx.principal, tenantSlug };
  await limitVerifiedTenant({ ...a, permission: "settings.manage" }, ctx);
  return a;
}

export async function connectParasutAction(raw: unknown) {
  const requestHeaders = await headers();
  const { ensureRecentAuth } = await import("../../../../lib/auth-service.ts");
  return guardedAction({ schema: connectSchema }, async (i, ctx) => {
    const a = await access(i.slug, ctx);
    return connectParasut(
      { ...a, recentAuth: () => ensureRecentAuth(requestHeaders) },
      { companyId: i.companyId, clientId: i.clientId, clientSecret: i.clientSecret, username: i.username, password: i.password, requestId: ctx.requestId },
    );
  })(raw);
}

export async function checkIntegrationAction(raw: unknown) {
  return guardedAction({ schema: providerSchema }, async (i, ctx) => checkIntegration(await access(i.slug, ctx), { provider: i.provider, requestId: ctx.requestId }))(raw);
}

export async function disconnectIntegrationAction(raw: unknown) {
  const requestHeaders = await headers();
  const { ensureRecentAuth } = await import("../../../../lib/auth-service.ts");
  return guardedAction({ schema: providerSchema }, async (i, ctx) => {
    const a = await access(i.slug, ctx);
    return disconnectIntegration({ ...a, recentAuth: () => ensureRecentAuth(requestHeaders) }, { provider: i.provider, requestId: ctx.requestId });
  })(raw);
}

export async function setIntegrationFlowAction(raw: unknown) {
  const queue = await getSenderQueue(); // transaction dışında başlatılır; yoksa ayar yine kaydedilir (zamanlanmış koşu alır)
  return guardedAction({ schema: flowSchema }, async (i, ctx) =>
    setIntegrationFlow(await access(i.slug, ctx), { provider: i.provider, flow: i.flow, enabled: i.enabled, direction: i.direction, requestId: ctx.requestId }, { queue }),
  )(raw);
}

export async function runIntegrationAction(raw: unknown) {
  const queue = await getSenderQueue();
  return guardedAction({ schema: runSchema }, async (i, ctx) =>
    requestIntegrationRun(await access(i.slug, ctx), { provider: i.provider, ...(i.flow === undefined ? {} : { flow: i.flow }), requestId: ctx.requestId }, { queue }),
  )(raw);
}

/** T-1006: "Açılış stokunu Paraşüt'ten al" ayarı (varsayılan kapalı; alındıktan sonra değişmez). */
export async function setOpeningStockAction(raw: unknown) {
  return guardedAction({ schema: openingSchema }, async (i, ctx) => setOpeningStockSetting(await access(i.slug, ctx), { provider: i.provider, enabled: i.enabled, requestId: ctx.requestId, ...(i.via === undefined ? {} : { via: i.via }) }))(raw);
}

/** T-1006: açılış stokunu ERP'den BİR KEZ al (seçilen rafa; tekrarı domain + DB kilidiyle reddedilir). Dönüşte tarih metindir. */
export async function pullOpeningStockAction(raw: unknown) {
  return guardedAction({ schema: pullSchema }, async (i, ctx) => {
    const r = await pullOpeningStock(await access(i.slug, ctx), { provider: i.provider, locationId: i.locationId, requestId: ctx.requestId });
    return r.ok ? { ...r, takenAt: r.takenAt.toISOString() } : r;
  })(raw);
}

export async function setProductBarcodeAction(raw: unknown) {
  return guardedAction({ schema: z.object({ slug, enabled: z.boolean() }).strict() }, async (i, ctx) =>
    setProductBarcodeSetting(await access(i.slug, ctx), { enabled: i.enabled, requestId: ctx.requestId }),
  )(raw);
}
