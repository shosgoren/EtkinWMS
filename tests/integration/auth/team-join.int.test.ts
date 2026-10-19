// T-429 (0052): ekibe katılma — yönetici QR'ı (7 gün, alan başına bir geçerli; yenilenince eskisi geçersiz) → personel telefonu talep eder
// (6 haneli kod yalnız cihazda) → yönetici kodu yazıp rolle onaylar (saha hesabı açılır) → cihaz kendi PIN'ini belirler, oturum açılır (tek
// kullanım). Onaysız talep giriş yapamaz; yanlış kod 3'te talebi iptal eder; aynı kullanıcı adı reddedilir; demo alanda kapalı; uygulama
// rolü kodu ve özetleri okuyamaz. Gerçek wms_app / wms_auth bağlantıları + RLS; Better Auth uçları `handler` ile. Fikstürler sentetik (G-09).
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { createAuth, readAuthEnv, type AuthService } from "../../../packages/auth/src/index.ts";
import { joinLinkHash as authJoinLinkHash } from "../../../packages/auth/src/field.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import { pinProblem } from "../../../packages/shared/src/field-login.ts";
import { approveJoinRequest, createJoinLink, getJoinOverview, joinLinkHash, rejectJoinRequest, revokeJoinLink } from "../../../packages/domain/src/identity/team-join.ts";
import { readAuthDatabaseUrl, readIntEnv, redactErrorChain } from "../harness/env.ts";

const env = readIntEnv(process.env);
const authUrl = readAuthDatabaseUrl(process.env);
const urls = [env.databaseUrl, env.databaseUrlDirect, authUrl];
const BASE = "http://localhost:3000";
const SECRET = randomBytes(32).toString("hex");
const JOIN_COOKIE = "wms_field_join";

let app: DbClient;
let authClient: DbClient;
let auth: AuthService;
let adm: pg.Client;

beforeAll(async () => {
  app = createDbClient({ url: env.databaseUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  authClient = createDbClient({ url: authUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  auth = createAuth({
    client: authClient,
    env: readAuthEnv({ BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: BASE, DATABASE_URL: env.databaseUrl, AUTH_DATABASE_URL: authUrl }),
  });
  adm = new pg.Client({ connectionString: env.databaseUrlDirect });
  adm.on("error", () => undefined);
  try {
    await adm.connect();
  } catch (e) {
    throw new Error(`connect failed: ${redactErrorChain(e, urls)}`);
  }
}, 120_000);

afterAll(async () => {
  await adm.end();
  await app.close();
  await authClient.close();
}, 60_000);

interface Fx {
  tenant: string;
  slug: string;
  ownerId: string;
}

async function mkTenant(isDemo = false): Promise<Fx> {
  const tenant = randomUUID();
  const slug = `t429-${randomBytes(5).toString("hex")}`;
  await adm.query("INSERT INTO public.tenants (id, slug, name, is_demo) VALUES ($1, $2, 'T429 Depo', $3)", [tenant, slug, isDemo]);
  const u = await adm.query<{ id: string }>(
    "INSERT INTO public.users (name, email, email_verified, two_factor_enabled) VALUES ('T429 owner', $1, true, true) RETURNING id",
    [`t429-${randomBytes(6).toString("hex")}@example.test`],
  );
  const ownerId = (u.rows[0] as { id: string }).id;
  const m = await adm.query<{ id: string }>(
    "INSERT INTO public.tenant_memberships (tenant_id, user_id, status, is_owner) VALUES ($1, $2, 'ACTIVE', true) RETURNING id",
    [tenant, ownerId],
  );
  await adm.query("INSERT INTO public.membership_roles (tenant_id, membership_id, role_key) VALUES ($1, $2, 'TENANT_ADMIN')", [tenant, (m.rows[0] as { id: string }).id]);
  return { tenant, slug, ownerId };
}

const recentAuth = async (): Promise<void> => undefined;
const access = (fx: Fx) => ({ db: app, principal: { userId: fx.ownerId, mfaVerified: true }, tenantSlug: fx.slug, recentAuth });
const accountPort = { createFieldAccount: (input: { readonly name: string }) => auth.createFieldAccount(input) };

function goodPin(): string {
  for (;;) {
    const p = String(randomInt(0, 1_000_000)).padStart(6, "0");
    if (pinProblem(p) === null) return p;
  }
}

let ipCounter = 0;
const nextIp = (): string => `198.51.100.${(++ipCounter % 250) + 1}`;

function post(path: string, body: unknown, cookie = ""): Promise<Response> {
  return auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, "fly-client-ip": nextIp(), "user-agent": "t429-int-test", ...(cookie === "" ? {} : { cookie }) },
      body: JSON.stringify(body),
    }),
  );
}

