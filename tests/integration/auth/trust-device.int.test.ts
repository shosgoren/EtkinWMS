// T-923 güvenilen cihaz ("Bu cihazı 30 gün hatırla"; ADR-014 §12 M4 eki, kullanıcı kararı 20 Ekim 2026) entegrasyon testi:
// gerçek Postgres, gerçek roller, `auth.handler` üzerinden HTTP. Parolalar/gizler çalışma anında üretilir (G-09).
//
// Kanıtlanan: güvenilen çerezle TOTP atlanır ve oturum MFA'lı açılır; süre MUTLAK (eklentinin 30 gün uzatması geri alınır);
// çerezsiz/bozuk/başka kullanıcının/süresi dolmuş çerezle TOTP istenir; yeniden doğrulama girişinde (`x-wms-reauth: 1`) çerez yok
// sayılır ve güvenilen oturum hassas işlem penceresini açmaz; parola değişimi, 2FA kapatma, yedek kod yenileme ve "tüm
// cihazlardan çık" güvenilen cihaz kayıtlarını siler.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS, type DbClient } from "../../../packages/db/src/client.ts";
import { AuthError, REAUTH_HEADER, TRUST_DEVICE_MAX_AGE_SEC, createAuth, readAuthEnv, type AuthService } from "../../../packages/auth/src/index.ts";
import { hashPassword } from "../../../packages/auth/src/password.ts";
import { readAuthDatabaseUrl, readIntEnv, redactErrorChain } from "../harness/env.ts";

const env = readIntEnv(process.env);
const authUrl = readAuthDatabaseUrl(process.env);
const urls = [env.databaseUrl, env.databaseUrlDirect, authUrl];

const BASE = "http://localhost:3000";
const PASSWORD = `P${randomBytes(12).toString("hex")}`;
const NEW_PASSWORD = `N${randomBytes(12).toString("hex")}`;
const SECRET = randomBytes(32).toString("hex");
const TRUST = "better-auth.trust_device";

let service: AuthService;
let authClient: DbClient;
let adm: pg.Client;

async function connect(url: string): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: url });
  c.on("error", () => undefined);
  try {
    await c.connect();
  } catch (e) {
    throw new Error(`connect failed: ${redactErrorChain(e, urls)}`);
  }
  return c;
}

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

function post(path: string, body: unknown, ip: string, cookie?: string, extra: Record<string, string> = {}): Promise<Response> {
  return service.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE,
        "fly-client-ip": ip,
        "user-agent": "t923-int-test",
        ...(cookie === undefined || cookie === "" ? {} : { cookie }),
        ...extra,
      },
      body: JSON.stringify(body),
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

