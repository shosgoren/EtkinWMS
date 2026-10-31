"use server";
// T-991: ERP entegrasyonu — ince giriş katmanı. Kural (settings.manage, demo reddi, yakın zamanda doğrulama, audit, sır mühürü) domain'dedir
// (`@wms/domain/integrations`); burada Origin + hız sınırı + hata maskeleme (`createProductionGuard`), tenant sayacı ve kuyruk istemcisi vardır.
// Kullanıcının girdiği Paraşüt bilgisi yalnız bu isteğin belleğinde yaşar: loga, dönüşe, hata gövdesine girmez; dönüşte yalnız şirket adı.
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { checkIntegration, disconnectIntegration, retryIntegrationOutbox, resolveIntegrationOutbox, pullOpeningStock, requestIntegrationRun, setIntegrationFlow, setOpeningStockSetting, setProductBarcodeSetting, countFlowRecords, CARD_FLOWS, FLOWS, DIRECTIONS, beginParasutOAuth, selectParasutOAuthCompany, encodeOAuthBinding, parseOAuthBinding, oauthCookieName, OAUTH_TTL_SECONDS, saveParasutOAuthSettings, completeParasutOAuth, PARASUT_OOB_REDIRECT_URI } from "@wms/domain/integrations";
import { createProductionGuard, limitVerifiedTenant, type ActionContext } from "../../../../lib/action-guard.ts";
import { getSenderQueue } from "../../../../lib/queue.ts";

const guardedAction = createProductionGuard(() => headers());
const slug = z.string().min(1).max(63);
const provider = z.enum(["PARASUT", "LOGO"]);

// T-1137 (kullanıcı kararı 30 Ekim): eski "e-posta + parola ile bağlan" kaldırıldı. Eski istemci hangi alanları gönderirse göndersin
// (yalnız `slug` doğrulanır; diğer alanlar okunmaz, saklanmaz, loglanmaz) açık bir kodla reddedilir. Mevcut parola bağlantıları çalışmaya
// devam eder (belirteç yenileme mühürlü kutudan); yalnız YENİ parola bağlantısı kurulamaz.
const legacyConnectSchema = z.object({ slug }); // bilinmeyen alanlar atılır (strip): parola ayrıştırılmış girdiye bile girmez
const outboxSchema = z.object({ slug, id: z.string().uuid() }).strict();
const resolveSchema = z.object({ slug, id: z.string().uuid(), resolution: z.enum(["SENT", "SKIP"]) }).strict();
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
  return guardedAction({ schema: legacyConnectSchema }, async (i, ctx) => {
    await access(i.slug, ctx); // yetki + hız sınırı yine uygulanır (yetkisiz çağrı FORBIDDEN alır, "UNSUPPORTED" bilgisi değil)
    return { ok: false, reason: "UNSUPPORTED" } as const;
  })(raw);
}

/** T-1137: kuyruk satırını yeniden dene (irsaliye yeniden gönder / kart bekletmesini kaldır); bağlıysa koşu kuyruğa girer. */
export async function retryIntegrationOutboxAction(raw: unknown) {
  const queue = await getSenderQueue();
  return guardedAction({ schema: outboxSchema }, async (i, ctx) => retryIntegrationOutbox(await access(i.slug, ctx), { id: i.id, requestId: ctx.requestId }, { queue }))(raw);
}

