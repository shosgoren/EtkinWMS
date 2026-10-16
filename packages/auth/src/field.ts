// Saha girişi (T-997, ADR-026 §7; kabul 16 Ekim 2026). Better Auth'un yerleşik e-posta/parola yoluna DOKUNMAZ: bu dosyadaki uçlar
// (`/field/device`, `/field/activate`, `/field/sign-in`) kendi eklentimizdir; oturumu iç bağdaştırıcıyla açar ve Better Auth oturum
// çerezini yazar (ADR-014 değişikliği; ayrı korunan PR + security-reviewer).
//
// Güvenlik özeti (ADR-026 kabul incelemesi koşulları, T-997):
// - PIN yalnız KAYITLI CİHAZDA: cihaz çerezi `<tenant>.<belirteç>` (httpOnly, Secure, SameSite=Strict, host-only, 180 gün); DB'de yalnız
//   özet; her başarılı girişte belirteç yenilenir (rotasyon); 60 gün kullanılmayan cihaz geçersiz.
// - Kilit: hesap başına 5 hata → 15 dk, 3. kilitte yönetici açana dek (DB işlevi); IP (Better Auth kuralı), cihaz ve tenant başına sayısal
//   hız sınırı (bu dosya). Bilinmeyen alan/kullanıcı/kayıtsız cihaz aynı genel ret + sabit maliyetli sahte Argon2 doğrulaması (kullanıcı
//   keşfi/zamanlama yok); yalnız kilit ayrı bildirilir.
// - Yönetim rolü bu yoldan ASLA oturum açamaz (rol her girişte DB işlevinde yeniden okunur).
// - Oturum `mfa_verified_at` ile açılır (kayıtlı cihaz + PIN iki etken), ama saha oturumu hassas işlem yeniden doğrulamasını (A-39)
//   karşılamaz ve mutlak süresi 12 saattir (index.ts `getPrincipal`/`ensureRecentAuth`).
// - PIN, kod ve belirteç loga, yanıta (çerez dışında) ve olay detayına yazılmaz.
import { createHash, randomBytes } from "node:crypto";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { sql } from "drizzle-orm";

export const FIELD_EMAIL_DOMAIN = "field.invalid";
export const FIELD_SESSION_MAX_SEC = 12 * 60 * 60;
/** Saha oturumu boşta üst sınırı (sunucuda; oturum `updatedAt` en çok 15 dk gecikmeyle yenilenir, A-39 `updateAge`). */
export const FIELD_SESSION_IDLE_SEC = 2 * 60 * 60;
export const FIELD_DEVICE_MAX_AGE_SEC = 180 * 24 * 60 * 60;
const ACTIVATION_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** IP başına (Better Auth `customRules`), cihaz başına ve tenant başına sınırlar (A-41 deseni, özetli anahtar). */
export const FIELD_RATE_RULES = Object.freeze({
  ipSignIn: { window: 10 * 60, max: 30 },
  ipActivate: { window: 60 * 60, max: 20 },
  device: { window: 15 * 60, max: 20 },
  tenant: { window: 15 * 60, max: 300 },
  activateUser: { window: 60 * 60, max: 10 },
});

export function isFieldEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.trim().toLowerCase().endsWith(`@${FIELD_EMAIL_DOMAIN}`);
}

/** @wms/shared/field-login ile AYNI kural (paket bağımlılığı yok; tests/unit/field-login.test.ts eşitliği denetler). */
export function normalizeActivationCode(raw: string): string | null {
  const v = raw.toUpperCase().replace(/[\s-]/g, "");
  if (v.length !== 8) return null;
  for (const ch of v) if (!ACTIVATION_ALPHABET.includes(ch)) return null;
  return v;
}

export function activationCodeHash(normalized: string): string {
  return createHash("sha256").update(`field-activation:${normalized}`).digest("hex");
}

/** @wms/shared/field-login `pinProblem` ile aynı. */
export function pinAcceptable(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return false;
  const d = [...pin].map(Number);
  const same = d.every((x) => x === d[0]);
  const up = d.every((x, i) => i === 0 || x === ((d[i - 1] as number) + 1) % 10);
  const down = d.every((x, i) => i === 0 || x === ((d[i - 1] as number) + 9) % 10);
  return !(same || up || down);
}

