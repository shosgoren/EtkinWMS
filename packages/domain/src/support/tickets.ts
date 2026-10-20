// Destek talebi — müşteri tarafı (T-967, B-84; 0054). Her ACTIVE üye talep açar (rol şartı yok: `stock.view` her rolde vardır). Görünürlük
// DB'dedir (RLS): üye yalnız kendi talebini, hesap yöneticisi (TENANT_ADMIN) firmanın bütün taleplerini görür. Hız sınırı (10 dakikada 5
// talep / 20 yanıt) DB tetikleyicisindedir; aşım `RATE_LIMITED`. Yeni talep aynı transaction'da `support.notify` işini kuyruğa yazar
// (savepoint: kuyruk yoksa talep yine kaydedilir; asıl kayıt panel rozetidir). Not metni ve bağlam audit'e/loga yazılmaz.
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import type { JobQueue } from "@wms/shared/queue";
import { runTenantCommand, runTenantQuery, type AccessTx, type TenantAccessParams } from "../identity/access.ts";

export const SUPPORT_SUBJECTS = ["BUG", "HOWTO", "IDEA", "OTHER"] as const;
export type SupportSubject = (typeof SUPPORT_SUBJECTS)[number];
export type SupportStatus = "OPEN" | "ANSWERED" | "CLOSED";
export type SupportAuthorKind = "CUSTOMER" | "OPERATOR";

export const SUPPORT_BODY_MAX = 2000;
const CONTEXT_FIELD_MAX = { route: 300, app_version: 40, support_code: 80, user_agent: 400 } as const;
const LIST_LIMIT = 20;
/** Tenant başına bildirim üst sınırı (güvenlik incelemesi MINOR-2): 10 dakikada en çok 3 WhatsApp; fazlası yalnız panel rozetinde. */
export const SUPPORT_NOTIFY_LIMIT = { limit: 3, windowSeconds: 600 } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Omit<TenantAccessParams, "permission" | "recentAuth">;

export interface SupportContextInput {
  readonly route?: string | null;
  readonly appVersion?: string | null;
  readonly supportCode?: string | null;
  readonly userAgent?: string | null;
}

export interface MySupportMessage {
  readonly id: string;
  readonly authorKind: SupportAuthorKind;
  readonly body: string;
  readonly createdAt: Date;
  /** Bu mesajı çağıran kullanıcı mı yazdı. */
  readonly mine: boolean;
}

export interface MySupportTicket {
  readonly id: string;
  readonly number: number;
  readonly subjectKind: SupportSubject;
  readonly body: string;
  readonly status: SupportStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Ekip yanıtı, müşterinin son görmesinden yeni mi (yalnız kendi talebinde). */
  readonly unreadReply: boolean;
  readonly mine: boolean;
  readonly messages: readonly MySupportMessage[];
}

export interface SupportDeps {
  readonly queue?: Pick<JobQueue<AccessTx>, "enqueue"> | undefined;
  readonly log?: (entry: Record<string, unknown>) => void;
}

function sqlstateOf(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 6 && cur !== undefined && cur !== null; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/** DB retleri: hız sınırı → RATE_LIMITED, kapalı talep → VERSION_CONFLICT, yetkisiz (demo, üyelik) → FORBIDDEN. */
function mapSupportError(e: unknown): unknown {
  // `runTenantCommand` tanımadığı DB hatasını INTERNAL'a sarar; kök SQLSTATE `cause` zincirinde kalır.
  if (e instanceof AppError && e.code !== "INTERNAL") return e;
  const state = sqlstateOf(e);
  const wrap = (code: "RATE_LIMITED" | "VERSION_CONFLICT" | "FORBIDDEN" | "VALIDATION_FAILED"): AppError => {
    const err = new AppError(code);
    err.cause = e;
    return err;
  };
  if (state === "P0429") return wrap("RATE_LIMITED");
  if (state === "55000") return wrap("VERSION_CONFLICT");
  if (state === "42501") return wrap("FORBIDDEN");
  if (state === "23514" || state === "22023") return wrap("VALIDATION_FAILED");
  return e;
}

export function supportBodyOf(v: unknown): string {
  if (typeof v !== "string") throw new AppError("VALIDATION_FAILED");
  const s = v.trim();
  if (s.length === 0 || s.length > SUPPORT_BODY_MAX) throw new AppError("VALIDATION_FAILED");
  return s;
}

function subjectOf(v: unknown): SupportSubject {
  if (typeof v !== "string" || !(SUPPORT_SUBJECTS as readonly string[]).includes(v)) throw new AppError("VALIDATION_FAILED");
  return v as SupportSubject;
}

function uuidOf(v: unknown): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new AppError("VALIDATION_FAILED");
  return v.toLowerCase();
}

