"use server";
// Ürün kartı eylemleri (T-216). İnce giriş: yalnızca girdi doğrulama (zod) + T-208 domain komutu. Kod/ad normalleştirmesi, takip modu,
// ölçek, dönüşüm katsayısı kuralları ve yetki (T-1141 kart anahtarları, A-68) sunucuda domain'dedir; burada yeniden yazılmaz. Katsayı ve
// barkod miktarı DİZGİ olarak domain'e iletilir (I-09: `Number`/float'a çevrilmez). Bu dosyada DB bağlantısı açılmaz (`getAppDb`
// yalnızca domain'e verilir). Köken (Origin) ve oturum denetimi ortak `createProductionGuard` içindedir.
import { headers } from "next/headers";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { addBarcode, archiveItem, createItem, createItemWithDefaultUnit, createUnit, createWithSuggestedCode, removeBarcode, removeItemImage, removeUnitConversion, restoreItemImage, searchItems, setItemImageMain, setItemStockPolicy, setUnitConversion, suggestCode, updateItem } from "@wms/domain/catalog";
import { createProductionGuard, limitVerifiedTenant, type ActionContext } from "../../../../lib/action-guard.ts";
import { listItemLots, listItemSerials } from "@wms/domain/stock";
import { loadItemsPage } from "./list-page.ts";
import { extraFilterShape, domainExtraFilters } from "./filters.ts";

const guardedAction = createProductionGuard(() => headers());

const slugSchema = z.string().min(1).max(63);
const idSchema = z.string().uuid();
// Sınırlar yalnızca istemci kötüye kullanımına karşı kaba üst sınırdır; asıl doğrulama/normalleştirme domain'dedir.
const textSchema = z.string().min(1).max(512);
/** Ondalık metin (katsayı/miktar): biçim ve ölçek denetimi domain'de (`assertConversionFactor`/`assertQuantityScale`); burada yalnızca uzunluk. */
const decimalSchema = z.string().min(1).max(64);
// `TrackingMode` / `PickPolicy` ile birebir (domain ayrıca doğrular).
const trackingSchema = z.enum(["NONE", "LOT", "SERIAL", "LOT_AND_SERIAL"]);
const pickSchema = z.enum(["FIFO", "FEFO"]);
// `ItemCardType` ile birebir (T-911; domain ayrıca doğrular).
const cardTypeSchema = z.enum(["HM", "YM", "MM", "TM"]);

const createItemSchema = z
  .object({
    slug: slugSchema,
    code: textSchema,
    name: textSchema,
    /** Yoksa (tenant'ta hiç birim yok) sunucu varsayılan `ADET` birimini hazırlar (T-250). */
    baseUnitId: idSchema.optional(),
    quantityScale: z.number().int().min(0).max(6).optional(),
    trackingMode: trackingSchema.optional(),
    pickPolicy: pickSchema.optional(),
    cardType: cardTypeSchema.optional(),
    /** T-250: kod kullanıcı tarafından değiştirilmedi (önerilen kod) beyanı; sunucu ayrıca kodun önerilen biçimde olduğunu doğrular, çakışmada sıradaki öneriyle yeniden dener. */
    autoCode: z.boolean().optional(),
  })
  .strict();
const suggestItemCodeSchema = z.object({ slug: slugSchema, prefix: z.string().max(16).optional() }).strict();
const searchItemsSchema = z.object({ slug: slugSchema, q: z.string().max(128), limit: z.number().int().min(1).max(10).optional(), ...extraFilterShape, cardType: cardTypeSchema.optional(), status: z.enum(["ACTIVE", "ARCHIVED", "REMOVED"]).optional() }).strict();
// T-1055: listenin sonraki sayfası (kaydırınca kendiliğinden). Süzgeçler sayfa adresindekilerle aynı; imleç domain'de doğrulanır.
const loadMoreItemsSchema = z
  .object({ slug: slugSchema, q: z.string().max(128), status: z.enum(["", "ACTIVE", "ARCHIVED", "REMOVED"]), cardType: z.union([z.literal(""), cardTypeSchema]), after: z.string().min(1).max(512), ...extraFilterShape })
  .strict();
