// T-998 (ADR-026 §7.5–7.7, 0045): ortak cihaz kaydı (5 dk QR → terminal talebi → yönetici onayı), cihaz listesi/iptal (oturumlar kapanır),
// ortak cihazda personel listesi ve hızlı kullanıcı değişimi. Gerçek wms_app / wms_auth bağlantıları + RLS; Better Auth uçları `handler` ile.
// Fikstürler sentetik (G-09).
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { createAuth, readAuthEnv, type AuthService } from "../../../packages/auth/src/index.ts";
import { AppError } from "../../../packages/shared/src/errors.ts";
import { pinProblem } from "../../../packages/shared/src/field-login.ts";
import { createFieldUser } from "../../../packages/domain/src/identity/field-users.ts";
import { approveEnrollment, cancelEnrollment, getEnrollment, listDevices, listSuspendedDevices, revokeDevice, startEnrollment } from "../../../packages/domain/src/identity/devices.ts";
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
  const slug = `t998-${randomBytes(5).toString("hex")}`;
  await adm.query("INSERT INTO public.tenants (id, slug, name, is_demo) VALUES ($1, $2, 'T997', false)", [tenant, slug]);
  const u = await adm.query<{ id: string }>(
    "INSERT INTO public.users (name, email, email_verified, two_factor_enabled) VALUES ('T997 owner', $1, true, true) RETURNING id",
    [`t998-${randomBytes(6).toString("hex")}@example.test`],
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
        "user-agent": "t998-int-test",
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
async function expectDenied(tenant: string, query: string): Promise<string | undefined> {
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

const devicePort = { revokeDeviceSessions: (deviceId: string) => auth.revokeDeviceSessions(deviceId) };

/** Terminal: kayıt talebi → yönetici onayı → kayıtlı ortak cihaz çerezi. */
async function sharedDevice(fx: Fx, name = "El terminali 1"): Promise<{ cookie: string; enrollmentId: string; deviceId: string }> {
  const e = await startEnrollment(access(fx));
  const res = await post("/field/enroll", { enrollment: e.secret, deviceName: name });
  expect(res.status, "talep").toBe(200);
  const cookie = deviceOnly(jarFrom(res));
  const confirmCode = ((await res.json()) as { confirmCode: string }).confirmCode;
  const ok = await approveEnrollment({ ...access(fx), enrollmentId: e.enrollmentId, confirmCode });
  return { cookie, enrollmentId: e.enrollmentId, deviceId: ok.deviceId };
}

describe("ortak cihaz kaydı", () => {
  it("yakın doğrulama zorunlu; talep bir kez; onaydan önce cihaz kayıtlı değil; onayla SHARED cihaz; olaylar", async () => {
    const fx = await mkTenant();
    const { recentAuth: _r, ...noReauth } = access(fx);
    void _r;
    expect((await failure(startEnrollment(noReauth))).detail).toBe("RECENT_AUTH_REQUIRED");
    const e = await startEnrollment(access(fx));
    expect(e.secret.startsWith(`${fx.tenant}.`)).toBe(true);
    expect(e.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000 + 5_000);
    const stored = await adm.query("SELECT token_hash FROM public.field_enrollments WHERE id = $1", [e.enrollmentId]);
    expect(JSON.stringify(stored.rows)).not.toContain(e.secret.split(".")[1]);
    expect((await getEnrollment({ ...access(fx), enrollmentId: e.enrollmentId })).state).toBe("WAITING");
    const res = await post("/field/enroll", { enrollment: e.secret, deviceName: "El terminali 1" });
    expect(res.status).toBe(200);
    const cookie = deviceOnly(jarFrom(res));
    const confirmCode = ((await res.json()) as { confirmCode: string }).confirmCode;
    expect(confirmCode).toMatch(/^\d{6}$/);
    // Uygulama rolü doğrulama kodunu okuyamaz (yönetici terminalden okur).
    const appRead = await expectDenied(fx.tenant, "SELECT confirm_code FROM public.field_enrollments");
    expect(appRead).toBe("42501");
    expect(cookie).not.toBe("");
    // Onaysız: kayıtlı değil, giriş yok.
    expect(((await (await get("/field/device", cookie)).json()) as { registered: boolean }).registered).toBe(false);
    // İkinci talep (QR fotoğrafı) reddedilir.
    const again = await post("/field/enroll", { enrollment: e.secret, deviceName: "Sahte" });
    expect([again.status, await code(again)]).toEqual([401, "FIELD_LOGIN_DENIED"]);
    const st = await getEnrollment({ ...access(fx), enrollmentId: e.enrollmentId });
    expect([st.state, st.deviceName]).toEqual(["CLAIMED", "El terminali 1"]);
    // Yanlış kod: onay yok (hata), kayıt hâlâ beklemede.
    const wrong = confirmCode === "000000" ? "111111" : "000000";
    expect((await failure(approveEnrollment({ ...access(fx), enrollmentId: e.enrollmentId, confirmCode: wrong }))).detail).toBe("CODE_MISMATCH");
    const { deviceId } = await approveEnrollment({ ...access(fx), enrollmentId: e.enrollmentId, confirmCode });
    const dev = (await (await get("/field/device", cookie)).json()) as Record<string, unknown>;
    expect(dev).toMatchObject({ registered: true, kind: "SHARED", deviceName: "El terminali 1" });
    expect((await listDevices(access(fx))).find((d) => d.id === deviceId)?.kind).toBe("SHARED");
    // Aynı kayıt ikinci kez onaylanamaz.
    expect((await failure(approveEnrollment({ ...access(fx), enrollmentId: e.enrollmentId, confirmCode }))).code).toBe("NOT_FOUND");
    const ev = await adm.query("SELECT event_type FROM public.security_events WHERE detail ->> 'device_id' = $1", [deviceId]);
    expect(ev.rows.map((r: { event_type: string }) => r.event_type)).toContain("device.enrolled");
  });

  it("süresi dolmuş/iptal edilmiş kayıt talep edilemez; başka yönetici ve başka tenant onaylayamaz", async () => {
    const fx = await mkTenant();
    const e1 = await startEnrollment(access(fx));
    await adm.query("UPDATE public.field_enrollments SET expires_at = now() - interval '1 second', created_at = now() - interval '6 minutes' WHERE id = $1", [e1.enrollmentId]);
    expect((await post("/field/enroll", { enrollment: e1.secret, deviceName: "Geç" })).status).toBe(401);
    expect((await getEnrollment({ ...access(fx), enrollmentId: e1.enrollmentId })).state).toBe("EXPIRED");
    const e2 = await startEnrollment(access(fx));
    await cancelEnrollment({ ...access(fx), enrollmentId: e2.enrollmentId });
    expect((await post("/field/enroll", { enrollment: e2.secret, deviceName: "İptal" })).status).toBe(401);
    const e3 = await startEnrollment(access(fx));
    const c3 = await post("/field/enroll", { enrollment: e3.secret, deviceName: "Terminal" });
    expect(c3.status).toBe(200);
    const code3 = ((await c3.json()) as { confirmCode: string }).confirmCode;
    // Aynı tenant'ta başka yönetici: kayıt görünmez/onaylanamaz.
    const u = await adm.query<{ id: string }>("INSERT INTO public.users (name, email, email_verified, two_factor_enabled) VALUES ('Diğer', $1, true, true) RETURNING id", [`t998-o-${randomBytes(5).toString("hex")}@example.test`]);
    const otherId = (u.rows[0] as { id: string }).id;
    const m = await adm.query<{ id: string }>("INSERT INTO public.tenant_memberships (tenant_id, user_id, status, is_owner) VALUES ($1, $2, 'ACTIVE', false) RETURNING id", [fx.tenant, otherId]);
    await adm.query("INSERT INTO public.membership_roles (tenant_id, membership_id, role_key) VALUES ($1, $2, 'TENANT_ADMIN')", [fx.tenant, (m.rows[0] as { id: string }).id]);
    const other = { db: app, principal: { userId: otherId, mfaVerified: true }, tenantSlug: fx.slug, recentAuth };
    expect((await failure(approveEnrollment({ ...other, enrollmentId: e3.enrollmentId, confirmCode: code3 }))).code).toBe("NOT_FOUND");
    expect((await failure(getEnrollment({ ...other, enrollmentId: e3.enrollmentId }))).code).toBe("NOT_FOUND");
    const fy = await mkTenant();
    expect((await failure(approveEnrollment({ ...access(fy), enrollmentId: e3.enrollmentId, confirmCode: code3 }))).code).toBe("NOT_FOUND");
    // Asıl yönetici onaylayabilir.
    expect((await approveEnrollment({ ...access(fx), enrollmentId: e3.enrollmentId, confirmCode: code3 })).deviceId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("ortak cihazda kullanım ve iptal", () => {
  it("personel listesi yalnız ortak cihazda; iki personel aynı cihazdan girer; iptal oturumları kapatır ve girişi keser", async () => {
    const fx = await mkTenant();
    const a = await enrolled(fx);
    const b = await enrolled(fx);
    const shared = await sharedDevice(fx);
    const staff = ((await (await get("/field/staff", shared.cookie)).json()) as { staff: { name: string; username: string }[] }).staff;
    expect(staff.map((s) => s.username).sort()).toEqual([a.username, b.username].sort());
    // Kişisel cihazda liste boş.
    expect(((await (await get("/field/staff", a.device)).json()) as { staff: unknown[] }).staff).toEqual([]);
    // Hızlı kullanıcı değişimi: aynı cihazdan iki personel sırayla.
    let cookie = shared.cookie;
    const sa = await post("/field/sign-in", { workspace: fx.slug, username: a.username, pin: a.pin }, cookie);
    expect(sa.status).toBe(200);
    const jarA = jarFrom(sa);
    cookie = deviceOnly(jarA);
    const sb = await post("/field/sign-in", { workspace: fx.slug, username: b.username, pin: b.pin }, cookie);
    expect(sb.status).toBe(200);
    const jarB = jarFrom(sb);
    cookie = deviceOnly(jarB);
    expect((await auth.getPrincipal(new Headers({ cookie: jarA })))?.userId).toBe(a.userId);
    expect((await auth.getPrincipal(new Headers({ cookie: jarB })))?.userId).toBe(b.userId);
    const links = await adm.query("SELECT count(*)::int AS n FROM public.field_sessions WHERE device_id = $1", [shared.deviceId]);
    expect(links.rows[0]?.n).toBe(2);
    // İptal: iki oturum da kapanır, cihazla giriş reddedilir, olay yazılır.
    await revokeDevice({ ...access(fx), deviceId: shared.deviceId }, devicePort);
    expect(await auth.getPrincipal(new Headers({ cookie: jarA }))).toBeNull();
    expect(await auth.getPrincipal(new Headers({ cookie: jarB }))).toBeNull();
    const after = await post("/field/sign-in", { workspace: fx.slug, username: a.username, pin: a.pin }, cookie);
    expect([after.status, await code(after)]).toEqual([401, "FIELD_LOGIN_DENIED"]);
    expect((await listDevices(access(fx))).some((d) => d.id === shared.deviceId)).toBe(false);
    expect((await failure(revokeDevice({ ...access(fx), deviceId: shared.deviceId }, devicePort))).code).toBe("NOT_FOUND");
    const ev = await adm.query("SELECT event_type FROM public.security_events WHERE detail ->> 'device_id' = $1 AND event_type = 'device.revoked'", [shared.deviceId]);
    expect(ev.rows).toHaveLength(1);
    // Kişisel cihaz etkilenmez.
    expect((await post("/field/sign-in", { workspace: fx.slug, username: a.username, pin: a.pin }, a.device)).status).toBe(200);
  });

  it("başka tenant yöneticisi cihazı iptal edemez ve listeyi göremez; PICKER cihaz yönetemez", async () => {
    const fx = await mkTenant();
    const shared = await sharedDevice(fx);
    const fy = await mkTenant();
    expect((await failure(revokeDevice({ ...access(fy), deviceId: shared.deviceId }, devicePort))).code).toBe("NOT_FOUND");
    expect((await listDevices(access(fy))).some((d) => d.id === shared.deviceId)).toBe(false);
    const p = await enrolled(fx);
    const asPicker = { db: app, principal: { userId: p.userId, mfaVerified: true }, tenantSlug: fx.slug, recentAuth };
    expect((await failure(listDevices(asPicker))).code).toBe("FORBIDDEN");
    expect((await failure(startEnrollment(asPicker))).code).toBe("FORBIDDEN");
    expect(((await (await get("/field/device", shared.cookie)).json()) as { registered: boolean }).registered).toBe(true);
  });

  it("QR'ı ilk okutan başka cihaz kodu bilmeden onaylatamaz: 3 yanlış kodda kayıt iptal", async () => {
    const fx = await mkTenant();
    const e = await startEnrollment(access(fx));
    const r = await post("/field/enroll", { enrollment: e.secret, deviceName: "El terminali" });
    const real = ((await r.json()) as { confirmCode: string }).confirmCode;
    const guesses = ["000000", "111111", "222222", "333333"].filter((g) => g !== real).slice(0, 3);
    for (const g of guesses) {
      expect((await failure(approveEnrollment({ ...access(fx), enrollmentId: e.enrollmentId, confirmCode: g }))).detail).toBe("CODE_MISMATCH");
    }
    expect((await getEnrollment({ ...access(fx), enrollmentId: e.enrollmentId })).state).toBe("CANCELLED");
    expect((await failure(approveEnrollment({ ...access(fx), enrollmentId: e.enrollmentId, confirmCode: real }))).code).toBe("NOT_FOUND");
  });

  it("toplu kilitleme: aynı ortak cihazdan 3 hesap kilitlenince cihaz kendiliğinden durur; yönetici listesinde uyarı", async () => {
    const fx = await mkTenant();
    const users = [await enrolled(fx), await enrolled(fx), await enrolled(fx)];
    const shared = await sharedDevice(fx, "Tablet 3");
    let cookie = shared.cookie;
    for (const u of users) {
      const wrong = u.pin === "482915" ? "579302" : "482915";
      for (let i = 0; i < 5; i++) {
        const r = await post("/field/sign-in", { workspace: fx.slug, username: u.username, pin: wrong }, cookie);
        cookie = deviceOnly(jarFrom(r, cookie)) || cookie;
      }
    }
    const dev = await adm.query("SELECT revoked_at IS NOT NULL AS revoked, revoke_reason FROM public.field_devices WHERE id = $1", [shared.deviceId]);
    expect(dev.rows[0]).toEqual({ revoked: true, revoke_reason: "LOCK_SPREE" });
    expect((await listSuspendedDevices(access(fx))).map((d) => d.name)).toEqual(["Tablet 3"]);
    const ev = await adm.query("SELECT count(*)::int AS n FROM public.security_events WHERE event_type = 'device.suspended' AND detail ->> 'device_id' = $1", [shared.deviceId]);
    expect(ev.rows[0]?.n).toBe(1);
  });

  it("iptal edilmiş cihazda oturum kapatma yeniden denenebilir (yarıda kalan iptal)", async () => {
    const fx = await mkTenant();
    const a = await enrolled(fx);
    const shared = await sharedDevice(fx);
    const s1 = await post("/field/sign-in", { workspace: fx.slug, username: a.username, pin: a.pin }, shared.cookie);
    const jar = jarFrom(s1);
    // İlk iptalde oturum kapatma "başarısız" olsun.
    await expect(revokeDevice({ ...access(fx), deviceId: shared.deviceId }, { revokeDeviceSessions: () => Promise.reject(new Error("down")) })).rejects.toThrow();
    expect(await auth.getPrincipal(new Headers({ cookie: jar }))).not.toBeNull();
    // Yeniden deneme: cihaz zaten iptal, oturumlar yine kapanır.
    await revokeDevice({ ...access(fx), deviceId: shared.deviceId }, devicePort);
    expect(await auth.getPrincipal(new Headers({ cookie: jar }))).toBeNull();
    const by = await adm.query("SELECT revoked_by FROM public.field_devices WHERE id = $1", [shared.deviceId]);
    expect(by.rows[0]?.revoked_by).toBe(fx.ownerId);
  });
});