export function deviceTokenHash(token: string): string {
  return createHash("sha256").update(`field-device:${token}`).digest("hex");
}

/** Çerez değeri `<tenant uuid>.<43 karakter base64url>`; biçimsizse `null`. */
export function parseDeviceCookie(raw: string | null | undefined): { tenantId: string; tokenHash: string } | null {
  if (typeof raw !== "string") return null;
  const i = raw.indexOf(".");
  if (i <= 0) return null;
  const tenantId = raw.slice(0, i);
  const token = raw.slice(i + 1);
  if (!UUID.test(tenantId) || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return { tenantId: tenantId.toLowerCase(), tokenHash: deviceTokenHash(token) };
}

function newDeviceToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: deviceTokenHash(token) };
}

function text(v: unknown, max: number): string {
  return typeof v === "string" && v.length <= max ? v : "";
}

type Exec = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) => Promise<T[]>;

export interface FieldPluginDeps {
  /** wms_auth bağlantısı (probe işlevleri bu role açık). */
  readonly execute: Exec;
  readonly hashPin: (pin: string) => Promise<string>;
  readonly verifyPin: (hash: string, pin: string) => Promise<boolean>;
  /** Sabit maliyetli sahte doğrulama için geçerli bir Argon2id özeti. */
  readonly dummyHash: () => Promise<string>;
  readonly consume: (key: string, rule: { window: number; max: number }) => Promise<{ allowed: boolean; retryAfter: number | null }>;
  /** Oturuma `mfa_verified_at = now()`; yazılamazsa oturum silinir (index.ts `sessionWriteOrRevoke`). */
  readonly markSessionVerified: (token: string) => Promise<void>;
  readonly secureCookies: boolean;
}

export function fieldDeviceCookieName(secure: boolean): string {
  return secure ? "__Host-wms_field_device" : "wms_field_device";
}

const DENIED = () => new APIError("UNAUTHORIZED", { code: "FIELD_LOGIN_DENIED", message: "FIELD_LOGIN_DENIED" });
const LOCKED = () => new APIError("FORBIDDEN", { code: "FIELD_LOGIN_LOCKED", message: "FIELD_LOGIN_LOCKED" });
const LIMITED = () => new APIError("TOO_MANY_REQUESTS", { code: "FIELD_RATE_LIMITED", message: "FIELD_RATE_LIMITED" });
const INVALID = () => new APIError("BAD_REQUEST", { code: "FIELD_INPUT_INVALID", message: "FIELD_INPUT_INVALID" });