const moreTrackingSchema = z.object({ slug: slugSchema, itemId: idSchema, part: z.enum(["lots", "serials"]), after: z.string().min(1).max(1024) }).strict();
const updateItemSchema = z
  .object({
    slug: slugSchema,
    itemId: idSchema,
    code: textSchema.optional(),
    name: textSchema.optional(),
    pickPolicy: pickSchema.optional(),
    cardType: cardTypeSchema.optional(),
    // T-1129: sabit alanlar yalnız hiç kullanılmamış üründe değişir; karar domain + 0065 tetikleyicisinde (istemciye güvenilmez).
    baseUnitId: idSchema.optional(),
    quantityScale: z.number().int().min(0).max(6).optional(),
    trackingMode: trackingSchema.optional(),
  })
  .strict();
const createUnitSchema = z.object({ slug: slugSchema, code: z.string().min(1).max(64), name: z.string().min(1).max(200) }).strict();
const archiveItemSchema = z.object({ slug: slugSchema, itemId: idSchema }).strict();
const conversionSchema = z.object({ slug: slugSchema, itemId: idSchema, unitId: idSchema, factor: decimalSchema }).strict();
const addBarcodeSchema = z
  .object({ slug: slugSchema, itemId: idSchema, unitId: idSchema.nullable(), barcode: textSchema, quantity: decimalSchema.nullable() })
  .strict();
const removeBarcodeSchema = z.object({ slug: slugSchema, barcodeId: idSchema }).strict();
// T-1160: dönüşüm kaldırma (Geri al = `setConversionAction` aynı katsayıyla), görsel sil / geri al / kapak yap, depo başına min-maks.
const removeConversionSchema = z.object({ slug: slugSchema, itemId: idSchema, unitId: idSchema }).strict();
const imageSchema = z.object({ slug: slugSchema, itemId: idSchema, imageId: idSchema }).strict();
const restoreImageSchema = z.object({ slug: slugSchema, itemId: idSchema, imageId: idSchema, main: z.boolean().optional() }).strict();
const stockPolicySchema = z.object({ slug: slugSchema, itemId: idSchema, warehouseId: idSchema, min: decimalSchema, max: decimalSchema }).strict();

/** Komut izni T-1141 kart anahtarı (domain komutuyla aynı); sayaç doğrulanmış tenant kimliğiyle tüketilir (üye/yetkisiz çağıran sayaç tüketmez). */
async function writeContext(slug: string, ctx: ActionContext, permission: "items.create" | "items.edit" | "items.archive") {
  const principal = ctx.principal;
  if (principal === null) throw new Error("unreachable: principal required");
  await limitVerifiedTenant({ db: getAppDb(), principal, tenantSlug: slug, permission }, ctx);
  return { db: getAppDb(), principal, tenantSlug: slug };
}

export async function createItemAction(raw: unknown) {
  return guardedAction({ schema: createItemSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, "items.create");
    const base = {
      name: input.name,
      ...(input.quantityScale === undefined ? {} : { quantityScale: input.quantityScale }),
      ...(input.trackingMode === undefined ? {} : { trackingMode: input.trackingMode }),
      ...(input.pickPolicy === undefined ? {} : { pickPolicy: input.pickPolicy }),
      ...(input.cardType === undefined ? {} : { cardType: input.cardType }),
    };
    const p = { ...params, requestId: ctx.requestId };
    const baseUnitId = input.baseUnitId;
    // Birim verilmediyse varsayılan birim çözümü ve ürün TEK transaction'dadır (domain); ürün reddedilirse birim de geri alınır (T-259).
    const create = (code: string) => (baseUnitId === undefined ? createItemWithDefaultUnit(p, { ...base, code }) : createItem(p, { ...base, code, baseUnitId }));
    if (input.autoCode !== true) return { itemId: (await create(input.code)).itemId };
    // `autoCode` yalnızca istemci beyanıdır: otomatik yeniden deneme için kodun sunucu önerisi biçiminde olması da gerekir (domain, T-259).
    const r = await createWithSuggestedCode({ kind: "item", code: input.code, auto: true, suggest: (prefix) => suggestCode(params, { kind: "item", prefix }), create });
    return { itemId: r.itemId };
  })(raw);
}

