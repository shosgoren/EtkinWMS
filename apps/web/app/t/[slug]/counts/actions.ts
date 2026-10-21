"use server";
// T-977 (B-51): sayım eylemleri. İnce giriş: zod (strict; kimlik/tenant alanı istemciden alınmaz) + T-309/T-987 domain komutu. Yetki (A-132:
// başlat/iptal/görev `document.approve`, sayım girişi/gönder `document.create`, fark onayı/işleme `count_diff.approve`), görev ayrılığı (T-416: satır sayan
// fark onaylayamaz), kilitler (I-15) ve idempotency (I-06) domain'dedir; burada yeniden yazılmaz. Miktarlar dizge (I-09). Yazma eylemleri `clientKey` ister.
import { headers } from "next/headers";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import type { Permission } from "@wms/domain/identity/permissions";
import { approveCount, cancelCount, createCountTasks, postCountAdjustment, recordCount, startCount, submitCount } from "@wms/domain/operations";
import { findLocationByCode } from "@wms/domain/warehouse";
import { createProductionGuard, limitVerifiedTenant, type ActionContext } from "../../../../lib/action-guard.ts";

const guardedAction = createProductionGuard(() => headers());
const slug = z.string().min(1).max(63);
const id = z.string().uuid();
const key = z.string().uuid();
const startSchema = z
  .object({ slug, clientKey: key, warehouseId: id, codes: z.array(z.string().min(1).max(64)).min(1).max(200), blind: z.boolean() })
  .strict();
const sessionSchema = z.object({ slug, clientKey: key, sessionId: id }).strict();
const cancelSchema = z.object({ slug, clientKey: key, sessionId: id, reason: z.string().min(1).max(500) }).strict();
const recordSchema = z
  .object({ slug, clientKey: key, sessionId: id, locationId: id, itemId: id, countedQuantity: z.string().min(1).max(32), stockStatus: z.enum(["AVAILABLE", "QUARANTINE", "DAMAGED", "BLOCKED"]).optional() })
  .strict();

async function writeContext(slugValue: string, permission: Permission, clientKey: string, ctx: ActionContext) {
  const principal = ctx.principal;
  if (principal === null) throw new Error("unreachable: principal required");
  await limitVerifiedTenant({ db: getAppDb(), principal, tenantSlug: slugValue, permission }, ctx);
  return { db: getAppDb(), principal, tenantSlug: slugValue, clientKey };
}

/**
 * Sayım başlat (`document.approve`) + raf başına sayım görevi (üstlenilebilir). Raf kodları sunucuda depo içinde çözülür; bulunmayan kod varsa
 * komut ÇALIŞMAZ ve eksik kodlar döner. Görev oluşturma ayrı komuttur ve tekrar çağrısı güvenlidir (yalnız eksik raflara görev açar).
 */
export async function startCountAction(raw: unknown) {
  return guardedAction({ schema: startSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, "document.approve", input.clientKey, ctx);
    const codes = [...new Set(input.codes.map((c) => c.trim()).filter((c) => c !== ""))];
    const ids: string[] = [];
    const missing: string[] = [];
    for (const code of codes) {
      const loc = await findLocationByCode(params, { warehouseId: input.warehouseId, code });
      if (loc === null || loc.status !== "ACTIVE") missing.push(code);
      else ids.push(loc.id);
    }
    if (missing.length > 0 || ids.length === 0) return { sessionId: null, missing, tasks: 0 };
    const started = await startCount(params, { warehouseId: input.warehouseId, locationIds: ids, blind: input.blind, requestId: ctx.requestId });
    const tasks = await createCountTasks(params, { sessionId: started.sessionId, requestId: ctx.requestId });
    return { sessionId: started.sessionId, missing: [] as string[], tasks: tasks.taskIds.length };
  })(raw);
}

/** Saha: bir rafın tek ürün sayısı (`document.create`). Aynı satır yeniden yazılırsa son değer geçerli; onaya kadar düzeltilebilir. */
export async function recordCountAction(raw: unknown) {
  return guardedAction({ schema: recordSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, "document.create", input.clientKey, ctx);
    return recordCount(params, {
      sessionId: input.sessionId,
      lines: [{ locationId: input.locationId, itemId: input.itemId, countedQuantity: input.countedQuantity, ...(input.stockStatus === undefined ? {} : { stockStatus: input.stockStatus }) }],
      requestId: ctx.requestId,
    });
  })(raw);
}

/** Saha: sayımı onaya gönder (`document.create`; tüm satırlar sayılmış olmalı, A-309-3). */
export async function submitCountAction(raw: unknown) {
  return guardedAction({ schema: sessionSchema }, async (input, ctx) => submitCount(await writeContext(input.slug, "document.create", input.clientKey, ctx), { sessionId: input.sessionId, requestId: ctx.requestId }))(raw);
}

/** Yönetici: farkı onayla (`count_diff.approve`; görev ayrılığı açıksa sayan onaylayamaz). */
export async function approveCountAction(raw: unknown) {
  return guardedAction({ schema: sessionSchema }, async (input, ctx) => {
    const r = await approveCount(await writeContext(input.slug, "count_diff.approve", input.clientKey, ctx), { sessionId: input.sessionId, requestId: ctx.requestId });
    return { status: r.status, differences: r.differences.length };
  })(raw);
}

/** Yönetici: fark fişini işle (`count_diff.approve`); kilitler açılır, raf görevleri kapanır. */
export async function postCountAction(raw: unknown) {
  return guardedAction({ schema: sessionSchema }, async (input, ctx) => {
    const r = await postCountAdjustment(await writeContext(input.slug, "count_diff.approve", input.clientKey, ctx), { sessionId: input.sessionId, requestId: ctx.requestId });
    return { documentId: r.documentId ?? null, replayed: r.replayed };
  })(raw);
}

/** Yönetici: sayımı iptal et (`document.approve`; fark uygulanmaz, kilitler açılır). */
export async function cancelCountAction(raw: unknown) {
  return guardedAction({ schema: cancelSchema }, async (input, ctx) => {
    const r = await cancelCount(await writeContext(input.slug, "document.approve", input.clientKey, ctx), { sessionId: input.sessionId, reason: input.reason, requestId: ctx.requestId });
    return { replayed: r.replayed };
  })(raw);
}
