// T-967 (B-84, 0054): destek talebi. Gerçek wms_app bağlantısı; migration rolü yalnız kurulum/doğrulama/temizlik. Kabul:
// - her ACTIVE üye açar; üye yalnız KENDİ talebini, hesap yöneticisi (TENANT_ADMIN) firmanın bütün taleplerini görür; başka tenant hiçbirini;
// - ham SQL'de de (RLS + tetikleyici): başkası adına açma, durum/yanıt damgası yazma, operatör adına mesaj, kapalı talebe yazma reddedilir;
// - hız sınırı: kullanıcı başına 10 dakikada 5 talep → RATE_LIMITED;
// - operatör yolu: yalnız operatör (üye NOT_FOUND, MFA'sız MFA_REQUIRED), gelen kutusu/süzgeç/açık sayısı, ayrıntı + bağlam, yanıt → ANSWERED
//   + müşteride okunmamış yanıt, müşteri yanıtı → OPEN, kapat → CLOSED ve yazışma kapanır; denetim kaydı (audit + security_events);
// - `support.notify` aynı transaction'da kuyruğa (yük: yalnız kimlik + numara); kuyruk hatası talebi düşürmez; demo tenant'ta açılamaz.
// Fikstürler sentetik (G-09).
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import type { Job } from "../../../packages/shared/src/queue.ts";
import {
  countUnreadSupportReplies,
  createTicket,
  listMyTickets,
  markMyTicketsSeen,
  replyAsCustomer,
} from "../../../packages/domain/src/support/tickets.ts";
import {
  countOpenSupportTickets,
  getSupportTicket,
  listSupportInbox,
  replySupportTicket,
  setSupportTicketStatus,
} from "../../../packages/domain/src/platform/support.ts";
import { cleanupRegistry, mkMembership, mkUser, newRegistry, seedWorld, type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";

const env = readIntEnv(process.env);
const reg = newRegistry();
let app: DbClient;
let raw: pg.Client;
let adm: pg.Client;
let A: TenantWorld;
let B: TenantWorld;
let operatorId: string;
let operatorEmail: string;
let demoTenant: string | null = null;
let rateUser: string;

const op = () => ({ db: app, principal: { userId: operatorId, mfaVerified: true } });
const as = (userId: string, w: TenantWorld) => ({ db: app, principal: { userId, mfaVerified: true }, tenantSlug: w.slug });
const owner = (w: TenantWorld) => as(w.ownerUserId, w);
const member = (w: TenantWorld) => as(w.memberUserId, w);
const tag = (): string => randomBytes(3).toString("hex");

async function failure(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error("expected rejection");
}

/** wms_app ham bağlantısında tek transaction (tenant + kullanıcı bağlamı), daima ROLLBACK. */
async function asApp<T>(tenant: string, user: string, fn: (q: (text: string, params?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>): Promise<T> {
  await raw.query("BEGIN");
  try {
    await raw.query("SELECT set_config('app.current_tenant_id', $1, true), set_config('app.current_user_id', $2, true)", [tenant, user]);
    return await fn((text, params) => raw.query(text, params));
  } finally {
    await raw.query("ROLLBACK");
  }
}

async function sqlstate(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  raw = new pg.Client({ connectionString: env.databaseUrl });
  raw.on("error", () => undefined);
  await raw.connect();
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  await adm.connect();
  A = await seedWorld(adm, reg, "A967");
  B = await seedWorld(adm, reg, "B967");
  rateUser = await mkUser(adm, reg, "A967 rate");
  await mkMembership(adm, A.tenantId, rateUser, { roles: ["READ_ONLY"] });
  operatorEmail = `t967-op-${randomBytes(6).toString("hex")}@example.test`;
  const u = await adm.query<{ id: string }>(
    "INSERT INTO public.users (name, email, email_verified, two_factor_enabled) VALUES ('T967 op', $1, true, true) RETURNING id",
    [operatorEmail],
  );
  operatorId = (u.rows[0] as { id: string }).id;
  await adm.query("INSERT INTO wms_platform.operators (email_normalized) VALUES ($1)", [operatorEmail]);
}, 120_000);

afterAll(async () => {
  const tenants = [A?.tenantId, B?.tenantId, demoTenant].filter((x): x is string => typeof x === "string");
  await adm.query("BEGIN");
  try {
    await adm.query("SET LOCAL session_replication_role = replica"); // yazışma append-only tetikleyicisi yalnız temizlikte devre dışı
    await adm.query("DELETE FROM public.support_ticket_messages WHERE tenant_id = ANY($1::uuid[])", [tenants]);
    await adm.query("DELETE FROM public.support_tickets WHERE tenant_id = ANY($1::uuid[])", [tenants]);
    await adm.query("COMMIT");
  } catch {
    await adm.query("ROLLBACK");
  }
  if (demoTenant !== null) {
    await adm.query("DELETE FROM public.membership_roles WHERE tenant_id = $1", [demoTenant]).catch(() => undefined);
    await adm.query("DELETE FROM public.tenant_memberships WHERE tenant_id = $1", [demoTenant]).catch(() => undefined);
    await adm.query("DELETE FROM public.tenants WHERE id = $1", [demoTenant]).catch(() => undefined);
  }
  await cleanupRegistry(adm, reg).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.operators WHERE email_normalized = $1", [operatorEmail]).catch(() => undefined);
  await adm.end();
  await raw.end();
  await app.close();
}, 60_000);

const ctx = { route: "/t/x/pano", appVersion: "git-abc1234", supportCode: "d1g3st", userAgent: "Mozilla/5.0 test" };
let memberTicket: { ticketId: string; number: number };
let ownerTicket: { ticketId: string; number: number };
let bTicket: { ticketId: string; number: number };

describe("müşteri tarafı: açma ve görünürlük (RLS)", () => {
  it("her ACTIVE üye talep açar; numara artar; bildirim işi aynı transaction'da kuyruğa yazılır (yük yalnız kimlik + numara)", async () => {
    const jobs: Job[] = [];
    const queue = { enqueue: (_tx: unknown, job: Job) => { jobs.push(job); return Promise.resolve({ jobId: null }); } };
    memberTicket = await createTicket(member(A), { subjectKind: "BUG", body: "  Etiket basılmıyor  ", context: ctx }, { queue });
    ownerTicket = await createTicket(owner(A), { subjectKind: "IDEA", body: "Rapor önerisi" }, { queue });
    bTicket = await createTicket(owner(B), { subjectKind: "HOWTO", body: "B sorusu" });
    expect(memberTicket.number).toBeGreaterThan(0);
    expect(ownerTicket.number).toBeGreaterThan(memberTicket.number);
    expect(jobs).toEqual([
      { type: "support.notify", actorUserId: A.memberUserId, payload: { ticketId: memberTicket.ticketId, ticketNo: memberTicket.number } },
      { type: "support.notify", actorUserId: A.ownerUserId, payload: { ticketId: ownerTicket.ticketId, ticketNo: ownerTicket.number } },
    ]);
    const row = await adm.query("SELECT body, status, context, membership_id FROM public.support_tickets WHERE id = $1", [memberTicket.ticketId]);
    expect(row.rows[0]).toEqual({ body: "Etiket basılmıyor", status: "OPEN", context: { route: "/t/x/pano", app_version: "git-abc1234", support_code: "d1g3st", user_agent: "Mozilla/5.0 test" }, membership_id: A.memberMembershipId });
    const audit = await adm.query("SELECT action, change_summary FROM public.audit_logs WHERE entity_id = $1", [memberTicket.ticketId]);
    expect(audit.rows).toEqual([{ action: "support.ticket_created", change_summary: { subject_kind: "BUG", number: memberTicket.number } }]);
  });

  it("kuyruk yazımı başarısızsa talep yine kaydedilir (notifyQueued=false)", async () => {
    const queue = { enqueue: () => Promise.reject(Object.assign(new Error("down"), { code: "ECONNREFUSED" })) };
    const logs: Record<string, unknown>[] = [];
    const r = await createTicket(as(rateUser, A), { subjectKind: "OTHER", body: "kuyruk yok" }, { queue, log: (e) => logs.push(e) });
    expect(r.notifyQueued).toBe(false);
    expect(logs).toEqual([{ level: "error", msg: "support.notify enqueue failed", error: "Error", code: "ECONNREFUSED" }]);
    expect((await adm.query("SELECT 1 FROM public.support_tickets WHERE id = $1", [r.ticketId])).rowCount).toBe(1);
  });

  it("üye yalnız kendi talebini görür; hesap yöneticisi firmanın bütün taleplerini; başka tenant hiçbirini", async () => {
    const mine = await listMyTickets(member(A));
    expect(mine.map((t) => t.id)).toEqual([memberTicket.ticketId]);
    expect(mine[0]?.mine).toBe(true);
    const admin = (await listMyTickets(owner(A))).map((t) => t.id);
    expect(admin).toContain(memberTicket.ticketId);
    expect(admin).toContain(ownerTicket.ticketId);
    expect(admin).not.toContain(bTicket.ticketId);
    expect((await listMyTickets(owner(B))).map((t) => t.id)).toEqual([bTicket.ticketId]);
    expect((await listMyTickets(member(B))).length).toBe(0);
  });

  it("ham SQL: başka kullanıcının/tenant'ın talebi ve mesajı görünmez; bağlamsız 0 satır", async () => {
    await asApp(A.tenantId, A.memberUserId, async (q) => {
      expect((await q("SELECT id FROM public.support_tickets")).rows.map((r) => r.id)).toEqual([memberTicket.ticketId]);
      expect((await q("SELECT count(*)::int AS n FROM public.support_tickets WHERE id = ANY($1::uuid[])", [[ownerTicket.ticketId, bTicket.ticketId]])).rows[0]?.n).toBe(0);
    });
    await asApp(B.tenantId, B.ownerUserId, async (q) => {
      expect((await q("SELECT count(*)::int AS n FROM public.support_tickets WHERE tenant_id = $1", [A.tenantId])).rows[0]?.n).toBe(0);
    });
    await raw.query("BEGIN");
    try {
      expect((await raw.query("SELECT count(*)::int AS n FROM public.support_tickets")).rows[0]?.n).toBe(0);
    } finally {
      await raw.query("ROLLBACK");
    }
  });

  it("ham SQL: başkası adına açma, durum/yanıt damgası, operatör mesajı, başka talebe mesaj reddedilir", async () => {
    await asApp(A.tenantId, A.memberUserId, async (q) => {
      expect(await sqlstate(q("INSERT INTO public.support_tickets (tenant_id, created_by, membership_id, subject_kind, body) VALUES ($1, $2, $3, 'BUG', 'x')", [A.tenantId, A.ownerUserId, A.ownerMembershipId]))).toBe("42501");
    });
    await asApp(A.tenantId, A.memberUserId, async (q) => {
      expect(await sqlstate(q("UPDATE public.support_tickets SET status = 'CLOSED' WHERE id = $1", [memberTicket.ticketId]))).toBe("42501");
    });
    await asApp(A.tenantId, A.memberUserId, async (q) => {
      expect(await sqlstate(q("UPDATE public.support_tickets SET operator_replied_at = now() WHERE id = $1", [memberTicket.ticketId]))).toBe("42501");
    });
    await asApp(A.tenantId, A.memberUserId, async (q) => {
      expect(await sqlstate(q("UPDATE public.support_tickets SET body = 'x' WHERE id = $1", [memberTicket.ticketId]))).toBe("42501");
    });
    await asApp(A.tenantId, A.memberUserId, async (q) => {
      expect(await sqlstate(q("INSERT INTO public.support_ticket_messages (tenant_id, ticket_id, author_kind, author_user_id, body) VALUES ($1, $2, 'OPERATOR', $3, 'x')", [A.tenantId, memberTicket.ticketId, A.memberUserId]))).toBe("42501");
    });
    await asApp(A.tenantId, A.memberUserId, async (q) => {
      // Yöneticinin talebi üyeye görünmez: mesaj RLS WITH CHECK ile reddedilir.
      expect(await sqlstate(q("INSERT INTO public.support_ticket_messages (tenant_id, ticket_id, author_kind, author_user_id, body) VALUES ($1, $2, 'CUSTOMER', $3, 'x')", [A.tenantId, ownerTicket.ticketId, A.memberUserId]))).toBe("42501");
    });
    await asApp(A.tenantId, A.memberUserId, async (q) => {
      expect(await sqlstate(q("DELETE FROM public.support_tickets WHERE id = $1", [memberTicket.ticketId]))).toBe("42501");
    });
    expect((await failure(replyAsCustomer(member(A), { ticketId: ownerTicket.ticketId, body: "x" }))).code).toBe("NOT_FOUND");
    expect((await failure(replyAsCustomer(owner(B), { ticketId: memberTicket.ticketId, body: "x" }))).code).toBe("NOT_FOUND");
  });

  it("doğrulama: konu, boş/uzun metin reddedilir", async () => {
    expect((await failure(createTicket(member(A), { subjectKind: "X" as never, body: "x" }))).code).toBe("VALIDATION_FAILED");
    expect((await failure(createTicket(member(A), { subjectKind: "BUG", body: "   " }))).code).toBe("VALIDATION_FAILED");
    expect((await failure(createTicket(member(A), { subjectKind: "BUG", body: "x".repeat(2001) }))).code).toBe("VALIDATION_FAILED");
  });

  it("hız sınırı: kullanıcı başına 10 dakikada 5 talep; 6. RATE_LIMITED, başka kullanıcı etkilenmez", async () => {
    // rateUser yukarıda 1 talep açtı.
    for (let i = 0; i < 4; i++) await createTicket(as(rateUser, A), { subjectKind: "OTHER", body: `deneme ${i}` });
    expect((await failure(createTicket(as(rateUser, A), { subjectKind: "OTHER", body: "fazla" }))).code).toBe("RATE_LIMITED");
    expect((await adm.query("SELECT count(*)::int AS n FROM public.support_tickets WHERE created_by = $1", [rateUser])).rows[0]?.n).toBe(5);
    const other = await createTicket(owner(A), { subjectKind: "OTHER", body: "başka kullanıcı" });
    expect(other.number).toBeGreaterThan(0);
  });

  it("demo tenant'ta talep açılamaz", async () => {
    const d = await adm.query<{ id: string }>("INSERT INTO public.tenants (slug, name, is_demo) VALUES ($1, 'T967 demo', true) RETURNING id", [`t967-demo-${tag()}`]);
    demoTenant = (d.rows[0] as { id: string }).id;
    await mkMembership(adm, demoTenant, A.memberUserId, { roles: ["PICKER"] });
    const slug = (await adm.query<{ slug: string }>("SELECT slug FROM public.tenants WHERE id = $1", [demoTenant])).rows[0]?.slug ?? "";
    const e = await failure(createTicket({ db: app, principal: { userId: A.memberUserId, mfaVerified: true }, tenantSlug: slug }, { subjectKind: "BUG", body: "demo" }));
    expect(e.code).toBe("FORBIDDEN");
  });
});

describe("operatör yolu (panel)", () => {
  it("yalnız operatör: üye NOT_FOUND, MFA'sız MFA_REQUIRED", async () => {
    const m = { db: app, principal: { userId: A.ownerUserId, mfaVerified: true } };
    expect((await failure(listSupportInbox(m))).code).toBe("NOT_FOUND");
    expect((await failure(getSupportTicket({ ...m, ticketId: memberTicket.ticketId }))).code).toBe("NOT_FOUND");
    expect((await failure(replySupportTicket({ ...m, ticketId: memberTicket.ticketId, body: "x" }))).code).toBe("NOT_FOUND");
    expect((await failure(setSupportTicketStatus({ ...m, ticketId: memberTicket.ticketId, status: "CLOSED" }))).code).toBe("NOT_FOUND");
    expect((await failure(countOpenSupportTickets(m))).code).toBe("NOT_FOUND");
    expect((await failure(listSupportInbox({ db: app, principal: { userId: operatorId, mfaVerified: false } }))).detail).toBe("MFA_REQUIRED");
  });

  it("gelen kutusu: tüm müşteriler, müşteri süzgeci, durum süzgeci ve açık sayısı; demo yok", async () => {
    const all = await listSupportInbox(op());
    const ids = all.rows.map((r) => r.id);
    expect(ids).toContain(memberTicket.ticketId);
    expect(ids).toContain(bTicket.ticketId);
    const m = all.rows.find((r) => r.id === memberTicket.ticketId);
    expect(m).toMatchObject({ number: memberTicket.number, tenantId: A.tenantId, subjectKind: "BUG", status: "OPEN", messageCount: 0, lastAuthor: "CUSTOMER", preview: "Etiket basılmıyor", authorName: "T104 A967 member" });
    expect(all.openCount).toBeGreaterThanOrEqual(2);
    expect(await countOpenSupportTickets(op())).toBe(all.openCount);
    const onlyB = await listSupportInbox({ ...op(), tenantId: B.tenantId });
    expect(onlyB.rows.map((r) => r.id)).toEqual([bTicket.ticketId]);
    expect((await listSupportInbox({ ...op(), status: "CLOSED", tenantId: A.tenantId })).rows).toEqual([]);
    expect((await failure(listSupportInbox({ ...op(), status: "NOPE" as never }))).code).toBe("VALIDATION_FAILED");
  });

  it("ayrıntı bağlamla; yanıt → ANSWERED + müşteride okunmamış; okundu; müşteri yanıtı → OPEN; kapat → yazışma kapanır; denetim kaydı", async () => {
    const d = await getSupportTicket({ ...op(), ticketId: memberTicket.ticketId });
    expect(d.body).toBe("Etiket basılmıyor");
    expect(d.context).toEqual({ route: "/t/x/pano", appVersion: "git-abc1234", supportCode: "d1g3st", userAgent: "Mozilla/5.0 test" });
    expect(d.messages).toEqual([]);

    const { messageId } = await replySupportTicket({ ...op(), ticketId: memberTicket.ticketId, body: "Yazıcı ayarını kontrol edin" });
    let mine = (await listMyTickets(member(A)))[0];
    expect(mine?.status).toBe("ANSWERED");
    expect(mine?.unreadReply).toBe(true);
    expect(mine?.messages).toEqual([expect.objectContaining({ id: messageId, authorKind: "OPERATOR", body: "Yazıcı ayarını kontrol edin", mine: false })]);
    expect(await countUnreadSupportReplies(member(A))).toBe(1);
    // Hesap yöneticisi başkasının talebinde okunmamış rozeti almaz, okundu damgası da basamaz.
    expect(await countUnreadSupportReplies(owner(A))).toBe(0);
    expect(await markMyTicketsSeen(owner(A))).toBe(0);
    expect(await markMyTicketsSeen(member(A))).toBe(1);
    expect(await countUnreadSupportReplies(member(A))).toBe(0);
    expect((await listMyTickets(member(A)))[0]?.unreadReply).toBe(false);

    await replyAsCustomer(member(A), { ticketId: memberTicket.ticketId, body: "Denedim, olmadı" });
    mine = (await listMyTickets(member(A)))[0];
    expect(mine?.status).toBe("OPEN");
    expect(mine?.messages.map((x) => [x.authorKind, x.mine])).toEqual([["OPERATOR", false], ["CUSTOMER", true]]);
    // Hesap yöneticisi başkasının talebine yanıt verebilir.
    await replyAsCustomer(owner(A), { ticketId: memberTicket.ticketId, body: "Ben de bakıyorum" });

    const inbox = (await listSupportInbox({ ...op(), tenantId: A.tenantId })).rows.find((r) => r.id === memberTicket.ticketId);
    expect(inbox).toMatchObject({ messageCount: 3, lastAuthor: "CUSTOMER", status: "OPEN" });

    expect(await setSupportTicketStatus({ ...op(), ticketId: memberTicket.ticketId, status: "CLOSED" })).toBe(true);
    expect(await setSupportTicketStatus({ ...op(), ticketId: memberTicket.ticketId, status: "CLOSED" })).toBe(false);
    expect((await failure(replyAsCustomer(member(A), { ticketId: memberTicket.ticketId, body: "kapalı" }))).code).toBe("VERSION_CONFLICT");
    expect((await failure(replySupportTicket({ ...op(), ticketId: memberTicket.ticketId, body: "kapalı" }))).code).toBe("VERSION_CONFLICT");
    await asApp(A.tenantId, A.memberUserId, async (q) => {
      expect(await sqlstate(q("INSERT INTO public.support_ticket_messages (tenant_id, ticket_id, author_kind, author_user_id, body) VALUES ($1, $2, 'CUSTOMER', $3, 'x')", [A.tenantId, memberTicket.ticketId, A.memberUserId]))).toBe("55000");
    });
    expect(await setSupportTicketStatus({ ...op(), ticketId: memberTicket.ticketId, status: "OPEN" })).toBe(true);
    expect((await failure(getSupportTicket({ ...op(), ticketId: "00000000-0000-4000-8000-000000000001" }))).code).toBe("NOT_FOUND");

    const ev = await adm.query<{ event_type: string; user_id: string; detail: Record<string, unknown> }>(
      "SELECT event_type, user_id, detail FROM public.security_events WHERE event_type LIKE 'platform.support.%' AND detail ->> 'ticket_id' = $1 ORDER BY occurred_at, id",
      [memberTicket.ticketId],
    );
    expect(ev.rows.map((r) => [r.event_type, r.user_id, r.detail.tenant_id])).toEqual([
      ["platform.support.replied", operatorId, A.tenantId],
      ["platform.support.status", operatorId, A.tenantId],
      ["platform.support.status", operatorId, A.tenantId],
    ]);
    expect(JSON.stringify(ev.rows)).not.toContain("Yazıcı");
    const audit = await adm.query("SELECT action FROM public.audit_logs WHERE entity_id = $1 ORDER BY occurred_at, id", [memberTicket.ticketId]);
    expect(audit.rows.map((r) => r.action)).toEqual(["support.ticket_created", "support.ticket_replied", "support.ticket_replied"]);
  });

  it("yazışma değiştirilemez/silinemez (migration rolü dahil)", async () => {
    const m = await adm.query<{ id: string }>("SELECT id FROM public.support_ticket_messages WHERE ticket_id = $1 LIMIT 1", [memberTicket.ticketId]);
    expect(await sqlstate(adm.query("UPDATE public.support_ticket_messages SET body = 'x' WHERE id = $1", [m.rows[0]?.id]))).toBe("42501");
    expect(await sqlstate(adm.query("DELETE FROM public.support_ticket_messages WHERE id = $1", [m.rows[0]?.id]))).toBe("42501");
  });
});
