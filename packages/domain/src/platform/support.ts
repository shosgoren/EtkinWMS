// Panel · Destek gelen kutusu (T-967, B-84; 0054). Bütün erişim `wms_probe.platform_support_*` SECURITY DEFINER işlevleriyle (operatör
// listesi + oturum MFA'sı; işlev operatörü yeniden denetler). Yanıt ve durum değişikliği `security_events` `platform.support.*` olarak
// denetlenir (tenant + talep kimliği; içerik yok). Talep metni yalnız operatör ekranına gider; loga yazılmaz (G-09).
import { sql } from "drizzle-orm";
import { withUser } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import type { AccessDbClient, AccessPrincipal } from "../identity/access.ts";
import { supportBodyOf, type SupportAuthorKind, type SupportStatus, type SupportSubject } from "../support/tickets.ts";
import { mapPlatformError, principalOrThrow } from "./demo-requests.ts";

export interface SupportInboxRow {
  readonly id: string;
  readonly number: number;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantSlug: string;
  readonly subjectKind: SupportSubject;
  readonly status: SupportStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly messageCount: number;
  readonly lastAuthor: SupportAuthorKind;
  readonly preview: string;
  readonly authorName: string | null;
}

export interface SupportTicketDetail extends SupportInboxRow {
  readonly body: string;
  readonly context: { readonly route: string | null; readonly appVersion: string | null; readonly supportCode: string | null; readonly userAgent: string | null };
  readonly messages: readonly { readonly id: string; readonly authorKind: SupportAuthorKind; readonly body: string; readonly createdAt: Date }[];
}

export type SupportInboxFilter = SupportStatus | "ALL";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT = 200;

interface Base {
  readonly db: AccessDbClient;
  readonly principal: AccessPrincipal | null;
}

function idOf(v: unknown): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new AppError("VALIDATION_FAILED");
  return v.toLowerCase();
}

function date(v: unknown): Date {
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new AppError("INTERNAL");
  return d;
}

type DbRow = {
  id: string;
  number: number | string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  subject_kind: SupportSubject;
  status: SupportStatus;
  created_at: Date | string;
  updated_at: Date | string;
  author_name: string | null;
};

function rowOf(r: DbRow & { message_count?: number | string; last_author?: string; preview?: string }, fallbackPreview = ""): SupportInboxRow {
  return {
    id: r.id,
    number: Number(r.number),
    tenantId: r.tenant_id,
    tenantName: r.tenant_name,
    tenantSlug: r.tenant_slug,
    subjectKind: r.subject_kind,
    status: r.status,
    createdAt: date(r.created_at),
    updatedAt: date(r.updated_at),
    messageCount: Number(r.message_count ?? 0),
    lastAuthor: r.last_author === "OPERATOR" ? "OPERATOR" : "CUSTOMER",
    preview: r.preview ?? fallbackPreview,
    authorName: r.author_name,
  };
}

/** WhatsApp (CallMeBot) bildirimi yapılandırılmış mı: yalnız anahtar varlığı (değer okunmaz/gösterilmez). */
export function isSupportWhatsAppConfigured(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.CALLMEBOT_PHONE ?? "").trim() !== "" && (env.CALLMEBOT_APIKEY ?? "").trim() !== "";
}

/** Gelen kutusu: durum süzgeci (varsayılan ALL) ve isteğe bağlı müşteri; en yeni güncellenen önce. `openCount` rozet içindir (OPEN). */
export async function listSupportInbox(
  params: Base & { readonly status?: SupportInboxFilter; readonly tenantId?: string },
): Promise<{ readonly rows: readonly SupportInboxRow[]; readonly openCount: number }> {
  const principal = principalOrThrow(params.principal);
  const status = params.status ?? "ALL";
  if (!["ALL", "OPEN", "ANSWERED", "CLOSED"].includes(status)) throw new AppError("VALIDATION_FAILED");
  const tenant = params.tenantId === undefined ? null : idOf(params.tenantId);
  try {
    const out = await withUser(params.db, principal.userId, async (tx) => {
      const rows = await tx.execute<DbRow & { message_count: number | string; last_author: string; preview: string }>(
        sql`SELECT * FROM wms_probe.platform_support_list(${status}, ${tenant}::uuid, ${LIMIT}::integer)`,
      );
      const open = await tx.execute<{ n: number | string }>(sql`SELECT wms_probe.platform_support_open_count() AS n`);
      return { rows, open: Number(open[0]?.n ?? 0) };
    });
    const rows = out.rows
      .map((r) => rowOf(r))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id))
      .slice(0, LIMIT);
    return { rows, openCount: out.open };
  } catch (e) {
    throw mapPlatformError(e);
  }
}

