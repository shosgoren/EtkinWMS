// T-421 (Gruplar.dc.html): hesap sahibinin tanımladığı ÖZEL yetki grupları. 0051 tabloları (permission_groups, member_groups).
//
// Kurallar (güvenlik incelemesi için):
// - Okuma `users.manage`; TÜM yazmalar yalnız HESAP SAHİBİ (`actor.isOwner`) ve yakın zamanda kimlik doğrulama (`recentAuth`, fail-closed).
// - Grup yalnız EK yetki verir (rol izinleri aynen kalır); verilebilecek yetkiler kapalı listedir (GRANTABLE = 0051 CHECK).
// - Hesap sahibi gruba konamaz (zaten tam yetki); saha hesabına (`@field.invalid`) MFA gerektiren yetki taşıyan grup verilemez
//   (paylaşılan cihaz girişi MFA yapamaz). Grup güncellenince aynı kural gruptaki saha hesapları için yeniden denetlenir.
// - Demo tenant'ta yazma kapalıdır (herkese açık demo hesapları yetki yükseltemez); okuma açıktır.
// - Grup ve üye değişikliğinde etkilenen üyeliklerin `roles_version` değeri artar (beklemedeki `withMembership` okumasıyla sıralanır, M4).
// - Audit aynı transaction'da: group.created / group.updated / group.archived / group.restored / member.group_changed.
// - T-1142 (yetki ekranı): tek dokunuşla yetki aç/kapa `changeGroupGrants` — küme işlemi (ekle/çıkar), sürüm istemez; aynı istek tekrarı
//   değişiklik üretmez (yazım ve audit yok, idempotent). Değişince `group.updated` (önceki/sonraki yetkiler) audit'i yazar.
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { isFieldEmail } from "@wms/shared/field-login";
import { mapAccessError, runTenantCommand, runTenantQuery, type AccessTx, type TenantAccessParams } from "./access.ts";
import { GRANTABLE, MFA_GRANTS, type Permission, type RoleKey } from "./permissions.ts";

export const GROUP_SCREENS = Object.freeze(["receive", "pick", "transfer", "prod", "count", "labels", "reports", "problem"] as const);
export type GroupScreen = (typeof GROUP_SCREENS)[number];
/** Tasarımdaki renk paleti (Gruplar.dc.html); başka değer kabul edilmez. */
export const GROUP_COLORS = Object.freeze(["#2F7D5B", "#0E7C7B", "#2F5DA8", "#6C4BD8", "#B5552B"] as const);

export type GroupIssue = "NAME_MISSING" | "NAME_TOO_LONG" | "NAME_TAKEN" | "COLOR_INVALID";

export interface CleanGroup {
  readonly name: string;
  readonly color: string;
  readonly screens: readonly GroupScreen[];
  readonly grants: readonly Permission[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_RE = /[\u0000-\u001f\u007f]/g;

function parseUuid(raw: unknown): string {
  if (typeof raw !== "string" || !UUID_RE.test(raw)) throw new AppError("VALIDATION_FAILED");
  return raw.toLowerCase();
}

/** Saf doğrulama (birim testli). Bilinmeyen ekran/yetki değeri sessizce atılmaz: `VALIDATION_FAILED` (istemci yalnız listeden gönderir). */
export function cleanGroup(input: { name?: unknown; color?: unknown; screens?: unknown; grants?: unknown }): { ok: true; value: CleanGroup } | { ok: false; issue: GroupIssue } {
  const name = typeof input.name === "string" ? input.name.replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim() : "";
  if (name === "") return { ok: false, issue: "NAME_MISSING" };
  if ([...name].length > 60) return { ok: false, issue: "NAME_TOO_LONG" };
  const color = typeof input.color === "string" ? input.color.trim().toUpperCase() : GROUP_COLORS[0];
  if (!(GROUP_COLORS as readonly string[]).includes(color)) return { ok: false, issue: "COLOR_INVALID" };
  const list = <T extends string>(raw: unknown, allowed: readonly T[]): T[] => {
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > allowed.length * 2) throw new AppError("VALIDATION_FAILED");
    const out: T[] = [];
    for (const v of raw) {
      if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) throw new AppError("VALIDATION_FAILED");
      if (!out.includes(v as T)) out.push(v as T);
    }
    // Kanonik sıra: kapalı listedeki sıra (fark karşılaştırması ve audit kararlı olsun).
    return allowed.filter((a) => out.includes(a));
  };
  return { ok: true, value: { name, color, screens: list(input.screens, GROUP_SCREENS), grants: list(input.grants, GRANTABLE) } };
}