function get(path: string, cookie = ""): Promise<Response> {
  return auth.handler(new Request(`${BASE}/api/auth${path}`, { method: "GET", headers: { origin: BASE, "fly-client-ip": nextIp(), ...(cookie === "" ? {} : { cookie }) } }));
}

function cookieOf(res: Response, name: string): string {
  for (const line of res.headers.getSetCookie()) {
    const first = line.split(";")[0] ?? "";
    if (first.startsWith(`${name}=`) && first.length > name.length + 1 && !/max-age=0/i.test(line)) return first;
  }
  return "";
}

async function errCode(res: Response): Promise<string | undefined> {
  const body = (await res.json().catch(() => ({}))) as { code?: unknown };
  return typeof body.code === "string" ? body.code : undefined;
}

async function failure(p: Promise<unknown>): Promise<AppError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

async function appQuery(tenant: string, query: string): Promise<string | undefined> {
  const c = new pg.Client({ connectionString: env.databaseUrl });
  c.on("error", () => undefined);
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenant]);
    return await c.query(query).then(
      () => "ok",
      (e: { code?: string }) => e.code,
    );
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    await c.end();
  }
}

async function request(join: string, username: string, name = "Ahmet Yılmaz"): Promise<{ res: Response; cookie: string; code: string }> {
  const res = await post("/field/join", { join, name, username, deviceHint: "Test telefonu" });
  const cookie = res.status === 200 ? cookieOf(res, JOIN_COOKIE) : "";
  const code = res.status === 200 ? ((await res.clone().json()) as { confirmCode: string }).confirmCode : "";
  return { res, cookie, code };
}