/** Bağlam: yalnız bilinen dört alan, denetim karakteri temizlenir, alan başına kesilir; boşlar atılır. */
export function supportContextOf(input: SupportContextInput | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (input === null || input === undefined) return out;
  const put = (key: keyof typeof CONTEXT_FIELD_MAX, v: unknown): void => {
    if (typeof v !== "string") return;
    const s = v.replace(/\p{Cc}/gu, " ").trim().slice(0, CONTEXT_FIELD_MAX[key]);
    if (s !== "") out[key] = s;
  };
  put("route", input.route);
  put("app_version", input.appVersion);
  put("support_code", input.supportCode);
  put("user_agent", input.userAgent);
  return out;
}

function date(v: unknown): Date {
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new AppError("INTERNAL");
  return d;
}

export interface CreateTicketInput {
  readonly subjectKind: SupportSubject;
  readonly body: string;
  readonly context?: SupportContextInput | null;
  readonly requestId?: string | null;
}

export async function createTicket(
  params: Params,
  input: CreateTicketInput,
  deps: SupportDeps = {},
): Promise<{ readonly ticketId: string; readonly number: number; readonly notifyQueued: boolean }> {
  const subject = subjectOf(input.subjectKind);
  const body = supportBodyOf(input.body);
  const context = supportContextOf(input.context);
  try {
    return await runTenantCommand({ ...params, permission: "stock.view" }, async (tx, m) => {
      const rows = await tx.execute<{ id: string; number: number | string }>(sql`
        INSERT INTO public.support_tickets (tenant_id, created_by, membership_id, subject_kind, body, context)
        VALUES (${m.tenantId}::uuid, ${m.userId}::uuid, ${m.membershipId}::uuid, ${subject}, ${body}, ${JSON.stringify(context)}::jsonb)
        RETURNING id, number`);
      const r = rows[0];
      if (r === undefined) throw new AppError("INTERNAL");
      const number = Number(r.number);
      await appendAudit(tx, {
        action: "support.ticket_created",
        actorUserId: m.userId,
        entityType: "support_ticket",
        entityId: r.id,
        requestId: input.requestId ?? null,
        // Not ve bağlam audit'e yazılmaz (kişisel ifade, cihaz bilgisi): yalnız konu ve numara.
        changeSummary: { subject_kind: subject, number },
      });
      let notifyQueued = false;
      // Tenant kovası talep kaydedildikten SONRA ve AYNI transaction'da tüketilir (inceleme MINOR-1 · 2. tur: ikinci havuz bağlantısı istenmez;
      // geri alınan talep kovayı tüketmez; reddedilen/yetkisiz deneme başka tenant'ın kovasına ulaşmaz). `request_rate_limits` platform
      // tablosudur (RLS yok), sabit pencere `consumeRateLimit` ile aynı; anahtar tenant kimliğinin özeti.
      let allowed = false;
      if (deps.queue !== undefined) {
        const windowMs = SUPPORT_NOTIFY_LIMIT.windowSeconds * 1000;
        const start = new Date(Math.floor(Date.now() / windowMs) * windowMs).toISOString();
        const key = createHash("sha256").update(`support.notify:${m.tenantId}`).digest("hex");
        const bucket = await tx.execute<{ count: number | string }>(sql`
          INSERT INTO public.request_rate_limits (scope, key_hash, window_start, count)
          VALUES ('support.notify', ${key}, ${start}::timestamptz, 1)
          ON CONFLICT (scope, key_hash, window_start) DO UPDATE SET count = public.request_rate_limits.count + 1
          RETURNING count`);
        allowed = Number(bucket[0]?.count ?? Number.POSITIVE_INFINITY) <= SUPPORT_NOTIFY_LIMIT.limit;
      }
      if (deps.queue !== undefined && allowed) {
        const queue = deps.queue;
        try {
          await tx.transaction((sp) => queue.enqueue(sp, { type: "support.notify", actorUserId: m.userId, payload: { ticketId: r.id, ticketNo: number } }));
          notifyQueued = true;
        } catch (cause) {
          const c = cause as { name?: unknown; code?: unknown } | null;
          deps.log?.({
            level: "error",
            msg: "support.notify enqueue failed",
            error: typeof c?.name === "string" ? c.name : "unknown",
            ...(typeof c?.code === "string" ? { code: c.code } : {}),
          });
        }
      }
      return { ticketId: r.id, number, notifyQueued };
    });
  } catch (e) {
    throw mapSupportError(e);
  }
}

type TicketRow = {
  id: string;
  number: number | string;
  subject_kind: SupportSubject;
  body: string;
  status: SupportStatus;
  created_at: Date | string;
  updated_at: Date | string;
  created_by: string;
  operator_replied_at: Date | string | null;
  customer_seen_at: Date | string | null;
};

