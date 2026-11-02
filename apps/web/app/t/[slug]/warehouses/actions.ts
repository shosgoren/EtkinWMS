"use server";
// Depo ve lokasyon eylemleri (T-207). İnce giriş: yalnızca girdi doğrulama (zod) + T-205 domain komutu; kod/ad normalleştirmesi
// (A-98) ve yetki (T-1141 kart anahtarları, A-68) sunucuda domain'dedir, burada yeniden yazılmaz. İdempotency gerekmez: komutlar stok
// değiştirmez; çift gönderim `CODE_TAKEN` ile sonuçlanır. Bu dosyada DB bağlantısı açılmaz (`getAppDb` yalnızca domain'e verilir).
import { headers } from "next/headers";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { createWithSuggestedCode, suggestCode } from "@wms/domain/catalog";
import {
  archiveLocation,
  archiveWarehouse,
  createBulkLocations,
  createLocation,
  createWarehouse,
  getLocationTree,
  getSetupProgress,
  previewBulkLocations,
  renameLocation,
  renameWarehouse,
  searchLocations,
} from "@wms/domain/warehouse";
import type { LocationKindValue } from "@wms/domain/warehouse";
import type { Permission } from "@wms/domain/identity/permissions";
import { createProductionGuard, limitVerifiedTenant, type ActionContext } from "../../../../lib/action-guard.ts";
import { loadWarehousesPage } from "./list-page.ts";
import { getSourceLinkedIds } from "@wms/domain/integrations";

const guardedAction = createProductionGuard(() => headers());

const slugSchema = z.string().min(1).max(63);
const idSchema = z.string().uuid();
// Sınırlar yalnızca istemci kötüye kullanımına karşı kaba üst sınırdır; asıl doğrulama/normalleştirme domain'dedir.
const textSchema = z.string().min(1).max(512);
// `LocationKindValue` ile birebir olmalıdır (`satisfies` derleme zamanında zorlar).
const kindSchema = z.enum(["RECEIVING", "STORAGE", "STAGING", "TRANSIT"] as const satisfies readonly LocationKindValue[]);

// `autoCode` (T-250): kod kullanıcı tarafından değiştirilmedi beyanı; sunucu kodun önerilen biçimde olduğunu da doğrular (T-259), çakışmada aynı önekle yeniden dener.
const createWarehouseSchema = z.object({ slug: slugSchema, code: textSchema, name: textSchema, autoCode: z.boolean().optional() }).strict();
const suggestCodeSchema = z.object({ slug: slugSchema, kind: z.enum(["warehouse", "location"]), warehouseId: idSchema.optional() }).strict();
const bulkSpecShape = {
  slug: slugSchema,
  warehouseId: idSchema,
  parentId: idSchema.nullable(),
  zone: z.string().min(1).max(16),
  rackFrom: z.number().int(),
  rackTo: z.number().int(),
  levelFrom: z.number().int(),
  levelTo: z.number().int(),
};
const previewBulkSchema = z.object(bulkSpecShape).strict();
const createBulkSchema = z.object({ ...bulkSpecShape, idempotencyKey: z.string().min(1).max(64) }).strict();
const searchLocationsSchema = z.object({ slug: slugSchema, warehouseId: idSchema, q: z.string().max(128), limit: z.number().int().min(1).max(20).optional() }).strict();
const setupProgressSchema = z.object({ slug: slugSchema }).strict();
const archiveWarehouseSchema = z.object({ slug: slugSchema, warehouseId: idSchema }).strict();
const createLocationSchema = z
  .object({ slug: slugSchema, warehouseId: idSchema, parentId: idSchema.nullable(), code: textSchema, name: textSchema, kind: kindSchema, autoCode: z.boolean().optional() })
  .strict();
const renameWarehouseSchema = z.object({ slug: slugSchema, warehouseId: idSchema, code: textSchema }).strict();
const renameLocationSchema = z.object({ slug: slugSchema, locationId: idSchema, code: textSchema }).strict();
const archiveLocationSchema = z.object({ slug: slugSchema, locationId: idSchema }).strict();
const moreLocationsSchema = z
  .object({ slug: slugSchema, warehouseId: idSchema, after: z.object({ depth: z.number().int().min(0).max(16), code: textSchema, id: idSchema }).strict() })
  .strict();

