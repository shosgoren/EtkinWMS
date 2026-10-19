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
import { APIError, createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
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
  enrollTenant: { window: 10 * 60, max: 10 },
  ipEnroll: { window: 10 * 60, max: 20 },
  // T-429: ekibe katılma (QR bağlantısı başına talep, IP başına, talep başına etkinleştirme).
  joinLink: { window: 60 * 60, max: 30 },
  ipJoin: { window: 10 * 60, max: 20 },
  joinActivate: { window: 60 * 60, max: 10 },
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

/** Ortak cihaz kayıt belirteci özeti (QR; 5 dk). Domain aynı kuralı kullanır (`@wms/shared/field-login` `enrollmentTokenHash`). */
export function enrollmentTokenHash(token: string): string {
  return createHash("sha256").update(`field-enroll:${token}`).digest("hex");
}

/** T-429 katılma bağlantısı (QR, 7 gün) özeti. Domain AYNI kuralı kullanır (`@wms/domain/identity/team-join` `joinLinkHash`). */
export function joinLinkHash(token: string): string {
  return createHash("sha256").update(`field-join-link:${token}`).digest("hex");
}

/** T-429 cihazın katılma talebi belirteci özeti (çerezde düz değer, DB'de yalnız özet). */
export function joinRequestHash(token: string): string {
  return createHash("sha256").update(`field-join-request:${token}`).digest("hex");
}

/** Katılma bağlantısı / talep çerezi `<tenant uuid>.<43 karakter base64url>`; biçimsizse `null`. */
export function parseJoinValue(raw: string | null | undefined): { tenantId: string; token: string } | null {
  if (typeof raw !== "string") return null;
  const i = raw.indexOf(".");
  if (i <= 0) return null;
  const tenantId = raw.slice(0, i);
  const token = raw.slice(i + 1);
  if (!UUID.test(tenantId) || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return { tenantId: tenantId.toLowerCase(), token };
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

/** Kontrol karakterlerini boşluğa çevirir (ad / cihaz ipucu; DB CHECK'i de reddeder). */
function noControl(v: string): string {
  return [...v].map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? " " : c)).join("");
}

function text(v: unknown, max: number): string {
  return typeof v === "string" && v.length <= max ? v : "";
}

/** İki uçta ortak Better Auth uç bağlamı (GenericEndpointContext; index.ts ile aynı türetme). */
type EndpointCtx = Parameters<typeof getSessionFromCtx>[0];

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
  /** Maskeli hata günlüğü (değer/parametre yazmaz). */
  readonly log?: (message: string, error: unknown) => void;
}

export function fieldDeviceCookieName(secure: boolean): string {
  return secure ? "__Host-wms_field_device" : "wms_field_device";
}

/** T-429: bekleyen katılma talebinin çerezi (httpOnly; betik okuyamaz). */
export function fieldJoinCookieName(secure: boolean): string {
  return secure ? "__Host-wms_field_join" : "wms_field_join";
}
const JOIN_COOKIE_MAX_AGE_SEC = 2 * 24 * 60 * 60;
const JOIN_USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
/** `@wms/shared/field-login` `normalizeFieldUsername` ile aynı kural (Türkçe harfler sadeleşir, küçük harf). */
export function normalizeJoinUsername(raw: string): string | null {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", Ö: "o", Ş: "s", Ü: "u" };
  const v = raw
    .trim()
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => map[c] ?? c)
    .toLowerCase();
  return JOIN_USERNAME_RE.test(v) ? v : null;
}

const DENIED = () => new APIError("UNAUTHORIZED", { code: "FIELD_LOGIN_DENIED", message: "FIELD_LOGIN_DENIED" });
const LOCKED = () => new APIError("FORBIDDEN", { code: "FIELD_LOGIN_LOCKED", message: "FIELD_LOGIN_LOCKED" });
const LIMITED = () => new APIError("TOO_MANY_REQUESTS", { code: "FIELD_RATE_LIMITED", message: "FIELD_RATE_LIMITED" });
const INVALID = () => new APIError("BAD_REQUEST", { code: "FIELD_INPUT_INVALID", message: "FIELD_INPUT_INVALID" });

