// T-909 independent QA: synthetic schema27 only. No production calls or credential output.
// HTTPS Request objects exercise the real AuthService handler; this is not a browser/TLS deployment test.
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import type { DbClient } from "../../../packages/db/src/client.ts";
import { createAuth, readAuthEnv, type AuthService } from "../../../packages/auth/src/index.ts";
import { checkInitialOwnerDatabase, checkInitialOwnerProof, enrollInitialOwner, validateInitialOwnerProofUrl, validateInitialOwnerTarget } from "../../../packages/auth/src/initial-owner.ts";
import { runTenantQuery } from "../../../packages/domain/src/identity/access.ts";
import { readAuthDatabaseUrl, readIntEnv, redactErrorChain } from "../harness/env.ts";

const env = readIntEnv(process.env);
const authUrl = readAuthDatabaseUrl(process.env);
const urls = [env.databaseUrl, env.databaseUrlDirect, authUrl];
for (const url of urls) {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) throw new Error("T907 QA requires an isolated loopback database");
}
const BASE = "https://localhost:3000";
const PASSWORD = `T907-${randomBytes(18).toString("hex")}`;
const direct = new URL(env.databaseUrlDirect);
const proofTarget = { appHost: new URL(env.databaseUrl).host, authHost: new URL(authUrl).host,
  database: decodeURIComponent(direct.pathname.slice(1)), baseUrl: BASE,
  proofHost: direct.host, proofRole: decodeURIComponent(direct.username) };
const migrationDir = new URL("../../../packages/db/migrations/", import.meta.url);
const expectedLedger = readdirSync(migrationDir).filter(f => f.endsWith(".up.sql")).sort().map(file => ({
  version: file.slice(0, 4), name: file.slice(5, -7),
  checksum_sha256: createHash("sha256").update(readFileSync(new URL(file, migrationDir))).update(Buffer.from([0]))
    .update(readFileSync(new URL(file.replace(".up.sql", ".down.sql"), migrationDir))).digest("hex"),
}));
let proof: DbClient;
let app: DbClient;
let authDb: DbClient;
let auth: AuthService;
let admin: pg.Client;
let address = 0;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: env.databaseUrlDirect });
  admin.on("error", () => undefined);
  try { await admin.connect(); } catch (e) { throw new Error(redactErrorChain(e, urls)); }
  const ledger = await admin.query<{ version: string }>("SELECT max(version) AS version FROM wms_meta.schema_migrations");
  // Fikstür DB defteri kaynak ağacındaki son migration ile aynı olmalı (araç kaynak defterini hedefle birebir eşleştirir).
  expect(ledger.rows[0]?.version, "fixture schema matches source ledger").toBe(expectedLedger[expectedLedger.length - 1]?.version);
  proof = createDbClient({ url: env.databaseUrlDirect, poolMax: 1, prepare: false });
  app = createDbClient({ url: env.databaseUrl, poolMax: 2, prepare: false });
  authDb = createDbClient({ url: authUrl, poolMax: 2, prepare: false });
  auth = createAuth({ client: authDb, env: readAuthEnv({
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), BETTER_AUTH_URL: BASE,
    DATABASE_URL: env.databaseUrl, AUTH_DATABASE_URL: authUrl,
    AUTH_REQUIRE_EMAIL_VERIFICATION: "false",
  }) });
});
afterAll(async () => { await proof?.close(); await app?.close(); await authDb?.close(); await admin?.end(); });

