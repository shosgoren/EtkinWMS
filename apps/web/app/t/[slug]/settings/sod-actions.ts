"use server";
// Görev ayrılığı ayarı (T-416, A-03): ince giriş katmanı. Kural `setSeparationOfDuties`'tadır (settings.manage, yeniden giriş, audit
// `tenant.settings_changed`); burada Origin + hız sınırı + hata maskeleme (`createProductionGuard`), tenant sayacı ve yönlendirme vardır.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { setSeparationOfDuties } from "@wms/domain/identity/separation";
import { createProductionGuard, limitVerifiedTenant } from "../../../../lib/action-guard.ts";

const guardedAction = createProductionGuard(() => headers());
const schema = z.object({ slug: z.string().min(1).max(63), enabled: z.enum(["0", "1"]) }).strict();

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

export async function setSeparationAction(form: FormData): Promise<void> {
  const slug = field(form, "slug");
  const base = `/t/${encodeURIComponent(slug)}/settings`;
  const requestHeaders = await headers();
  const { ensureRecentAuth } = await import("../../../../lib/auth-service.ts");
  const result = await guardedAction({ schema }, async (input, ctx) => {
    const principal = ctx.principal;
    if (principal === null) throw new Error("unreachable: principal required");
    const db = getAppDb();
    await limitVerifiedTenant({ db, principal, tenantSlug: input.slug, permission: "settings.manage" }, ctx);
    return setSeparationOfDuties({ db, principal, tenantSlug: input.slug, enabled: input.enabled === "1", requestId: ctx.requestId, recentAuth: () => ensureRecentAuth(requestHeaders) });
  })({ slug, enabled: field(form, "enabled") });
  if (!result.ok) {
    if (result.error.code === "UNAUTHENTICATED" && result.error.detail === "RECENT_AUTH_REQUIRED") redirect(`${base}?sod=reauth`);
    redirect(`${base}?error=${encodeURIComponent(result.error.code)}`);
  }
  redirect(`${base}?sod=${result.data.changed ? (field(form, "enabled") === "1" ? "on" : "off") : "unchanged"}`);
}