/** Sıradaki ürün kodu (T-250): sunucuda hesaplanır, yazımda benzersizlik yine denetlenir. */
export async function suggestItemCodeAction(raw: unknown) {
  return guardedAction({ schema: suggestItemCodeSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, "items.create");
    return suggestCode(params, { kind: "item", ...(input.prefix === undefined ? {} : { prefix: input.prefix }) });
  })(raw);
}

/** Yazdıkça ürün arama (T-250): kod/ad öneki ya da tam barkod; en çok 10 sonuç; okuma izni `stock.view` domain'de. */
export async function searchItemsAction(raw: unknown) {
  return guardedAction({ schema: searchItemsSchema }, async (input, ctx) => {
    const principal = ctx.principal;
    if (principal === null) throw new Error("unreachable: principal required");
    const page = await searchItems({ db: getAppDb(), principal, tenantSlug: input.slug }, { q: input.q, status: input.status ?? "ACTIVE", limit: input.limit ?? 8, ...(input.cardType === undefined ? {} : { cardType: input.cardType }), ...domainExtraFilters(input) });
    // T-257: eski kodla eşleşen kartlar için "bu kod X olarak değişti" bilgisi (eski kod → güncel kod).
    return { items: page.items.map((i) => ({ id: i.id, code: i.code, name: i.name })), renamedFrom: (page.renamedFrom ?? []).map((r) => ({ itemId: r.itemId, oldCode: r.oldCode, currentCode: r.currentCode })) };
  })(raw);
}

/** T-1055: liste sonuna yaklaşınca sonraki 50 ürün (+ stok rozeti). Okuma: `stock.view` (domain okuyucusu). */
export async function loadMoreItemsAction(raw: unknown) {
  return guardedAction({ schema: loadMoreItemsSchema }, async (input, ctx) => {
    const principal = ctx.principal;
    if (principal === null) throw new Error("unreachable: principal required");
    const page = await loadItemsPage({ db: getAppDb(), principal, tenantSlug: input.slug }, { q: input.q, status: input.status, cardType: input.cardType, after: input.after, category: input.category, tracking: input.tracking, barcode: input.barcode });
    return { rows: page.rows, stock: page.stock, nextCursor: page.nextCursor };
  })(raw);
}

/** T-1116: ürün kartı › Takip — lotların ya da serilerin sonraki sayfası (keyset). Okuma: `stock.view` + depo kapsamı (domain). */
export async function loadMoreItemTrackingAction(raw: unknown) {
  return guardedAction({ schema: moreTrackingSchema }, async (input, ctx) => {
    const principal = ctx.principal;
    if (principal === null) throw new Error("unreachable: principal required");
    const params = { db: getAppDb(), principal, tenantSlug: input.slug };
    if (input.part === "lots") {
      const page = await listItemLots(params, input.itemId, { after: input.after });
      return { lots: page.rows, serials: [], next: page.next };
    }
    const page = await listItemSerials(params, input.itemId, { after: input.after });
    return { lots: [], serials: page.rows, next: page.next };
  })(raw);
}

export async function updateItemAction(raw: unknown) {
  return guardedAction({ schema: updateItemSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, "items.edit");
    const r = await updateItem(
      { ...params, requestId: ctx.requestId },
      {
        itemId: input.itemId,
        ...(input.code === undefined ? {} : { code: input.code }),
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.pickPolicy === undefined ? {} : { pickPolicy: input.pickPolicy }),
        ...(input.cardType === undefined ? {} : { cardType: input.cardType }),
        ...(input.baseUnitId === undefined ? {} : { baseUnitId: input.baseUnitId }),
        ...(input.quantityScale === undefined ? {} : { quantityScale: input.quantityScale }),
        ...(input.trackingMode === undefined ? {} : { trackingMode: input.trackingMode }),
      },
    );
    return { changed: r.changed };
  })(raw);
}