export async function countOpenSupportTickets(params: Base): Promise<number> {
  const principal = principalOrThrow(params.principal);
  try {
    const rows = await withUser(params.db, principal.userId, (tx) =>
      tx.execute<{ n: number | string }>(sql`SELECT wms_probe.platform_support_open_count() AS n`),
    );
    return Number(rows[0]?.n ?? 0);
  } catch (e) {
    throw mapPlatformError(e);
  }
}

export async function getSupportTicket(params: Base & { readonly ticketId: string }): Promise<SupportTicketDetail> {
  const principal = principalOrThrow(params.principal);
  const id = idOf(params.ticketId);
  try {
    return await withUser(params.db, principal.userId, async (tx) => {
      const rows = await tx.execute<DbRow & { body: string; context: Record<string, unknown> | null }>(
        sql`SELECT * FROM wms_probe.platform_support_get(${id}::uuid)`,
      );
      const r = rows[0];
      if (r === undefined) throw new AppError("NOT_FOUND");
      const msgs = await tx.execute<{ id: string; author_kind: SupportAuthorKind; body: string; created_at: Date | string }>(
        sql`SELECT * FROM wms_probe.platform_support_messages(${id}::uuid)`,
      );
      const ctx = r.context ?? {};
      const str = (k: string): string | null => (typeof ctx[k] === "string" ? (ctx[k] as string) : null);
      const last = msgs[msgs.length - 1];
      return {
        ...rowOf({ ...r, message_count: msgs.length, last_author: last?.author_kind ?? "CUSTOMER" }, r.body.slice(0, 140)),
        body: r.body,
        context: { route: str("route"), appVersion: str("app_version"), supportCode: str("support_code"), userAgent: str("user_agent") },
        messages: msgs.map((m) => ({ id: m.id, authorKind: m.author_kind, body: m.body, createdAt: date(m.created_at) })),
      };
    });
  } catch (e) {
    throw mapPlatformError(e);
  }
}

/** Operatör yanıtı: talep ANSWERED olur, müşteri ekranına döner. Kapalı talep → VERSION_CONFLICT. */
export async function replySupportTicket(params: Base & { readonly ticketId: string; readonly body: string }): Promise<{ readonly messageId: string }> {
  const principal = principalOrThrow(params.principal);
  const id = idOf(params.ticketId);
  const body = supportBodyOf(params.body);
  try {
    const rows = await withUser(params.db, principal.userId, (tx) =>
      tx.execute<{ id: string }>(sql`SELECT wms_probe.platform_support_reply(${id}::uuid, ${body}) AS id`),
    );
    const messageId = rows[0]?.id;
    if (messageId === undefined) throw new AppError("INTERNAL");
    return { messageId };
  } catch (e) {
    throw mapPlatformError(e);
  }
}

/** Operatör durum değişikliği (OPEN ya da CLOSED). Değişmediyse `false`. */
export async function setSupportTicketStatus(params: Base & { readonly ticketId: string; readonly status: "OPEN" | "CLOSED" }): Promise<boolean> {
  const principal = principalOrThrow(params.principal);
  const id = idOf(params.ticketId);
  if (params.status !== "OPEN" && params.status !== "CLOSED") throw new AppError("VALIDATION_FAILED");
  try {
    const rows = await withUser(params.db, principal.userId, (tx) =>
      tx.execute<{ changed: boolean }>(sql`SELECT wms_probe.platform_support_set_status(${id}::uuid, ${params.status}) AS changed`),
    );
    return rows[0]?.changed === true;
  } catch (e) {
    throw mapPlatformError(e);
  }
}

/** Kapat (kısayol). */
export function closeSupportTicket(params: Base & { readonly ticketId: string }): Promise<boolean> {
  return setSupportTicketStatus({ ...params, status: "CLOSED" });
}