export const needsMfa = (grants: readonly string[]): boolean => grants.some((g) => (MFA_GRANTS as readonly string[]).includes(g));

/**
 * T-1142: yetki aç/kapa kümesi (saf, birim testli). `add` ve `remove` yalnız kapalı listeden (GRANTABLE), aynı anahtar ikisinde birden olamaz;
 * aksi `VALIDATION_FAILED`. Sonuç kanonik sırada: (önceki ∪ add) \ remove.
 */
export function nextGrants(before: readonly string[], add: unknown, remove: unknown): readonly Permission[] {
  const parse = (raw: unknown): Permission[] => {
    if (!Array.isArray(raw) || raw.length > GRANTABLE.length) throw new AppError("VALIDATION_FAILED");
    for (const v of raw) if (typeof v !== "string" || !(GRANTABLE as readonly string[]).includes(v)) throw new AppError("VALIDATION_FAILED");
    return raw as Permission[];
  };
  const a = parse(add);
  const r = parse(remove);
  if (a.length + r.length === 0 || a.some((x) => r.includes(x))) throw new AppError("VALIDATION_FAILED");
  return GRANTABLE.filter((g) => (before.includes(g) || a.includes(g)) && !r.includes(g));
}

// ---------------------------------------------------------------------------------------------

type Access = Omit<TenantAccessParams, "permission">;
type CommandParams = Access & { readonly requestId?: string };

