// Saha cihazları (T-998, ADR-026 §7.5–7.7; 0045). Yönetici (`users.manage`) kayıtlı cihazları görür ve iptal eder; ortak cihazı (el
// terminali/tablet) üç adımla kaydeder: (1) 5 dk'lık kayıt belirteci (yakın doğrulama; DB'de özeti; düz değer yalnız bu yanıtta, QR'ın `#`
// parçasında), (2) terminal talep eder (`/api/auth/field/enroll`), (3) yönetici KENDİ ekranında talep eden cihazı onaylar. İptal, o cihazda
// açılmış oturumları da kapatır (`revokeDeviceSessions` portu, commit'ten sonra).
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { enrollmentTokenHash, generateEnrollmentToken } from "@wms/shared/field-login";
import { mapAccessError, runTenantCommand, runTenantQuery, type TenantAccessParams } from "./access.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CommandParams = Omit<TenantAccessParams, "permission"> & { readonly requestId?: string };

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

function mapDeviceError(e: unknown): unknown {
  if (e instanceof AppError) return e;
  if (sqlstateOf(e) === "P0002") {
    const err = new AppError("NOT_FOUND");
    err.cause = e;
    return err;
  }
  return mapAccessError(e);
}

function toDate(v: Date | string | null): Date | null {
  return v === null ? null : v instanceof Date ? v : new Date(v);
}

export interface DeviceRow {
  readonly id: string;
  readonly kind: "PERSONAL" | "SHARED";
  readonly name: string;
  /** Kişisel cihazın sahibi (ad); ortak cihazda `null`. */
  readonly owner: string | null;
  readonly lastUsedAt: Date;
  readonly createdAt: Date;
}

/** Geçerli (iptal edilmemiş, süresi ve boşta süresi dolmamış) cihazlar; belirteç özeti okunmaz. */
export async function listDevices(params: Omit<TenantAccessParams, "permission">): Promise<readonly DeviceRow[]> {
  try {
    return await runTenantQuery({ ...params, permission: "users.manage" }, async (tx, actor) => {
      const rows = await tx.execute<{ id: string; kind: "PERSONAL" | "SHARED"; name: string; owner: string | null; last_used_at: Date | string; created_at: Date | string }>(
        sql`SELECT d.id, d.kind, d.name, u.name AS owner, d.last_used_at, d.created_at
              FROM public.field_devices d
              LEFT JOIN public.users u ON u.id = d.user_id
             WHERE d.tenant_id = ${actor.tenantId}::uuid AND d.revoked_at IS NULL AND d.expires_at > now()
               AND d.last_used_at > now() - interval '60 days'
             ORDER BY d.kind DESC, d.last_used_at DESC
             LIMIT 500`,
      );
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        owner: r.owner,
        lastUsedAt: toDate(r.last_used_at) as Date,
        createdAt: toDate(r.created_at) as Date,
      }));
    });
  } catch (e) {
    throw mapDeviceError(e);
  }
}

export interface RevokeDeviceDeps {
  /** Commit'ten SONRA cihazdaki oturumları kapatır (`@wms/auth` `revokeDeviceSessions`). */
  readonly revokeDeviceSessions: (deviceId: string) => Promise<void>;
}

/** Cihazı iptal eder (geri alınmaz) ve oturumlarını kapatır. Zaten iptal/yok → `NOT_FOUND`. */
export async function revokeDevice(params: CommandParams & { readonly deviceId: string }, deps: RevokeDeviceDeps): Promise<void> {
  const { deviceId: rawId, requestId, ...access } = params;
  const deviceId = parseUuid(rawId);
  try {
    await runTenantCommand({ ...access, permission: "users.manage" }, async (tx, actor) => {
      const r = await tx.execute<{ ok: boolean }>(sql`SELECT wms_probe.field_device_revoke(${deviceId}::uuid, ${actor.userId}::uuid) AS ok`);
      if (r[0]?.ok !== true) throw new AppError("NOT_FOUND");
      await appendAudit(tx, {
        action: "field_device.revoked",
        actorUserId: actor.userId,
        entityType: "field_device",
        entityId: deviceId,
        requestId: requestId ?? null,
        changeSummary: {},
      });
    });
  } catch (e) {
    throw mapDeviceError(e);
  }
  await deps.revokeDeviceSessions(deviceId);
}

export interface EnrollmentStart {
  readonly enrollmentId: string;
  /** QR `#` parçası: `<tenant>.<belirteç>`; yalnız bu yanıtta. */
  readonly secret: string;
  readonly expiresAt: Date;
}