describe("T-429 ekibe katılma", () => {
  it("uçtan uca: QR → talep → onay → PIN → oturum; tek kullanım; uygulama rolü kodu okuyamaz", async () => {
    const fx = await mkTenant();
    expect(joinLinkHash("x")).toBe(authJoinLinkHash("x")); // iki paket aynı özet kuralı
    const { recentAuth: _r, ...noReauth } = access(fx);
    void _r;
    expect((await failure(createJoinLink(noReauth))).detail).toBe("RECENT_AUTH_REQUIRED");
    const link = await createJoinLink(access(fx));
    const join = `${link.tenantId}.${link.token}`;
    expect(link.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 3600_000);
    const stored = await adm.query("SELECT token_hash FROM public.team_join_links WHERE tenant_id = $1", [fx.tenant]);
    expect(JSON.stringify(stored.rows)).not.toContain(link.token);

    const preview = await post("/field/join/link", { join });
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as { tenantName: string }).tenantName).toBe("T429 Depo");

    const username = `ahmet.${randomBytes(3).toString("hex")}`;
    const r = await request(join, username.toUpperCase());
    expect(r.res.status).toBe(200);
    expect(r.code).toMatch(/^\d{6}$/);
    expect(r.cookie).not.toBe("");
    expect(((await (await get("/field/join/status", r.cookie)).json()) as { status: string }).status).toBe("PENDING");
    // Uygulama rolü kodu / özetleri okuyamaz; talep ekleyemez.
    expect(await appQuery(fx.tenant, "SELECT confirm_code FROM public.team_join_requests")).toBe("42501");
    expect(await appQuery(fx.tenant, "SELECT request_hash FROM public.team_join_requests")).toBe("42501");
    expect(await appQuery(fx.tenant, "SELECT token_hash FROM public.team_join_links")).toBe("42501");

    const overview = await getJoinOverview(access(fx));
    expect(overview.link).not.toBeNull();
    expect(overview.pending).toHaveLength(1);
    const pending = overview.pending[0];
    expect(pending?.username).toBe(username);
    expect(JSON.stringify(overview)).not.toContain(r.code);

    // Onaydan önce etkinleştirme yok.
    expect((await post("/field/join/activate", { pin: goodPin() }, r.cookie)).status).toBe(401);
    const wrong = r.code === "000000" ? "111111" : "000000";
    expect(await approveJoinRequest({ ...access(fx), joinRequestId: pending?.id ?? "", code: wrong, roleKey: "PICKER" }, accountPort)).toEqual({ ok: false, issue: "CODE_WRONG" });
    const ok = await approveJoinRequest({ ...access(fx), joinRequestId: pending?.id ?? "", code: r.code, roleKey: "PICKER" }, accountPort);
    expect(ok).toMatchObject({ ok: true, username });
    expect(((await (await get("/field/join/status", r.cookie)).json()) as { status: string }).status).toBe("APPROVED");
    const role = await adm.query<{ role_key: string }>("SELECT role_key FROM public.membership_roles WHERE membership_id = $1", [ok.ok ? ok.membershipId : null]);
    expect(role.rows.map((x) => x.role_key)).toEqual(["PICKER"]);

    // Talep çerezi olmadan etkinleştirme yok; çerezle PIN belirlenir, oturum açılır.
    expect((await post("/field/join/activate", { pin: goodPin() })).status).toBe(400);
    const pin = goodPin();
    const act = await post("/field/join/activate", { pin, deviceName: "Ahmet telefonu" }, r.cookie);
    expect(act.status).toBe(200);
    expect(act.headers.getSetCookie().some((l) => /session_token=/.test(l))).toBe(true);
    expect(cookieOf(act, "wms_field_device")).not.toBe("");
    // Tek kullanım.
    expect((await post("/field/join/activate", { pin: goodPin() }, r.cookie)).status).toBe(401);
    const status = await adm.query<{ status: string }>("SELECT status FROM public.team_join_requests WHERE id = $1", [pending?.id]);
    expect(status.rows[0]?.status).toBe("CLAIMED");
    // Aynı kullanıcı adıyla yeni talep reddedilir.
    const again = await request(join, username, "Başka Kişi");
    expect(again.res.status).toBe(400);
    expect(await errCode(again.res)).toBe("FIELD_USERNAME_TAKEN");
    const audits = await adm.query<{ action: string }>(
      "SELECT action FROM public.audit_logs WHERE tenant_id = $1 AND action LIKE 'team_join.%' ORDER BY created_xid::text::bigint",
      [fx.tenant],
    );
    expect(audits.rows.map((x) => x.action)).toEqual(["team_join.link_created", "team_join.approved"]);
  });

  it("yenilenen ya da kapatılan QR geçersiz; 3 yanlış kod talebi iptal eder; ret; demo kapalı; geçersiz belirteç", async () => {
    const fx = await mkTenant();
    const first = await createJoinLink(access(fx));
    const second = await createJoinLink(access(fx));
    const oldJoin = `${first.tenantId}.${first.token}`;
    const join = `${second.tenantId}.${second.token}`;
    expect((await post("/field/join/link", { join: oldJoin })).status).toBe(401);
    expect((await request(oldJoin, `eski.${randomBytes(3).toString("hex")}`)).res.status).toBe(401);
    expect((await post("/field/join/link", { join: `${fx.tenant}.${randomBytes(32).toString("base64url")}` })).status).toBe(401);
    expect((await post("/field/join/link", { join: "bozuk" })).status).toBe(400);

    const a = await request(join, `kerem.${randomBytes(3).toString("hex")}`, "Kerem Us");
    expect(a.res.status).toBe(200);
    const pa = (await getJoinOverview(access(fx))).pending[0];
    const bad = a.code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 3; i++) expect(await approveJoinRequest({ ...access(fx), joinRequestId: pa?.id ?? "", code: bad, roleKey: "COUNTER" }, accountPort)).toMatchObject({ ok: false });
    expect(await approveJoinRequest({ ...access(fx), joinRequestId: pa?.id ?? "", code: a.code, roleKey: "COUNTER" }, accountPort)).toEqual({ ok: false, issue: "GONE" });
    expect(((await (await get("/field/join/status", a.cookie)).json()) as { status: string }).status).toBe("CANCELLED");

    const b = await request(join, `zeynep.${randomBytes(3).toString("hex")}`, "Zeynep Ak");
    const pb = (await getJoinOverview(access(fx))).pending.find((p) => p.name === "Zeynep Ak");
    expect(await rejectJoinRequest({ ...access(fx), joinRequestId: pb?.id ?? "" })).toEqual({ changed: true });
    expect(((await (await get("/field/join/status", b.cookie)).json()) as { status: string }).status).toBe("REJECTED");
    expect((await post("/field/join/activate", { pin: goodPin() }, b.cookie)).status).toBe(401);

    expect(await revokeJoinLink(access(fx))).toEqual({ changed: true });
    expect((await request(join, `nur.${randomBytes(3).toString("hex")}`)).res.status).toBe(401);
    expect((await getJoinOverview(access(fx))).link).toBeNull();

    const demo = await mkTenant(true);
    expect((await failure(createJoinLink(access(demo)))).code).toBe("FORBIDDEN");
  });

  it("başka alanın talebi görünmez ve onaylanamaz", async () => {
    const A = await mkTenant();
    const B = await mkTenant();
    const link = await createJoinLink(access(A));
    const r = await request(`${link.tenantId}.${link.token}`, `ali.${randomBytes(3).toString("hex")}`, "Ali Veli");
    expect(r.res.status).toBe(200);
    const pa = (await getJoinOverview(access(A))).pending[0];
    expect((await getJoinOverview(access(B))).pending).toHaveLength(0);
    expect(await approveJoinRequest({ ...access(B), joinRequestId: pa?.id ?? "", code: r.code, roleKey: "PICKER" }, accountPort)).toEqual({ ok: false, issue: "GONE" });
    // Başka alanın kimliğiyle verilen bağlantı belirteci de geçmez.
    expect((await post("/field/join/link", { join: `${B.tenant}.${link.token}` })).status).toBe(401);
  });
});