/** Komut izni T-1141 kart anahtarı (domain komutuyla aynı); sayaç doğrulanmış tenant kimliğiyle tüketilir (üye/yetkisiz çağıran sayaç tüketmez). */
async function writeContext(slug: string, ctx: ActionContext, permission: Permission) {
  const principal = ctx.principal;
  if (principal === null) throw new Error("unreachable: principal required");
  await limitVerifiedTenant({ db: getAppDb(), principal, tenantSlug: slug, permission }, ctx);
  return { db: getAppDb(), principal, tenantSlug: slug };
}

export async function createWarehouseAction(raw: unknown) {
  return guardedAction({ schema: createWarehouseSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, "warehouses.create");
    const create = (code: string) => createWarehouse(params, { code, name: input.name, requestId: ctx.requestId });
    const r = await createWithSuggestedCode({
      kind: "warehouse",
      code: input.code,
      auto: input.autoCode === true,
      suggest: (prefix) => suggestCode(params, { kind: "warehouse", prefix }),
      create,
    });
    return { warehouseId: r.warehouseId };
  })(raw);
}

export async function archiveWarehouseAction(raw: unknown) {
  return guardedAction({ schema: archiveWarehouseSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, "warehouses.archive");
    const r = await archiveWarehouse(params, { warehouseId: input.warehouseId, requestId: ctx.requestId });
    return { archived: r.archived };
  })(raw);
}

/** Depo kodunu değiştirir (T-257): normalleştirme, benzersizlik, kod geçmişi ve audit T-251 domain komutundadır. */
export async function renameWarehouseAction(raw: unknown) {
  return guardedAction({ schema: renameWarehouseSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, "warehouses.edit");
    const r = await renameWarehouse(params, { warehouseId: input.warehouseId, code: input.code, requestId: ctx.requestId });
    return { changed: r.changed };
  })(raw);
}

/** Lokasyon kodunu değiştirir (T-257): depo içi benzersizlik ve kod geçmişi domain'dedir. */
export async function renameLocationAction(raw: unknown) {
  return guardedAction({ schema: renameLocationSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, "locations.edit");
    const r = await renameLocation(params, { locationId: input.locationId, code: input.code, requestId: ctx.requestId });
    return { changed: r.changed };
  })(raw);
}

export async function createLocationAction(raw: unknown) {
  return guardedAction({ schema: createLocationSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, "locations.create");
    const create = (code: string) =>
      createLocation(params, { warehouseId: input.warehouseId, parentId: input.parentId, code, name: input.name, kind: input.kind, requestId: ctx.requestId });
    const r = await createWithSuggestedCode({
      kind: "location",
      code: input.code,
      auto: input.autoCode === true,
      suggest: (prefix) => suggestCode(params, { kind: "location", warehouseId: input.warehouseId, prefix }),
      create,
    });
    return { locationId: r.locationId, depth: r.depth };
  })(raw);
}

export async function archiveLocationAction(raw: unknown) {
  return guardedAction({ schema: archiveLocationSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, "locations.archive");
    const r = await archiveLocation(params, { locationId: input.locationId, requestId: ctx.requestId });
    return { archived: r.archived };
  })(raw);
}

// T-1055: depo listesinin sonraki sayfası (kaydırınca kendiliğinden); süzgeçler sayfa adresindekilerle aynı, imleç domain'de doğrulanır.
const moreWarehousesSchema = z.object({ slug: z.string().min(1).max(63), q: z.string().max(100), archived: z.boolean(), after: z.string().min(1).max(256) }).strict();

