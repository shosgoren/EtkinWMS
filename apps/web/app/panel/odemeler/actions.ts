"use server";
// Ödemeler (T-406, ADR-027 §8): dönem tahakkuku ve elle "ödendi" kaydı. İnce giriş katmanı: Origin + hız sınırı + hata maskeleme
// `createProductionGuard`'da (panel kipi); operatör/MFA/yakın zamanda doğrulama domain'de, kurallar veritabanı işlevinde (0043).
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { accrueCharges, markChargePaid } from "@wms/domain/platform/charges";
import { createProductionGuard } from "../../../lib/action-guard.ts";
import { appSurface } from "../../../lib/surface.ts";

const PATH = "/odemeler";
const INTERNAL_PATH = "/panel/odemeler";
const guardedAction = createProductionGuard(() => headers(), undefined, "panel");
const schema = z
  .object({
    intent: z.enum(["PAID", "ACCRUE"]),
    id: z.string().max(64),
    paidOn: z.string().max(32),
    method: z.string().max(16),
    note: z.string().max(2000),
  })
  .strict();

export interface PaymentActionState {
  readonly error?: string;
  /** Dönem tahakkukunda açılan adet. */
  readonly accrued?: number;
}

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

/** gg.aa.yyyy → yyyy-aa-gg (biçimsizse olduğu gibi; domain reddeder). */
function isoDay(v: string): string {
  const m = /^\s*(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s*$/.exec(v);
  if (m === null) return v.trim();
  return `${m[3]}-${(m[2] ?? "").padStart(2, "0")}-${(m[1] ?? "").padStart(2, "0")}`;
}

export async function paymentAction(_prev: PaymentActionState, form: FormData): Promise<PaymentActionState> {
  if (appSurface() !== "panel") notFound();
  const requestHeaders = await headers();
  const { ensureRecentAuth } = await import("../../../lib/auth-service.ts");
  const result = await guardedAction({ schema }, async (input, ctx) => {
    const common = { db: getAppDb(), principal: ctx.principal, recentAuth: () => ensureRecentAuth(requestHeaders) };
    if (input.intent === "ACCRUE") return { accrued: await accrueCharges(common) };
    await markChargePaid({ ...common, chargeId: input.id, paidOn: isoDay(input.paidOn), method: input.method, note: input.note });
    return {};
  })({ intent: field(form, "intent"), id: field(form, "id"), paidOn: field(form, "paidOn"), method: field(form, "method"), note: field(form, "note") });
  if (!result.ok) {
    if (result.error.code === "UNAUTHENTICATED") {
      redirect(`/login?${result.error.detail === "RECENT_AUTH_REQUIRED" ? "reauth=1&" : ""}next=${encodeURIComponent(PATH)}`);
    }
    if (result.error.code === "FORBIDDEN" && result.error.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(PATH)}`);
    revalidatePath(INTERNAL_PATH);
    return { error: result.error.detail === undefined ? result.error.code : `${result.error.code}/${result.error.detail}` };
  }
  revalidatePath(INTERNAL_PATH);
  return result.data;
}
