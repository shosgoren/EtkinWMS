// Ürün görselleri (T-1145, 0072). Yazma `items.edit` (T-1141 kart anahtarı; gruptan verilmişse MFA ister — T-1142 `MFA_GRANTS`), okuma
// `stock.view` (ürün kartıyla aynı). Hepsi `runTenantCommand`/`runTenantQuery` içinde: tenant yalnız doğrulanmış üyelikten gelir (I-01),
// bağlam transaction-local (I-02), RLS + FORCE (I-03); audit aynı transaction'da (I-12).
//
// - Giriş denetimi iki katmanlıdır: web sunucusu yüklemeyi bayt imzasından (JPEG/PNG/WebP; SVG ve diğerleri yok) tanır ve yeniden kodlar
//   (EXIF/konum silinir, uzun kenar ≤ 1280 px, WebP); domain yalnız yeniden kodlanmış WebP'yi kabul eder (imza + boyut sınırı) ve
//   sha256'yı KENDİSİ hesaplar. DB CHECK'leri aynı imza ve sınırları ayrıca zorlar.
// - Ürün başına en çok 5 etkin görsel, en çok bir kapak. Aynı baytlar aynı üründe ikinci kez eklenmez (idempotent: var olan kimlik döner).
// - "Sil" yumuşak silmedir (`removed_at`): Geri al aynı satırı geri açar. Silinmiş görselin baytları 10 dakika sonra, aynı tenant'ın sonraki
//   görsel komutunda boşaltılır (tetikleyici süreyi zorlar); boşaltılmış görsel geri açılamaz (`NOT_FOUND`).
// - Eşzamanlılık: komutlar ürün satırını FOR UPDATE kilitler (sayı sınırı, kapak tekliği, arşiv ile serileşir). Stok tablosuna dokunulmaz.
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { runTenantCommand, runTenantQuery, type AccessTx } from "../identity/access.ts";
import { loadItem, parseUuid, type CatalogCommandParams } from "./units.ts";

export type ImageInputType = "image/jpeg" | "image/png" | "image/webp";

/** Yükleme (ham dosya) üst sınırı. */
export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
/** Saklanan (yeniden kodlanmış) görsel ve küçük resim üst sınırları (0072 CHECK ile aynı). */
export const IMAGE_STORED_MAX_BYTES = 1_048_576;
export const IMAGE_THUMB_MAX_BYTES = 16_384;
/** Saklanan görselin uzun kenarı ve küçük resmin kutusu (px). */
export const IMAGE_MAX_SIDE = 1280;
export const IMAGE_THUMB_SIDE = 160;
/** Ürün başına etkin görsel sınırı (0072 tetikleyicisiyle aynı). */
export const ITEM_IMAGES_MAX = 5;

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0): boolean => b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x);

/** Bayt imzasından görsel türü; kabul edilmeyen (SVG, GIF, HEIC, metin …) `null`. Dosya adı / istemci türü dikkate alınmaz. */
export function sniffImageType(bytes: Uint8Array): ImageInputType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (isWebp(bytes)) return "image/webp";
  return null;
}

/** RIFF....WEBP imzası (12 bayt). */
export function isWebp(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8);
}

/** Yeniden kodlanmış görsel (web sunucusunun ürettiği); domain yeniden doğrular. */
export interface ProcessedItemImage {
  readonly data: Uint8Array;
  readonly thumb: Uint8Array;
  readonly width: number;
  readonly height: number;
}

function assertProcessed(img: ProcessedItemImage): void {
  const side = (n: unknown): boolean => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 4096;
  if (!(img.data instanceof Uint8Array) || !(img.thumb instanceof Uint8Array) || !side(img.width) || !side(img.height)) {
    throw new AppError("VALIDATION_FAILED", { detail: "IMAGE_INVALID" });
  }
  if (img.data.length > IMAGE_STORED_MAX_BYTES || img.thumb.length > IMAGE_THUMB_MAX_BYTES) throw new AppError("VALIDATION_FAILED", { detail: "IMAGE_TOO_LARGE" });
  if (!isWebp(img.data) || !isWebp(img.thumb)) throw new AppError("VALIDATION_FAILED", { detail: "IMAGE_INVALID" });
}

