// T-995 (ADR-026 §3.3–3.5, 0039): onaylı demo talebinden deneme aktivasyonu. Gerçek wms_app / wms_auth / wms_worker bağlantıları +
// gerçek pg-boss kuyruğu; migration rolü yalnız kurulum/doğrulama/temizlik. Kanıtlanan (kart kabul ölçütü):
// - bağlantı yalnız özetiyle, 72 saat, tek kullanım (tekrar ve süre dolumu NOT_FOUND);
// - çalışma alanı adı: ayrılmış ve alınmış ad aynı yanıt (CODE_TAKEN), yoklama yalnız geçerli bağlantıyla;
// - deneme bitişi veritabanı saatinden (started_at + 3 ay), abonelik tablosuna uygulama rolleri yazamaz;
// - sahip hesabı TENANT_ADMIN, e-posta talepten (parametre değil); hoş geldiniz işi aynı transaction'da, sırsız;
// - e-postayla teslimde belirteci yalnız worker üretir (wms_app çağıramaz), yeni belirteç eskisini geçersiz kılar.
// Fikstürler sentetik (G-09); parola çalışma anında üretilir.
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient, withTenant } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, createTenantContext, type DbClient } from "../../../packages/db/src/client.ts";
import { createAuth, readAuthEnv, type AuthService } from "../../../packages/auth/src/index.ts";
import { QUEUE_SCHEMA, createJobQueue, installQueueSchema, type PgBossJobQueue } from "../../../packages/queue-adapter/src/index.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import { loadMailConfig, type MailConfig } from "../../../packages/shared/src/mailer.ts";
import { decideDemoRequest, ingestDemoLeads, listDemoRequests, reissueActivation } from "../../../packages/domain/src/platform/demo-requests.ts";
import {
  activateTrial,
  checkWorkspaceName,
  hashActivationToken,
  prepareActivationDelivery,
  previewActivation,
  type ActivateTrialDeps,
} from "../../../packages/domain/src/platform/activation.ts";
import { readAuthDatabaseUrl, readIntEnv, readWorkerDatabaseUrl, redactErrorChain } from "../harness/env.ts";

const env = readIntEnv(process.env);
const authUrl = readAuthDatabaseUrl(process.env);
const urls = [env.databaseUrl, env.databaseUrlDirect, authUrl];
const PASSWORD = `P${randomBytes(12).toString("hex")}`;
const ok = async (): Promise<void> => undefined;
const mailOff: MailConfig = loadMailConfig({});
const mailOn: MailConfig = loadMailConfig({ MAIL_MODE: "mailpit", MAILPIT_URL: "http://localhost:8025", MAIL_FROM: "noreply@example.test" });

let app: DbClient;
let worker: DbClient;
let authClient: DbClient;
let auth: AuthService;
let adm: pg.Client;
let queue: PgBossJobQueue;
let operatorId: string;
let operatorEmail: string;
const leadIds: string[] = [];
const platformJobs: string[] = [];

const decideDeps = (mailConfig: MailConfig = mailOff) => ({
  mailConfig,
  queue: {
    enqueuePlatform: async (job: { payload: unknown }) => {
      platformJobs.push(JSON.stringify(job));
      return { jobId: randomUUID() };
    },
  },
});

const activateDeps = (mailConfig: MailConfig = mailOn): ActivateTrialDeps => ({
  createActivatedAccount: (input) => auth.createActivatedAccount(input),
  mailConfig,
  queue,
});

async function mkUser(email: string): Promise<string> {
  const r = await adm.query<{ id: string }>(
    "INSERT INTO public.users (name, email, email_verified, two_factor_enabled) VALUES ('T995 fixture', $1, true, true) RETURNING id",
    [email],
  );
  return (r.rows[0] as { id: string }).id;
}

