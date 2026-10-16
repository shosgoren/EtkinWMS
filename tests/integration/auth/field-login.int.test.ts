// T-997 (ADR-026 §7, 0044): e-postasız saha personeli. Gerçek wms_app / wms_auth bağlantıları + RLS; Better Auth uçları
// `service.handler` ile. Migration rolü yalnız kurulum/doğrulama. Fikstürler sentetik (G-09); PIN'ler çalışma anında üretilir.
//
// ADR-026 Doğrulama listesi:
// - hesap açılışı: kod bir kez döner, DB'de yalnız özet; uygulama rolü PIN/kod özetini okuyamaz;
// - etkinleştirme: kod tek kullanım; kişisel cihaz çerezi (httpOnly, SameSite=Strict); oturum açılır;
// - giriş: kayıtlı cihaz şart; başka kişinin kişisel cihazı ret; belirteç rotasyonu (eski çerez geçersiz);
// - genel ret: bilinmeyen alan/kullanıcı/cihaz aynı yanıt; 5 hatada kilit, yönetici açar; kod yenileme eski PIN/cihaz/oturumu düşürür;
// - yönetim rolü: saha hesabına verilemez; DB'de verilmiş olsa bile saha girişi reddeder;
// - e-posta uçları: iç e-posta ile e-posta/parola girişi ve sıfırlama reddedilir; saha oturumu yakın doğrulamayı karşılamaz;
// - olaylar: field_login.*, field_pin.*, device.* yazılır; PIN/kod/belirteç olay detayına girmez; uygulama rolü bu olayları yazamaz.
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { createAuth, readAuthEnv, type AuthService } from "../../../packages/auth/src/index.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import { pinProblem } from "../../../packages/shared/src/field-login.ts";
import { createFieldUser, listFieldLogins, resetFieldCode, unlockFieldLogin } from "../../../packages/domain/src/identity/field-users.ts";
import { MembershipDenied, changeRole } from "../../../packages/domain/src/identity/memberships.ts";
import { readAuthDatabaseUrl, readIntEnv, redactErrorChain } from "../harness/env.ts";

const env = readIntEnv(process.env);
const authUrl = readAuthDatabaseUrl(process.env);
const urls = [env.databaseUrl, env.databaseUrlDirect, authUrl];
const BASE = "http://localhost:3000";
const SECRET = randomBytes(32).toString("hex");
const DEVICE_COOKIE = "wms_field_device";

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

// ---------------------------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------------------------
interface Fx {
  tenant: string;
  slug: string;
  ownerId: string;
}

async function mkTenant(): Promise<Fx> {
  const tenant = randomUUID();
  const slug = `t997-${randomBytes(5).toString("hex")}`;
  await adm.query("INSERT INTO public.tenants (id, slug, name, is_demo) VALUES ($1, $2, 'T997', false)", [tenant, slug]);
  const u = await adm.query<{ id: string }>(
    "INSERT INTO public.users (name, email, email_verified, two_factor_enabled) VALUES ('T997 owner', $1, true, true) RETURNING id",
    [`t997-${randomBytes(6).toString("hex")}@example.test`],
  );
  const ownerId = (u.rows[0] as { id: string }).id;
  const m = await adm.query<{ id: string }>(
    "INSERT INTO public.tenant_memberships (tenant_id, user_id, status, is_owner) VALUES ($1, $2, 'ACTIVE', true) RETURNING id",
    [tenant, ownerId],
  );
  await adm.query("INSERT INTO public.membership_roles (tenant_id, membership_id, role_key) VALUES ($1, $2, 'TENANT_ADMIN')", [
    tenant,
    (m.rows[0] as { id: string }).id,
  ]);
  return { tenant, slug, ownerId };
}

const recentAuth = async (): Promise<void> => undefined;
const access = (fx: Fx) => ({ db: app, principal: { userId: fx.ownerId, mfaVerified: true }, tenantSlug: fx.slug, recentAuth });
const accountPort = { createFieldAccount: (input: { readonly name: string }) => auth.createFieldAccount(input) };
const revokePort = { revokeUserSessions: (userId: string) => auth.revokeUserSessions(userId) };