type Row = { id: string; is_main: boolean; removed_at: string | null; has_data: boolean };

async function lockActiveItem(tx: AccessTx, tenantId: string, itemId: string): Promise<void> {
  const item = await loadItem(tx, tenantId, itemId, "update");
  if (item === undefined) throw new AppError("NOT_FOUND");
  if (item.status !== "ACTIVE") throw new AppError("VALIDATION_FAILED");
}

/** 10 dakikadan eski silinmiş görsellerin baytlarını boşaltır (tenant başına bir seferde en çok 50 satır). */
async function purgeRemoved(tx: AccessTx, tenantId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE public.item_images SET data = NULL, thumb = NULL
     WHERE tenant_id = ${tenantId}::uuid AND id IN (
       SELECT id FROM public.item_images
        WHERE tenant_id = ${tenantId}::uuid AND removed_at IS NOT NULL AND data IS NOT NULL AND removed_at < now() - interval '10 minutes'
        ORDER BY removed_at LIMIT 50)`);
}

async function loadImage(tx: AccessTx, tenantId: string, itemId: string, imageId: string): Promise<Row | undefined> {
  const rows = await tx.execute<Row>(sql`
    SELECT id, is_main, removed_at::text AS removed_at, data IS NOT NULL AS has_data FROM public.item_images
     WHERE tenant_id = ${tenantId}::uuid AND item_id = ${itemId}::uuid AND id = ${imageId}::uuid`);
  return rows[0];
}

async function activeCount(tx: AccessTx, tenantId: string, itemId: string): Promise<number> {
  const r = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM public.item_images WHERE tenant_id = ${tenantId}::uuid AND item_id = ${itemId}::uuid AND removed_at IS NULL`);
  return r[0]?.n ?? 0;
}

async function currentMain(tx: AccessTx, tenantId: string, itemId: string): Promise<string | null> {
  const r = await tx.execute<{ id: string }>(sql`
    SELECT id FROM public.item_images WHERE tenant_id = ${tenantId}::uuid AND item_id = ${itemId}::uuid AND is_main`);
  return r[0]?.id ?? null;
}

export interface AddItemImageResult {
  readonly imageId: string;
  /** Değiştirilen (silinen) görsel; `replaces` verilmediyse `null`. */
  readonly replacedId: string | null;
  readonly isMain: boolean;
  /** Aynı baytlar zaten etkinse `false` (yeni satır yok). */
  readonly changed: boolean;
}

/**
 * Görsel ekle ya da (`replaces`) değiştir. Değiştirmede eski görsel aynı transaction'da silinir (Geri al ile döner) ve kapaksa yenisi
 * kapak olur. İlk görsel kendiliğinden kapaktır.
 */