/** T-1137: irsaliyeyi elle çözüldü say ("SENT" Paraşüt'te var · "SKIP" gönderme). */
export async function resolveIntegrationOutboxAction(raw: unknown) {
  return guardedAction({ schema: resolveSchema }, async (i, ctx) => resolveIntegrationOutbox(await access(i.slug, ctx), { id: i.id, resolution: i.resolution, requestId: ctx.requestId }))(raw);
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

/** T-1136: yön onay penceresi için kart akışının yerel kayıt sayısı (yalnız sayı; tenant + `settings.manage` domain'de). */
export async function countFlowRecordsAction(raw: unknown) {
  return guardedAction({ schema: z.object({ slug, provider, flow: z.enum(CARD_FLOWS) }).strict() }, async (i, ctx) =>
    countFlowRecords(await access(i.slug, ctx), { provider: i.provider, flow: i.flow }),
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

/** T-1066: browser nonce is returned only in an HttpOnly host cookie, never in the action payload. */
export async function beginParasutOAuthAction(raw: unknown) {
  const requestHeaders = await headers();
  const { ensureRecentAuth } = await import("../../../../lib/auth-service.ts");
  return guardedAction({ schema: z.object({ slug }).strict() }, async (i, ctx) => {
    const result = await beginParasutOAuth({ ...await access(i.slug, ctx), recentAuth: () => ensureRecentAuth(requestHeaders) });
    if (!result.ok) return result;
    (await cookies()).set(oauthCookieName(ctx.origin),encodeOAuthBinding(result.binding),{httpOnly:true,secure:ctx.origin.startsWith("https:"),sameSite:"lax",path:"/",maxAge:OAUTH_TTL_SECONDS});
    return {ok:true,authorizationUrl:result.authorizationUrl,manual:result.manual} as const;
  })(raw);
}
export async function selectParasutOAuthCompanyAction(raw: unknown) {
  const requestHeaders = await headers();
  const { ensureRecentAuth } = await import("../../../../lib/auth-service.ts");
  return guardedAction({ schema: z.object({ slug, companyId:z.string().regex(/^[0-9]{1,12}$/) }).strict() }, async (i,ctx) => {
    const a = await access(i.slug,ctx);const jar=await cookies();const name=oauthCookieName(ctx.origin);
    const binding=parseOAuthBinding(jar.get(name)?.value);
    if(binding===null||binding.slug!==i.slug)throw new AppError("VALIDATION_FAILED");
    const result=await selectParasutOAuthCompany({...a,recentAuth:()=>ensureRecentAuth(requestHeaders)},{binding,companyId:i.companyId},{queue:await getSenderQueue()});
    jar.set(name,"",{httpOnly:true,secure:ctx.origin.startsWith("https:"),sameSite:"lax",path:"/",maxAge:0});
    return result;
  })(raw);
}

/** T-1133 (Gelişmiş: kendi uygulaman): dönüş adresi istemciden alınmaz — sunucunun gerçek callback'i; `oob` yalnız eski yetki kodu yöntemi. */
export async function saveParasutOAuthSettingsAction(raw:unknown) {
 const requestHeaders=await headers();
 const {ensureRecentAuth}=await import("../../../../lib/auth-service.ts");
 return guardedAction({schema:z.object({slug,clientId:z.string().min(1).max(200),clientSecret:z.string().min(1).max(200),oob:z.boolean().optional()}).strict()},async(i,ctx)=>
 saveParasutOAuthSettings({...await access(i.slug,ctx),recentAuth:()=>ensureRecentAuth(requestHeaders)},{clientId:i.clientId,clientSecret:i.clientSecret,...(i.oob===true?{callbackUrl:PARASUT_OOB_REDIRECT_URI}:{})}))(raw);
}

/** OOB: explicit user-entered authorization code, bound to the same HttpOnly browser attempt. */
export async function completeParasutOAuthCodeAction(raw:unknown) {
 const requestHeaders=await headers();const {ensureRecentAuth}=await import("../../../../lib/auth-service.ts");
 return guardedAction({schema:z.object({slug,code:z.string().min(1).max(4096)}).strict()},async(i,ctx)=>{
 const a=await access(i.slug,ctx);const jar=await cookies();const name=oauthCookieName(ctx.origin);
 const binding=parseOAuthBinding(jar.get(name)?.value);if(binding===null||binding.slug!==i.slug)throw new AppError("VALIDATION_FAILED");
 const r=await completeParasutOAuth({...a,recentAuth:()=>ensureRecentAuth(requestHeaders)},{binding,code:i.code},{queue:await getSenderQueue()});
 if(!r.ok||r.status==="CONNECTED")jar.set(name,"",{httpOnly:true,secure:ctx.origin.startsWith("https:"),sameSite:"lax",path:"/",maxAge:0});
 return r;
 })(raw);
}
