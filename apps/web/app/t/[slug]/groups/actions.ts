"use server";
// Yetki grubu eylemleri (T-421). İnce giriş: yalnız girdi doğrulama (zod) + domain komutu; hesap sahibi kuralı, kapalı yetki listesi,
// MFA ve audit domain'dedir (`@wms/domain/identity/groups`). Her yazma yakın zamanda kimlik doğrulama ister (fail-closed). DB bağlantısı açılmaz.
import { headers } from "next/headers";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { GROUP_SCREENS, saveGroup, setGroupArchived, setMemberGroup } from "@wms/domain/identity/groups";
import { GRANTABLE } from "@wms/domain/identity/permissions";
import { ensureRecentAuth } from "../../../../lib/auth-service.ts";
import { createProductionGuard, limitVerifiedTenant, type ActionContext } from "../../../../lib/action-guard.ts";

const guardedAction = createProductionGuard(() => headers());
const slugSchema = z.string().min(1).max(63);
const version = z.number().int().min(1).max(2_147_483_647);
const grants = z.array(z.enum(GRANTABLE as unknown as [string, ...string[]])).max(16);
const screens = z.array(z.enum(GROUP_SCREENS as unknown as [string, ...string[]])).max(16);

const saveSchema = z
  .object({ slug: slugSchema, id: z.string().uuid().optional(), expectedVersion: version.optional(), name: z.string().max(200), color: z.string().max(16), screens, grants })
  .strict();
const archiveSchema = z.object({ slug: slugSchema, id: z.string().uuid(), expectedVersion: version, archived: z.boolean() }).strict();
const memberSchema = z.object({ slug: slugSchema, memberId: z.string().uuid(), groupId: z.string().uuid().nullable() }).strict();

async function ownerContext(slug: string, ctx: ActionContext) {
  const principal = ctx.principal;
  if (principal === null) throw new Error("unreachable: principal required");
  await limitVerifiedTenant({ db: getAppDb(), principal, tenantSlug: slug, permission: "users.manage" }, ctx);
  const h = await headers();
  return { db: getAppDb(), principal, tenantSlug: slug, requestId: ctx.requestId, recentAuth: () => ensureRecentAuth(h) };
}

export async function saveGroupAction(raw: unknown) {
  return guardedAction({ schema: saveSchema }, async (input, ctx) => {
    const { slug, ...body } = input;
    return saveGroup({ ...(await ownerContext(slug, ctx)), ...body });
  })(raw);
}

export async function archiveGroupAction(raw: unknown) {
  return guardedAction({ schema: archiveSchema }, async (input, ctx) =>
    setGroupArchived({ ...(await ownerContext(input.slug, ctx)), id: input.id, expectedVersion: input.expectedVersion, archived: input.archived }),
  )(raw);
}

export async function setMemberGroupAction(raw: unknown) {
  return guardedAction({ schema: memberSchema }, async (input, ctx) =>
    setMemberGroup({ ...(await ownerContext(input.slug, ctx)), memberId: input.memberId, groupId: input.groupId }),
  )(raw);
}