export async function addItemImage(
  params: CatalogCommandParams,
  input: { readonly itemId: string; readonly image: ProcessedItemImage; readonly replaces?: string | null },
): Promise<AddItemImageResult> {
  const itemId = parseUuid(input.itemId);
  const replaces = input.replaces === undefined || input.replaces === null ? null : parseUuid(input.replaces);
  assertProcessed(input.image);
  const { data, thumb, width, height } = input.image;
  const sha256 = createHash("sha256").update(data).digest("hex");
  const { requestId, ...access } = params;
  return runTenantCommand({ ...access, permission: "items.edit" }, async (tx, actor) => {
    const t = actor.tenantId;
    await lockActiveItem(tx, t, itemId);
    await purgeRemoved(tx, t);
    const same = await tx.execute<{ id: string; is_main: boolean }>(sql`
      SELECT id, is_main FROM public.item_images
       WHERE tenant_id = ${t}::uuid AND item_id = ${itemId}::uuid AND sha256 = ${sha256} AND removed_at IS NULL`);
    if (same[0] !== undefined) return { imageId: same[0].id, replacedId: null, isMain: same[0].is_main, changed: false };
    if (replaces !== null) {
      const old = await loadImage(tx, t, itemId, replaces);
      if (old === undefined || old.removed_at !== null) throw new AppError("NOT_FOUND");
      await tx.execute(sql`UPDATE public.item_images SET is_main = false, removed_at = now() WHERE tenant_id = ${t}::uuid AND id = ${replaces}::uuid`);
    }
    if ((await activeCount(tx, t, itemId)) >= ITEM_IMAGES_MAX) throw new AppError("VALIDATION_FAILED", { detail: "IMAGE_LIMIT" });
    // Değiştirilen görsel kapaksa kapak boşaldı → yeni görsel kapak olur; ilk görsel de kapaktır.
    const isMain = (await currentMain(tx, t, itemId)) === null;
    const ins = await tx.execute<{ id: string }>(sql`
      INSERT INTO public.item_images (tenant_id, id, item_id, data, thumb, width, height, sha256, is_main)
      VALUES (${t}::uuid, gen_random_uuid(), ${itemId}::uuid, ${Buffer.from(data)}::bytea, ${Buffer.from(thumb)}::bytea, ${width}, ${height}, ${sha256}, ${isMain})
      RETURNING id`);
    const imageId = ins[0]?.id;
    if (imageId === undefined) throw new AppError("INTERNAL");
    await appendAudit(tx, {
      action: replaces === null ? "item_image.added" : "item_image.replaced",
      actorUserId: actor.userId,
      entityType: "item",
      entityId: itemId,
      requestId: requestId ?? null,
      changeSummary: { image_id: imageId, ...(replaces === null ? {} : { replaced_id: replaces }), sha256, width, height, size: data.length, is_main: isMain },
    });
    return { imageId, replacedId: replaces, isMain, changed: true };
  });
}

/** Görseli sil (Geri al: `restoreItemImage`). Kapak silinirse kalan en eski görsel kapak olur. Zaten silinmişse `changed: false`. */
export async function removeItemImage(
  params: CatalogCommandParams,
  input: { readonly itemId: string; readonly imageId: string },
): Promise<{ readonly changed: boolean; readonly wasMain: boolean; readonly newMainId: string | null }> {
  const itemId = parseUuid(input.itemId);
  const imageId = parseUuid(input.imageId);
  const { requestId, ...access } = params;
  return runTenantCommand({ ...access, permission: "items.edit" }, async (tx, actor) => {
    const t = actor.tenantId;
    await lockActiveItem(tx, t, itemId);
    await purgeRemoved(tx, t);
    const row = await loadImage(tx, t, itemId, imageId);
    if (row === undefined) throw new AppError("NOT_FOUND");
    if (row.removed_at !== null) return { changed: false, wasMain: false, newMainId: null };
    await tx.execute(sql`UPDATE public.item_images SET is_main = false, removed_at = now() WHERE tenant_id = ${t}::uuid AND id = ${imageId}::uuid`);
    let newMainId: string | null = null;
    if (row.is_main) {
      const next = await tx.execute<{ id: string }>(sql`
        UPDATE public.item_images SET is_main = true
         WHERE tenant_id = ${t}::uuid AND id = (
           SELECT id FROM public.item_images WHERE tenant_id = ${t}::uuid AND item_id = ${itemId}::uuid AND removed_at IS NULL ORDER BY created_at, id LIMIT 1)
        RETURNING id`);
      newMainId = next[0]?.id ?? null;
    }
    await appendAudit(tx, {
      action: "item_image.removed",
      actorUserId: actor.userId,
      entityType: "item",
      entityId: itemId,
      requestId: requestId ?? null,
      changeSummary: { image_id: imageId, was_main: row.is_main, new_main_id: newMainId },
    });
    return { changed: true, wasMain: row.is_main, newMainId };
  });
}