function goodPin(): string {
  for (;;) {
    const p = String(randomInt(0, 1_000_000)).padStart(6, "0");
    if (pinProblem(p) === null) return p;
  }
}

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `198.51.100.${(ipCounter % 250) + 1}`;
}

function post(path: string, body: unknown, cookie = "", ip = nextIp()): Promise<Response> {
  return auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE,
        "fly-client-ip": ip,
        "user-agent": "t997-int-test",
        ...(cookie === "" ? {} : { cookie }),
      },
      body: JSON.stringify(body),
    }),
  );
}

function get(path: string, cookie = ""): Promise<Response> {
  return auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "GET",
      headers: { origin: BASE, "fly-client-ip": nextIp(), ...(cookie === "" ? {} : { cookie }) },
    }),
  );
}

function jarFrom(res: Response, previous = ""): string {
  const jar = new Map<string, string>();
  for (const part of previous.split("; ")) {
    const i = part.indexOf("=");
    if (i > 0) jar.set(part.slice(0, i), part.slice(i + 1));
  }
  for (const line of res.headers.getSetCookie()) {
    const first = line.split(";")[0] ?? "";
    const i = first.indexOf("=");
    if (i <= 0) continue;
    const name = first.slice(0, i);
    const value = first.slice(i + 1);
    if (value === "" || /max-age=0/i.test(line)) jar.delete(name);
    else jar.set(name, value);
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

const deviceOnly = (jar: string): string => jar.split("; ").filter((c) => c.startsWith(`${DEVICE_COOKIE}=`)).join("; ");

async function code(res: Response): Promise<string | undefined> {
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

async function events(userId: string): Promise<{ event_type: string; detail: Record<string, unknown> }[]> {
  const r = await adm.query("SELECT event_type, detail FROM public.security_events WHERE user_id = $1 ORDER BY occurred_at, id", [userId]);
  return r.rows;
}

/** Personel açar + etkinleştirir; cihaz çerezi ve oturum çerezi döner. */
async function enrolled(fx: Fx, role: "PICKER" | "COUNTER" = "PICKER") {
  const username = `p${randomBytes(4).toString("hex")}`;
  const created = await createFieldUser({ ...access(fx), name: "Saha Personeli", username, roleKey: role }, accountPort);
  const pin = goodPin();
  const res = await post("/field/activate", { workspace: fx.slug, username, code: created.code, pin, deviceName: "Test telefonu" });
  expect(res.status, "etkinleştirme").toBe(200);
  const jar = jarFrom(res);
  return { ...created, pin, jar, device: deviceOnly(jar) };
}

// ---------------------------------------------------------------------------------------------
describe("saha hesabı açılışı (yönetici)", () => {
  it("kod bir kez döner; DB'de yalnız özet; iç e-posta; rol saha; uygulama rolü özetleri okuyamaz", async () => {
    const fx = await mkTenant();
    const r = await createFieldUser({ ...access(fx), name: "Ayşe Yılmaz", username: " Ayşe.Yılmaz ", roleKey: "COUNTER" }, accountPort);
    expect(r.username).toBe("ayse.yilmaz");
    expect(r.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(r.expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);
    const row = await adm.query("SELECT activation_hash, pin_hash FROM public.field_logins WHERE user_id = $1", [r.userId]);
    expect(row.rows[0]?.activation_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row.rows[0])).not.toContain(r.code.replace("-", ""));
    expect(row.rows[0]?.pin_hash).toBeNull();
    const u = await adm.query("SELECT email FROM public.users WHERE id = $1", [r.userId]);
    expect(u.rows[0]?.email).toMatch(/@field\.invalid$/);
    const acc = await adm.query("SELECT count(*)::int AS n FROM public.accounts WHERE user_id = $1", [r.userId]);
    expect(acc.rows[0]?.n).toBe(0);
    const roles = await adm.query("SELECT role_key FROM public.membership_roles WHERE membership_id = $1", [r.membershipId]);
    expect(roles.rows.map((x: { role_key: string }) => x.role_key)).toEqual(["COUNTER"]);
    const list = await listFieldLogins(access(fx));
    expect(list).toEqual([{ membershipId: r.membershipId, username: "ayse.yilmaz", active: false, pendingUntil: expect.any(Date), locked: false }]);
    const audit = await adm.query("SELECT change_summary FROM public.audit_logs WHERE tenant_id = $1 AND action = 'field_user.created'", [fx.tenant]);
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows)).not.toContain(r.code);
    // Uygulama rolü PIN/kod özetini okuyamaz.
    const c = new pg.Client({ connectionString: env.databaseUrl });
    c.on("error", () => undefined);
    await c.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [fx.tenant]);
      const denied = await c.query("SELECT activation_hash FROM public.field_logins").then(
        () => "ok",
        (e: { code?: string }) => e.code,
      );
      expect(denied).toBe("42501");
      await c.query("ROLLBACK");
    } finally {
      await c.end();
    }
  });

  it("kullanıcı adı alan içinde tekil; yönetim rolü ve biçimsiz girdi reddedilir; yalnız users.manage", async () => {
    const fx = await mkTenant();
    const username = `u${randomBytes(4).toString("hex")}`;
    await createFieldUser({ ...access(fx), name: "Bir", username, roleKey: "PICKER" }, accountPort);
    expect((await failure(createFieldUser({ ...access(fx), name: "İki", username, roleKey: "PICKER" }, accountPort))).detail).toBe("CODE_TAKEN");
    expect((await failure(createFieldUser({ ...access(fx), name: "Üç", username: `x${username}`, roleKey: "TENANT_ADMIN" }, accountPort))).code).toBe("VALIDATION_FAILED");
    expect((await failure(createFieldUser({ ...access(fx), name: "Dört", username: "a b", roleKey: "PICKER" }, accountPort))).code).toBe("VALIDATION_FAILED");
    // Yakın doğrulama bağlanmadan hesap açılamaz ve kod yenilenemez (fail-closed).
    const { recentAuth: _omit, ...noReauth } = access(fx);
    void _omit;
    expect((await failure(createFieldUser({ ...noReauth, name: "Altı", username: `z${username}`, roleKey: "PICKER" }, accountPort))).detail).toBe("RECENT_AUTH_REQUIRED");
    // Var olmayan depo kapsamı: hesap AÇILMAZ (kapsam aynı transaction'da; "tüm depolar" ile yarım hesap kalmaz).
    const ghostWh = await failure(
      createFieldUser({ ...access(fx), name: "Yedi", username: `w${username}`, roleKey: "PICKER", warehouseId: randomUUID() }, accountPort),
    );
    expect(ghostWh.code).toBe("VALIDATION_FAILED");
    const leftover = await adm.query("SELECT count(*)::int AS n FROM public.field_logins WHERE tenant_id = $1 AND username = $2", [fx.tenant, `w${username}`]);
    expect(leftover.rows[0]?.n).toBe(0);
    // PICKER üyesi saha hesabı açamaz.
    const picker = await enrolled(fx);
    const asPicker = { db: app, principal: { userId: picker.userId, mfaVerified: true }, tenantSlug: fx.slug, recentAuth };
    const e = await failure(createFieldUser({ ...asPicker, name: "Beş", username: `y${username}`, roleKey: "PICKER" }, accountPort));
    expect(e.code).toBe("FORBIDDEN");
  });

  it("saha hesabına yönetim rolü verilemez (rol değişimi); saha rolleri arasında geçiş serbest", async () => {
    const fx = await mkTenant();
    const p = await createFieldUser({ ...access(fx), name: "Rol", username: `r${randomBytes(4).toString("hex")}`, roleKey: "PICKER" }, accountPort);
    for (const role of ["TENANT_ADMIN", "WAREHOUSE_MANAGER", "READ_ONLY"]) {
      const err = await failure(changeRole({ ...access(fx), memberId: p.membershipId, roleKey: role }, { demoEmailDomain: null }));
      expect(err.code).toBe("FORBIDDEN");
      expect((err.cause as MembershipDenied).reason).toBe("FIELD_ACCOUNT");
    }
    expect((await changeRole({ ...access(fx), memberId: p.membershipId, roleKey: "COUNTER" }, { demoEmailDomain: null })).changed).toBe(true);
  });
});