/** Ortak cihaz kaydını başlatır (5 dk). Yakın doğrulama ZORUNLU (cihaz kimlik bilgisi verir). Önceki açık kayıtlar iptal edilir. */
export async function startEnrollment(params: CommandParams): Promise<EnrollmentStart> {
  const { requestId: _requestId, ...access } = params;
  void _requestId;
  if (access.recentAuth === undefined) throw new AppError("UNAUTHENTICATED", { detail: "RECENT_AUTH_REQUIRED" });
  try {
    return await runTenantCommand({ ...access, permission: "users.manage" }, async (tx, actor) => {
      const demo = await tx.execute<{ is_demo: boolean }>(sql`SELECT is_demo FROM public.tenants WHERE id = ${actor.tenantId}::uuid`);
      if (demo[0]?.is_demo !== false) throw new AppError("FORBIDDEN");
      await tx.execute(
        sql`UPDATE public.field_enrollments SET cancelled_at = now()
             WHERE tenant_id = ${actor.tenantId}::uuid AND created_by = ${actor.userId}::uuid AND approved_at IS NULL AND cancelled_at IS NULL`,
      );
      const token = generateEnrollmentToken();
      const id = randomUUID();
      const rows = await tx.execute<{ expires_at: Date | string }>(
        sql`INSERT INTO public.field_enrollments (tenant_id, id, token_hash, created_by)
            VALUES (${actor.tenantId}::uuid, ${id}::uuid, ${enrollmentTokenHash(token)}, ${actor.userId}::uuid)
            RETURNING expires_at`,
      );
      const exp = rows[0]?.expires_at;
      if (exp === undefined) throw new Error("startEnrollment: insert returned no row");
      return { enrollmentId: id, secret: `${actor.tenantId}.${token}`, expiresAt: toDate(exp) as Date };
    });
  } catch (e) {
    throw mapDeviceError(e);
  }
}

export type EnrollmentState = "WAITING" | "CLAIMED" | "APPROVED" | "EXPIRED" | "CANCELLED";

export interface EnrollmentStatus {
  readonly state: EnrollmentState;
  /** Talep eden cihazın adı (CLAIMED/APPROVED). */
  readonly deviceName: string | null;
  readonly expiresAt: Date;
}

/** Yöneticinin kendi kaydının durumu (başka yöneticinin kaydı görünmez). */
export async function getEnrollment(params: Omit<TenantAccessParams, "permission"> & { readonly enrollmentId: string }): Promise<EnrollmentStatus> {
  const { enrollmentId: rawId, ...access } = params;
  const id = parseUuid(rawId);
  try {
    return await runTenantQuery({ ...access, permission: "users.manage" }, async (tx, actor) => {
      const rows = await tx.execute<{
        expires_at: Date | string;
        claimed_at: Date | string | null;
        device_name: string | null;
        approved_at: Date | string | null;
        cancelled_at: Date | string | null;
        expired: boolean;
      }>(
        sql`SELECT expires_at, claimed_at, device_name, approved_at, cancelled_at,
                   (claimed_at IS NULL AND expires_at <= now()) OR (claimed_at IS NOT NULL AND approved_at IS NULL AND claimed_at < now() - interval '10 minutes') AS expired
              FROM public.field_enrollments
             WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${id}::uuid AND created_by = ${actor.userId}::uuid`,
      );
      const r = rows[0];
      if (r === undefined) throw new AppError("NOT_FOUND");
      const state: EnrollmentState =
        r.approved_at !== null ? "APPROVED" : r.cancelled_at !== null ? "CANCELLED" : r.expired ? "EXPIRED" : r.claimed_at !== null ? "CLAIMED" : "WAITING";
      return { state, deviceName: r.device_name, expiresAt: toDate(r.expires_at) as Date };
    });
  } catch (e) {
    throw mapDeviceError(e);
  }
}

/** Talep eden ortak cihazı onaylar (yalnız kaydı başlatan yönetici). */
export async function approveEnrollment(params: CommandParams & { readonly enrollmentId: string }): Promise<{ readonly deviceId: string }> {
  const { enrollmentId: rawId, requestId, ...access } = params;
  const id = parseUuid(rawId);
  try {
    return await runTenantCommand({ ...access, permission: "users.manage" }, async (tx, actor) => {
      const rows = await tx.execute<{ device_id: string }>(sql`SELECT wms_probe.field_enroll_approve(${id}::uuid, ${actor.userId}::uuid) AS device_id`);
      const deviceId = rows[0]?.device_id;
      if (deviceId === undefined || deviceId === null) throw new AppError("NOT_FOUND");
      await appendAudit(tx, {
        action: "field_device.enrolled",
        actorUserId: actor.userId,
        entityType: "field_device",
        entityId: deviceId,
        requestId: requestId ?? null,
        changeSummary: { kind: "SHARED" },
      });
      return { deviceId };
    });
  } catch (e) {
    throw mapDeviceError(e);
  }
}

/** Kaydı iptal eder (talep gelmiş olsa da cihaz açılmaz). */
export async function cancelEnrollment(params: CommandParams & { readonly enrollmentId: string }): Promise<void> {
  const { enrollmentId: rawId, requestId: _requestId, ...access } = params;
  void _requestId;
  const id = parseUuid(rawId);
  try {
    await runTenantCommand({ ...access, permission: "users.manage" }, async (tx, actor) => {
      await tx.execute(
        sql`UPDATE public.field_enrollments SET cancelled_at = now()
             WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${id}::uuid AND created_by = ${actor.userId}::uuid
               AND approved_at IS NULL AND cancelled_at IS NULL`,
      );
    });
  } catch (e) {
    throw mapDeviceError(e);
  }
}