/** Silinmiş görseli geri aç ("Geri al"). `main: true` kapak yapar; aksi kapak yoksa kapak olur. Baytları boşaltılmışsa `NOT_FOUND`. */
export async function restoreItemImage(
  params: CatalogCommandParams,
  input: { readonly itemId: string; readonly imageId: string; readonly main?: boolean },
): Promise<{ readonly changed: boolean; readonly isMain: boolean }> {
  const itemId = parseUuid(input.itemId);
  const imageId = parseUuid(input.imageId);
  const wantMain = input.main === true;
  const { requestId, ...access } = params;
  return runTenantCommand({ ...access, permission: "items.edit" }, async (tx, actor) => {
    const t = actor.tenantId;
    await lockActiveItem(tx, t, itemId);
    const row = await loadImage(tx, t, itemId, imageId);
    if (row === undefined || !row.has_data) throw new AppError("NOT_FOUND");
    if (row.removed_at === null) return { changed: false, isMain: row.is_main };
    if ((await activeCount(tx, t, itemId)) >= ITEM_IMAGES_MAX) throw new AppError("VALIDATION_FAILED", { detail: "IMAGE_LIMIT" });
    // Aynı baytlar arada yeniden eklendiyse (etkin kopya var) ikinci kez açılmaz.
    const dup = await tx.execute<{ id: string }>(sql`
      SELECT a.id FROM public.item_images a JOIN public.item_images r ON r.tenant_id = a.tenant_id AND r.id = ${imageId}::uuid
       WHERE a.tenant_id = ${t}::uuid AND a.item_id = ${itemId}::uuid AND a.removed_at IS NULL AND a.sha256 = r.sha256`);
    if (dup[0] !== undefined) return { changed: false, isMain: false };
    const main = await currentMain(tx, t, itemId);
    const isMain = wantMain || main === null;
    if (isMain && main !== null) await tx.execute(sql`UPDATE public.item_images SET is_main = false WHERE tenant_id = ${t}::uuid AND id = ${main}::uuid`);
    await tx.execute(sql`UPDATE public.item_images SET removed_at = NULL, is_main = ${isMain} WHERE tenant_id = ${t}::uuid AND id = ${imageId}::uuid`);
    await appendAudit(tx, {
      action: "item_image.restored",
      actorUserId: actor.userId,
      entityType: "item",
      entityId: itemId,
      requestId: requestId ?? null,
      changeSummary: { image_id: imageId, is_main: isMain },
    });
    return { changed: true, isMain };
  });
}

/** Kapak yap. Zaten kapaksa `changed: false`; silinmiş görsel `NOT_FOUND`. */
export async function setItemImageMain(
  params: CatalogCommandParams,
  input: { readonly itemId: string; readonly imageId: string },
): Promise<{ readonly changed: boolean; readonly previousMainId: string | null }> {
  const itemId = parseUuid(input.itemId);
  const imageId = parseUuid(input.imageId);
  const { requestId, ...access } = params;
  return runTenantCommand({ ...access, permission: "items.edit" }, async (tx, actor) => {
    const t = actor.tenantId;
    await lockActiveItem(tx, t, itemId);
    const row = await loadImage(tx, t, itemId, imageId);
    if (row === undefined || row.removed_at !== null) throw new AppError("NOT_FOUND");
    if (row.is_main) return { changed: false, previousMainId: imageId };
    const prev = await currentMain(tx, t, itemId);
    if (prev !== null) await tx.execute(sql`UPDATE public.item_images SET is_main = false WHERE tenant_id = ${t}::uuid AND id = ${prev}::uuid`);
    await tx.execute(sql`UPDATE public.item_images SET is_main = true WHERE tenant_id = ${t}::uuid AND id = ${imageId}::uuid`);
    await appendAudit(tx, {
      action: "item_image.main_set",
      actorUserId: actor.userId,
      entityType: "item",
      entityId: itemId,
      requestId: requestId ?? null,
      changeSummary: { image_id: imageId, previous_main_id: prev },
    });
    return { changed: true, previousMainId: prev };
  });
}

export interface ItemImageView {
  readonly id: string;
  readonly isMain: boolean;
  readonly width: number;
  readonly height: number;
  /** Önbellek sürümü (sha256'nın ilk 16 hanesi): adres değişmezse tarayıcı önbelleği geçerli kalır. */
  readonly version: string;
  /** Küçük resim (`data:image/webp;base64,…`). */
  readonly thumb: string;
}

type ReadParams = Omit<CatalogCommandParams, "requestId">;

