"use server";
// T-967 (B-84): Destek talebi — müşteri tarafı sunucu aksiyonları. İnce giriş: zod + domain komutu; görünürlük ve hız sınırı DB'dedir
// (0054 RLS + tetikleyici). Tarayıcı kimliği (user agent) istemciden değil istek başlığından alınır. Not metni loga yazılmaz.
import { headers } from "next/headers";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import {
  SUPPORT_BODY_MAX,
  SUPPORT_SUBJECTS,
  countUnreadSupportReplies,
  createTicket,
  listMyTickets,
  markMyTicketsSeen,
  replyAsCustomer,
  type MySupportTicket,
} from "@wms/domain/support/tickets";
import { createConsoleLogger } from "@wms/shared/log";
import { createProductionGuard, limitVerifiedTenant, type ActionContext } from "../../../lib/action-guard.ts";
import { getSenderQueue } from "../../../lib/queue.ts";

const guardedAction = createProductionGuard(() => headers());
const logger = createConsoleLogger("web");
const slug = z.string().min(1).max(63);
const body = z.string().min(1).max(SUPPORT_BODY_MAX);
const ctxText = (max: number) => z.string().max(max).nullable();

const submitSchema = z
  .object({
    slug,
    subjectKind: z.enum(SUPPORT_SUBJECTS),
    body,
    context: z.object({ route: ctxText(300), appVersion: ctxText(40), supportCode: ctxText(80) }).strict(),
  })
  .strict();
const listSchema = z.object({ slug }).strict();
const replySchema = z.object({ slug, ticketId: z.string().uuid(), body }).strict();

export interface SupportTicketView {
  readonly id: string;
  readonly number: number;
  readonly subjectKind: MySupportTicket["subjectKind"];
  readonly body: string;
  readonly status: MySupportTicket["status"];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly unreadReply: boolean;
  readonly messages: readonly { readonly id: string; readonly authorKind: "CUSTOMER" | "OPERATOR"; readonly body: string; readonly createdAt: string; readonly mine: boolean }[];
}

function access(tenantSlug: string, ctx: ActionContext) {
  if (ctx.principal === null) throw new Error("unreachable: principal required");
  return { db: getAppDb(), principal: ctx.principal, tenantSlug };
}

async function writeAccess(tenantSlug: string, ctx: ActionContext) {
  const a = access(tenantSlug, ctx);
  await limitVerifiedTenant({ ...a, permission: "stock.view" }, ctx);
  return a;
}

function view(t: MySupportTicket): SupportTicketView {
  return {
    id: t.id,
    number: t.number,
    subjectKind: t.subjectKind,
    body: t.body,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    unreadReply: t.unreadReply,
    messages: t.messages.map((m) => ({ id: m.id, authorKind: m.authorKind, body: m.body, createdAt: m.createdAt.toISOString(), mine: m.mine })),
  };
}

export async function submitSupportTicketAction(raw: unknown) {
  const userAgent = (await headers()).get("user-agent");
  const queue = await getSenderQueue(); // transaction dışında başlatılır; yoksa talep yine kaydedilir (panel rozeti asıl kayıt)
  return guardedAction({ schema: submitSchema }, async (i, ctx) => {
    const r = await createTicket(
      await writeAccess(i.slug, ctx),
      { subjectKind: i.subjectKind, body: i.body, context: { ...i.context, userAgent }, requestId: ctx.requestId },
      { queue, log: (e) => logger.error("support.notify enqueue failed", { error: e.error, ...(typeof e.code === "string" ? { code: e.code } : {}) }) },
    );
    return { ticketId: r.ticketId, number: r.number };
  })(raw);
}

export async function listMySupportTicketsAction(raw: unknown) {
  return guardedAction({ schema: listSchema }, async (i, ctx) => {
    const a = access(i.slug, ctx);
    const [tickets, unread] = await Promise.all([listMyTickets(a), countUnreadSupportReplies(a)]);
    return { tickets: tickets.map(view), unread };
  })(raw);
}

export async function replySupportTicketAction(raw: unknown) {
  return guardedAction({ schema: replySchema }, async (i, ctx) =>
    replyAsCustomer(await writeAccess(i.slug, ctx), { ticketId: i.ticketId, body: i.body, requestId: ctx.requestId }),
  )(raw);
}

export async function markSupportSeenAction(raw: unknown) {
  return guardedAction({ schema: listSchema }, async (i, ctx) => {
    await markMyTicketsSeen(await writeAccess(i.slug, ctx));
    return { seen: true as const };
  })(raw);
}
