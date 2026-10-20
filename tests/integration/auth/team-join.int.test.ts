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

/** wms_app bağlantısında tenant + kullanıcı bağlamıyla sırayla sorgu; her sorgunun sonucu "ok" ya da SQLSTATE (T-919). Sonunda geri alınmaz: COMMIT. */
async function appAs(tenant: string, user: string, queries: ReadonlyArray<readonly [string, readonly unknown[]]>): Promise<string[]> {
  const c = new pg.Client({ connectionString: env.databaseUrl });
  c.on("error", () => undefined);
  await c.connect();
  const out: string[] = [];
  try {
    for (const [q, args] of queries) {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_tenant_id', $1, true), set_config('app.current_user_id', $2, true)", [tenant, user]);
      const r = await c.query(q, [...args]).then(
        () => "ok",
        (e: { code?: string }) => e.code ?? "error",
      );
      await c.query(r === "ok" ? "COMMIT" : "ROLLBACK");
      out.push(r);
    }
    return out;
  } finally {
    await c.end();
  }
}

async function ownerMembership(fx: Fx): Promise<string> {
  const m = await adm.query<{ id: string }>("SELECT id FROM public.tenant_memberships WHERE tenant_id = $1 AND user_id = $2", [fx.tenant, fx.ownerId]);
  return (m.rows[0] as { id: string }).id;
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

    // Onaylanmış ama PIN'i belirlenmemiş talep yönetici tarafından iptal edilir → çerez artık işe yaramaz (hesap kalır).
    const c = await request(join, `can.${randomBytes(3).toString("hex")}`, "Can Demir");
    const pc = (await getJoinOverview(access(fx))).pending.find((p) => p.name === "Can Demir");
    expect(await approveJoinRequest({ ...access(fx), joinRequestId: pc?.id ?? "", code: c.code, roleKey: "PICKER" }, accountPort)).toMatchObject({ ok: true });
    expect((await getJoinOverview(access(fx))).approvedWaiting.map((x) => x.name)).toContain("Can Demir");
    expect(await rejectJoinRequest({ ...access(fx), joinRequestId: pc?.id ?? "" })).toEqual({ changed: true });
    expect((await post("/field/join/activate", { pin: goodPin() }, c.cookie)).status).toBe(401);
    expect(((await (await get("/field/join/status", c.cookie)).json()) as { status: string }).status).toBe("CANCELLED");

    expect(await revokeJoinLink(access(fx))).toEqual({ changed: true });
    expect((await request(join, `nur.${randomBytes(3).toString("hex")}`)).res.status).toBe(401);
    expect((await getJoinOverview(access(fx))).link).toBeNull();

    const demo = await mkTenant(true);
    expect((await failure(createJoinLink(access(demo)))).code).toBe("FORBIDDEN");
  });

  it("T-919 (0053): onay DB'de kod doğrulamasına bağlı; geçersiz geçiş ve karar alanı oynaması 42501; security_events yalnız id", async () => {
    const fx = await mkTenant();
    const mem = await ownerMembership(fx);
    const link = await createJoinLink(access(fx));
    const join = `${link.tenantId}.${link.token}`;
    const upd = "UPDATE public.team_join_requests SET status = 'APPROVED', decided_by = $2, decided_at = now(), membership_id = $3 WHERE id = $1";
    const idOf = async (name: string): Promise<string> => (await getJoinOverview(access(fx))).pending.find((p) => p.name === name)?.id ?? "";

    // (a) Kod doğrulanmadan doğrudan onay yazılamaz.
    const a = await request(join, `ayse.${randomBytes(3).toString("hex")}`, "Ayşe Kaya");
    expect(a.res.status).toBe(200);
    const ida = await idOf("Ayşe Kaya");
    expect(await appAs(fx.tenant, fx.ownerId, [[upd, [ida, fx.ownerId, mem]]])).toEqual(["42501"]);
    // Uygulama rolü doğrulama damgasını kendisi basamaz.
    expect(await appAs(fx.tenant, fx.ownerId, [["UPDATE public.team_join_requests SET code_verified_by = $2, code_verified_at = now() WHERE id = $1", [ida, fx.ownerId]]])).toEqual(["42501"]);

    // (b) Başka kullanıcının doğruladığı talebi bu kullanıcı onaylayamaz.
    const other = randomUUID();
    expect(await appAs(fx.tenant, other, [["SELECT wms_probe.field_join_verify($1::uuid, $2)", [ida, a.code]]])).toEqual(["ok"]);
    const st = await adm.query<{ code_verified_by: string | null }>("SELECT code_verified_by FROM public.team_join_requests WHERE id = $1", [ida]);
    expect(st.rows[0]?.code_verified_by).toBe(other);
    expect(await appAs(fx.tenant, fx.ownerId, [[upd, [ida, fx.ownerId, mem]]])).toEqual(["42501"]);

    // (c) Kendi doğrulaması sonrası onay geçer; karar zamanı ve kişisi sunucuda üretilir (istemci değeri yok sayılır).
    const future = "UPDATE public.team_join_requests SET status = 'APPROVED', decided_by = $2, decided_at = now() + interval '30 days', membership_id = $3 WHERE id = $1";
    expect(await appAs(fx.tenant, fx.ownerId, [["SELECT wms_probe.field_join_verify($1::uuid, $2)", [ida, a.code]], [future, [ida, other, mem]]])).toEqual(["ok", "ok"]);
    const dec = await adm.query<{ decided_by: string; late: boolean }>(
      "SELECT decided_by, decided_at > now() + interval '1 minute' AS late FROM public.team_join_requests WHERE id = $1", [ida]);
    expect(dec.rows[0]).toEqual({ decided_by: fx.ownerId, late: false });
    // Durum değişmeden karar alanı oynanamaz (24 saatlik etkinleştirme penceresi uzatılamaz).
    expect(await appAs(fx.tenant, fx.ownerId, [["UPDATE public.team_join_requests SET decided_at = now() + interval '30 days' WHERE id = $1", [ida]]])).toEqual(["42501"]);

    // (d) 3 yanlış kodla iptal edilen talep geri onaylanamaz; REJECTED → APPROVED da yok.
    const b = await request(join, `veli.${randomBytes(3).toString("hex")}`, "Veli Er");
    const idb = await idOf("Veli Er");
    const bad = b.code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 3; i++) expect(await approveJoinRequest({ ...access(fx), joinRequestId: idb, code: bad, roleKey: "PICKER" }, accountPort)).toMatchObject({ ok: false });
    expect(await appAs(fx.tenant, fx.ownerId, [["UPDATE public.team_join_requests SET status = 'PENDING' WHERE id = $1", [idb]], [upd, [idb, fx.ownerId, mem]]])).toEqual(["42501", "42501"]);
    const c = await request(join, `nil.${randomBytes(3).toString("hex")}`, "Nil Su");
    const idc = await idOf("Nil Su");
    expect(await rejectJoinRequest({ ...access(fx), joinRequestId: idc })).toEqual({ changed: true });
    expect(await appAs(fx.tenant, fx.ownerId, [["SELECT wms_probe.field_join_verify($1::uuid, $2)", [idc, c.code]], [upd, [idc, fx.ownerId, mem]]])).toEqual(["ok", "42501"]);
    // Uygulama rolü bekleyen talebi sessizce iptal edemez / CLAIMED yapamaz (yalnız probe).
    const d = await request(join, `ece.${randomBytes(3).toString("hex")}`, "Ece Tan");
    const idd = await idOf("Ece Tan");
    expect(d.res.status).toBe(200);
    expect(await appAs(fx.tenant, fx.ownerId, [["UPDATE public.team_join_requests SET status = 'CANCELLED' WHERE id = $1", [idd]]])).toEqual(["42501"]);

    // (e) security_events: uygulama rolü içeriği okuyamaz, yalnız id (INSERT ... RETURNING id); kefalet işlevi yalnız evet/hayır.
    expect(await appQuery(fx.tenant, "SELECT user_id FROM public.security_events LIMIT 1")).toBe("42501");
    expect(await appQuery(fx.tenant, "SELECT ip, detail FROM public.security_events LIMIT 1")).toBe("42501");
    expect(await appQuery(fx.tenant, "SELECT id FROM public.security_events LIMIT 1")).toBe("ok");
    const since = (await adm.query<{ t: string }>("SELECT (now() - interval '1 second')::text AS t")).rows[0]?.t ?? "";
    const vouch = async (user: string): Promise<boolean | undefined> => {
      const cl = new pg.Client({ connectionString: env.databaseUrl });
      cl.on("error", () => undefined);
      await cl.connect();
      try {
        await cl.query("BEGIN");
        await cl.query("SELECT set_config('app.current_tenant_id', $1, true)", [fx.tenant]);
        const r = await cl.query<{ v: boolean }>("SELECT wms_probe.credentials_changed_since($1::uuid, $2::timestamptz) AS v", [user, since]);
        return r.rows[0]?.v;
      } finally {
        await cl.query("ROLLBACK").catch(() => undefined);
        await cl.end();
      }
    };
    expect(await vouch(fx.ownerId)).toBe(false);
    expect(await vouch(randomUUID())).toBe(true); // bu alanın üyesi değil: kefalet yok (fail-closed)
    const authC = new pg.Client({ connectionString: authUrl });
    authC.on("error", () => undefined);
    await authC.connect();
    try {
      await authC.query("INSERT INTO public.security_events (user_id, event_type) VALUES ($1, 'two_factor_disabled')", [fx.ownerId]);
    } finally {
      await authC.end();
    }
    expect(await vouch(fx.ownerId)).toBe(true);
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