const dataUrl = (b: Uint8Array): string => `data:image/webp;base64,${Buffer.from(b).toString("base64")}`;

/** Tek ürünün etkin görselleri (kapak önce, sonra eklenme sırası). Başka tenant / olmayan ürün `NOT_FOUND`. */
export async function listItemImages(params: ReadParams, itemIdRaw: string): Promise<readonly ItemImageView[]> {
  const itemId = parseUuid(itemIdRaw);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, actor) => {
    if ((await loadItem(tx, actor.tenantId, itemId)) === undefined) throw new AppError("NOT_FOUND");
    const rows = await tx.execute<{ id: string; is_main: boolean; width: number; height: number; sha256: string; thumb: Uint8Array }>(sql`
      SELECT id, is_main, width, height, sha256, thumb FROM public.item_images
       WHERE tenant_id = ${actor.tenantId}::uuid AND item_id = ${itemId}::uuid AND removed_at IS NULL
       ORDER BY is_main DESC, created_at, id
       LIMIT ${ITEM_IMAGES_MAX}`);
    return rows.map((r) => ({ id: r.id, isMain: r.is_main, width: r.width, height: r.height, version: r.sha256.slice(0, 16), thumb: dataUrl(r.thumb) }));
  });
}

/** Görsel baytları (yalnız etkin görsel; ürün + görsel aynı tenant'ta olmalı). `variant: "thumb"` küçük resim. */
export async function getItemImage(
  params: ReadParams,
  input: { readonly itemId: string; readonly imageId: string; readonly variant: "full" | "thumb" },
): Promise<{ readonly bytes: Uint8Array; readonly sha256: string }> {
  const itemId = parseUuid(input.itemId);
  const imageId = parseUuid(input.imageId);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, actor) => {
    const rows =
      input.variant === "thumb"
        ? await tx.execute<{ b: Uint8Array | null; sha256: string }>(sql`
            SELECT thumb AS b, sha256 FROM public.item_images
             WHERE tenant_id = ${actor.tenantId}::uuid AND item_id = ${itemId}::uuid AND id = ${imageId}::uuid AND removed_at IS NULL`)
        : await tx.execute<{ b: Uint8Array | null; sha256: string }>(sql`
            SELECT data AS b, sha256 FROM public.item_images
             WHERE tenant_id = ${actor.tenantId}::uuid AND item_id = ${itemId}::uuid AND id = ${imageId}::uuid AND removed_at IS NULL`);
    const r = rows[0];
    if (r === undefined || r.b === null) throw new AppError("NOT_FOUND");
    return { bytes: r.b, sha256: r.sha256 };
  });
}

export interface ItemMainThumb {
  readonly itemId: string;
  /** Etkin görsel sayısı (listede nokta göstergesi). */
  readonly count: number;
  /** Kapak küçük resmi (`data:` adresi). */
  readonly thumb: string;
}

/** Liste için ürün başına kapak küçük resmi + görsel sayısı (en çok 100 ürün; görselsiz ürün dönmez). */
export async function listItemMainThumbs(params: ReadParams, itemIds: readonly string[]): Promise<readonly ItemMainThumb[]> {
  if (itemIds.length > 100) throw new AppError("VALIDATION_FAILED");
  const ids = itemIds.map(parseUuid);
  if (ids.length === 0) return [];
  const list = `{${ids.join(",")}}`;
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, actor) => {
    const rows = await tx.execute<{ item_id: string; n: number; thumb: Uint8Array }>(sql`
      SELECT m.item_id, c.n, m.thumb
        FROM public.item_images m
        JOIN (SELECT item_id, count(*)::int AS n FROM public.item_images
               WHERE tenant_id = ${actor.tenantId}::uuid AND item_id = ANY(${list}::uuid[]) AND removed_at IS NULL GROUP BY item_id) c ON c.item_id = m.item_id
       WHERE m.tenant_id = ${actor.tenantId}::uuid AND m.item_id = ANY(${list}::uuid[]) AND m.is_main`);
    return rows.map((r) => ({ itemId: r.item_id, count: r.n, thumb: dataUrl(r.thumb) }));
  });
}