function cookieOf(jar: string, name: string): string | undefined {
  return jar
    .split("; ")
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/** Yalnızca güvenilen cihaz çerezi (oturum çerezi olmadan yeni bir giriş denemesi için). */
function trustOnly(jar: string): string {
  const v = cookieOf(jar, TRUST);
  return v === undefined ? "" : `${TRUST}=${v}`;
}

function headersWith(jar: string): Headers {
  return new Headers({ cookie: jar, "fly-client-ip": "198.51.100.250" });
}

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of input.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totp(secretBase32: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac("sha1", base32Decode(secretBase32)).update(counter).digest();
  const off = (h[h.length - 1] ?? 0) & 0x0f;
  const bin = (((h[off] ?? 0) & 0x7f) << 24) | (((h[off + 1] ?? 0) & 0xff) << 16) | (((h[off + 2] ?? 0) & 0xff) << 8) | ((h[off + 3] ?? 0) & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}

interface TfaUser {
  readonly id: string;
  readonly email: string;
  readonly secret: string;
}

/** 2FA'sı etkin kullanıcı (fikstür: kullanıcı + parola migration rolüyle; 2FA gerçek uçlarla kurulur). */
async function mkTfaUser(): Promise<TfaUser> {
  const id = randomUUID();
  const email = `t923-${randomBytes(6).toString("hex")}@example.invalid`;
  await adm.query("INSERT INTO public.users (id, name, email, email_verified) VALUES ($1, 'T923 Kullanici', $2, true)", [id, email]);
  await adm.query("INSERT INTO public.accounts (account_id, provider_id, user_id, password) VALUES ($1, 'credential', $2, $3)", [
    id,
    id,
    await hashPassword(PASSWORD),
  ]);
  const ip = nextIp();
  const first = await post("/sign-in/email", { email, password: PASSWORD }, ip);
  const jar = jarFrom(first);
  const enable = await post("/two-factor/enable", { password: PASSWORD }, ip, jar);
  expect(enable.status).toBe(200);
  const secret = new URL(((await enable.json()) as { totpURI: string }).totpURI).searchParams.get("secret") ?? "";
  const confirm = await post("/two-factor/verify-totp", { code: totp(secret) }, ip, jar);
  expect(confirm.status).toBe(200);
  await post("/sign-out", {}, ip, jarFrom(confirm, jar));
  return { id, email, secret };
}

/** Parola + TOTP (`trustDevice`) ile giriş; dönen çerez kavanozu oturum + (istenirse) güvenilen cihaz çerezini taşır. */
async function loginWithTotp(u: TfaUser, trustDevice: boolean, cookie = ""): Promise<{ jar: string; status: number }> {
  const ip = nextIp();
  const first = await post("/sign-in/email", { email: u.email, password: PASSWORD }, ip, cookie);
  expect(((await first.clone().json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
  const pending = jarFrom(first, cookie);
  const res = await post("/two-factor/verify-totp", { code: totp(u.secret), trustDevice }, ip, pending);
  return { jar: jarFrom(res, pending), status: res.status };
}

/** Yalnızca parola ile giriş denemesi (verilen çerezle). */
async function passwordOnly(u: TfaUser, cookie: string, extra: Record<string, string> = {}): Promise<{ res: Response; jar: string; redirect: boolean }> {
  const res = await post("/sign-in/email", { email: u.email, password: PASSWORD }, nextIp(), cookie, extra);
  const body = (await res.clone().json()) as { twoFactorRedirect?: boolean };
  return { res, jar: jarFrom(res, cookie), redirect: body.twoFactorRedirect === true };
}

async function trustRows(userId: string): Promise<{ identifier: string; expires_at: Date }[]> {
  const r = await adm.query<{ identifier: string; expires_at: Date }>(
    "SELECT identifier, expires_at FROM public.verifications WHERE value = $1 AND identifier LIKE 'trust-device:h.%' ORDER BY created_at",
    [userId],
  );
  return r.rows;
}

async function eventTypes(userId: string): Promise<string[]> {
  const r = await adm.query<{ event_type: string }>("SELECT event_type FROM public.security_events WHERE user_id = $1 ORDER BY occurred_at", [userId]);
  return r.rows.map((x) => x.event_type);
}

beforeAll(async () => {
  authClient = createDbClient({ url: authUrl, poolMax: DB_CLIENT_SETTINGS.poolMax, prepare: env.prepare ?? DB_CLIENT_SETTINGS.prepare });
  service = createAuth({
    client: authClient,
    env: readAuthEnv({ BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: BASE, DATABASE_URL: env.databaseUrl, AUTH_DATABASE_URL: authUrl }),
  });
  adm = await connect(env.databaseUrlDirect);
});

afterAll(async () => {
  await authClient.close();
  await adm.end().catch(() => undefined);
}, 60_000);

describe(`T-923 güvenilen cihaz (target=${env.target})`, () => {
  it("işaretsiz TOTP güvenilen cihaz çerezi yazmaz; sonraki girişte TOTP yine istenir", async () => {
    const u = await mkTfaUser();
    const { jar, status } = await loginWithTotp(u, false);
    expect(status).toBe(200);
    expect(cookieOf(jar, TRUST)).toBeUndefined();
    expect(await trustRows(u.id)).toHaveLength(0);
    const again = await passwordOnly(u, "");
    expect(again.redirect).toBe(true);
  });

  it("güvenilen çerezle TOTP atlanır: oturum MFA'lı, süre MUTLAK (uzatma geri alınır), kimlik önekli özet, olaylar yazılır", async () => {
    const u = await mkTfaUser();
    const first = await loginWithTotp(u, true);
    expect(first.status).toBe(200);
    const cookie = cookieOf(first.jar, TRUST);
    expect(cookie).toBeDefined();
    const rows = await trustRows(u.id);
    expect(rows).toHaveLength(1);
    const original = rows[0];
    if (original === undefined) return;
    // Düz kimlik DB'de yok (çerezdeki `trust-device-…` saklanmaz).
    const plainId = decodeURIComponent(cookie ?? "").split("!")[1]?.split(".")[0] ?? "x";
    expect(plainId).toMatch(/^trust-device-/);
    const plain = await adm.query("SELECT 1 FROM public.verifications WHERE identifier = $1", [plainId]);
    expect(plain.rowCount).toBe(0);
    const ageDays = (original.expires_at.getTime() - Date.now()) / 86_400_000;
    expect(ageDays).toBeGreaterThan(29.9);
    expect(ageDays).toBeLessThanOrEqual(TRUST_DEVICE_MAX_AGE_SEC / 86400);

    // Kayıt 10 gün önce verilmiş gibi: bitiş 20 gün sonra. Güvenilen giriş bitişi 30 güne UZATMAMALI.
    const shifted = new Date(Date.now() + 20 * 86_400_000);
    await adm.query("UPDATE public.verifications SET expires_at = $2 WHERE identifier = $1", [original.identifier, shifted]);
    const trusted = await passwordOnly(u, trustOnly(first.jar));
    expect(trusted.res.status).toBe(200);
    expect(trusted.redirect).toBe(false);
    const p = await service.getPrincipal(headersWith(trusted.jar));
    expect(p?.userId).toBe(u.id);
    expect(p?.mfaVerified).toBe(true);
    // Çerez döndü (yeni kimlik), eski kayıt silindi, yeni kaydın bitişi eskisiyle aynı (mutlak 30 gün).
    expect(cookieOf(trusted.jar, TRUST)).not.toBe(cookie);
    const after = await trustRows(u.id);
    expect(after).toHaveLength(1);
    expect(after[0]?.identifier).not.toBe(original.identifier);
    expect(Math.abs((after[0]?.expires_at.getTime() ?? 0) - shifted.getTime())).toBeLessThan(1000);
    // Oturumun MFA zamanı = ilk TOTP zamanı (≈ 10 gün önce), giriş anı değil.
    const s = await adm.query<{ mfa_verified_at: Date }>("SELECT mfa_verified_at FROM public.sessions WHERE id = $1", [p?.sessionId]);
    const mfaAgeDays = (Date.now() - (s.rows[0]?.mfa_verified_at.getTime() ?? 0)) / 86_400_000;
    expect(mfaAgeDays).toBeGreaterThan(9.9);
    expect(mfaAgeDays).toBeLessThan(10.1);
    const types = await eventTypes(u.id);
    expect(types).toEqual(expect.arrayContaining(["two_factor_trusted_device_added", "two_factor_trusted_device_used"]));
  });

  it("çerezsiz, imzası bozuk ve başka kullanıcının çereziyle TOTP istenir", async () => {
    const a = await mkTfaUser();
    const b = await mkTfaUser();
    const { jar } = await loginWithTotp(a, true);
    const value = cookieOf(jar, TRUST) ?? "";
    expect(value).not.toBe("");

    expect((await passwordOnly(a, "")).redirect).toBe(true);
    // Bozuk: değerin ilk karakteri (HMAC belirteci; çerez imzası da tutmaz) değişir.
    const decoded = decodeURIComponent(value);
    const tampered = `${TRUST}=${encodeURIComponent((decoded.startsWith("A") ? "B" : "A") + decoded.slice(1))}`;
    expect((await passwordOnly(a, tampered)).redirect).toBe(true);
    // B, A'nın (geçerli imzalı) çereziyle: HMAC kullanıcıya bağlı → TOTP istenir.
    const other = await passwordOnly(b, trustOnly(jar));
    expect(other.redirect).toBe(true);
    expect(await service.getPrincipal(headersWith(other.jar))).toBeNull();
  });

  it("süresi dolmuş kayıt reddedilir (TOTP istenir)", async () => {
    const u = await mkTfaUser();
    const { jar } = await loginWithTotp(u, true);
    await adm.query("UPDATE public.verifications SET expires_at = now() - interval '1 second' WHERE value = $1 AND identifier LIKE 'trust-device:h.%'", [u.id]);
    const res = await passwordOnly(u, trustOnly(jar));
    expect(res.redirect).toBe(true);
    expect(await service.getPrincipal(headersWith(res.jar))).toBeNull();
  });

  it("yeniden doğrulama: x-wms-reauth girişinde çerez yok sayılır; güvenilen oturum hassas işlem penceresini AÇMAZ", async () => {
    const u = await mkTfaUser();
    const { jar } = await loginWithTotp(u, true);
    // İlk TOTP 1 gün önce yapılmış gibi.
    await adm.query(
      "UPDATE public.verifications SET expires_at = now() + make_interval(secs => $2) - interval '1 day' WHERE value = $1 AND identifier LIKE 'trust-device:h.%'",
      [u.id, TRUST_DEVICE_MAX_AGE_SEC],
    );
    // Güvenilen giriş: oturum açılır, MFA zorunluluğu geçer ama yeni parola girişine rağmen hassas işlem reddedilir.
    const trusted = await passwordOnly(u, trustOnly(jar));
    expect(trusted.redirect).toBe(false);
    const p = await service.getPrincipal(headersWith(trusted.jar));
    expect(p?.mfaVerified).toBe(true);
    if (p === null) return;
    await expect(service.requireRecentAuth(p, 600)).rejects.toBeInstanceOf(AuthError);
    await expect(service.ensureRecentAuth(headersWith(trusted.jar))).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    // Yeniden doğrulama girişi: çerez yok sayılır → iki adım; çerez ve kayıt korunur.
    const reauth = await passwordOnly(u, trustOnly(trusted.jar), { [REAUTH_HEADER]: "1" });
    expect(reauth.redirect).toBe(true);
    expect(await trustRows(u.id)).toHaveLength(1);
    const res = await post("/two-factor/verify-totp", { code: totp(u.secret) }, nextIp(), reauth.jar);
    expect(res.status).toBe(200);
    const fresh = jarFrom(res, reauth.jar);
    await expect(service.ensureRecentAuth(headersWith(fresh))).resolves.toBeUndefined();
  });

  it("parola değişimi güvenilen cihazları siler (sonraki girişte TOTP)", async () => {
    const u = await mkTfaUser();
    const { jar } = await loginWithTotp(u, true);
    expect(await trustRows(u.id)).toHaveLength(1);
    const res = await post("/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, nextIp(), jar);
    expect(res.status).toBe(200);
    expect(await trustRows(u.id)).toHaveLength(0);
    const next = await post("/sign-in/email", { email: u.email, password: NEW_PASSWORD }, nextIp(), trustOnly(jar));
    expect(((await next.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
    expect(await eventTypes(u.id)).toContain("two_factor_trusted_devices_revoked");
  });

  it("2FA kapatma bütün cihazların güvenini siler; yedek kod yenileme de siler", async () => {
    const u = await mkTfaUser();
    const one = await loginWithTotp(u, true);
    await loginWithTotp(u, true); // ikinci cihaz
    expect(await trustRows(u.id)).toHaveLength(2);
    const regen = await post("/two-factor/generate-backup-codes", { password: PASSWORD }, nextIp(), one.jar);
    expect(regen.status).toBe(200);
    expect(await trustRows(u.id)).toHaveLength(0);

    const two = await loginWithTotp(u, true);
    await loginWithTotp(u, true);
    expect(await trustRows(u.id)).toHaveLength(2);
    const off = await post("/two-factor/disable", { password: PASSWORD }, nextIp(), two.jar);
    expect(off.status).toBe(200);
    expect(await trustRows(u.id)).toHaveLength(0);
  });

  it("tüm cihazlardan çık (/revoke-sessions ve revokeUserSessions) güveni siler; /revoke-other-sessions bu cihazınkini korur", async () => {
    const u = await mkTfaUser();
    const a = await loginWithTotp(u, true);
    await loginWithTotp(u, true);
    expect(await trustRows(u.id)).toHaveLength(2);
    const other = await post("/revoke-other-sessions", {}, nextIp(), a.jar);
    expect(other.status).toBe(200);
    const kept = await trustRows(u.id);
    expect(kept).toHaveLength(1);
    // Kalan kayıt bu cihazınki: çerezle giriş TOTP'siz.
    const trusted = await passwordOnly(u, trustOnly(a.jar));
    expect(trusted.redirect).toBe(false);
    const all = await post("/revoke-sessions", {}, nextIp(), trusted.jar);
    expect(all.status).toBe(200);
    expect(await trustRows(u.id)).toHaveLength(0);

    await loginWithTotp(u, true);
    expect(await trustRows(u.id)).toHaveLength(1);
    await service.revokeUserSessions(u.id);
    expect(await trustRows(u.id)).toHaveLength(0);
  });
});
