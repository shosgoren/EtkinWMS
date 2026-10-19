// T-429 (Ekip.dc.html; 0052): saha personelinin kendi telefonuyla ekibe katılması — yönetici tarafı.
//
// Akış: (1) yönetici (`users.manage`, yakın doğrulama) katılma bağlantısı üretir: 7 gün, alan başına bir geçerli; düz belirteç yalnız bu yanıtta
// (QR adresinin `#` parçası), DB'de özeti; yenileme eskisini o anda geçersiz kılar. (2) Personel cihazı kimlik servisinden talep eder
// (`/api/auth/field/join`, oturumsuz): ad + kullanıcı adı; cihaz ekranında 6 haneli kod. (3) Yönetici bekleyenleri görür, cihazdaki kodu yazar
// (`field_join_verify`; 3 yanlışta talep iptal), rolü (PICKER / COUNTER) seçer: saha hesabı mevcut yoldan (T-997 `createFieldUser`) açılır ve
// talep AYNI transaction'da APPROVED + üyeliğe bağlanır. (4) Cihaz kendi PIN'ini belirler (`/api/auth/field/join/activate`).
// Yönetici ekranı doğrulama kodunu ve belirteç özetlerini GÖRMEZ (uygulama rolü okuyamaz). Demo alanda kapalı. Audit aynı transaction'da.
import { randomBytes, createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { mapAccessError, runTenantCommand, runTenantQuery, type AccessTx, type TenantAccessParams } from "./access.ts";
import { FIELD_ROLES, createFieldUser, type FieldRole, type FieldUserDeps } from "./field-users.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const JOIN_LINK_DAYS = 7;

type Access = Omit<TenantAccessParams, "permission">;
type CommandParams = Access & { readonly requestId?: string };

/** Katılma belirteci özeti (alan ayrımı öneki; `@wms/auth` field.ts `joinLinkHash` ile AYNI olmalı — int testi denetler). */
export function joinLinkHash(token: string): string {
  return createHash("sha256").update(`field-join-link:${token}`).digest("hex");
}

function parseUuid(raw: unknown): string {
  if (typeof raw !== "string" || !UUID_RE.test(raw)) throw new AppError("VALIDATION_FAILED");
  return raw.toLowerCase();
}

async function assertNotDemo(tx: AccessTx, tenantId: string): Promise<void> {
  const rows = await tx.execute<{ is_demo: boolean; status: string }>(sql`SELECT is_demo, status FROM public.tenants WHERE id = ${tenantId}::uuid`);
  if (rows[0]?.is_demo !== false) throw new AppError("FORBIDDEN");
}

function needRecentAuth(access: Access): void {
  if (access.recentAuth === undefined) throw new AppError("UNAUTHENTICATED", { detail: "RECENT_AUTH_REQUIRED" });
}

// ---------------------------------------------------------------------------------------------

export interface JoinOverview {
  readonly link: { readonly createdAt: Date; readonly expiresAt: Date } | null;
  readonly pending: readonly {
    readonly id: string;
    readonly name: string;
    readonly username: string;
    readonly deviceHint: string | null;
    readonly createdAt: Date;
    readonly expiresAt: Date;
    readonly wrongTries: number;
  }[];
  /** Onaylanmış, kişinin PIN belirlemesini bekleyen talepler (24 saat; yönetici iptal edebilir). */
  readonly approvedWaiting: readonly { readonly id: string; readonly name: string; readonly username: string; readonly decidedAt: Date }[];
  readonly isDemo: boolean;
}

const asDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

export async function getJoinOverview(params: Access): Promise<JoinOverview> {
  return runTenantQuery({ ...params, permission: "users.manage" }, async (tx, actor) => {
    const link = await tx.execute<{ created_at: Date | string; expires_at: Date | string }>(
      sql`SELECT created_at, expires_at FROM public.team_join_links
           WHERE tenant_id = ${actor.tenantId}::uuid AND revoked_at IS NULL AND expires_at > now()`,
    );
    const rows = await tx.execute<{ id: string; name: string; username: string; device_hint: string | null; created_at: Date | string; expires_at: Date | string; confirm_failed: number }>(
      sql`SELECT id, name, username, device_hint, created_at, expires_at, confirm_failed FROM public.team_join_requests
           WHERE tenant_id = ${actor.tenantId}::uuid AND status = 'PENDING' AND expires_at > now()
           ORDER BY created_at, id LIMIT 50`,
    );
    const approved = await tx.execute<{ id: string; name: string; username: string; decided_at: Date | string }>(
      sql`SELECT id, name, username, decided_at FROM public.team_join_requests
           WHERE tenant_id = ${actor.tenantId}::uuid AND status = 'APPROVED' AND decided_at > now() - interval '24 hours'
           ORDER BY decided_at DESC, id LIMIT 50`,
    );
    const demo = await tx.execute<{ is_demo: boolean }>(sql`SELECT is_demo FROM public.tenants WHERE id = ${actor.tenantId}::uuid`);
    const l = link[0];
    return {
      link: l === undefined ? null : { createdAt: asDate(l.created_at), expiresAt: asDate(l.expires_at) },
      pending: rows.map((r) => ({
        id: r.id,
        name: r.name,
        username: r.username,
        deviceHint: r.device_hint,
        createdAt: asDate(r.created_at),
        expiresAt: asDate(r.expires_at),
        wrongTries: Number(r.confirm_failed),
      })),
      approvedWaiting: approved.map((r) => ({ id: r.id, name: r.name, username: r.username, decidedAt: asDate(r.decided_at) })),
      isDemo: demo[0]?.is_demo !== false,
    };
  });
}

/** Yeni katılma bağlantısı (eskisi o anda geçersiz). Düz belirteç YALNIZ bu dönüşte; QR adresi `/field/join#<tenant>.<belirteç>`. */
export async function createJoinLink(params: CommandParams): Promise<{ readonly tenantId: string; readonly token: string; readonly expiresAt: Date }> {
  const { requestId, ...access } = params;
  needRecentAuth(access);
  const token = randomBytes(32).toString("base64url");
  try {
    return await runTenantCommand({ ...access, permission: "users.manage" }, async (tx, actor) => {
      await assertNotDemo(tx, actor.tenantId);
      await tx.execute(sql`UPDATE public.team_join_links SET revoked_at = now() WHERE tenant_id = ${actor.tenantId}::uuid AND revoked_at IS NULL`);
      const rows = await tx.execute<{ id: string; expires_at: Date | string }>(
        sql`INSERT INTO public.team_join_links (tenant_id, token_hash, created_by, expires_at)
            VALUES (${actor.tenantId}::uuid, ${joinLinkHash(token)}, ${actor.userId}::uuid, now() + make_interval(days => ${JOIN_LINK_DAYS}))
            RETURNING id, expires_at`,
      );
      const r = rows[0];
      if (r === undefined) throw new AppError("INTERNAL");
      await appendAudit(tx, {
        action: "team_join.link_created",
        actorUserId: actor.userId,
        entityType: "team_join_link",
        entityId: r.id,
        requestId: requestId ?? null,
        changeSummary: { days: JOIN_LINK_DAYS },
      });
      return { tenantId: actor.tenantId, token, expiresAt: asDate(r.expires_at) };
    });
  } catch (e) {
    throw mapAccessError(e);
  }
}

/** Geçerli bağlantıyı kapatır (yeni talep açılamaz; bekleyen talepler kalır, onaylanabilir/reddedilebilir). */
export async function revokeJoinLink(params: CommandParams): Promise<{ readonly changed: boolean }> {
  const { requestId, ...access } = params;
  needRecentAuth(access);
  return runTenantCommand({ ...access, permission: "users.manage" }, async (tx, actor) => {
    await assertNotDemo(tx, actor.tenantId);
    const rows = await tx.execute<{ id: string }>(
      sql`UPDATE public.team_join_links SET revoked_at = now() WHERE tenant_id = ${actor.tenantId}::uuid AND revoked_at IS NULL RETURNING id`,
    );
    const r = rows[0];
    if (r === undefined) return { changed: false };
    await appendAudit(tx, { action: "team_join.link_revoked", actorUserId: actor.userId, entityType: "team_join_link", entityId: r.id, requestId: requestId ?? null });
    return { changed: true };
  });
}

export type ApproveJoinResult =
  | { readonly ok: true; readonly membershipId: string; readonly username: string }
  | { readonly ok: false; readonly issue: "CODE_WRONG" | "GONE" };

/**
 * Bekleyen talebi onaylar: cihazdaki 6 haneli kod (yanlışsa sayılır, 3'te talep iptal) + saha rolü. Hesap `createFieldUser` ile açılır
 * (yetki, demo, kullanıcı adı, paket sınırı orada da denetlenir) ve talep aynı transaction'da onaylanır; yarışta ikinci onay `VERSION_CONFLICT`.
 */
export async function approveJoinRequest(
  params: CommandParams & { readonly joinRequestId: string; readonly code: string; readonly roleKey: string; readonly warehouseId?: string | null },
  deps: Pick<FieldUserDeps, "createFieldAccount">,
): Promise<ApproveJoinResult> {
  const { joinRequestId: rawId, code: rawCode, roleKey, warehouseId, requestId, ...access } = params;
  const id = parseUuid(rawId);
  const code = typeof rawCode === "string" ? rawCode.replace(/\s+/g, "") : "";
  if (!(FIELD_ROLES as readonly string[]).includes(roleKey)) throw new AppError("VALIDATION_FAILED");
  needRecentAuth(access);
  // (1) Kod doğrulaması (yanlış deneme kalıcı sayılır: bu transaction normal biter).
  const pre = await runTenantCommand({ ...access, permission: "users.manage" }, async (tx, actor) => {
    await assertNotDemo(tx, actor.tenantId);
    const v = await tx.execute<{ r: string }>(sql`SELECT wms_probe.field_join_verify(${id}::uuid, ${/^\d{6}$/.test(code) ? code : null}) AS r`);
    const outcome = v[0]?.r;
    if (outcome !== "OK") return { ok: false as const, issue: outcome === "WRONG" ? ("CODE_WRONG" as const) : ("GONE" as const) };
    const rows = await tx.execute<{ name: string; username: string }>(
      sql`SELECT name, username FROM public.team_join_requests WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${id}::uuid`,
    );
    const r = rows[0];
    if (r === undefined) return { ok: false as const, issue: "GONE" as const };
    return { ok: true as const, name: r.name, username: r.username };
  });
  if (!pre.ok) return pre;
  // (2) Hesap + talep onayı tek transaction'da (afterCreate).
  const created = await createFieldUser(
    { ...access, requestId, name: pre.name, username: pre.username, roleKey: roleKey as FieldRole, ...(warehouseId === undefined ? {} : { warehouseId }) },
    {
      createFieldAccount: deps.createFieldAccount,
      afterCreate: async (tx, ctx) => {
        const upd = await tx.execute<{ id: string }>(
          sql`UPDATE public.team_join_requests
                 SET status = 'APPROVED', decided_by = ${ctx.actorUserId}::uuid, decided_at = now(), membership_id = ${ctx.membershipId}::uuid
               WHERE tenant_id = ${ctx.tenantId}::uuid AND id = ${id}::uuid AND status = 'PENDING' AND expires_at > now()
               RETURNING id`,
        );
        if (upd.length === 0) throw new AppError("VERSION_CONFLICT");
        await appendAudit(tx, {
          action: "team_join.approved",
          actorUserId: ctx.actorUserId,
          entityType: "membership",
          entityId: ctx.membershipId,
          requestId: requestId ?? null,
          changeSummary: { join_request: id, role_key: roleKey, username: pre.username },
        });
      },
    },
  );
  return { ok: true, membershipId: created.membershipId, username: created.username };
}

/** Bekleyen talebi reddeder; onaylanmış ama PIN'i belirlenmemiş talebi iptal eder (açılan hesap kalır; kod yenilemeyle etkinleştirilebilir). */
export async function rejectJoinRequest(params: CommandParams & { readonly joinRequestId: string }): Promise<{ readonly changed: boolean }> {
  const { joinRequestId: rawId, requestId, ...access } = params;
  const id = parseUuid(rawId);
  needRecentAuth(access);
  return runTenantCommand({ ...access, permission: "users.manage" }, async (tx, actor) => {
    await assertNotDemo(tx, actor.tenantId);
    const rows = await tx.execute<{ id: string; status: string }>(
      sql`UPDATE public.team_join_requests
             SET status = CASE WHEN status = 'PENDING' THEN 'REJECTED' ELSE 'CANCELLED' END,
                 decided_by = CASE WHEN status = 'PENDING' THEN ${actor.userId}::uuid ELSE decided_by END,
                 decided_at = CASE WHEN status = 'PENDING' THEN now() ELSE decided_at END
           WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${id}::uuid AND status IN ('PENDING', 'APPROVED') RETURNING id, status`,
    );
    const r = rows[0];
    if (r === undefined) return { changed: false };
    await appendAudit(tx, {
      action: "team_join.rejected",
      actorUserId: actor.userId,
      entityType: "team_join_request",
      entityId: id,
      requestId: requestId ?? null,
      changeSummary: { outcome: r.status },
    });
    return { changed: true };
  });
}
