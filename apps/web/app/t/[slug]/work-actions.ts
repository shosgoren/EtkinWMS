"use server";
// T-989 (I-18): Görevlerim sinyalleri — sorun bildir/kapat, iş önceliği (ACİL + saat), vardiya. İnce giriş: zod + domain komutu;
// yetki domain'dedir (bildirim: saha rolleri; kapatma/öncelik: document.approve; vardiya: settings.manage). Not metni loga yazılmaz.
import { headers } from "next/headers";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import type { Permission } from "@wms/domain/identity/permissions";
import { PROBLEM_REASONS, WORK_SUBJECT_KINDS, reportProblem, resolveProblem, setWorkPriority, updateWorkShift } from "@wms/domain/operations";
import { createProductionGuard, limitVerifiedTenant, type ActionContext } from "../../../lib/action-guard.ts";

const guardedAction = createProductionGuard(() => headers());
const slug = z.string().min(1).max(63);
const id = z.string().uuid();
const note = z.string().max(2000).nullable().optional();
const hhmm = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const kind = z.enum(WORK_SUBJECT_KINDS);

const reportSchema = z
  .object({ slug, reason: z.enum(PROBLEM_REASONS), note, subjectKind: kind.nullable().optional(), subjectId: id.nullable().optional(), warehouseId: id.nullable().optional() })
  .strict();
const resolveSchema = z.object({ slug, problemId: id, note }).strict();
const prioritySchema = z.object({ slug, subjectKind: kind, subjectId: id, urgent: z.boolean(), dueTime: hhmm.nullable().optional() }).strict();
const shiftSchema = z.object({ slug, start: hhmm, end: hhmm }).strict();

async function writeContext(tenantSlug: string, permission: Permission, ctx: ActionContext) {
  if (ctx.principal === null) throw new Error("unreachable: principal required");
  await limitVerifiedTenant({ db: getAppDb(), principal: ctx.principal, tenantSlug, permission }, ctx);
  return { db: getAppDb(), principal: ctx.principal, tenantSlug };
}

export async function reportProblemAction(raw: unknown) {
  return guardedAction({ schema: reportSchema }, async (i, ctx) =>
    reportProblem(await writeContext(i.slug, "stock.view", ctx), {
      reason: i.reason,
      note: i.note ?? null,
      subjectKind: i.subjectKind ?? null,
      subjectId: i.subjectId ?? null,
      warehouseId: i.warehouseId ?? null,
      requestId: ctx.requestId,
    }),
  )(raw);
}

export async function resolveProblemAction(raw: unknown) {
  return guardedAction({ schema: resolveSchema }, async (i, ctx) => {
    await resolveProblem(await writeContext(i.slug, "document.approve", ctx), { problemId: i.problemId, note: i.note ?? null, requestId: ctx.requestId });
    return { resolved: true as const };
  })(raw);
}

export async function setWorkPriorityAction(raw: unknown) {
  return guardedAction({ schema: prioritySchema }, async (i, ctx) =>
    setWorkPriority(await writeContext(i.slug, "document.approve", ctx), { subjectKind: i.subjectKind, subjectId: i.subjectId, urgent: i.urgent, dueTime: i.dueTime ?? null, requestId: ctx.requestId }),
  )(raw);
}

export async function updateWorkShiftAction(raw: unknown) {
  return guardedAction({ schema: shiftSchema }, async (i, ctx) => {
    await updateWorkShift(await writeContext(i.slug, "settings.manage", ctx), { start: i.start, end: i.end, requestId: ctx.requestId });
    return { saved: true as const };
  })(raw);
}
