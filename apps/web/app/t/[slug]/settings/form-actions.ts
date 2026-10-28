"use server";
// T-968 (B-63, KalipForm): Ayarlar form kalıbının TEK "Kaydet"i — değişen çalışma alanı alanları (ad, dil, saat dilimi) ve görev ayrılığı
// birlikte kaydedilir. Kurallar aynen domain'dedir: `updateTenantSettings` (T-121; settings.manage, audit) ve `setSeparationOfDuties`
// (T-416; settings.manage, yeniden giriş, audit). Bu dosya yalnız ince giriş katmanıdır: Origin + hız sınırı + hata maskeleme
// (`createProductionGuard`), tenant sayacı, sonuca göre yönlendirme. Ayrı eylemler (`saveSettingsAction`, `setSeparationAction`) değişmedi.
// T-1109: Etkin sesli yanıt da aynı Kaydet'le (`setVoiceReply`). Görev ayrılığı yeniden giriş isterse önce kaydedilen alanlar korunur, yönlendirme ikisini birlikte söyler (`saved=1&sod=reauth`).
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { setSeparationOfDuties } from "@wms/domain/identity/separation";
import { setVoiceReply } from "@wms/domain/voice";
import { updateTenantSettings } from "@wms/domain/onboarding/workspace";
import { TIME_ZONES } from "../../../../lib/timezones.ts";
import { createProductionGuard, limitVerifiedTenant } from "../../../../lib/action-guard.ts";

const guardedAction = createProductionGuard(() => headers());
const tenantSchema = z
  .object({ slug: z.string().min(1).max(63), name: z.string().max(500), locale: z.string().max(16), timeZone: z.enum(TIME_ZONES) })
  .strict();
const sodSchema = z.object({ slug: z.string().min(1).max(63), enabled: z.enum(["0", "1"]) }).strict();

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

export async function saveSettingsFormAction(form: FormData): Promise<void> {
  const slug = field(form, "slug");
  const base = `/t/${encodeURIComponent(slug)}/settings`;
  const parts = new URLSearchParams();
  if (field(form, "tenant") === "1") {
    const result = await guardedAction({ schema: tenantSchema }, async (input, ctx) => {
      const principal = ctx.principal;
      if (principal === null) throw new Error("unreachable: principal required");
      const db = getAppDb();
      await limitVerifiedTenant({ db, principal, tenantSlug: input.slug, permission: "settings.manage" }, ctx);
      return updateTenantSettings(db, input.slug, principal, { name: input.name, locale: input.locale, timeZone: input.timeZone });
    })({ slug, name: field(form, "name"), locale: field(form, "locale"), timeZone: field(form, "timeZone") });
    if (!result.ok) redirect(`${base}?error=${encodeURIComponent(result.error.code)}`);
    // T-999c: dil/ad değişince bütün düzenler (kök düzendeki dil sağlayıcısı dahil) yeni değerle yeniden çizilir; istemci önbelleği bayatlamaz.
    if (result.data.changed) revalidatePath("/", "layout");
    parts.set(result.data.changed ? "saved" : "unchanged", "1");
  }
  const sod = field(form, "sod");
  if (sod === "0" || sod === "1") {
    const requestHeaders = await headers();
    const { ensureRecentAuth } = await import("../../../../lib/auth-service.ts");
    const result = await guardedAction({ schema: sodSchema }, async (input, ctx) => {
      const principal = ctx.principal;
      if (principal === null) throw new Error("unreachable: principal required");
      const db = getAppDb();
      await limitVerifiedTenant({ db, principal, tenantSlug: input.slug, permission: "settings.manage" }, ctx);
      return setSeparationOfDuties({ db, principal, tenantSlug: input.slug, enabled: input.enabled === "1", requestId: ctx.requestId, recentAuth: () => ensureRecentAuth(requestHeaders) });
    })({ slug, enabled: sod });
    if (!result.ok) {
      if (result.error.code === "UNAUTHENTICATED" && result.error.detail === "RECENT_AUTH_REQUIRED") parts.set("sod", "reauth");
      else {
        parts.set("error", result.error.code);
      }
    } else parts.set("sod", result.data.changed ? (sod === "1" ? "on" : "off") : "unchanged");
  }
  // T-1109 (B-134): Etkin sesli yanıt — settings.manage, audit; yeniden giriş istemez (sunum tercihi).
  const voice = field(form, "voice");
  if (voice === "0" || voice === "1") {
    const result = await guardedAction({ schema: sodSchema }, async (input, ctx) => {
      const principal = ctx.principal;
      if (principal === null) throw new Error("unreachable: principal required");
      const db = getAppDb();
      await limitVerifiedTenant({ db, principal, tenantSlug: input.slug, permission: "settings.manage" }, ctx);
      return setVoiceReply({ db, principal, tenantSlug: input.slug, enabled: input.enabled === "1", requestId: ctx.requestId });
    })({ slug, enabled: voice });
    if (!result.ok) parts.set("error", result.error.code);
    else parts.set("voice", result.data.changed ? (voice === "1" ? "on" : "off") : "unchanged");
  }
  const q = parts.toString();
  redirect(q === "" ? `${base}?unchanged=1` : `${base}?${q}`);
}