export function fieldLoginPlugin(deps: FieldPluginDeps) {
  const cookieName = fieldDeviceCookieName(deps.secureCookies);
  const cookieOptions = {
    httpOnly: true,
    secure: deps.secureCookies,
    sameSite: "strict" as const,
    path: "/",
    maxAge: FIELD_DEVICE_MAX_AGE_SEC,
  };

  async function limit(key: string, rule: { window: number; max: number }): Promise<void> {
    const r = await deps.consume(key, rule);
    if (!r.allowed) throw LIMITED();
  }

  /** Sabit maliyet: başarısız yollarda da bir Argon2 doğrulaması yapılır (kullanıcı/cihaz keşfi zamanlamayla olmasın). */
  async function burn(pin: string): Promise<void> {
    await deps.verifyPin(await deps.dummyHash(), pin).catch(() => false);
  }

  return {
    id: "wms-field-login",
    endpoints: {
      fieldDeviceStatus: createAuthEndpoint("/field/device", { method: "GET" }, async (ctx) => {
        const parsed = parseDeviceCookie(ctx.getCookie(cookieName));
        if (parsed === null) return ctx.json({ registered: false });
        const rows = await deps.execute<{ slug: string; tenant_name: string; device_name: string; kind: string }>(
          sql`SELECT * FROM wms_probe.field_device_status(${parsed.tenantId}::uuid, ${parsed.tokenHash})`,
        );
        const r = rows[0];
        if (r === undefined) return ctx.json({ registered: false });
        return ctx.json({ registered: true, workspace: r.slug, tenantName: r.tenant_name, deviceName: r.device_name, kind: r.kind });
      }),

      fieldActivate: createAuthEndpoint("/field/activate", { method: "POST" }, async (ctx) => {
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const workspace = text(body.workspace, 64).trim().toLowerCase();
        const username = text(body.username, 64).trim().toLowerCase();
        const code = normalizeActivationCode(text(body.code, 32));
        const pin = text(body.pin, 16);
        const deviceName = text(body.deviceName, 60).trim();
        if (workspace === "" || username === "" || code === null || !pinAcceptable(pin)) throw INVALID();
        await limit(`field:activate-user:${workspace}:${username}`, FIELD_RATE_RULES.activateUser);
        await limit(`field:tenant:${workspace}`, FIELD_RATE_RULES.tenant);
        const device = newDeviceToken();
        const pinHash = await deps.hashPin(pin);
        const rows = await deps.execute<{ outcome: string; user_id: string | null; tenant_id: string | null; device_id: string | null }>(
          sql`SELECT * FROM wms_probe.field_activate(${workspace}, ${username}, ${activationCodeHash(code)}, ${pinHash}, ${device.hash},
                                                     ${deviceName === "" ? null : deviceName})`,
        );
        const r = rows[0];
        if (r?.outcome === "LOCKED") throw LOCKED();
        if (r?.outcome !== "OK" || r.user_id === null || r.tenant_id === null) throw DENIED();
        ctx.setCookie(cookieName, `${r.tenant_id}.${device.token}`, cookieOptions);
        const user = await ctx.context.internalAdapter.findUserById(r.user_id);
        if (user === null || !isFieldEmail(user.email)) throw DENIED();
        const session = await ctx.context.internalAdapter.createSession(r.user_id, false);
        await deps.markSessionVerified(session.token);
        await setSessionCookie(ctx, { session, user });
        return ctx.json({ ok: true });
      }),

      fieldSignIn: createAuthEndpoint("/field/sign-in", { method: "POST" }, async (ctx) => {
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const workspace = text(body.workspace, 64).trim().toLowerCase();
        const username = text(body.username, 64).trim().toLowerCase();
        const pin = text(body.pin, 16);
        if (workspace === "" || username === "" || !/^\d{6}$/.test(pin)) throw INVALID();
        const parsed = parseDeviceCookie(ctx.getCookie(cookieName));
        await limit(`field:device:${parsed?.tokenHash ?? "none"}`, FIELD_RATE_RULES.device);
        await limit(`field:tenant:${workspace}`, FIELD_RATE_RULES.tenant);
        const rows = await deps.execute<{ outcome: string; login_id: string | null; tenant_id: string | null; user_id: string | null; device_id: string | null; pin_hash: string | null }>(
          sql`SELECT * FROM wms_probe.field_signin_begin(${workspace}, ${username}, ${parsed?.tokenHash ?? null})`,
        );
        const r = rows[0];
        if (r?.outcome === "LOCKED") {
          await burn(pin);
          throw LOCKED();
        }
        // Cihaz tenant'ı ile girilen alan aynı olmalı (başka tenant'ın cihazı reddi; işlev de tenant içinde arar).
        if (r?.outcome !== "OK" || r.pin_hash === null || r.login_id === null || r.tenant_id === null || r.user_id === null
            || parsed === null || parsed.tenantId !== r.tenant_id) {
          await burn(pin);
          throw DENIED();
        }
        const ok = await deps.verifyPin(r.pin_hash, pin).catch(() => false);
        const next = newDeviceToken();
        const finished = await deps.execute<{ outcome: string }>(
          sql`SELECT wms_probe.field_signin_finish(${r.tenant_id}::uuid, ${r.login_id}::uuid, ${r.device_id}::uuid, ${ok},
                                                   ${ok ? next.hash : null}) AS outcome`,
        );
        const outcome = finished[0]?.outcome;
        if (outcome === "LOCKED") throw LOCKED();
        if (!ok || outcome !== "OK") throw DENIED();
        ctx.setCookie(cookieName, `${r.tenant_id}.${next.token}`, cookieOptions);
        const user = await ctx.context.internalAdapter.findUserById(r.user_id);
        if (user === null || !isFieldEmail(user.email)) throw DENIED();
        const session = await ctx.context.internalAdapter.createSession(r.user_id, false);
        await deps.markSessionVerified(session.token);
        await setSessionCookie(ctx, { session, user });
        return ctx.json({ ok: true });
      }),
    },
  };
}