/** Çağıranın görebildiği talepler (RLS): üye kendi talepleri; hesap yöneticisi firmanın bütün talepleri. En yeni 20, yazışmasıyla. */
export async function listMyTickets(params: Params): Promise<readonly MySupportTicket[]> {
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, m) => {
    const tickets = await tx.execute<TicketRow>(sql`
      SELECT id, number, subject_kind, body, status, created_at, updated_at, created_by, operator_replied_at, customer_seen_at
        FROM public.support_tickets WHERE tenant_id = ${m.tenantId}::uuid
       ORDER BY updated_at DESC, id LIMIT ${LIST_LIMIT}`);
    if (tickets.length === 0) return [];
    const ids = `{${tickets.map((t) => t.id).join(",")}}`;
    const msgs = await tx.execute<{ id: string; ticket_id: string; author_kind: SupportAuthorKind; author_user_id: string; body: string; created_at: Date | string }>(sql`
      SELECT id, ticket_id, author_kind, author_user_id, body, created_at FROM public.support_ticket_messages
       WHERE tenant_id = ${m.tenantId}::uuid AND ticket_id = ANY(${ids}::uuid[]) ORDER BY created_at, id`);
    return tickets.map((t): MySupportTicket => {
      const mine = t.created_by === m.userId;
      const replied = t.operator_replied_at === null ? null : date(t.operator_replied_at);
      const seen = t.customer_seen_at === null ? null : date(t.customer_seen_at);
      return {
        id: t.id,
        number: Number(t.number),
        subjectKind: t.subject_kind,
        body: t.body,
        status: t.status,
        createdAt: date(t.created_at),
        updatedAt: date(t.updated_at),
        unreadReply: mine && replied !== null && (seen === null || seen.getTime() < replied.getTime()),
        mine,
        messages: msgs
          .filter((x) => x.ticket_id === t.id)
          .map((x) => ({ id: x.id, authorKind: x.author_kind, body: x.body, createdAt: date(x.created_at), mine: x.author_user_id === m.userId })),
      };
    });
  });
}

/** Okunmamış ekip yanıtı olan kendi talep sayısı (üst çubuk dikkat işareti). */
export async function countUnreadSupportReplies(params: Params): Promise<number> {
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, m) => {
    const rows = await tx.execute<{ n: number | string }>(sql`
      SELECT count(*) AS n FROM public.support_tickets
       WHERE tenant_id = ${m.tenantId}::uuid AND created_by = ${m.userId}::uuid AND operator_replied_at IS NOT NULL
         AND (customer_seen_at IS NULL OR customer_seen_at < operator_replied_at)`);
    return Number(rows[0]?.n ?? 0);
  });
}

/** Kendi taleplerindeki ekip yanıtlarını görüldü işaretler (zaman DB'de `now()`). Dönüş: işaretlenen talep sayısı. */
export async function markMyTicketsSeen(params: Params): Promise<number> {
  try {
    return await runTenantCommand({ ...params, permission: "stock.view" }, async (tx, m) => {
      const rows = await tx.execute<{ id: string }>(sql`
        UPDATE public.support_tickets SET customer_seen_at = now()
         WHERE tenant_id = ${m.tenantId}::uuid AND created_by = ${m.userId}::uuid AND operator_replied_at IS NOT NULL
           AND (customer_seen_at IS NULL OR customer_seen_at < operator_replied_at)
        RETURNING id`);
      return rows.length;
    });
  } catch (e) {
    throw mapSupportError(e);
  }
}

/** Müşteri yanıtı: görünür (RLS) ve kapalı olmayan talebe; ekip yanıtlamışsa talep yeniden OPEN olur. */
export async function replyAsCustomer(
  params: Params,
  input: { readonly ticketId: string; readonly body: string; readonly requestId?: string | null },
): Promise<{ readonly messageId: string }> {
  const ticketId = uuidOf(input.ticketId);
  const body = supportBodyOf(input.body);
  try {
    return await runTenantCommand({ ...params, permission: "stock.view" }, async (tx, m) => {
      const t = await tx.execute<{ status: SupportStatus }>(
        sql`SELECT status FROM public.support_tickets WHERE tenant_id = ${m.tenantId}::uuid AND id = ${ticketId}::uuid FOR UPDATE`,
      );
      const status = t[0]?.status;
      if (status === undefined) throw new AppError("NOT_FOUND");
      if (status === "CLOSED") throw new AppError("VERSION_CONFLICT");
      const rows = await tx.execute<{ id: string }>(sql`
        INSERT INTO public.support_ticket_messages (tenant_id, ticket_id, author_kind, author_user_id, body)
        VALUES (${m.tenantId}::uuid, ${ticketId}::uuid, 'CUSTOMER', ${m.userId}::uuid, ${body}) RETURNING id`);
      const id = rows[0]?.id;
      if (id === undefined) throw new AppError("INTERNAL");
      if (status === "ANSWERED") {
        await tx.execute(sql`UPDATE public.support_tickets SET status = 'OPEN' WHERE tenant_id = ${m.tenantId}::uuid AND id = ${ticketId}::uuid`);
      }
      await appendAudit(tx, {
        action: "support.ticket_replied",
        actorUserId: m.userId,
        entityType: "support_ticket",
        entityId: ticketId,
        requestId: input.requestId ?? null,
        changeSummary: { message_id: id, reopened: status === "ANSWERED" },
      });
      return { messageId: id };
    });
  } catch (e) {
    throw mapSupportError(e);
  }
}