describe("etkinleştirme ve giriş", () => {
  it("etkinleştirme: kod tek kullanım; cihaz çerezi httpOnly + SameSite=Strict; oturum MFA'lı ama yakın doğrulamayı karşılamaz", async () => {
    const fx = await mkTenant();
    const username = `a${randomBytes(4).toString("hex")}`;
    const created = await createFieldUser({ ...access(fx), name: "Etkin", username, roleKey: "PICKER" }, accountPort);
    const pin = goodPin();
    // Bariz PIN reddedilir (kod tüketilmez).
    expect((await post("/field/activate", { workspace: fx.slug, username, code: created.code, pin: "123456" })).status).toBe(400);
    const res = await post("/field/activate", { workspace: fx.slug, username, code: created.code.toLowerCase(), pin });
    expect(res.status).toBe(200);
    const setCookie = res.headers.getSetCookie().find((l) => l.startsWith(`${DEVICE_COOKIE}=`)) ?? "";
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).not.toMatch(/Domain=/i);
    const jar = jarFrom(res);
    const principal = await auth.getPrincipal(new Headers({ cookie: jar }));
    expect(principal?.userId).toBe(created.userId);
    expect(principal?.fieldStaff).toBe(true);
    expect(principal?.mfaVerified).toBe(true);
    await expect(auth.ensureRecentAuth(new Headers({ cookie: jar }))).rejects.toMatchObject({ reason: "REAUTH_REQUIRED" });
    // Boşta üst sınırı (2 saat) sunucuda: güncellenmemiş oturum iptal edilir.
    const idle = await post("/field/sign-in", { workspace: fx.slug, username, pin }, deviceOnly(jar));
    expect(idle.status).toBe(200);
    const idleJar = jarFrom(idle);
    await adm.query(
      "UPDATE public.sessions SET created_at = now() - interval '3 hours', updated_at = now() - interval '3 hours', expires_at = now() + interval '9 hours' WHERE user_id = $1 AND token = $2",
      [created.userId, (idleJar.split("; ").find((c) => c.includes("session_token"))?.split("=")[1] ?? "").split(".")[0]],
    );
    // Better Auth'un kendi uçları (get-session) boşta oturumu yenileyip canlandıramaz (inceleme N1).
    const gs = await get("/get-session", idleJar);
    expect(await gs.json().catch(() => null)).toBeNull();
    expect(await auth.getPrincipal(new Headers({ cookie: idleJar }))).toBeNull();
    // Etkin oturum (30 dk önce kullanılmış, yenileme zamanı gelmiş) geçerli kalır ve yenilenir.
    const live = await post("/field/sign-in", { workspace: fx.slug, username, pin }, deviceOnly(idleJar));
    expect(live.status).toBe(200);
    const liveJar = jarFrom(live);
    const liveToken = (liveJar.split("; ").find((c) => c.includes("session_token"))?.split("=")[1] ?? "").split(".")[0];
    await adm.query(
      "UPDATE public.sessions SET updated_at = now() - interval '30 minutes', expires_at = now() + interval '11 hours 30 minutes' WHERE token = $1",
      [liveToken],
    );
    expect((await auth.getPrincipal(new Headers({ cookie: liveJar })))?.userId).toBe(created.userId);
    const refreshed = await adm.query<{ fresh: boolean }>("SELECT updated_at > now() - interval '1 minute' AS fresh FROM public.sessions WHERE token = $1", [liveToken]);
    expect(refreshed.rows[0]?.fresh).toBe(true);
    // Aynı kod ikinci kez kullanılamaz.
    expect((await post("/field/activate", { workspace: fx.slug, username, code: created.code, pin: goodPin() })).status).toBe(401);
    // Cihaz durumu: yalnız alan ve cihaz adı.
    const st = (await (await get("/field/device", deviceOnly(liveJar))).json()) as Record<string, unknown>;
    expect(st).toMatchObject({ registered: true, workspace: fx.slug, kind: "PERSONAL" });
    expect(JSON.stringify(st)).not.toContain(created.userId);
  });

  it("etkinleştirme ucu kilit koymaz ve kilit bildirmez: kod beklemeyen hesapta sayaç değişmez; 5 yanlış kod kodu geçersiz kılar", async () => {
    const fx = await mkTenant();
    const p = await enrolled(fx);
    // Kod beklemeyen (etkin) hesap: çok sayıda deneme → hep aynı genel ret; PIN girişi etkilenmez.
    for (let i = 0; i < 7; i++) {
      const r = await post("/field/activate", { workspace: fx.slug, username: p.username, code: "ABCD-EFGH", pin: goodPin() });
      expect([r.status, await code(r)]).toEqual([401, "FIELD_LOGIN_DENIED"]);
    }
    const st = await adm.query("SELECT failed_count, lock_count, locked_until FROM public.field_logins WHERE user_id = $1", [p.userId]);
    expect(st.rows[0]).toEqual({ failed_count: 0, lock_count: 0, locked_until: null });
    expect((await post("/field/sign-in", { workspace: fx.slug, username: p.username, pin: p.pin }, p.device)).status).toBe(200);
    // Bekleyen kod: 5 yanlış denemede kod geçersiz, doğru kod da artık çalışmaz.
    const q = await createFieldUser({ ...access(fx), name: "Kod", username: `k${randomBytes(4).toString("hex")}`, roleKey: "PICKER" }, accountPort);
    const wrong = q.code.startsWith("A") ? "BBBB-BBBB" : "AAAA-AAAA";
    for (let i = 0; i < 5; i++) {
      const r = await post("/field/activate", { workspace: fx.slug, username: q.username, code: wrong, pin: goodPin() });
      expect([r.status, await code(r)]).toEqual([401, "FIELD_LOGIN_DENIED"]);
    }
    const after = await post("/field/activate", { workspace: fx.slug, username: q.username, code: q.code, pin: goodPin() });
    expect([after.status, await code(after)]).toEqual([401, "FIELD_LOGIN_DENIED"]);
    const row = await adm.query("SELECT activation_hash, locked_until FROM public.field_logins WHERE user_id = $1", [q.userId]);
    expect(row.rows[0]).toEqual({ activation_hash: null, locked_until: null });
  });

  it("paralel denemeler 5'i aşamaz: doğrulanmamış ayrılmış denemeler doluysa giriş kilitlenir ve doğru PIN de reddedilir", async () => {
    const fx = await mkTenant();
    const p = await enrolled(fx);
    const wrong = p.pin === "482915" ? "579302" : "482915";
    const res = await Promise.all(
      Array.from({ length: 8 }, () => post("/field/sign-in", { workspace: fx.slug, username: p.username, pin: wrong }, p.device)),
    );
    const codes = await Promise.all(res.map((r) => code(r)));
    expect(codes.filter((c) => c === "FIELD_LOGIN_DENIED").length).toBeLessThanOrEqual(5);
    expect(codes).toContain("FIELD_LOGIN_LOCKED");
    const ok = await post("/field/sign-in", { workspace: fx.slug, username: p.username, pin: p.pin }, p.device);
    expect([ok.status, await code(ok)]).toEqual([403, "FIELD_LOGIN_LOCKED"]);
  });

  it("giriş: kayıtlı cihaz şart; belirteç her girişte yenilenir (eski çerez geçersiz); bilinmeyenler aynı genel ret", async () => {
    const fx = await mkTenant();
    const p = await enrolled(fx);
    const ok = await post("/field/sign-in", { workspace: fx.slug, username: p.username, pin: p.pin }, p.device);
    expect(ok.status).toBe(200);
    const rotated = deviceOnly(jarFrom(ok));
    expect(rotated).not.toBe(p.device);
    expect(rotated).not.toBe("");
    // Eski belirteç artık geçersiz.
    const stale = await post("/field/sign-in", { workspace: fx.slug, username: p.username, pin: p.pin }, p.device);
    expect([stale.status, await code(stale)]).toEqual([401, "FIELD_LOGIN_DENIED"]);
    // Cihazsız, bilinmeyen kullanıcı, bilinmeyen alan: aynı yanıt.
    for (const [body, cookie] of [
      [{ workspace: fx.slug, username: p.username, pin: p.pin }, ""],
      [{ workspace: fx.slug, username: "yok-boyle-biri", pin: p.pin }, rotated],
      [{ workspace: "yok-boyle-alan", username: p.username, pin: p.pin }, rotated],
    ] as const) {
      const r = await post("/field/sign-in", body, cookie);
      expect([r.status, await code(r)]).toEqual([401, "FIELD_LOGIN_DENIED"]);
    }
    const good = await post("/field/sign-in", { workspace: fx.slug, username: p.username, pin: p.pin }, rotated);
    expect(good.status).toBe(200);
  });

  it("kişisel cihaz yalnız kendi kullanıcısına giriş açar; başka tenant'ın cihazı reddedilir", async () => {
    const fx = await mkTenant();
    const a = await enrolled(fx);
    const b = await enrolled(fx);
    const r = await post("/field/sign-in", { workspace: fx.slug, username: b.username, pin: b.pin }, a.device);
    expect([r.status, await code(r)]).toEqual([401, "FIELD_LOGIN_DENIED"]);
    const other = await mkTenant();
    const c = await enrolled(other);
    const x = await post("/field/sign-in", { workspace: fx.slug, username: a.username, pin: a.pin }, c.device);
    expect([x.status, await code(x)]).toEqual([401, "FIELD_LOGIN_DENIED"]);
  });

  it("5 yanlış PIN → kilit (doğru PIN de reddedilir); yönetici kilidi açar", async () => {
    const fx = await mkTenant();
    const p = await enrolled(fx);
    const wrong = p.pin === "482915" ? "579302" : "482915";
    let device = p.device;
    const codes: (string | undefined)[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await post("/field/sign-in", { workspace: fx.slug, username: p.username, pin: wrong }, device);
      codes.push(await code(r));
      device = deviceOnly(jarFrom(r, device)) || device;
    }
    expect(codes).toEqual(["FIELD_LOGIN_DENIED", "FIELD_LOGIN_DENIED", "FIELD_LOGIN_DENIED", "FIELD_LOGIN_DENIED", "FIELD_LOGIN_LOCKED"]);
    const locked = await post("/field/sign-in", { workspace: fx.slug, username: p.username, pin: p.pin }, device);
    expect([locked.status, await code(locked)]).toEqual([403, "FIELD_LOGIN_LOCKED"]);
    expect((await listFieldLogins(access(fx))).find((x) => x.username === p.username)?.locked).toBe(true);
    await unlockFieldLogin({ ...access(fx), memberId: p.membershipId });
    const again = await post("/field/sign-in", { workspace: fx.slug, username: p.username, pin: p.pin }, device);
    expect(again.status).toBe(200);
    const ev = (await events(p.userId)).map((e) => e.event_type);
    expect(ev).toContain("field_login.locked");
    expect(ev).toContain("field_login.succeeded");
  });

  it("kod yenileme: eski PIN, kişisel cihaz ve açık oturum geçersiz; yeni kodla yeniden etkinleştirme", async () => {
    const fx = await mkTenant();
    const p = await enrolled(fx);
    expect(await auth.getPrincipal(new Headers({ cookie: p.jar }))).not.toBeNull();
    const fresh = await resetFieldCode({ ...access(fx), memberId: p.membershipId }, revokePort);
    expect(fresh.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(await auth.getPrincipal(new Headers({ cookie: p.jar }))).toBeNull();
    const old = await post("/field/sign-in", { workspace: fx.slug, username: p.username, pin: p.pin }, p.device);
    expect([old.status, await code(old)]).toEqual([401, "FIELD_LOGIN_DENIED"]);
    const pin = goodPin();
    const res = await post("/field/activate", { workspace: fx.slug, username: p.username, code: fresh.code, pin });
    expect(res.status).toBe(200);
    const ok = await post("/field/sign-in", { workspace: fx.slug, username: p.username, pin }, deviceOnly(jarFrom(res)));
    expect(ok.status).toBe(200);
  });

  it("DB'de yönetim rolü verilmiş saha hesabı giriş yapamaz (rol her girişte okunur); çıkarılan üye de yapamaz", async () => {
    const fx = await mkTenant();
    const p = await enrolled(fx);
    await adm.query("UPDATE public.membership_roles SET role_key = 'WAREHOUSE_MANAGER' WHERE membership_id = $1", [p.membershipId]);
    const r = await post("/field/sign-in", { workspace: fx.slug, username: p.username, pin: p.pin }, p.device);
    expect([r.status, await code(r)]).toEqual([401, "FIELD_LOGIN_DENIED"]);
    await adm.query("UPDATE public.membership_roles SET role_key = 'PICKER' WHERE membership_id = $1", [p.membershipId]);
    await adm.query("UPDATE public.tenant_memberships SET status = 'REMOVED', removed_at = now() WHERE id = $1", [p.membershipId]);
    const s = await post("/field/sign-in", { workspace: fx.slug, username: p.username, pin: p.pin }, p.device);
    expect([s.status, await code(s)]).toEqual([401, "FIELD_LOGIN_DENIED"]);
    const reasons = (await events(p.userId)).filter((e) => e.event_type === "field_login.failed").map((e) => e.detail.reason);
    expect(reasons).toEqual(expect.arrayContaining(["role"]));
  });
});