function deny(): AppError {
  return new AppError("FORBIDDEN");
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

async function ownerWrite<T>(params: CommandParams, fn: (tx: AccessTx, actor: { tenantId: string; userId: string; membershipId: string }) => Promise<T>): Promise<T> {
  const { requestId: _r, ...access } = params;
  void _r;
  if (access.recentAuth === undefined) throw new AppError("UNAUTHENTICATED", { detail: "RECENT_AUTH_REQUIRED" });
  try {
    return await runTenantCommand({ ...access, permission: "users.manage" }, async (tx, actor) => {
      if (!actor.isOwner) throw deny();
      const demo = await tx.execute<{ is_demo: boolean }>(sql`SELECT is_demo FROM public.tenants WHERE id = ${actor.tenantId}::uuid`);
      if (demo[0]?.is_demo !== false) throw deny();
      return fn(tx, { tenantId: actor.tenantId, userId: actor.userId, membershipId: actor.membershipId });
    });
  } catch (e) {
    throw mapAccessError(e);
  }
}

async function bumpMembers(tx: AccessTx, tenantId: string, membershipIds: readonly string[]): Promise<void> {
  if (membershipIds.length === 0) return;
  await tx.execute(
    sql`UPDATE public.tenant_memberships SET roles_version = roles_version + 1
         WHERE tenant_id = ${tenantId}::uuid AND id IN (${sql.join(membershipIds.map((id) => sql`${id}::uuid`), sql`, `)})`,
  );
}

/** Gruptaki üyeler (kilitli; FOR UPDATE OF m) — grup değişikliği ile üye okuması sıralanır. */
async function lockGroupMembers(tx: AccessTx, tenantId: string, groupId: string): Promise<{ id: string; email: string }[]> {
  const rows = await tx.execute<{ id: string; email: string }>(
    sql`SELECT m.id, u.email
          FROM public.member_groups mg
          JOIN public.tenant_memberships m ON m.tenant_id = mg.tenant_id AND m.id = mg.membership_id
          JOIN public.users u ON u.id = m.user_id
         WHERE mg.tenant_id = ${tenantId}::uuid AND mg.group_id = ${groupId}::uuid AND m.status = 'ACTIVE'
         ORDER BY m.id
           FOR UPDATE OF m`,
  );
  return [...rows];
}

type GroupRow = {
  id: string;
  name: string;
  color: string;
  screens: string[];
  grants: string[];
  archived_at: Date | string | null;
  version: number;
};

async function lockGroup(tx: AccessTx, tenantId: string, id: string): Promise<GroupRow> {
  const rows = await tx.execute<GroupRow>(
    sql`SELECT id, name, color, screens, grants, archived_at, version FROM public.permission_groups
         WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`,
  );
  const r = rows[0];
  if (r === undefined) throw new AppError("NOT_FOUND");
  return r;
}

// ---------------------------------------------------------------------------------------------
// Okuma
// ---------------------------------------------------------------------------------------------

export interface GroupView {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly screens: readonly string[];
  readonly grants: readonly string[];
  readonly archived: boolean;
  readonly version: number;
  readonly memberCount: number;
}

export interface GroupMemberView {
  readonly membershipId: string;
  readonly name: string;
  readonly isOwner: boolean;
  readonly isField: boolean;
  readonly roles: readonly RoleKey[];
  readonly groupId: string | null;
}

export interface GroupsOverview {
  readonly groups: readonly GroupView[];
  readonly members: readonly GroupMemberView[];
  /** Yazma yalnız hesap sahibine ve demo dışında açık. */
  readonly canEdit: boolean;
}

export async function listGroups(params: Access): Promise<GroupsOverview> {
  return runTenantQuery({ ...params, permission: "users.manage" }, async (tx, actor) => {
    const groups = await tx.execute<GroupRow & { n: number }>(
      sql`SELECT g.id, g.name, g.color, g.screens, g.grants, g.archived_at, g.version,
                 (SELECT count(*)::int FROM public.member_groups mg
                    JOIN public.tenant_memberships m ON m.tenant_id = mg.tenant_id AND m.id = mg.membership_id AND m.status = 'ACTIVE'
                   WHERE mg.tenant_id = g.tenant_id AND mg.group_id = g.id) AS n
            FROM public.permission_groups g
           WHERE g.tenant_id = ${actor.tenantId}::uuid
           ORDER BY g.archived_at IS NOT NULL, lower(g.name), g.id`,
    );
    const members = await tx.execute<{ id: string; name: string; email: string; is_owner: boolean; group_id: string | null }>(
      sql`SELECT m.id, u.name, u.email, m.is_owner, mg.group_id
            FROM public.tenant_memberships m
            JOIN public.users u ON u.id = m.user_id
            LEFT JOIN public.member_groups mg ON mg.tenant_id = m.tenant_id AND mg.membership_id = m.id
           WHERE m.tenant_id = ${actor.tenantId}::uuid AND m.status = 'ACTIVE'
           ORDER BY m.is_owner DESC, u.name, m.id`,
    );
    const roles = await tx.execute<{ membership_id: string; role_key: RoleKey }>(
      sql`SELECT membership_id, role_key FROM public.membership_roles WHERE tenant_id = ${actor.tenantId}::uuid ORDER BY role_key`,
    );
    const roleBy = new Map<string, RoleKey[]>();
    for (const r of roles) roleBy.set(r.membership_id, [...(roleBy.get(r.membership_id) ?? []), r.role_key]);
    const demo = await tx.execute<{ is_demo: boolean }>(sql`SELECT is_demo FROM public.tenants WHERE id = ${actor.tenantId}::uuid`);
    return {
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        color: g.color,
        screens: g.screens,
        grants: g.grants,
        archived: g.archived_at !== null,
        version: g.version,
        memberCount: g.n,
      })),
      // E-posta yanıta girmez (yalnız saha hesabı bayrağı).
      members: members.map((m) => ({
        membershipId: m.id,
        name: m.name,
        isOwner: m.is_owner,
        isField: isFieldEmail(m.email),
        roles: roleBy.get(m.id) ?? [],
        groupId: m.group_id,
      })),
      canEdit: actor.isOwner && demo[0]?.is_demo === false,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Yazma
// ---------------------------------------------------------------------------------------------

export type SaveGroupResult = { ok: true; id: string; version: number } | { ok: false; issue: GroupIssue | "FIELD_MEMBER_MFA" };

export async function saveGroup(
  params: CommandParams & { readonly id?: string; readonly expectedVersion?: number; readonly name?: unknown; readonly color?: unknown; readonly screens?: unknown; readonly grants?: unknown },
): Promise<SaveGroupResult> {
  const { id: rawId, expectedVersion, name, color, screens, grants, ...rest } = params;
  const id = rawId === undefined ? undefined : parseUuid(rawId);
  if (id !== undefined && (typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion) || expectedVersion < 1)) throw new AppError("VALIDATION_FAILED");
  const clean = cleanGroup({ name, color, screens, grants });
  if (!clean.ok) return clean;
  const g = clean.value;
  try {
    return await ownerWrite(rest, async (tx, actor) => {
      const taken = await tx.execute<{ id: string }>(
        sql`SELECT id FROM public.permission_groups
             WHERE tenant_id = ${actor.tenantId}::uuid AND archived_at IS NULL AND lower(name) = lower(${g.name})
               ${id === undefined ? sql`` : sql`AND id <> ${id}::uuid`}`,
      );
      if (taken.length > 0) return { ok: false, issue: "NAME_TAKEN" } as const;
      const screensArr = sql`ARRAY[${sql.join(g.screens.map((s) => sql`${s}`), sql`, `)}]::text[]`;
      const grantsArr = sql`ARRAY[${sql.join(g.grants.map((s) => sql`${s}`), sql`, `)}]::text[]`;
      if (id === undefined) {
        const rows = await tx.execute<{ id: string; version: number }>(
          sql`INSERT INTO public.permission_groups (tenant_id, name, color, screens, grants, created_by)
              VALUES (${actor.tenantId}::uuid, ${g.name}, ${g.color}, ${g.screens.length === 0 ? sql`'{}'::text[]` : screensArr},
                      ${g.grants.length === 0 ? sql`'{}'::text[]` : grantsArr}, ${actor.membershipId}::uuid)
              RETURNING id, version`,
        );
        const created = rows[0];
        if (created === undefined) throw new AppError("INTERNAL");
        await appendAudit(tx, {
          action: "group.created",
          actorUserId: actor.userId,
          entityType: "permission_group",
          entityId: created.id,
          requestId: params.requestId ?? null,
          changeSummary: { name: g.name, screens: [...g.screens], grants: [...g.grants] },
        });
        return { ok: true, id: created.id, version: created.version } as const;
      }
      // Kilit sırası withMembership ile aynı: önce üyelik satırları, sonra grup (ters sıra deadlock üretirdi).
      const members = await lockGroupMembers(tx, actor.tenantId, id);
      const before = await lockGroup(tx, actor.tenantId, id);
      if (before.version !== expectedVersion) throw new AppError("VERSION_CONFLICT");
      if (before.archived_at !== null) throw new AppError("VALIDATION_FAILED");
      if (needsMfa(g.grants) && members.some((m) => isFieldEmail(m.email))) return { ok: false, issue: "FIELD_MEMBER_MFA" } as const;
      const rows = await tx.execute<{ version: number }>(
        sql`UPDATE public.permission_groups
               SET name = ${g.name}, color = ${g.color},
                   screens = ${g.screens.length === 0 ? sql`'{}'::text[]` : screensArr},
                   grants = ${g.grants.length === 0 ? sql`'{}'::text[]` : grantsArr}
             WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${id}::uuid
             RETURNING version`,
      );
      await bumpMembers(tx, actor.tenantId, members.map((m) => m.id));
      await appendAudit(tx, {
        action: "group.updated",
        actorUserId: actor.userId,
        entityType: "permission_group",
        entityId: id,
        requestId: params.requestId ?? null,
        changeSummary: {
          from_name: before.name,
          name: g.name,
          from_color: before.color,
          color: g.color,
          from_grants: [...before.grants],
          grants: [...g.grants],
          from_screens: [...before.screens],
          screens: [...g.screens],
        },
      });
      return { ok: true, id, version: rows[0]?.version ?? before.version + 1 } as const;
    });
  } catch (e) {
    if (sqlstateOf(e) === "23505") return { ok: false, issue: "NAME_TAKEN" };
    throw e;
  }
}

/** Arşiv: grup silinmez; arşivdeki grubun yetkisi uygulanmaz (`withMembership`). Geri alırken ad çakışması `NAME_TAKEN`. */
export async function setGroupArchived(
  params: CommandParams & { readonly id: string; readonly expectedVersion: number; readonly archived: boolean },
): Promise<SaveGroupResult> {
  const { id: rawId, expectedVersion, archived, ...rest } = params;
  const id = parseUuid(rawId);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || typeof archived !== "boolean") throw new AppError("VALIDATION_FAILED");
  try {
    return await ownerWrite(rest, async (tx, actor) => {
      const members = await lockGroupMembers(tx, actor.tenantId, id); // kilit sırası: üyelik → grup
      const before = await lockGroup(tx, actor.tenantId, id);
      if (before.version !== expectedVersion) throw new AppError("VERSION_CONFLICT");
      if ((before.archived_at !== null) === archived) return { ok: true, id, version: before.version } as const;
      if (!archived && needsMfa(before.grants) && members.some((m) => isFieldEmail(m.email))) return { ok: false, issue: "FIELD_MEMBER_MFA" } as const;
      const rows = await tx.execute<{ version: number }>(
        sql`UPDATE public.permission_groups SET archived_at = ${archived ? sql`now()` : sql`NULL`}
             WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${id}::uuid RETURNING version`,
      );
      await bumpMembers(tx, actor.tenantId, members.map((m) => m.id));
      await appendAudit(tx, {
        action: archived ? "group.archived" : "group.restored",
        actorUserId: actor.userId,
        entityType: "permission_group",
        entityId: id,
        requestId: params.requestId ?? null,
        changeSummary: { name: before.name, members: members.length },
      });
      return { ok: true, id, version: rows[0]?.version ?? before.version + 1 } as const;
    });
  } catch (e) {
    if (sqlstateOf(e) === "23505") return { ok: false, issue: "NAME_TAKEN" };
    throw e;
  }
}

