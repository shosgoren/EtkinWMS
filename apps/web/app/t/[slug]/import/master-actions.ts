"use server";
// T-981b: Depolar ve Raflar Excel'den içe aktarma / güncelleme eylemleri. İnce giriş: yalnız girdi doğrulama (zod) + domain komutu
// (`@wms/domain/onboarding/master-import`): yetki (`data.import` + `settings.manage`), depo kapsamı, kod biçimi ve audit domain'dedir.
// Satırlar yalnız bellekte taşınır (diske/loga yazılmaz, G-09). Bu dosyada DB bağlantısı açılmaz (`getAppDb` yalnız domain'e verilir).
import { headers } from "next/headers";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { MASTER_IMPORT_MAX_ROWS, importLocations, importWarehouses } from "@wms/domain/onboarding/master-import";
import { createProductionGuard, limitVerifiedTenant, type ActionContext } from "../../../../lib/action-guard.ts";

const guardedAction = createProductionGuard(() => headers());

const slugSchema = z.string().min(1).max(63);
const text = (max: number) => z.string().max(max).optional();
const row = z.number().int().min(1).max(100_000);
const opts = { slug: slugSchema, dryRun: z.boolean(), update: z.boolean(), addMissing: z.boolean() };
const warehouseSchema = z
  .object({ ...opts, rows: z.array(z.object({ row, code: text(200), name: text(400) }).strict()).min(1).max(MASTER_IMPORT_MAX_ROWS) })
  .strict();
const locationSchema = z
  .object({ ...opts, rows: z.array(z.object({ row, warehouseCode: text(200), code: text(200), name: text(400), parentCode: text(200), kind: text(60) }).strict()).min(1).max(MASTER_IMPORT_MAX_ROWS) })
  .strict();

async function writeContext(slug: string, ctx: ActionContext) {
  const principal = ctx.principal;
  if (principal === null) throw new Error("unreachable: principal required");
  await limitVerifiedTenant({ db: getAppDb(), principal, tenantSlug: slug, permission: "data.import" }, ctx);
  return { db: getAppDb(), principal, tenantSlug: slug };
}

/** Depo satırları (≤ 500). `dryRun`: kontrol adımı, hiçbir şey yazılmaz. */
export async function importWarehousesAction(raw: unknown) {
  return guardedAction({ schema: warehouseSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx);
    return importWarehouses({ ...params, requestId: ctx.requestId }, { rows: input.rows, dryRun: input.dryRun, update: input.update, addMissing: input.addMissing });
  })(raw);
}

/** Raf satırları (≤ 500; üst raf önce gelmeli). `dryRun`: kontrol adımı, hiçbir şey yazılmaz. */
export async function importLocationsAction(raw: unknown) {
  return guardedAction({ schema: locationSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx);
    return importLocations({ ...params, requestId: ctx.requestId }, { rows: input.rows, dryRun: input.dryRun, update: input.update, addMissing: input.addMissing });
  })(raw);
}