/** T-1055: liste sonuna yaklaşınca sonraki 50 depo (+ raf yeri sayısı). Okuma yetkisi domain okuyucusunda. */
export async function loadMoreWarehousesAction(raw: unknown) {
  return guardedAction({ schema: moreWarehousesSchema }, async (input, ctx) => {
    const principal = ctx.principal;
    if (principal === null) throw new Error("unreachable: principal required");
    const call = { db: getAppDb(), principal, tenantSlug: input.slug };
    const page = await loadWarehousesPage(call, { q: input.q, archived: input.archived, after: input.after });
    // T-1201: ilk sayfayla aynı — sayfadaki Paraşüt'e bağlı depolar tek toplu okumayla (bölüm "Paraşüt'ten al" değilse boş).
    const linkedIds = page.rows.length === 0 ? [] : await getSourceLinkedIds(call, "WAREHOUSE", page.rows.map((w) => w.id));
    return { rows: page.rows, nextAfter: page.nextAfter, linkedIds };
  })(raw);
}

/** "Daha fazla" (keyset, OFFSET yok): okuma `stock.view`; domain izin ve kapsamı denetler. */
export async function loadMoreLocationsAction(raw: unknown) {
  return guardedAction({ schema: moreLocationsSchema }, async (input, ctx) => {
    const principal = ctx.principal;
    if (principal === null) throw new Error("unreachable: principal required");
    const page = await getLocationTree({ db: getAppDb(), principal, tenantSlug: input.slug }, { warehouseId: input.warehouseId, includeArchived: true, after: input.after, limit: 200 });
    return { items: page.items, next: page.next };
  })(raw);
}

/** Sıradaki depo/lokasyon kodu (T-250): sunucuda hesaplanır; yazımda benzersizlik yine denetlenir. */
export async function suggestCodeAction(raw: unknown) {
  return guardedAction({ schema: suggestCodeSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, input.kind === "location" ? "locations.create" : "warehouses.create");
    return suggestCode(params, { kind: input.kind, ...(input.warehouseId === undefined ? {} : { warehouseId: input.warehouseId }) });
  })(raw);
}

/** Toplu raf önizleme (T-250): salt okuma; kod üretimi, sınır ve çakışma denetimi domain'de. */
export async function previewBulkLocationsAction(raw: unknown) {
  return guardedAction({ schema: previewBulkSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, "locations.create");
    return previewBulkLocations(params, {
      warehouseId: input.warehouseId,
      parentId: input.parentId,
      zone: input.zone,
      rackFrom: input.rackFrom,
      rackTo: input.rackTo,
      levelFrom: input.levelFrom,
      levelTo: input.levelTo,
    });
  })(raw);
}

/** Toplu raf oluşturma (T-250): tek transaction + idempotency anahtarı domain'dedir. */
export async function createBulkLocationsAction(raw: unknown) {
  return guardedAction({ schema: createBulkSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, "locations.create");
    return createBulkLocations(params, {
      warehouseId: input.warehouseId,
      parentId: input.parentId,
      zone: input.zone,
      rackFrom: input.rackFrom,
      rackTo: input.rackTo,
      levelFrom: input.levelFrom,
      levelTo: input.levelTo,
      idempotencyKey: input.idempotencyKey,
      requestId: ctx.requestId,
    });
  })(raw);
}

/** Yazdıkça lokasyon arama (T-250): okuma `stock.view`; sınırlı sonuç. */
export async function searchLocationsAction(raw: unknown) {
  return guardedAction({ schema: searchLocationsSchema }, async (input, ctx) => {
    const principal = ctx.principal;
    if (principal === null) throw new Error("unreachable: principal required");
    return searchLocations({ db: getAppDb(), principal, tenantSlug: input.slug }, { warehouseId: input.warehouseId, q: input.q, ...(input.limit === undefined ? {} : { limit: input.limit }) });
  })(raw);
}

/** Boş ekran rehberi ilerlemesi (T-250): okuma `stock.view`. */
export async function getSetupProgressAction(raw: unknown) {
  return guardedAction({ schema: setupProgressSchema }, async (input, ctx) => {
    const principal = ctx.principal;
    if (principal === null) throw new Error("unreachable: principal required");
    return getSetupProgress({ db: getAppDb(), principal, tenantSlug: input.slug });
  })(raw);
}