export type ChangeGrantsResult = { ok: true; changed: boolean; version: number; grants: readonly Permission[] } | { ok: false; issue: "FIELD_MEMBER_MFA" };

/**
 * T-1142: grubun yetkilerini aç/kapa (bölüm "hepsi", hazır şablon ve tek satır aynı komut). Yalnız hesap sahibi + yakın zamanda kimlik
 * doğrulama (`ownerWrite`); arşivdeki grup değiştirilemez; MFA isteyen yetki saha hesabı olan gruba açılamaz. Değişiklik yoksa yazım/audit yok.
 */
export async function changeGroupGrants(params: CommandParams & { readonly id: string; readonly add: unknown; readonly remove: unknown }): Promise<ChangeGrantsResult> {
  const { id: rawId, add, remove, ...rest } = params;
  const id = parseUuid(rawId);
  // Girdi biçimi transaction'dan önce (geçersiz istek DB'ye gitmez).
  nextGrants([], add, remove);
  return ownerWrite(rest, async (tx, actor) => {
    const members = await lockGroupMembers(tx, actor.tenantId, id); // kilit sırası: üyelik → grup
    const before = await lockGroup(tx, actor.tenantId, id);
    if (before.archived_at !== null) throw new AppError("VALIDATION_FAILED");
    const grants = nextGrants(before.grants, add, remove);
    const same = grants.length === before.grants.length && grants.every((g) => before.grants.includes(g));
    if (same) return { ok: true, changed: false, version: before.version, grants } as const;
    // Yalnız EKLENEN MFA yetkisi engellenir (kapatma her zaman serbest).
    if (needsMfa(grants.filter((g) => !before.grants.includes(g))) && members.some((m) => isFieldEmail(m.email))) return { ok: false, issue: "FIELD_MEMBER_MFA" } as const;
    const arr = grants.length === 0 ? sql`'{}'::text[]` : sql`ARRAY[${sql.join(grants.map((g) => sql`${g}`), sql`, `)}]::text[]`;
    const rows = await tx.execute<{ version: number }>(
      sql`UPDATE public.permission_groups SET grants = ${arr} WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${id}::uuid RETURNING version`,
    );
    await bumpMembers(tx, actor.tenantId, members.map((m) => m.id));
    await appendAudit(tx, {
      action: "group.updated",
      actorUserId: actor.userId,
      entityType: "permission_group",
      entityId: id,
      requestId: params.requestId ?? null,
      changeSummary: { name: before.name, from_grants: [...before.grants], grants: [...grants], via: "permission_screen" },
    });
    return { ok: true, changed: true, version: rows[0]?.version ?? before.version + 1, grants } as const;
  });
}

