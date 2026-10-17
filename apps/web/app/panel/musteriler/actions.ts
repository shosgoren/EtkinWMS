"use server";
// Müşteri işlemleri (T-403, ADR-027 §3): askıya al (gerekçe zorunlu) / devam ettir / denemeyi 30 gün uzat / paketi değiştir. İnce giriş
// katmanı: Origin + hız sınırı + hata maskeleme `createProductionGuard`'da (panel kipi); operatör/MFA/yakın zamanda doğrulama domain'de,
// durum kuralları veritabanı işlevinde (0042).
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { changeCustomerPlan, extendCustomerTrial, setCustomerSuspended } from "@wms/domain/platform/customers";
import { createProductionGuard } from "../../../lib/action-guard.ts";
import { appSurface } from "../../../lib/surface.ts";

const PATH = "/musteriler";
const INTERNAL_PATH = "/panel/musteriler";
const guardedAction = createProductionGuard(() => headers(), undefined, "panel");
const schema = z
  .object({
    id: z.string().max(64),
    intent: z.enum(["SUSPEND", "RESUME", "EXTEND", "PLAN"]),
    reason: z.string().max(2000),
    plan: z.string().max(64),
  })
  .strict();

export interface CustomerActionState {
  readonly error?: string;
}

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

export async function customerAction(_prev: CustomerActionState, form: FormData): Promise<CustomerActionState> {
  if (appSurface() !== "panel") notFound();
  const requestHeaders = await headers();
  const { ensureRecentAuth } = await import("../../../lib/auth-service.ts");
  const id = field(form, "id");
  const back = `${PATH}?m=${encodeURIComponent(id)}`;
  const result = await guardedAction({ schema }, async (input, ctx) => {
    const common = { db: getAppDb(), principal: ctx.principal, tenantId: input.id, recentAuth: () => ensureRecentAuth(requestHeaders) };
    if (input.intent === "EXTEND") await extendCustomerTrial(common);
    else if (input.intent === "PLAN") await changeCustomerPlan({ ...common, planId: input.plan });
    else await setCustomerSuspended({ ...common, suspend: input.intent === "SUSPEND", reason: input.reason });
    return true;
  })({ id, intent: field(form, "intent"), reason: field(form, "reason"), plan: field(form, "plan") });
  if (!result.ok) {
    if (result.error.code === "UNAUTHENTICATED") {
      redirect(`/login?${result.error.detail === "RECENT_AUTH_REQUIRED" ? "reauth=1&" : ""}next=${encodeURIComponent(back)}`);
    }
    if (result.error.code === "FORBIDDEN" && result.error.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(back)}`);
    revalidatePath(INTERNAL_PATH);
    return { error: result.error.detail === undefined ? result.error.code : `${result.error.code}/${result.error.detail}` };
  }
  revalidatePath(INTERNAL_PATH);
  return {};
}
