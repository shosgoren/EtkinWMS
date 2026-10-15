"use server";
// Operatör demo talebi kararı (T-994, ADR-026 §3). İnce giriş katmanı: Origin + hız sınırı + hata maskeleme `createProductionGuard`'da,
// iş kuralı `@wms/domain/platform/demo-requests`'te (operatör veritabanında zorlanır, MFA + yakın zamanda doğrulama domain'de).
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { decideDemoRequest } from "@wms/domain/platform/demo-requests";
import { getAppDb } from "@wms/db";
import { createProductionGuard } from "../../../lib/action-guard.ts";

const PATH = "/operator/demo-requests";
const guardedAction = createProductionGuard(() => headers());
const schema = z.object({ id: z.string().max(64), decision: z.enum(["APPROVED", "REJECTED"]) }).strict();

export async function decideDemoRequestAction(form: FormData): Promise<void> {
  const id = form.get("id");
  const decision = form.get("decision");
  const requestHeaders = await headers();
  const { ensureRecentAuth } = await import("../../../lib/auth-service.ts");
  const result = await guardedAction({ schema }, async (input, ctx) =>
    decideDemoRequest({
      db: getAppDb(),
      principal: ctx.principal,
      id: input.id,
      decision: input.decision,
      recentAuth: () => ensureRecentAuth(requestHeaders),
    }),
  )({ id: typeof id === "string" ? id : "", decision: typeof decision === "string" ? decision : "" });
  if (!result.ok) {
    if (result.error.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(PATH)}`);
    if (result.error.code === "FORBIDDEN" && result.error.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(PATH)}`);
    redirect(`${PATH}?error=${encodeURIComponent(result.error.code)}`);
  }
  redirect(PATH);
}