export function fieldLoginPlugin(deps: FieldPluginDeps) {
  const cookieName = fieldDeviceCookieName(deps.secureCookies);
  const joinCookie = fieldJoinCookieName(deps.secureCookies);
  const joinCookieOptions = { httpOnly: true, secure: deps.secureCookies, sameSite: "strict" as const, path: "/", maxAge: JOIN_COOKIE_MAX_AGE_SEC };
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

  /**
   * Toplu kilitleme koruması (T-997 koşul 1, T-998): YALNIZ bu istekte konan kilitte (yanlış PIN → kilit geçişi; kilitli hesaba deneme
   * sayılmaz, inceleme n2) ortak cihaz + hesap eşlenir; 60 dk'da 3 hesap → cihaz durdurulur ve o cihazdaki oturumlar AYNI istekte kapanır
   * (inceleme n1). Hata loglanır (sessiz koruma kaybı yok).
   */
  async function spree(tenantId: string, tokenHash: string, username: string): Promise<void> {
    try {
      const rows = await deps.execute<{ device: string | null }>(
        sql`SELECT wms_probe.field_lock_spree_check(${tenantId}::uuid, ${tokenHash}, ${username}) AS device`,
      );
      const device = rows[0]?.device ?? null;
      if (device !== null && UUID.test(device)) {
        await deps.execute(sql`DELETE FROM public.sessions WHERE id IN (SELECT session_id FROM public.field_sessions WHERE device_id = ${device}::uuid)`);
      }
    } catch (e) {
      deps.log?.("field lock spree check failed", e);
    }
  }

  /**
   * Cihaz çerezini yazar ve oturumu açar. Oturum açıldıktan SONRA cihaz yeniden doğrulanır: arada yönetici kodu yeniledi/cihazı iptal
   * ettiyse (oturumlar o anda kapatılmıştı) yeni oturum silinir ve genel ret döner (inceleme m3).
   */
  async function openSession(
    ctx: EndpointCtx,
    userId: string,
    tenantId: string,
    device: { token: string; hash: string },
    deviceId: string | null,
  ): Promise<void> {
    const user = await ctx.context.internalAdapter.findUserById(userId);
    if (user === null || !isFieldEmail(user.email)) throw DENIED();
    const session = await ctx.context.internalAdapter.createSession(userId, false);
    // T-998: oturum ↔ cihaz bağı yeniden denetimden ÖNCE yazılır (inceleme m1): arada gelen iptal ya bu bağı görüp oturumu siler ya da
    // aşağıdaki denetim iptali görür. Yazılamazsa oturum açılmaz.
    if (deviceId !== null && UUID.test(deviceId)) {
      try {
        await deps.execute(sql`INSERT INTO public.field_sessions (session_id, device_id) VALUES (${session.id}::uuid, ${deviceId}::uuid)`);
      } catch (e) {
        await ctx.context.internalAdapter.deleteSession(session.token);
        throw e;
      }
    }
    const still = await deps.execute<{ slug: string }>(sql`SELECT slug FROM wms_probe.field_device_status(${tenantId}::uuid, ${device.hash})`);
    if (still.length === 0) {
      await ctx.context.internalAdapter.deleteSession(session.token);
      throw DENIED();
    }
    await deps.markSessionVerified(session.token);
    ctx.setCookie(cookieName, `${tenantId}.${device.token}`, cookieOptions);
    await setSessionCookie(ctx, { session, user });
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

      // T-998: ortak cihaz personel listesi (hızlı kullanıcı değişimi). Yalnız geçerli SHARED cihaz çereziyle; aksi boş liste.
      fieldDeviceStaff: createAuthEndpoint("/field/staff", { method: "GET" }, async (ctx) => {
        const parsed = parseDeviceCookie(ctx.getCookie(cookieName));
        if (parsed === null) return ctx.json({ staff: [] });
        const rows = await deps.execute<{ name: string; username: string; role_key: string | null }>(
          sql`SELECT * FROM wms_probe.field_device_staff(${parsed.tenantId}::uuid, ${parsed.tokenHash})`,
        );
        return ctx.json({ staff: rows.map((r) => ({ name: r.name, username: r.username, role: r.role_key === "COUNTER" ? "COUNTER" : "PICKER" })) });
      }),

      // T-998: ortak cihaz kaydı talebi. QR adresinin `#` parçası `<tenant>.<kayıt belirteci>`; terminal kendi rastgele cihaz belirtecini
      // üretir (çerez), DB'ye yalnız özetler gider. Cihaz, yönetici kendi ekranında ONAYLAYANA dek kayıtlı sayılmaz (`/field/device`).
      fieldEnroll: createAuthEndpoint("/field/enroll", { method: "POST" }, async (ctx) => {
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const enrollment = parseDeviceCookie(text(body.enrollment, 120));
        const name = text(body.deviceName, 60).trim();
        if (enrollment === null || name === "") throw INVALID();
        // Kayıt belirteci özeti (alan ayrımı: `field-enroll:` öneki). Hız sınırı belirteç özetine bağlı: doğrulanmamış trafik bir tenant'ın
        // bütün kayıtlarını kapatamaz (inceleme m3); IP sınırı ayrıca Better Auth kuralında.
        const tokenHash = enrollmentTokenHash(text(body.enrollment, 120).slice(enrollment.tenantId.length + 1));
        await limit(`field:enroll:${tokenHash}`, FIELD_RATE_RULES.enrollTenant);
        const device = newDeviceToken();
        const rows = await deps.execute<{ outcome: string }>(
          sql`SELECT wms_probe.field_enroll_claim(${enrollment.tenantId}::uuid, ${tokenHash}, ${device.hash}, ${name}) AS outcome`,
        );
        const confirm = rows[0]?.outcome ?? "DENIED";
        if (!/^\d{6}$/.test(confirm)) throw DENIED();
        ctx.setCookie(cookieName, `${enrollment.tenantId}.${device.token}`, cookieOptions);
        // Doğrulama kodu yalnız bu terminalin ekranında görünür; yönetici onayda yazar (inceleme M1).
        return ctx.json({ ok: true, pending: true, confirmCode: confirm });
      }),

      // T-429: ekibe katılma bağlantısı önizlemesi (QR `#` parçası `<tenant>.<belirteç>`). Geçersizse genel ret; alan adı yalnız geçerli bağlantıda.
      fieldJoinLink: createAuthEndpoint("/field/join/link", { method: "POST" }, async (ctx) => {
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const link = parseJoinValue(text(body.join, 120));
        if (link === null) throw INVALID();
        const hash = joinLinkHash(link.token);
        await limit(`field:join-link:${hash}`, FIELD_RATE_RULES.joinLink);
        const rows = await deps.execute<{ tenant_name: string }>(sql`SELECT tenant_name FROM wms_probe.field_join_link(${link.tenantId}::uuid, ${hash})`);
        const r = rows[0];
        if (r === undefined) throw DENIED();
        return ctx.json({ ok: true, tenantName: r.tenant_name });
      }),

      // T-429: katılma talebi (oturumsuz). Cihaz kendi rastgele talep belirtecini üretir (httpOnly çerez), DB'ye yalnız özeti gider.
      // Yanıt: cihaz ekranında gösterilecek 6 haneli kod (yönetici onayda yazar). Kullanıcı adı alınmışsa ayrı bildirilir (aynı alanda).
      fieldJoin: createAuthEndpoint("/field/join", { method: "POST" }, async (ctx) => {
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const link = parseJoinValue(text(body.join, 120));
        const name = noControl(text(body.name, 60)).trim();
        const username = normalizeJoinUsername(text(body.username, 64));
        const hint = noControl(text(body.deviceHint, 80)).trim();
        if (link === null || name === "" || username === null) throw INVALID();
        const hash = joinLinkHash(link.token);
        await limit(`field:join-link:${hash}`, FIELD_RATE_RULES.joinLink);
        const req = newDeviceToken();
        const reqHash = joinRequestHash(req.token);
        const rows = await deps.execute<{ outcome: string }>(
          sql`SELECT wms_probe.field_join_request(${link.tenantId}::uuid, ${hash}, ${reqHash}, ${name}, ${username}, ${hint === "" ? null : hint}) AS outcome`,
        );
        const outcome = rows[0]?.outcome ?? "DENIED";
        if (outcome === "USERNAME_TAKEN") throw new APIError("BAD_REQUEST", { code: "FIELD_USERNAME_TAKEN", message: "FIELD_USERNAME_TAKEN" });
        if (outcome === "FULL") throw LIMITED();
        if (!/^\d{6}$/.test(outcome)) throw DENIED();
        ctx.setCookie(joinCookie, `${link.tenantId}.${req.token}`, joinCookieOptions);
        return ctx.json({ ok: true, confirmCode: outcome, username });
      }),

      // T-429: talep durumu (yalnız talep çerezini tutan cihaz). PENDING | APPROVED | REJECTED | CANCELLED | CLAIMED | EXPIRED | NONE.
      fieldJoinStatus: createAuthEndpoint("/field/join/status", { method: "GET" }, async (ctx) => {
        const v = parseJoinValue(ctx.getCookie(joinCookie));
        if (v === null) return ctx.json({ status: "NONE" });
        const rows = await deps.execute<{ status: string; slug: string; username: string; tenant_name: string }>(
          sql`SELECT * FROM wms_probe.field_join_status(${v.tenantId}::uuid, ${joinRequestHash(v.token)})`,
        );
        const r = rows[0];
        if (r === undefined) return ctx.json({ status: "NONE" });
        return ctx.json({ status: r.status, workspace: r.slug, username: r.username, tenantName: r.tenant_name });
      }),

      // T-429: onaylanmış talep → kişi kendi PIN'ini belirler; kişisel cihaz açılır ve oturum başlar (tek kullanım).
      fieldJoinActivate: createAuthEndpoint("/field/join/activate", { method: "POST" }, async (ctx) => {
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const pin = text(body.pin, 16);
        const deviceName = text(body.deviceName, 60).trim();
        const v = parseJoinValue(ctx.getCookie(joinCookie));
        if (v === null || !pinAcceptable(pin)) throw INVALID();
        const reqHash = joinRequestHash(v.token);
        await limit(`field:join-activate:${reqHash}`, FIELD_RATE_RULES.joinActivate);
        const device = newDeviceToken();
        const pinHash = await deps.hashPin(pin);
        const rows = await deps.execute<{ outcome: string; user_id: string | null; tenant_id: string | null; device_id: string | null }>(
          sql`SELECT * FROM wms_probe.field_join_activate(${v.tenantId}::uuid, ${reqHash}, ${pinHash}, ${device.hash}, ${deviceName === "" ? null : deviceName})`,
        );
        const r = rows[0];
        if (r?.outcome !== "OK" || r.user_id === null || r.tenant_id === null) throw DENIED();
        ctx.setCookie(joinCookie, "", { ...joinCookieOptions, maxAge: 0 });
        await openSession(ctx, r.user_id, r.tenant_id, device, r.device_id);
        return ctx.json({ ok: true });
      }),

      fieldActivate: createAuthEndpoint("/field/activate", { method: "POST" }, async (ctx) => {
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const workspace = text(body.workspace, 64).trim().toLowerCase();
        const username = text(body.username, 64).trim().toLowerCase();
        const code = normalizeActivationCode(text(body.code, 32));
        const pin = text(body.pin, 16);
        const deviceName = text(body.deviceName, 60).trim();
        if (workspace === "" || username === "" || code === null || !pinAcceptable(pin)) throw INVALID();
        // Kullanıcı başına sınır (IP sınırı Better Auth kuralı). Tenant kovası burada TÜKETİLMEZ: doğrulanmamış trafik bütün alanın
        // girişini kapatamamalı (inceleme M3).
        await limit(`field:activate-user:${workspace}:${username}`, FIELD_RATE_RULES.activateUser);
        const device = newDeviceToken();
        const pinHash = await deps.hashPin(pin);
        const rows = await deps.execute<{ outcome: string; user_id: string | null; tenant_id: string | null; device_id: string | null }>(
          sql`SELECT * FROM wms_probe.field_activate(${workspace}, ${username}, ${activationCodeHash(code)}, ${pinHash}, ${device.hash},
                                                     ${deviceName === "" ? null : deviceName})`,
        );
        const r = rows[0];
        // Etkinleştirme kilit bildirmez (kullanıcı adı keşfi yok; inceleme M1): her ret aynı.
        if (r?.outcome !== "OK" || r.user_id === null || r.tenant_id === null) throw DENIED();
        await openSession(ctx, r.user_id, r.tenant_id, device, r.device_id);
        return ctx.json({ ok: true });
      }),

      fieldSignIn: createAuthEndpoint("/field/sign-in", { method: "POST" }, async (ctx) => {
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const workspace = text(body.workspace, 64).trim().toLowerCase();
        const username = text(body.username, 64).trim().toLowerCase();
        const pin = text(body.pin, 16);
        if (workspace === "" || username === "" || !/^\d{6}$/.test(pin)) throw INVALID();
        const parsed = parseDeviceCookie(ctx.getCookie(cookieName));
        // Cihaz çerezi yoksa/biçimsizse kova harcanmadan genel ret (her zaman ret; hesap bilgisi taşımaz — inceleme M3).
        if (parsed === null) throw DENIED();
        await limit(`field:device:${parsed.tokenHash}`, FIELD_RATE_RULES.device);
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
            || parsed.tenantId !== r.tenant_id) {
          await burn(pin);
          throw DENIED();
        }
        // Tenant kovası yalnız KAYITLI cihazdan gelen deneme için (tenant kimliğiyle): kayıtsız trafik alanı kilitleyemez. Sınır
        // aşılırsa `begin`'in ayırdığı deneme geri verilir (hayalet hata sayılmaz; inceleme N2).
        try {
          await limit(`field:tenant:${r.tenant_id}`, FIELD_RATE_RULES.tenant);
        } catch (e) {
          await deps
            .execute(sql`SELECT wms_probe.field_signin_finish(${r.tenant_id}::uuid, ${r.login_id}::uuid, ${r.device_id}::uuid, NULL, NULL)`)
            .catch(() => undefined);
          throw e;
        }
        const ok = await deps.verifyPin(r.pin_hash, pin).catch(() => false);
        const next = newDeviceToken();
        const finished = await deps.execute<{ outcome: string }>(
          sql`SELECT wms_probe.field_signin_finish(${r.tenant_id}::uuid, ${r.login_id}::uuid, ${r.device_id}::uuid, ${ok},
                                                   ${ok ? next.hash : null}) AS outcome`,
        );
        const outcome = finished[0]?.outcome;
        if (outcome === "LOCKED") {
          // Yanlış PIN ile konan kilit (geçiş); doğru PIN'in paralel kilide takılması sayılmaz.
          if (!ok) await spree(parsed.tenantId, parsed.tokenHash, username);
          throw LOCKED();
        }
        if (!ok || outcome !== "OK") throw DENIED();
        await openSession(ctx, r.user_id, r.tenant_id, next, r.device_id);
        return ctx.json({ ok: true });
      }),
    },
  };
}