/** Yeni birim (T-911): kod tenant içinde benzersiz (`CODE_TAKEN`); yeni ürün formundan satır içi eklenir. Yetki `items.create` domain'de (T-1141). */
export async function createUnitAction(raw: unknown) {
  return guardedAction({ schema: createUnitSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, "items.create");
    const r = await createUnit({ ...params, requestId: ctx.requestId }, { code: input.code, name: input.name });
    return { unitId: r.unitId };
  })(raw);
}

export async function archiveItemAction(raw: unknown) {
  return guardedAction({ schema: archiveItemSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, "items.archive");
    const r = await archiveItem({ ...params, requestId: ctx.requestId }, { itemId: input.itemId });
    return { changed: r.changed };
  })(raw);
}

export async function setConversionAction(raw: unknown) {
  return guardedAction({ schema: conversionSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, "items.edit");
    const r = await setUnitConversion({ ...params, requestId: ctx.requestId }, { itemId: input.itemId, unitId: input.unitId, factor: input.factor });
    return { factor: r.factor };
  })(raw);
}

export async function addBarcodeAction(raw: unknown) {
  return guardedAction({ schema: addBarcodeSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, "items.edit");
    const r = await addBarcode({ ...params, requestId: ctx.requestId }, { itemId: input.itemId, unitId: input.unitId, barcode: input.barcode, quantity: input.quantity });
    return { barcodeId: r.barcodeId };
  })(raw);
}

export async function removeBarcodeAction(raw: unknown) {
  return guardedAction({ schema: removeBarcodeSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, "items.edit");
    const r = await removeBarcode({ ...params, requestId: ctx.requestId }, { barcodeId: input.barcodeId });
    return { barcodeId: r.barcodeId };
  })(raw);
}

/** T-1160: kullanılmayan birim dönüşümünü kaldır; belge / mal kabul / barkod kullanıyorsa domain `IN_USE` ile reddeder. */
export async function removeConversionAction(raw: unknown) {
  return guardedAction({ schema: removeConversionSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, "items.edit");
    const r = await removeUnitConversion({ ...params, requestId: ctx.requestId }, { itemId: input.itemId, unitId: input.unitId });
    return { changed: r.changed, factor: r.factor };
  })(raw);
}

/** T-1160: görseli sil (yumuşak silme; Geri al `restoreItemImageAction`). */
export async function removeItemImageAction(raw: unknown) {
  return guardedAction({ schema: imageSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, "items.edit");
    const r = await removeItemImage({ ...params, requestId: ctx.requestId }, { itemId: input.itemId, imageId: input.imageId });
    return { changed: r.changed, wasMain: r.wasMain };
  })(raw);
}

/** T-1160: silinen görseli geri aç ("Geri al"); `main` kapak yapar. */
export async function restoreItemImageAction(raw: unknown) {
  return guardedAction({ schema: restoreImageSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, "items.edit");
    const r = await restoreItemImage({ ...params, requestId: ctx.requestId }, { itemId: input.itemId, imageId: input.imageId, ...(input.main === undefined ? {} : { main: input.main }) });
    return { changed: r.changed, isMain: r.isMain };
  })(raw);
}

/** T-1160: kapak yap. */
export async function setItemImageMainAction(raw: unknown) {
  return guardedAction({ schema: imageSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, "items.edit");
    const r = await setItemImageMain({ ...params, requestId: ctx.requestId }, { itemId: input.itemId, imageId: input.imageId });
    return { changed: r.changed, previousMainId: r.previousMainId };
  })(raw);
}

/** T-1160: bir depoda min / maks stok. Değerler DİZGİ olarak domain'e gider (I-09); ölçek ve min ≤ maks domain'de. */
export async function setStockPolicyAction(raw: unknown) {
  return guardedAction({ schema: stockPolicySchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, "items.edit");
    const r = await setItemStockPolicy({ ...params, requestId: ctx.requestId }, { itemId: input.itemId, warehouseId: input.warehouseId, min: input.min, max: input.max });
    return { changed: r.changed, min: r.min, max: r.max };
  })(raw);
}