/** İçe alınmış + onaylanmış talep; ekranda teslim (posta kapalı) → düz belirteç. */
async function approvedLead(company = "Deneme Kauçuk AŞ"): Promise<{ id: string; email: string; token: string }> {
  const id = randomUUID();
  leadIds.push(id);
  const email = `t995-${randomBytes(5).toString("hex")}@example.test`;
  const line = JSON.stringify({ id, createdAt: new Date().toISOString(), name: "Deneme Kişi", company, email, sector: "", message: "" });
  await ingestDemoLeads({ db: worker, jsonl: `${line}\n` });
  const r = await decideDemoRequest({ db: app, principal: { userId: operatorId, mfaVerified: true }, id, decision: "APPROVED", recentAuth: ok }, decideDeps());
  const token = r.activation?.token;
  if (token === undefined) throw new Error("expected SCREEN token");
  return { id, email, token };
}

/** E-postayla teslim: worker yeni belirteç üretir (adres bağlantıyla doğrulanır). */
async function emailedLead(company = "Posta Teslim AŞ"): Promise<{ id: string; email: string; token: string }> {
  const id = randomUUID();
  leadIds.push(id);
  const email = `t995-p-${randomBytes(5).toString("hex")}@example.test`;
  await ingestDemoLeads({ db: worker, jsonl: `${JSON.stringify({ id, createdAt: new Date().toISOString(), name: "Kişi", company, email })}\n` });
  await decideDemoRequest({ db: app, principal: { userId: operatorId, mfaVerified: true }, id, decision: "APPROVED", recentAuth: ok }, decideDeps(mailOn));
  const p = await prepareActivationDelivery(worker, id);
  if (p === null) throw new Error("expected prepared delivery");
  return { id, email, token: p.token };
}

const slugOf = (): string => `t995-${randomBytes(4).toString("hex")}`;