describe("e-posta uçları ve olaylar", () => {
  it("iç e-posta ile e-posta/parola girişi ve sıfırlama reddedilir; saha oturumu hesap uçlarını kullanamaz", async () => {
    const fx = await mkTenant();
    const p = await enrolled(fx);
    const u = await adm.query<{ email: string }>("SELECT email FROM public.users WHERE id = $1", [p.userId]);
    const email = (u.rows[0] as { email: string }).email;
    const s = await post("/sign-in/email", { email, password: `P${randomBytes(12).toString("hex")}` });
    expect(s.status).toBe(401);
    // Self-servis sıfırlama bu ortamda kapalı olabilir (posta yok): her durumda başarı dönmez.
    const rp = await post("/request-password-reset", { email, redirectTo: `${BASE}/reset` });
    expect(rp.ok).toBe(false);
    const tf = await post("/two-factor/enable", { password: "x" }, p.jar);
    expect([tf.status, await code(tf)]).toEqual([403, "FIELD_ACCOUNT_FORBIDDEN"]);
  });

  it("olay detayında PIN/kod/belirteç yok; uygulama rolü saha olayı yazamaz", async () => {
    const fx = await mkTenant();
    const p = await enrolled(fx);
    await post("/field/sign-in", { workspace: fx.slug, username: p.username, pin: p.pin }, p.device);
    const ev = await events(p.userId);
    expect(ev.map((e) => e.event_type)).toEqual(expect.arrayContaining(["field_pin.set", "device.enrolled", "field_login.succeeded"]));
    const blob = JSON.stringify(ev);
    expect(blob).not.toContain(p.pin);
    expect(blob).not.toContain(p.code);
    expect(blob).not.toContain(p.code.replace("-", ""));
    expect(blob).not.toContain(p.device.split("=")[1]?.split(".")[1] ?? "never");
    const c = new pg.Client({ connectionString: env.databaseUrl });
    c.on("error", () => undefined);
    await c.connect();
    try {
      const w = await c
        .query("INSERT INTO public.security_events (user_id, event_type, detail) VALUES ($1, 'field_login.succeeded', '{}'::jsonb)", [p.userId])
        .then(
          () => "ok",
          (e: { code?: string }) => e.code,
        );
      expect(w).toBe("42501");
    } finally {
      await c.end();
    }
  });
});
