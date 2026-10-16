"use server";
// "Örnek verileri temizle" (T-996, ADR-026 §4): ince giriş katmanı. Kural `clearSampleData`'dadır (settings.manage, yakın zamanda
// doğrulama, tek transaction, audit `sample_data.cleared`); burada Origin + hız sınırı + hata maskeleme (`createProductionGuard`),
// tenant sayacı, onay kutusu ve sonuca göre yönlendirme vardır. Sonuç (silindi / pasife alındı / yok) ekranda açıkça söylenir.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { clearSampleData } from "@wms/domain/onboarding/sample-data";
import { createProductionGuard, limitVerifiedTenant } from "../../../../lib/action-guard.ts";

const guardedAction = createProductionGuard(() => headers());
const schema = z.object({ slug: z.string().min(1).max(63) }).strict();

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

export async function clearSampleDataAction(form: FormData): Promise<void> {
  const slug = field(form, "slug");
  const base = `/t/${encodeURIComponent(slug)}/settings`;
  if (field(form, "confirm") !== "1") redirect(`${base}?sample=confirm`);
  const requestHeaders = await headers();
  const { ensureRecentAuth } = await import("../../../../lib/auth-service.ts");
  const result = await guardedAction({ schema }, async (input, ctx) => {
    const principal = ctx.principal;
    if (principal === null) throw new Error("unreachable: principal required");
    const db = getAppDb();
    await limitVerifiedTenant({ db, principal, tenantSlug: input.slug, permission: "settings.manage" }, ctx);
    return clearSampleData({ db, principal, tenantSlug: input.slug, recentAuth: () => ensureRecentAuth(requestHeaders) });
  })({ slug });
  if (!result.ok) {
    if (result.error.code === "VALIDATION_FAILED" && result.error.detail === "IN_USE") redirect(`${base}?sample=in_use`);
    if (result.error.code === "UNAUTHENTICATED" && result.error.detail === "RECENT_AUTH_REQUIRED") redirect(`${base}?sample=reauth`);
    redirect(`${base}?error=${encodeURIComponent(result.error.code)}`);
  }
  redirect(`${base}?sample=${result.data.mode.toLowerCase()}`);
}