function post(path: string, body: unknown, cookie = ""): Promise<Response> {
  address += 1;
  return auth.handler(new Request(`${BASE}/api/auth${path}`, {
    method: "POST", headers: { "content-type": "application/json", origin: BASE,
      "fly-client-ip": `203.0.113.${address}`, "user-agent": "t907-independent-qa", cookie },
    body: JSON.stringify(body),
  }));
}
function cookies(res: Response, old = ""): string {
  const jar = new Map(old.split("; ").filter(Boolean).map((part) => {
    const split = part.indexOf("="); return [part.slice(0, split), part.slice(split + 1)];
  }));
  for (const raw of res.headers.getSetCookie()) {
    const part = raw.split(";")[0] ?? "", split = part.indexOf("=");
    if (split <= 0) continue;
    const key = part.slice(0, split), value = part.slice(split + 1);
    if (!value || /max-age=0/i.test(raw)) jar.delete(key); else jar.set(key, value);
  }
  return [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
}
function identity() {
  const suffix = randomUUID();
  return { userId: randomUUID(), operator: "synthetic-qa-operator", email: `t907-${suffix}@example.test`, slug: `t907-${suffix}`, requestId: randomUUID(), userName: "T907 synthetic owner", tenantName: "T907 synthetic tenant" };
}

async function enroll(plan = identity()) {
  await checkInitialOwnerProof(proof, proofTarget, expectedLedger, plan, false);
  let token = "";
  const result = await enrollInitialOwner({ service: auth, appDb: app, plan, resume: false,
    checkpoint: async () => undefined,
    deliver: async (link: string) => {
      const url = new URL(link);
      expect(url.origin === BASE, "enrollment uses the configured HTTPS origin").toBe(true);
      expect(url.pathname).toBe("/reset-password");
      token = url.searchParams.get("token") ?? "";
      expect(token.length > 0, "a usable one-time token is delivered privately").toBe(true);
    },
  });
  return { ...result, plan, token };
}
async function count(query: string, args: unknown[]): Promise<number> {
  const result = await admin.query<{ n: number }>(query, args);
  return result.rows[0]?.n ?? -1;
}
function totp(secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

it("credentialsız owner normal HTTPS reset ile kendi parolasını belirler; MFA öncesi tenant erişimi reddedilir", async () => {
  const target = await enroll();
  const user = await admin.query("SELECT email_verified, two_factor_enabled FROM public.users WHERE id=$1", [target.userId]);
  expect(user.rows).toEqual([{ email_verified: false, two_factor_enabled: false }]);
  expect(await count("SELECT count(*)::int n FROM public.accounts WHERE user_id=$1", [target.userId])).toBe(0);
  expect(await count("SELECT count(*)::int n FROM public.tenant_memberships m JOIN public.membership_roles r ON r.tenant_id=m.tenant_id AND r.membership_id=m.id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND m.is_owner AND r.role_key='TENANT_ADMIN'", [target.tenantId, target.userId])).toBe(1);
  const reset = await post("/reset-password", { token: target.token, newPassword: PASSWORD });
  expect(reset.status).toBe(200);
  expect(await count("SELECT count(*)::int n FROM public.accounts WHERE user_id=$1 AND provider_id='credential' AND password IS NOT NULL", [target.userId])).toBe(1);
  expect((await post("/reset-password", { token: target.token, newPassword: PASSWORD })).status).toBeGreaterThanOrEqual(400);
  const login = await post("/sign-in/email", { email: target.plan.email, password: PASSWORD });
  expect(login.status).toBe(200);
  const jar = cookies(login);
  const principal = await auth.getPrincipal(new Headers({ cookie: jar }));
  expect(principal?.userId).toBe(target.userId);
  expect(principal?.mfaVerified).toBe(false);
  const access = () => runTenantQuery({ db: app, principal, tenantSlug: target.plan.slug, permission: "settings.manage" }, async () => true);
  await expect(access()).rejects.toMatchObject({ code: "FORBIDDEN", detail: "MFA_REQUIRED" });
  const enable = await post("/two-factor/enable", { password: PASSWORD }, jar);
  expect(enable.status).toBe(200);
  const enabled = await enable.json() as { totpURI: string };
  const secret = new URL(enabled.totpURI).searchParams.get("secret") ?? "";
  expect(secret.length > 0, "MFA secret was issued").toBe(true);
  const verified = await post("/two-factor/verify-totp", { code: totp(secret) }, jar);
  expect(verified.status).toBe(200);
  const verifiedPrincipal = await auth.getPrincipal(new Headers({ cookie: cookies(verified, jar) }));
  expect(verifiedPrincipal?.mfaVerified).toBe(true);
  await expect(runTenantQuery({ db: app, principal: verifiedPrincipal, tenantSlug: target.plan.slug, permission: "settings.manage" }, async () => true)).resolves.toBe(true);
  expect((await admin.query("SELECT email_verified FROM public.users WHERE id=$1", [target.userId])).rows[0]?.email_verified).toBe(false);
});

it("expired initial-password token cannot create credentials", async () => {
  const target = await enroll();
  await admin.query("UPDATE public.verifications SET expires_at=now()-interval '1 second' WHERE value=$1", [target.userId]);
  expect((await post("/reset-password", { token: target.token, newPassword: PASSWORD })).status).toBeGreaterThanOrEqual(400);
  expect(await count("SELECT count(*)::int n FROM public.accounts WHERE user_id=$1", [target.userId])).toBe(0);
});

it("token identifies its exact user even if caller supplies a different email/userId", async () => {
  const owner = await enroll(), other = await enroll();
  expect((await post("/reset-password", { token: owner.token, newPassword: PASSWORD, email: other.plan.email, userId: other.userId })).status).toBe(200);
  expect(await count("SELECT count(*)::int n FROM public.accounts WHERE user_id=$1 AND provider_id='credential'", [owner.userId])).toBe(1);
  expect(await count("SELECT count(*)::int n FROM public.accounts WHERE user_id=$1", [other.userId])).toBe(0);
});

it("existing email and tenant are never adopted; no extra owner is created", async () => {
  const target = await enroll();
  const attempt = async (plan: ReturnType<typeof identity>) => enrollInitialOwner({ service: auth, appDb: app, plan, resume: false,
    checkpoint: async () => undefined, deliver: async () => { throw new Error("must not deliver for a preexisting identity"); } });
  await expect(attempt({ ...identity(), email: target.plan.email })).rejects.toThrow();
  await expect(attempt({ ...identity(), slug: target.plan.slug })).rejects.toThrow();
  expect(await count("SELECT count(*)::int n FROM public.users WHERE email=$1", [target.plan.email])).toBe(1);
  expect(await count("SELECT count(*)::int n FROM public.tenant_memberships WHERE tenant_id=$1 AND is_owner", [target.tenantId])).toBe(1);
});

it("delivery failure revokes the minted token and does not install credentials", async () => {
  const plan = identity();
  await expect(enrollInitialOwner({ service: auth, appDb: app, plan, resume: false,
    checkpoint: async () => undefined, deliver: async () => { throw new Error("synthetic private delivery failure"); } })).rejects.toThrow();
  expect(await count("SELECT count(*)::int n FROM public.verifications WHERE value=$1", [plan.userId])).toBe(0);
  expect(await count("SELECT count(*)::int n FROM public.accounts WHERE user_id=$1", [plan.userId])).toBe(0);
});

it("database/role identity and exact target mismatch fail closed before enrollment", async () => {
  const appUrl = new URL(env.databaseUrl), authDbUrl = new URL(authUrl);
  const database = decodeURIComponent(appUrl.pathname.slice(1));
  const target = { appHost: appUrl.host, authHost: authDbUrl.host, database, baseUrl: BASE };
  appUrl.search = "?sslmode=verify-full";
  authDbUrl.search = "?sslmode=verify-full";
  const settings = { DATABASE_URL: appUrl.toString(), AUTH_DATABASE_URL: authDbUrl.toString(), BETTER_AUTH_URL: BASE,
    AUTH_REQUIRE_EMAIL_VERIFICATION: "false", SIGNUP_ENABLED: "false", MAIL_MODE: "disabled", WMS_ENV: "production" };
  expect(() => validateInitialOwnerTarget(settings, target)).not.toThrow();
  expect(() => validateInitialOwnerTarget(settings, { ...target, database: `${database}-wrong` })).toThrow("INITIAL_OWNER_TARGET");
  expect(() => validateInitialOwnerTarget(settings, { ...target, appHost: "wrong.invalid:5432" })).toThrow("INITIAL_OWNER_TARGET");
  expect(() => validateInitialOwnerTarget(settings, { ...target, baseUrl: "https://wrong.invalid" })).toThrow("INITIAL_OWNER_TARGET");
  expect(() => validateInitialOwnerTarget({ ...settings, AUTH_REQUIRE_EMAIL_VERIFICATION: "true" }, target)).toThrow("INITIAL_OWNER_ENV");
  await expect(checkInitialOwnerDatabase(app, database, "wms_app")).resolves.toBeUndefined();
  await expect(checkInitialOwnerDatabase(authDb, database, "wms_auth")).resolves.toBeUndefined();
  await expect(checkInitialOwnerDatabase(app, `${database}-wrong`, "wms_app")).rejects.toThrow("INITIAL_OWNER_DATABASE");
  await expect(checkInitialOwnerDatabase(app, database, "wms_auth")).rejects.toThrow("INITIAL_OWNER_DATABASE");
});

it("concurrent identical enrollment yields one owner and one token, not two successes", async () => {
  const plan = identity();
  const settled = await Promise.allSettled([enroll(plan), enroll(plan)]);
  expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(settled.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(await count("SELECT count(*)::int n FROM public.users WHERE email=$1", [plan.email])).toBe(1);
  expect(await count("SELECT count(*)::int n FROM public.tenant_memberships WHERE user_id=$1 AND is_owner", [plan.userId])).toBe(1);
  expect(await count("SELECT count(*)::int n FROM public.verifications WHERE value=$1", [plan.userId])).toBe(1);
});

it("failure after user creation leaves no token; exact planned identity can resume without a second owner", async () => {
  const plan = identity();
  await expect(enrollInitialOwner({ service: auth, appDb: app, plan, resume: false,
    checkpoint: async (phase) => { if (phase === "user-ready") throw new Error("synthetic checkpoint failure"); },
    deliver: async () => { throw new Error("must not deliver before tenant creation"); },
  })).rejects.toThrow("synthetic checkpoint failure");
  expect(await count("SELECT count(*)::int n FROM public.users WHERE id=$1", [plan.userId])).toBe(1);
  expect(await count("SELECT count(*)::int n FROM public.tenant_memberships WHERE user_id=$1", [plan.userId])).toBe(0);
  expect(await count("SELECT count(*)::int n FROM public.verifications WHERE value=$1", [plan.userId])).toBe(0);
  let delivered = false;
  const resumed = await enrollInitialOwner({ service: auth, appDb: app, plan, resume: true,
    checkpoint: async () => undefined, deliver: async () => { delivered = true; },
  });
  expect(delivered).toBe(true);
  expect(resumed.userId).toBe(plan.userId);
  expect(await count("SELECT count(*)::int n FROM public.tenant_memberships WHERE user_id=$1 AND is_owner", [plan.userId])).toBe(1);
});

it("proof validates all source checksums without modifying tenant/account data", async () => {
  const plan = identity();
  expect(expectedLedger.length).toBeGreaterThanOrEqual(27);
  expect(expectedLedger.map((m) => m.version)).toEqual(expectedLedger.map((_, i) => String(i + 1).padStart(4, "0")));
  const before = await admin.query("SELECT (SELECT count(*) FROM public.users) users, (SELECT count(*) FROM public.tenants) tenants");
  await expect(checkInitialOwnerProof(proof, proofTarget, expectedLedger, plan, false)).resolves.toBeUndefined();
  const after = await admin.query("SELECT (SELECT count(*) FROM public.users) users, (SELECT count(*) FROM public.tenants) tenants");
  expect(after.rows).toEqual(before.rows);
  const meta = await admin.query("SELECT current_setting('server_version_num')::int version");
  expect(meta.rows[0]?.version).toBeGreaterThanOrEqual(180000);
  expect(meta.rows[0]?.version).toBeLessThan(190000);
  await expect(checkInitialOwnerProof(proof, { ...proofTarget, database: `${proofTarget.database}-wrong` }, expectedLedger, plan, false)).rejects.toThrow("INITIAL_OWNER_PROOF_TARGET");
  await expect(checkInitialOwnerProof(proof, { ...proofTarget, proofRole: "wrong_operator" }, expectedLedger, plan, false)).rejects.toThrow("INITIAL_OWNER_PROOF_TARGET");
  expect(await count("SELECT count(*)::int n FROM public.users WHERE id=$1", [plan.userId])).toBe(0);
});

it("altered ledger checksum or extra schema30 entry rejects before account creation", async () => {
  const plan = identity();
  const original = expectedLedger[0];
  if (!original) throw new Error("missing baseline migration");
  try {
    await admin.query("UPDATE wms_meta.schema_migrations SET checksum_sha256=$1 WHERE version=$2", ["0".repeat(64), original.version]);
    await expect(checkInitialOwnerProof(proof, proofTarget, expectedLedger, plan, false)).rejects.toThrow("INITIAL_OWNER_SCHEMA_MISMATCH");
  } finally {
    await admin.query("UPDATE wms_meta.schema_migrations SET checksum_sha256=$1 WHERE version=$2", [original.checksum_sha256, original.version]);
  }
  try {
    await admin.query("INSERT INTO wms_meta.schema_migrations(version,name,checksum_sha256) VALUES ('0030','synthetic_wrong_schema',$1)", ["0".repeat(64)]);
    await expect(checkInitialOwnerProof(proof, proofTarget, expectedLedger, plan, false)).rejects.toThrow("INITIAL_OWNER_SCHEMA_MISMATCH");
  } finally { await admin.query("DELETE FROM wms_meta.schema_migrations WHERE version='0030' AND name='synthetic_wrong_schema'"); }
  expect(await count("SELECT count(*)::int n FROM public.users WHERE id=$1", [plan.userId])).toBe(0);
});

it("preexisting exact slug is rejected by proof before any new auth user write", async () => {
  const existing = await enroll();
  const plan = { ...identity(), slug: existing.plan.slug };
  await expect(checkInitialOwnerProof(proof, proofTarget, expectedLedger, plan, false)).rejects.toThrow("INITIAL_OWNER_EXISTS");
  await expect(enroll(plan)).rejects.toThrow("INITIAL_OWNER_EXISTS");
  expect(await count("SELECT count(*)::int n FROM public.users WHERE id=$1 OR email=$2", [plan.userId, plan.email])).toBe(0);
  expect(await count("SELECT count(*)::int n FROM public.tenant_memberships WHERE tenant_id=$1 AND is_owner", [existing.tenantId])).toBe(1);
});

it("strict connection URLs reject hidden target/TLS overrides for both app and proof", () => {
  const appUrl = new URL(env.databaseUrl), authDbUrl = new URL(authUrl), proofUrl = new URL(env.databaseUrlDirect);
  for (const url of [appUrl, authDbUrl, proofUrl]) url.search = "?sslmode=verify-full";
  const settings = { DATABASE_URL: appUrl.toString(), AUTH_DATABASE_URL: authDbUrl.toString(), BETTER_AUTH_URL: BASE,
    AUTH_REQUIRE_EMAIL_VERIFICATION: "false", SIGNUP_ENABLED: "false", MAIL_MODE: "disabled", WMS_ENV: "production" };
  expect(() => validateInitialOwnerProofUrl(proofUrl.toString(), proofTarget)).not.toThrow();
  for (const query of ["", "?sslmode=disable", "?sslmode=verify-full&host=wrong.invalid", "?sslmode=verify-full&sslmode=disable", "?sslmode=verify-full&options=-c%20role=other"]) {
    const badApp = new URL(appUrl), badProof = new URL(proofUrl);
    badApp.search = query; badProof.search = query;
    expect(() => validateInitialOwnerTarget({ ...settings, DATABASE_URL: badApp.toString() }, proofTarget)).toThrow("INITIAL_OWNER_TARGET");
    expect(() => validateInitialOwnerProofUrl(badProof.toString(), proofTarget)).toThrow("INITIAL_OWNER_PROOF_TARGET");
  }
  appUrl.port = ""; proofUrl.port = "";
  expect(() => validateInitialOwnerTarget({ ...settings, DATABASE_URL: appUrl.toString() }, proofTarget)).toThrow("INITIAL_OWNER_TARGET");
  expect(() => validateInitialOwnerProofUrl(proofUrl.toString(), proofTarget)).toThrow("INITIAL_OWNER_PROOF_TARGET");
});

it("resume rejects an existing verification and preserves the original single token", async () => {
  const existing = await enroll();
  let delivered = false;
  await expect(enrollInitialOwner({ service: auth, appDb: app, plan: existing.plan, resume: true,
    checkpoint: async () => undefined, deliver: async () => { delivered = true; },
  })).rejects.toThrow("INITIAL_OWNER_USED");
  expect(delivered).toBe(false);
  expect(await count("SELECT count(*)::int n FROM public.verifications WHERE value=$1", [existing.userId])).toBe(1);
  expect(await count("SELECT count(*)::int n FROM public.accounts WHERE user_id=$1", [existing.userId])).toBe(0);
  expect((await post("/reset-password", { token: existing.token, newPassword: PASSWORD })).status).toBe(200);
  expect((await post("/reset-password", { token: existing.token, newPassword: PASSWORD })).status).toBeGreaterThanOrEqual(400);
});

it("resume proof rejects another tenant membership without adopting or modifying it", async () => {
  const plan = identity();
  await expect(enrollInitialOwner({ service: auth, appDb: app, plan, resume: false,
    checkpoint: async (phase) => { if (phase === "user-ready") throw new Error("synthetic checkpoint failure"); },
    deliver: async () => { throw new Error("must not deliver"); },
  })).rejects.toThrow("synthetic checkpoint failure");
  const otherTenant = randomUUID();
  await admin.query("INSERT INTO public.tenants(id,slug,name,is_demo) VALUES ($1,$2,'Synthetic unrelated tenant',false)", [otherTenant, `t909-other-${randomUUID()}`]);
  await admin.query("INSERT INTO public.tenant_memberships(tenant_id,user_id,status,is_owner) VALUES ($1,$2,'ACTIVE',false)", [otherTenant, plan.userId]);
  await expect(checkInitialOwnerProof(proof, proofTarget, expectedLedger, plan, true)).rejects.toThrow("INITIAL_OWNER_EXISTS");
  expect(await count("SELECT count(*)::int n FROM public.tenant_memberships WHERE tenant_id=$1 AND user_id=$2 AND status='ACTIVE' AND NOT is_owner", [otherTenant, plan.userId])).toBe(1);
  expect(await count("SELECT count(*)::int n FROM public.tenants WHERE slug=$1", [plan.slug])).toBe(0);
  expect(await count("SELECT count(*)::int n FROM public.verifications WHERE value=$1", [plan.userId])).toBe(0);
  expect(await count("SELECT count(*)::int n FROM public.accounts WHERE user_id=$1", [plan.userId])).toBe(0);
});