export type AssignGroupResult = { ok: true; changed: boolean } | { ok: false; issue: "OWNER" | "FIELD_MEMBER_MFA" | "GROUP_ARCHIVED" };

/** Üyeyi özel gruba koyar (`groupId`) ya da gruptan çıkarır (`null` → yalnız rolünün yetkileri). Üye en çok bir gruptadır. */
export async function setMemberGroup(params: CommandParams & { readonly memberId: string; readonly groupId: string | null }): Promise<AssignGroupResult> {
  const { memberId: rawMember, groupId: rawGroup, ...rest } = params;
  const memberId = parseUuid(rawMember);
  const groupId = rawGroup === null ? null : parseUuid(rawGroup);
  return ownerWrite(rest, async (tx, actor) => {
    const target = await tx.execute<{ id: string; is_owner: boolean; email: string }>(
      sql`SELECT m.id, m.is_owner, u.email FROM public.tenant_memberships m JOIN public.users u ON u.id = m.user_id
           WHERE m.tenant_id = ${actor.tenantId}::uuid AND m.id = ${memberId}::uuid AND m.status = 'ACTIVE'
             FOR UPDATE OF m`,
    );
    const t = target[0];
    if (t === undefined) throw new AppError("NOT_FOUND");
    if (t.is_owner) return { ok: false, issue: "OWNER" } as const;
    const current = await tx.execute<{ group_id: string }>(
      sql`SELECT group_id FROM public.member_groups WHERE tenant_id = ${actor.tenantId}::uuid AND membership_id = ${memberId}::uuid FOR UPDATE`,
    );
    const from = current[0]?.group_id ?? null;
    if (from === groupId) return { ok: true, changed: false } as const;
    if (groupId === null) {
      await tx.execute(sql`DELETE FROM public.member_groups WHERE tenant_id = ${actor.tenantId}::uuid AND membership_id = ${memberId}::uuid`);
    } else {
      const g = await tx.execute<{ grants: string[]; archived_at: Date | string | null }>(
        sql`SELECT grants, archived_at FROM public.permission_groups WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${groupId}::uuid FOR SHARE`,
      );
      const grp = g[0];
      if (grp === undefined) throw new AppError("NOT_FOUND");
      if (grp.archived_at !== null) return { ok: false, issue: "GROUP_ARCHIVED" } as const;
      if (needsMfa(grp.grants) && isFieldEmail(t.email)) return { ok: false, issue: "FIELD_MEMBER_MFA" } as const;
      await tx.execute(
        sql`INSERT INTO public.member_groups (tenant_id, membership_id, group_id, assigned_by)
            VALUES (${actor.tenantId}::uuid, ${memberId}::uuid, ${groupId}::uuid, ${actor.membershipId}::uuid)
            ON CONFLICT (tenant_id, membership_id) DO UPDATE SET group_id = EXCLUDED.group_id, assigned_by = EXCLUDED.assigned_by`,
      );
    }
    await bumpMembers(tx, actor.tenantId, [memberId]);
    await appendAudit(tx, {
      action: "member.group_changed",
      actorUserId: actor.userId,
      entityType: "membership",
      entityId: memberId,
      requestId: params.requestId ?? null,
      changeSummary: { from_group: from, to_group: groupId },
    });
    return { ok: true, changed: true } as const;
  });
}
