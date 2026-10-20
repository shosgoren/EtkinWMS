"use server";
// Panel · Destek talebi işlemleri (T-967, B-84): yanıt yaz, durum değiştir (OPEN/CLOSED). İnce giriş katmanı: Origin + hız sınırı + hata
// maskeleme `createProductionGuard`'da (panel kipi); operatör/MFA denetimi domain'de ve veritabanı işlevinde (0054), denetim kaydı
// `security_events` `platform.support.*`. Yanıt metni loga yazılmaz.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { replySupportTicket, setSupportTicketStatus } from "@wms/domain/platform/support";
import { SUPPORT_BODY_MAX } from "@wms/domain/support/tickets";
import { createProductionGuard } from "../../../lib/action-guard.ts";
import { appSurface } from "../../../lib/surface.ts";

const PATH = "/support";
const INTERNAL_PATH = "/panel/support";
const guardedAction = createProductionGuard(() => headers(), undefined, "panel");
const replySchema = z.object({ id: z.string().uuid(), body: z.string().min(1).max(SUPPORT_BODY_MAX) }).strict();
const statusSchema = z.object({ id: z.string().uuid(), status: z.enum(["OPEN", "CLOSED"]) }).strict();

export interface SupportActionState {
  readonly error?: string;
  readonly ok?: boolean;
}

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

function finish(id: string, result: { ok: true } | { ok: false; error: { code: string; detail?: string | undefined } }): SupportActionState {
  const back = `${PATH}?t=${encodeURIComponent(id)}`;
  revalidatePath(INTERNAL_PATH);
  if (result.ok) return { ok: true };
  if (result.error.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(back)}`);
  if (result.error.code === "FORBIDDEN" && result.error.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(back)}`);
  return { error: result.error.detail === undefined ? result.error.code : `${result.error.code}/${result.error.detail}` };
}

export async function supportReplyAction(_prev: SupportActionState, form: FormData): Promise<SupportActionState> {
  if (appSurface() !== "panel") notFound();
  const id = field(form, "id");
  const result = await guardedAction({ schema: replySchema }, async (input, ctx) => {
    await replySupportTicket({ db: getAppDb(), principal: ctx.principal, ticketId: input.id, body: input.body });
    return true;
  })({ id, body: field(form, "body") });
  return finish(id, result.ok ? { ok: true } : { ok: false, error: result.error });
}

export async function supportStatusAction(_prev: SupportActionState, form: FormData): Promise<SupportActionState> {
  if (appSurface() !== "panel") notFound();
  const id = field(form, "id");
  const result = await guardedAction({ schema: statusSchema }, async (input, ctx) => {
    await setSupportTicketStatus({ db: getAppDb(), principal: ctx.principal, ticketId: input.id, status: input.status });
    return true;
  })({ id, status: field(form, "status") });
  return finish(id, result.ok ? { ok: true } : { ok: false, error: result.error });
}
