// Saha personeli hesapları (T-997, ADR-026 §7; 0044). Yönetici (`users.manage`) e-postasız saha hesabı açar: ad + kullanıcı adı + saha
// rolü (PICKER/COUNTER). Etkinleştirme kodu (8 karakter, 24 saat, tek kullanım) yalnız yöneticiye BİR KEZ döner; DB'de özeti.
//
// - Hesap açılışı iki adım (davet kabulündeki m8 sırası gibi): (1) Better Auth `users` satırı `createFieldAccount` portuyla
//   (`<uuid>@field.invalid`; domain `@wms/auth` import etmez), (2) tenant komutu: üyelik + rol + `field_logins`. (2) başarısız olursa
//   (1)'in satırı yetim kalır: iç e-postalı, parolasız, üyeliksiz — hiçbir yoldan girilemez (e-posta uçları reddeder, saha girişi
//   `field_logins` ister). Ön denetim (yetki, demo, kullanıcı adı, paket sınırı) (1)'den önce ayrı transaction'da yapılır.
// - Kod yenileme / kilit açma `wms_probe.field_admin_reset` ile (uygulama rolü PIN/kod özeti sütununa yazamaz). Kod yenileme eski PIN'i
//   ve kişisel cihazları geçersiz kılar.
// - Saha hesabına yönetim rolü verilemez (`memberships.changeRole` ve sahiplik devri `isFieldEmail` ile reddeder; 0044 giriş işlevi rolü
//   her girişte yeniden okur).
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { ACTIVATION_TTL_HOURS, activationCodeHash, generateActivationCode, normalizeActivationCode, normalizeFieldUsername } from "@wms/shared/field-login";
import { mapAccessError, runTenantCommand, runTenantQuery, type AccessTx, type TenantAccessParams } from "./access.ts";

export const FIELD_ROLES = ["PICKER", "COUNTER"] as const;
export type FieldRole = (typeof FIELD_ROLES)[number];

const NAME_MAX = 100; // `@wms/auth` createFieldAccount ile aynı
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CommandParams = Omit<TenantAccessParams, "permission"> & { readonly requestId?: string };

export interface FieldUserDeps {
  /** Better Auth'ta iç e-postalı, parolasız kullanıcı açar (`@wms/auth` `createFieldAccount`). */
  readonly createFieldAccount: (input: { readonly name: string }) => Promise<{ readonly userId: string }>;
}

export interface FieldCodeResult {
  /** Gösterim biçimi `XXXX-XXXX`; yalnız bu yanıtta, bir kez. */
  readonly code: string;
  readonly expiresAt: Date;
}

export interface CreateFieldUserResult extends FieldCodeResult {
  readonly userId: string;
  readonly membershipId: string;
  readonly username: string;
}

function parseName(raw: unknown): string {
  if (typeof raw !== "string") throw new AppError("VALIDATION_FAILED");
  const v = raw.trim().replace(/\s+/g, " ");
  if (v.length < 2 || v.length > NAME_MAX || /\p{Cc}/u.test(v)) throw new AppError("VALIDATION_FAILED");
  return v;
}

function parseFieldRole(raw: unknown): FieldRole {
  const r = FIELD_ROLES.find((x) => x === raw);
  if (r === undefined) throw new AppError("VALIDATION_FAILED");
  return r;
}

function parseUuid(raw: unknown): string {
  if (typeof raw !== "string" || !UUID_RE.test(raw)) throw new AppError("VALIDATION_FAILED");
  return raw;
}