const failure = async (p: Promise<unknown>): Promise<AppError> => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error("expected rejection");
};

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  worker = createDbClient({ url: readWorkerDatabaseUrl(process.env), poolMax: 1, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  authClient = createDbClient({ url: authUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  auth = createAuth({
    client: authClient,
    env: readAuthEnv({ BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), BETTER_AUTH_URL: "http://localhost:3000", DATABASE_URL: env.databaseUrl, AUTH_DATABASE_URL: authUrl }),
  });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  try {
    await adm.connect();
    await installQueueSchema({ url: env.databaseUrlDirect });
  } catch (e) {
    throw new Error(`connect failed: ${redactErrorChain(e, urls)}`);
  }
  queue = createJobQueue({
    connectionString: env.databaseUrl,
    max: 2,
    pollingIntervalSeconds: 0.5,
    stopTimeoutMs: 5000,
    runInTenant: (tenantId, _reason, fn) => withTenant(createTenantContext(app, tenantId), fn),
  });
  await queue.start();
  operatorEmail = `t995-op-${randomBytes(6).toString("hex")}@example.test`;
  operatorId = await mkUser(operatorEmail);
  await adm.query("INSERT INTO wms_platform.operators (email_normalized) VALUES ($1)", [operatorEmail]);
}, 120_000);

afterAll(async () => {
  // Audit/tenant satırları append-only ve kısa ömürlü ortam (invitations testiyle aynı); yalnız platform kayıtları temizlenir.
  await adm.query("DELETE FROM wms_platform.subscriptions WHERE demo_request_id = ANY($1::uuid[])", [leadIds]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.demo_requests WHERE id = ANY($1::uuid[])", [leadIds]).catch(() => undefined);
  await adm.query("DELETE FROM wms_platform.operators WHERE email_normalized = $1", [operatorEmail]).catch(() => undefined);
  await queue.stop();
  await adm.end();
  await app.close();
  await worker.close();
  await authClient.close();
}, 60_000);

describe("bağlantı", () => {
  it("onay (posta kapalı): ekranda tek seferlik belirteç; DB'de yalnız özeti; 72 saat DB saatinden; liste aktivasyon durumunu gösterir", async () => {
    const l = await approvedLead();
    const row = await adm.query<{ h: string; d: string; ok: boolean }>(
      `SELECT activation_token_hash AS h, activation_delivery AS d,
              activation_expires_at BETWEEN now() + interval '71 hours 59 minutes' AND now() + interval '72 hours 1 minute' AS ok
         FROM wms_platform.demo_requests WHERE id = $1`,
      [l.id],
    );
    expect(row.rows[0]).toEqual({ h: hashActivationToken(l.token), d: "SCREEN", ok: true });
    const dump = await adm.query<{ t: string }>("SELECT row_to_json(d)::text AS t FROM wms_platform.demo_requests d WHERE id = $1", [l.id]);
    expect(dump.rows[0]?.t).not.toContain(l.token);
    const listed = (await listDemoRequests({ db: app, principal: { userId: operatorId, mfaVerified: true } })).find((x) => x.id === l.id);
    expect(listed?.activation?.delivery).toBe("SCREEN");
    expect(listed?.activatedAt).toBeNull();
    expect(await previewActivation({ db: app, token: l.token })).toMatchObject({ company: "Deneme Kauçuk AŞ", email: l.email, emailVerifiedByLink: false });
    expect(await previewActivation({ db: app, token: "x".repeat(43) })).toBeNull();
    expect(await previewActivation({ db: app, token: "kısa" })).toBeNull();
  });

  it("e-postayla teslim: kuyruğa yalnız talep kimliği; belirteci yalnız worker üretir; yer tutucu özet hiçbir belirteçle eşleşmez", async () => {
    const id = randomUUID();
    leadIds.push(id);
    const email = `t995-m-${randomBytes(5).toString("hex")}@example.test`;
    await ingestDemoLeads({ db: worker, jsonl: `${JSON.stringify({ id, createdAt: new Date().toISOString(), name: "Kişi", company: "Posta AŞ", email })}\n` });
    const before = platformJobs.length;
    const r = await decideDemoRequest({ db: app, principal: { userId: operatorId, mfaVerified: true }, id, decision: "APPROVED", recentAuth: ok }, decideDeps(mailOn));
    expect(r.activation).toMatchObject({ delivery: "EMAIL" });
    expect(r.activation).not.toHaveProperty("token");
    expect(platformJobs.slice(before)).toEqual([JSON.stringify({ type: "platform.activation.deliver", actorUserId: operatorId, payload: { demoRequestId: id } })]);
    // wms_app teslim işlevini çağıramaz.
    await expect(prepareActivationDelivery(app, id)).rejects.toBeDefined();
    const first = await prepareActivationDelivery(worker, id);
    expect(first).toMatchObject({ email, company: "Posta AŞ" });
    expect(await previewActivation({ db: app, token: first?.token })).toMatchObject({ email, emailVerifiedByLink: true });
    // Yeniden deneme yeni belirteç üretir; önceki geçersiz kalır.
    const second = await prepareActivationDelivery(worker, id);
    expect(second?.token).not.toBe(first?.token);
    expect(await previewActivation({ db: app, token: first?.token })).toBeNull();
    expect(await previewActivation({ db: app, token: second?.token })).not.toBeNull();
  });

  it("yeni bağlantı: eski geçersiz olur; operatör olmayan NOT_FOUND; reddedilmiş talebe bağlantı yok", async () => {
    const l = await approvedLead();
    const again = await reissueActivation({ db: app, principal: { userId: operatorId, mfaVerified: true }, id: l.id, recentAuth: ok }, decideDeps());
    expect(again.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await previewActivation({ db: app, token: l.token })).toBeNull();
    expect(await previewActivation({ db: app, token: again.token })).not.toBeNull();
    const other = await mkUser(`t995-x-${randomBytes(5).toString("hex")}@example.test`);
    expect((await failure(reissueActivation({ db: app, principal: { userId: other, mfaVerified: true }, id: l.id, recentAuth: ok }, decideDeps()))).code).toBe("NOT_FOUND");
    const rej = randomUUID();
    leadIds.push(rej);
    await ingestDemoLeads({ db: worker, jsonl: `${JSON.stringify({ id: rej, createdAt: new Date().toISOString(), name: "K", company: "R", email: `t995-r-${randomBytes(4).toString("hex")}@example.test` })}\n` });
    await decideDemoRequest({ db: app, principal: { userId: operatorId, mfaVerified: true }, id: rej, decision: "REJECTED", recentAuth: ok }, decideDeps());
    expect((await failure(reissueActivation({ db: app, principal: { userId: operatorId, mfaVerified: true }, id: rej, recentAuth: ok }, decideDeps()))).code).toBe("VERSION_CONFLICT");
  });

  it("süresi dolmuş bağlantı: önizleme yok, aktivasyon NOT_FOUND, hesap açılmaz", async () => {
    const l = await approvedLead();
    await adm.query("UPDATE wms_platform.demo_requests SET activation_expires_at = now() - interval '1 second' WHERE id = $1", [l.id]);
    expect(await previewActivation({ db: app, token: l.token })).toBeNull();
    const e = await failure(activateTrial({ db: app, token: l.token, company: "X", workspaceName: slugOf(), sample: false, password: PASSWORD }, activateDeps()));
    expect(e.code).toBe("NOT_FOUND");
    expect((await adm.query("SELECT 1 FROM public.users WHERE email = $1", [l.email])).rowCount).toBe(0);
  });
});

describe("çalışma alanı adı", () => {
  it("yoklama: kısa → short; ayrılmış ve alınmış aynı (taken); uygun → ok; Türkçe ad sadeleşir; geçersiz bağlantı NOT_FOUND", async () => {
    const l = await approvedLead();
    expect(await checkWorkspaceName({ db: app, token: l.token, name: "ab" })).toEqual({ slug: "ab", state: "short" });
    expect(await checkWorkspaceName({ db: app, token: l.token, name: "login" })).toEqual({ slug: "login", state: "taken" });
    expect(await checkWorkspaceName({ db: app, token: l.token, name: "activate" })).toEqual({ slug: "activate", state: "taken" });
    const taken = await adm.query<{ slug: string }>("SELECT slug FROM public.tenants WHERE NOT is_demo ORDER BY created_at LIMIT 1");
    const existing = taken.rows[0]?.slug;
    if (existing !== undefined && existing.length >= 3 && existing.length <= 30) {
      expect(await checkWorkspaceName({ db: app, token: l.token, name: existing })).toEqual({ slug: existing, state: "taken" });
    }
    const fresh = slugOf();
    expect(await checkWorkspaceName({ db: app, token: l.token, name: fresh })).toEqual({ slug: fresh, state: "ok" });
    expect(await checkWorkspaceName({ db: app, token: l.token, name: "Çağrı Gıda Şirketi" })).toMatchObject({ slug: "cagri-gida-sirketi" });
    expect((await failure(checkWorkspaceName({ db: app, token: "y".repeat(43), name: fresh }))).code).toBe("NOT_FOUND");
  });

  it("aktivasyonda ayrılmış ya da alınmış ad CODE_TAKEN; talep bırakılır, aynı bağlantıyla başka adla hemen devam edilir (aynı hesap)", async () => {
    const first = await approvedLead();
    const slug = slugOf();
    await activateTrial({ db: app, token: first.token, company: "İlk AŞ", workspaceName: slug, sample: false, password: PASSWORD }, activateDeps());
    const l = await approvedLead();
    const reserved = await failure(activateTrial({ db: app, token: l.token, company: "İkinci AŞ", workspaceName: "login", sample: false, password: PASSWORD }, activateDeps()));
    expect([reserved.code, reserved.detail]).toEqual(["VALIDATION_FAILED", "CODE_TAKEN"]);
    const takenErr = await failure(activateTrial({ db: app, token: l.token, company: "İkinci AŞ", workspaceName: slug, sample: false, password: PASSWORD }, activateDeps()));
    expect([takenErr.code, takenErr.detail]).toEqual(["VALIDATION_FAILED", "CODE_TAKEN"]);
    const okSlug = slugOf();
    const r = await activateTrial({ db: app, token: l.token, company: "İkinci AŞ", workspaceName: okSlug, sample: true, password: PASSWORD }, activateDeps());
    expect(r.tenantSlug).toBe(okSlug);
    expect((await adm.query("SELECT 1 FROM public.users WHERE email = $1", [l.email])).rowCount).toBe(1);
  });
});

describe("aktivasyon", () => {
  it("hesap + tenant + deneme tek seferde: sahip TENANT_ADMIN; deneme DB saatinden 3 ay; hoş geldiniz işi kuyrukta; bağlantı tekrar kullanılamaz", async () => {
    const l = await emailedLead("Motive Deneme");
    const slug = slugOf();
    const r = await activateTrial({ db: app, token: l.token, company: "  Motive Deneme  ", workspaceName: slug, sample: true, password: PASSWORD }, activateDeps());
    expect(r).toMatchObject({ tenantSlug: slug, email: l.email, welcomeQueued: true });
    const t = await adm.query<{ name: string; is_demo: boolean; status: string }>("SELECT name, is_demo, status FROM public.tenants WHERE id = $1", [r.tenantId]);
    expect(t.rows[0]).toEqual({ name: "Motive Deneme", is_demo: false, status: "ACTIVE" });
    const owner = await adm.query<{ email: string; verified: boolean; role: string; is_owner: boolean }>(
      `SELECT u.email, u.email_verified AS verified, mr.role_key AS role, m.is_owner
         FROM public.tenant_memberships m JOIN public.users u ON u.id = m.user_id
         JOIN public.membership_roles mr ON mr.membership_id = m.id AND mr.tenant_id = m.tenant_id
        WHERE m.tenant_id = $1`,
      [r.tenantId],
    );
    // Bağlantı e-postayla gitti: tıklama adres sahipliğini kanıtlar → doğrulanmış.
    expect(owner.rows).toEqual([{ email: l.email, verified: true, role: "TENANT_ADMIN", is_owner: true }]);
    const sub = await adm.query<{ plan: string; exact: boolean; fresh: boolean; dr: string }>(
      `SELECT plan, trial_ends_at = started_at + interval '3 months' AS exact, started_at > now() - interval '1 minute' AS fresh,
              demo_request_id::text AS dr FROM wms_platform.subscriptions WHERE tenant_id = $1`,
      [r.tenantId],
    );
    expect(sub.rows[0]).toEqual({ plan: "TRIAL", exact: true, fresh: true, dr: l.id });
    const dbEnd = await adm.query<{ e: Date }>("SELECT trial_ends_at AS e FROM wms_platform.subscriptions WHERE tenant_id = $1", [r.tenantId]);
    expect(r.trialEndsAt.getTime()).toBe(new Date(dbEnd.rows[0]?.e as Date).getTime());
    const dr = await adm.query<{ activated: boolean; sample: boolean; claim: string | null }>(
      "SELECT activated_at IS NOT NULL AS activated, activation_sample AS sample, activation_claim_id::text AS claim FROM wms_platform.demo_requests WHERE id = $1",
      [l.id],
    );
    expect(dr.rows[0]).toEqual({ activated: true, sample: true, claim: null });
    const jobs = await adm.query<{ data: Record<string, unknown> }>(`SELECT data FROM ${QUEUE_SCHEMA}.job WHERE name = 'trial.welcome' AND data->>'tenantId' = $1`, [r.tenantId]);
    expect(jobs.rows.length).toBe(1);
    expect(JSON.stringify(jobs.rows[0]?.data)).not.toContain(PASSWORD);
    expect(jobs.rows[0]?.data.payload).toEqual({});
    const ev = await adm.query<{ detail: Record<string, unknown> }>("SELECT detail FROM public.security_events WHERE event_type = 'platform.demo_request.activated' AND detail->>'demo_request_id' = $1", [l.id]);
    expect(ev.rows[0]?.detail).toEqual({ demo_request_id: l.id, tenant_id: r.tenantId });
    const audit = await adm.query<{ action: string }>("SELECT action FROM public.audit_logs WHERE tenant_id = $1 ORDER BY occurred_at, id", [r.tenantId]);
    expect(audit.rows.map((x) => x.action)).toEqual(expect.arrayContaining(["tenant.created", "trial.started"]));
    // Tek kullanım.
    expect(await previewActivation({ db: app, token: l.token })).toBeNull();
    const again = await failure(activateTrial({ db: app, token: l.token, company: "X", workspaceName: slugOf(), sample: false, password: PASSWORD }, activateDeps()));
    expect(again.code).toBe("NOT_FOUND");
    // Uygulama rolü kendi tenant'ının deneme kaydını yalnız okuma işleviyle görür; tabloya yazamaz.
    const c = new pg.Client({ connectionString: env.databaseUrl });
    await c.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [r.tenantId]);
      const s = await c.query<{ plan: string }>("SELECT plan FROM wms_probe.platform_tenant_subscription()");
      expect(s.rows).toEqual([{ plan: "TRIAL" }]);
      await c.query("ROLLBACK");
      await expect(c.query("UPDATE wms_platform.subscriptions SET trial_ends_at = now() + interval '10 years'")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await c.end();
    }
  });

  it("aynı e-postayla başka yoldan açılmış hesap: FORBIDDEN, tenant açılmaz, talep yeniden denenebilir kalır", async () => {
    const l = await approvedLead();
    await mkUser(l.email);
    const e = await failure(activateTrial({ db: app, token: l.token, company: "X", workspaceName: slugOf(), sample: false, password: PASSWORD }, activateDeps()));
    expect(e.code).toBe("FORBIDDEN");
    expect(await previewActivation({ db: app, token: l.token })).not.toBeNull();
    const claim = await adm.query<{ live: boolean }>("SELECT activation_claim_expires_at > now() AS live FROM wms_platform.demo_requests WHERE id = $1", [l.id]);
    expect(claim.rows[0]?.live).toBe(false);
  });

  it("süren talep varken ikinci deneme VERSION_CONFLICT; kısa parola ve biçimsiz ad VALIDATION_FAILED (talep yazılmadan)", async () => {
    const l = await approvedLead();
    const c = new pg.Client({ connectionString: env.databaseUrl });
    await c.connect();
    try {
      await c.query("SELECT wms_probe.platform_activation_claim($1)", [hashActivationToken(l.token)]);
    } finally {
      await c.end();
    }
    const e = await failure(activateTrial({ db: app, token: l.token, company: "X", workspaceName: slugOf(), sample: false, password: PASSWORD }, activateDeps()));
    expect(e.code).toBe("VERSION_CONFLICT");
    const l2 = await approvedLead();
    expect((await failure(activateTrial({ db: app, token: l2.token, company: "X", workspaceName: slugOf(), sample: false, password: "kısa" }, activateDeps()))).code).toBe(
      "VALIDATION_FAILED",
    );
    expect((await failure(activateTrial({ db: app, token: l2.token, company: "X", workspaceName: "-bad-", sample: false, password: PASSWORD }, activateDeps()))).code).toBe(
      "VALIDATION_FAILED",
    );
    const claim = await adm.query<{ c: string | null }>("SELECT activation_claim_id::text AS c FROM wms_platform.demo_requests WHERE id = $1", [l2.id]);
    expect(claim.rows[0]?.c).toBeNull();
  });

  it("posta kapalıysa ya da adres doğrulanmamışsa (ekranda iletilen bağlantı) hoş geldiniz işi yazılmaz ve sonuç bunu söyler", async () => {
    const l = await emailedLead();
    const r = await activateTrial({ db: app, token: l.token, company: "Sessiz AŞ", workspaceName: slugOf(), sample: false, password: PASSWORD }, activateDeps(mailOff));
    expect(r.welcomeQueued).toBe(false);
    const jobs = await adm.query(`SELECT 1 FROM ${QUEUE_SCHEMA}.job WHERE name = 'trial.welcome' AND data->>'tenantId' = $1`, [r.tenantId]);
    expect(jobs.rowCount).toBe(0);
    const screen = await approvedLead();
    const r2 = await activateTrial({ db: app, token: screen.token, company: "Ekran AŞ", workspaceName: slugOf(), sample: false, password: PASSWORD }, activateDeps(mailOn));
    expect(r2.welcomeQueued).toBe(false);
  });

  it("yarıda kalan deneme sonrası yeni bağlantı: aynı hesap yeniden kullanılır ve yeni parola geçerli olur (inceleme M-1, m-2)", async () => {
    const l = await approvedLead();
    // 1. deneme: talep + hesap açılır, tenant aşamasına gelinmeden yarıda kalır (talep bırakılır).
    const hash = hashActivationToken(l.token);
    const c = new pg.Client({ connectionString: env.databaseUrl });
    await c.connect();
    try {
      const claim = (await c.query<{ id: string }>("SELECT wms_probe.platform_activation_claim($1)::text AS id", [hash])).rows[0]?.id as string;
      await auth.createActivatedAccount({ activationTokenHash: hash, claimId: claim, password: PASSWORD });
      await c.query("SELECT wms_probe.platform_activation_release($1, $2::uuid)", [hash, claim]);
    } finally {
      await c.end();
    }
    const uid = (await adm.query<{ id: string }>("SELECT id FROM public.users WHERE email = $1", [l.email])).rows[0]?.id;
    expect(uid).toBeDefined();
    const again = await reissueActivation({ db: app, principal: { userId: operatorId, mfaVerified: true }, id: l.id, recentAuth: ok }, decideDeps());
    const newPassword = `N${randomBytes(12).toString("hex")}`;
    const r = await activateTrial({ db: app, token: again.token, company: "Sonra AŞ", workspaceName: slugOf(), sample: false, password: newPassword }, activateDeps());
    const owner = await adm.query<{ user_id: string }>("SELECT user_id FROM public.tenant_memberships WHERE tenant_id = $1 AND is_owner", [r.tenantId]);
    expect(owner.rows[0]?.user_id).toBe(uid);
    const pw = await adm.query<{ password: string }>("SELECT password FROM public.accounts WHERE user_id = $1 AND provider_id = 'credential'", [uid]);
    const { verifyPassword } = await import("../../../packages/auth/src/password.ts");
    expect(await verifyPassword({ hash: pw.rows[0]?.password ?? "", password: newPassword })).toBe(true);
  });

  it("operatör adresiyle talep: bağlantı müşteri hesabı açmaz (NOT_FOUND)", async () => {
    const id = randomUUID();
    leadIds.push(id);
    await ingestDemoLeads({ db: worker, jsonl: `${JSON.stringify({ id, createdAt: new Date().toISOString(), name: "K", company: "Op AŞ", email: operatorEmail })}\n` });
    const r = await decideDemoRequest({ db: app, principal: { userId: operatorId, mfaVerified: true }, id, decision: "APPROVED", recentAuth: ok }, decideDeps());
    const e = await failure(activateTrial({ db: app, token: r.activation?.token, company: "Op AŞ", workspaceName: slugOf(), sample: false, password: PASSWORD }, activateDeps()));
    expect(e.code).toBe("NOT_FOUND");
  });

  it("tüketme işlevi başka tenant bağlamından ya da talep sahibine ait olmayan tenant'la çağrılamaz", async () => {
    const l = await approvedLead();
    const hash = hashActivationToken(l.token);
    const c = new pg.Client({ connectionString: env.databaseUrl });
    await c.connect();
    try {
      const claim = (await c.query<{ id: string }>("SELECT wms_probe.platform_activation_claim($1) AS id", [hash])).rows[0]?.id;
      const other = await adm.query<{ id: string }>("SELECT id FROM public.tenants WHERE NOT is_demo ORDER BY created_at LIMIT 1");
      const tid = other.rows[0]?.id as string;
      await c.query("BEGIN");
      await expect(c.query("SELECT wms_probe.platform_activation_consume($1, $2::uuid, $3::uuid, false)", [hash, claim, tid])).rejects.toMatchObject({ code: "42501" });
      await c.query("ROLLBACK");
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tid]);
      await expect(c.query("SELECT wms_probe.platform_activation_consume($1, $2::uuid, $3::uuid, false)", [hash, claim, tid])).rejects.toMatchObject({ code: "42501" });
      await c.query("ROLLBACK");
    } finally {
      await c.end();
    }
  });
});