function sqlstateOf(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 6 && cur !== undefined && cur !== null; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

function mapFieldError(e: unknown): unknown {
  if (e instanceof AppError) return e;
  const state = sqlstateOf(e);
  if (state === "23505") {
    const err = new AppError("VALIDATION_FAILED", { detail: "CODE_TAKEN" });
    err.cause = e;
    return err;
  }
  if (state === "P0002") {
    const err = new AppError("NOT_FOUND");
    err.cause = e;
    return err;
  }
  return mapAccessError(e);
}

async function assertNotDemo(tx: AccessTx, tenantId: string): Promise<void> {
  const rows = await tx.execute<{ is_demo: boolean }>(sql`SELECT is_demo FROM public.tenants WHERE id = ${tenantId}::uuid`);
  if (rows[0]?.is_demo !== false) throw new AppError("FORBIDDEN");
}

async function assertUsernameFree(tx: AccessTx, tenantId: string, username: string): Promise<void> {
  const rows = await tx.execute<{ one: number }>(
    sql`SELECT 1 AS one FROM public.field_logins WHERE tenant_id = ${tenantId}::uuid AND username = ${username} LIMIT 1`,
  );
  if (rows.length > 0) throw new AppError("VALIDATION_FAILED", { detail: "CODE_TAKEN" });
}

async function assertFieldSeat(tx: AccessTx, tenantId: string): Promise<void> {
  const cap = await tx.execute<{ lim: number | null }>(sql`SELECT wms_probe.platform_tenant_plan_limit(${tenantId}::uuid, 'field') AS lim`);
  const lim = cap[0]?.lim ?? null;
  if (lim === null || Number(lim) <= 0) return;
  const used = await tx.execute<{ n: number }>(
    sql`SELECT public.plan_member_count(${tenantId}::uuid, 'field', NULL)
             + (SELECT count(*) FROM public.invitations WHERE tenant_id = ${tenantId}::uuid
                  AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
                  AND role_key = ANY('{PICKER,COUNTER}'::text[])) AS n`,
  );
  if (Number(used[0]?.n ?? 0) >= Number(lim)) throw new AppError("VALIDATION_FAILED", { detail: "PLAN_LIMIT" });
}

function newCode(): { code: string; hash: string } {
  const code = generateActivationCode();
  const normalized = normalizeActivationCode(code);
  if (normalized === null) throw new Error("field-users: generated code not normalizable");
  return { code, hash: activationCodeHash(normalized) };
}

export type CreateFieldUserParams = CommandParams & { readonly name: string; readonly username: string; readonly roleKey: string };

export async function createFieldUser(params: CreateFieldUserParams, deps: FieldUserDeps): Promise<CreateFieldUserResult> {
  const { name: rawName, username: rawUsername, roleKey: rawRole, requestId, ...access } = params;
  const name = parseName(rawName);
  const role = parseFieldRole(rawRole);
  const username = typeof rawUsername === "string" ? normalizeFieldUsername(rawUsername) : null;
  if (username === null) throw new AppError("VALIDATION_FAILED");
  // Kimlik bilgisi veren komut: yakın zamanda doğrulama ZORUNLU (ADR-026 §7.1; inceleme M4 — `issuePasswordResetLink` deseni).
  if (access.recentAuth === undefined) throw new AppError("UNAUTHENTICATED", { detail: "RECENT_AUTH_REQUIRED" });
  try {
    // (0) Ön denetim: yetki, demo, kullanıcı adı, paket sınırı — hesap açılmadan önce.
    await runTenantCommand({ ...access, permission: "users.manage" }, async (tx, actor) => {
      await assertNotDemo(tx, actor.tenantId);
      await assertUsernameFree(tx, actor.tenantId, username);
      await assertFieldSeat(tx, actor.tenantId);
    });
    // (1) Kimlik satırı (wms_auth bağlantısı).
    const { userId } = await deps.createFieldAccount({ name });
    if (!UUID_RE.test(userId)) throw new Error("field-users: account port returned no id");
    // (2) Üyelik + rol + saha girişi (tek transaction; yarış durumunda kısıt/tetikleyici reddeder).
    const { code, hash } = newCode();
    return await runTenantCommand({ ...access, permission: "users.manage" }, async (tx, actor) => {
      await assertNotDemo(tx, actor.tenantId);
      await assertUsernameFree(tx, actor.tenantId, username);
      await assertFieldSeat(tx, actor.tenantId);
      const created = await tx.execute<{ id: string }>(
        sql`INSERT INTO public.tenant_memberships (tenant_id, user_id, status, is_owner, joined_at)
            VALUES (${actor.tenantId}::uuid, ${userId}::uuid, 'ACTIVE', false, now())
            RETURNING id`,
      );
      const membershipId = created[0]?.id;
      if (membershipId === undefined) throw new Error("createFieldUser: membership insert returned no row");
      await tx.execute(
        sql`INSERT INTO public.membership_roles (tenant_id, membership_id, role_key)
            VALUES (${actor.tenantId}::uuid, ${membershipId}::uuid, ${role})`,
      );
      const login = await tx.execute<{ expires: Date | string }>(
        sql`INSERT INTO public.field_logins (tenant_id, user_id, membership_id, username, activation_hash, activation_expires_at, created_by)
            VALUES (${actor.tenantId}::uuid, ${userId}::uuid, ${membershipId}::uuid, ${username}, ${hash},
                    now() + make_interval(hours => ${ACTIVATION_TTL_HOURS}), ${actor.userId}::uuid)
            RETURNING activation_expires_at AS expires`,
      );
      const raw = login[0]?.expires;
      if (raw === undefined) throw new Error("createFieldUser: field login insert returned no row");
      const expiresAt = raw instanceof Date ? raw : new Date(raw);
      await appendAudit(tx, {
        action: "field_user.created",
        actorUserId: actor.userId,
        entityType: "membership",
        entityId: membershipId,
        requestId: requestId ?? null,
        changeSummary: { role_key: role, username },
      });
      return { userId, membershipId, username, code, expiresAt };
    });
  } catch (e) {
    throw mapFieldError(e);
  }
}

async function loginOf(tx: AccessTx, tenantId: string, membershipId: string): Promise<{ id: string; username: string }> {
  const rows = await tx.execute<{ id: string; username: string }>(
    sql`SELECT l.id, l.username FROM public.field_logins l
          JOIN public.tenant_memberships m ON m.tenant_id = l.tenant_id AND m.id = l.membership_id
         WHERE l.tenant_id = ${tenantId}::uuid AND l.membership_id = ${membershipId}::uuid AND m.status = 'ACTIVE'`,
  );
  const r = rows[0];
  if (r === undefined) throw new AppError("NOT_FOUND");
  return r;
}

export type FieldMemberParams = CommandParams & { readonly memberId: string };

export interface ResetFieldCodeDeps {
  /** Commit'ten SONRA personelin açık oturumlarını kapatır (`@wms/auth` `revokeUserSessions`). */
  readonly revokeUserSessions: (userId: string) => Promise<void>;
}

/** Yeni etkinleştirme kodu: eski PIN, kişisel cihazlar ve açık oturumlar geçersiz, kilit açılır. Kod yalnız bu yanıtta. */
export async function resetFieldCode(params: FieldMemberParams, deps: ResetFieldCodeDeps): Promise<FieldCodeResult> {
  const { memberId: rawMember, requestId, ...access } = params;
  const memberId = parseUuid(rawMember);
  if (access.recentAuth === undefined) throw new AppError("UNAUTHENTICATED", { detail: "RECENT_AUTH_REQUIRED" }); // fail-closed (M4)
  let result: FieldCodeResult & { readonly userId: string };
  try {
    result = await runTenantCommand({ ...access, permission: "users.manage" }, async (tx, actor) => {
      await assertNotDemo(tx, actor.tenantId);
      const login = await loginOf(tx, actor.tenantId, memberId);
      const { code, hash } = newCode();
      const reset = await tx.execute<{ user_id: string }>(
        sql`SELECT wms_probe.field_admin_reset(${login.id}::uuid, ${hash}, ${actor.userId}::uuid) AS user_id`,
      );
      const userId = reset[0]?.user_id;
      if (userId === undefined) throw new Error("resetFieldCode: reset returned no user");
      const rows = await tx.execute<{ expires: Date | string | null }>(
        sql`SELECT activation_expires_at AS expires FROM public.field_logins WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${login.id}::uuid`,
      );
      const raw = rows[0]?.expires;
      if (raw === undefined || raw === null) throw new Error("resetFieldCode: expiry not readable");
      await appendAudit(tx, {
        action: "field_user.code_reset",
        actorUserId: actor.userId,
        entityType: "membership",
        entityId: memberId,
        requestId: requestId ?? null,
        changeSummary: { username: login.username },
      });
      return { code, expiresAt: raw instanceof Date ? raw : new Date(raw), userId };
    });
  } catch (e) {
    throw mapFieldError(e);
  }
  await deps.revokeUserSessions(result.userId);
  return { code: result.code, expiresAt: result.expiresAt };
}

/** Kilidi açar (PIN ve cihazlar korunur). */
export async function unlockFieldLogin(params: FieldMemberParams): Promise<void> {
  const { memberId: rawMember, requestId, ...access } = params;
  const memberId = parseUuid(rawMember);
  try {
    await runTenantCommand({ ...access, permission: "users.manage" }, async (tx, actor) => {
      await assertNotDemo(tx, actor.tenantId);
      const login = await loginOf(tx, actor.tenantId, memberId);
      await tx.execute(sql`SELECT wms_probe.field_admin_reset(${login.id}::uuid, NULL, ${actor.userId}::uuid)`);
      await appendAudit(tx, {
        action: "field_user.unlocked",
        actorUserId: actor.userId,
        entityType: "membership",
        entityId: memberId,
        requestId: requestId ?? null,
        changeSummary: { username: login.username },
      });
    });
  } catch (e) {
    throw mapFieldError(e);
  }
}

export interface FieldLoginInfo {
  readonly membershipId: string;
  readonly username: string;
  /** PIN belirlenmiş (etkinleştirilmiş). */
  readonly active: boolean;
  /** Geçerli etkinleştirme kodu bekliyor. */
  readonly pendingUntil: Date | null;
  /** Kilitli (süreli ya da yönetici açana dek). */
  readonly locked: boolean;
}

/** Üyeler ekranı için saha girişi durumu (özet sütunları okunmaz). */
export async function listFieldLogins(params: Omit<TenantAccessParams, "permission">): Promise<readonly FieldLoginInfo[]> {
  try {
    return await runTenantQuery({ ...params, permission: "users.manage" }, async (tx, actor) => {
      const rows = await tx.execute<{
        membership_id: string;
        username: string;
        pin_set_at: Date | string | null;
        activation_expires_at: Date | string | null;
        locked: boolean;
      }>(
        sql`SELECT membership_id, username, pin_set_at, activation_expires_at,
                   (locked_until IS NOT NULL AND locked_until > now()) AS locked
              FROM public.field_logins WHERE tenant_id = ${actor.tenantId}::uuid ORDER BY username`,
      );
      const now = Date.now();
      return rows.map((r) => {
        const exp = r.activation_expires_at === null ? null : new Date(r.activation_expires_at);
        return {
          membershipId: r.membership_id,
          username: r.username,
          active: r.pin_set_at !== null,
          pendingUntil: exp !== null && exp.getTime() > now ? exp : null,
          locked: r.locked === true,
        };
      });
    });
  } catch (e) {
    throw mapFieldError(e);
  }
}
