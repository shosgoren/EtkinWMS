// Ürün kartı komutları (T-208; A-68, A-87, A-16, A-33). Yazma: ekle `items.create`, değiştir `items.edit`, arşivle `items.archive` (T-1141), okuma `stock.view`.
//
// - Stok DEĞİŞTİRMEZ (G-01); yalnızca katalog satırı yazar ve stok tablolarını OKUR. Bu yüzden `acquireStockLocks`
//   kullanılmaz; arşiv/stok-denetimi için yalnızca ürün KATALOG satırı `FOR UPDATE` ile kilitlenir (stok kilidi değil).
// - T-1129 (B-188; A-87/A-107 güncellemesi, kullanıcı kararı 27 Ekim): `base_unit_id`, `tracking_mode`, `quantity_scale` yalnız HİÇ
//   KULLANILMAMIŞ üründe değişir; ilk kullanımla kilitlenir. "Kullanılmış" tek tanımdır: 0065 `item_fixed_usage` (stok boyutu,
//   belge/kabul/iade/sipariş satırı, lot/seri, birim dönüşümü, birimli ya da miktarlı barkod, görev/sayım, reçete, stok politikası,
//   entegrasyon işareti). Bağlı sistemden gelen (external_refs ITEM) üründe temel birim ayrıca kilitli. Kullanılmışsa `IN_USE`.
//   Karar ürün satırı `FOR UPDATE` kilitliyken DB'de verilir; 0065 tetikleyicisi aynı tanımla doğrudan SQL'i de reddeder.
// - `archiveItem`: pozitif bakiye ya da açık (ACTIVE) rezervasyon varsa `IN_USE`. Kullanılmış kart silinmez; DELETE yoktur (05 §Geri alma).
import { sql } from "drizzle-orm";
import type { ItemCardType, PickPolicy, TrackingMode } from "@wms/db";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { runTenantCommand, runTenantQuery, type AccessTx } from "../identity/access.ts";
import { loadItem, parseCode, parseName, parseUuid, type CatalogCommandParams, type ItemHeader } from "./units.ts";

const TRACKING: readonly TrackingMode[] = ["NONE", "LOT", "SERIAL", "LOT_AND_SERIAL"];
const PICK: readonly PickPolicy[] = ["FIFO", "FEFO"];
/**
 * Kart türleri (T-911; 0031 `items.card_type`): Hammadde, Yarı Mamul, Mamul, Ticari Mal — Logo ERP'deki standart malzeme türleri.
 * Sıra ekrandaki sıradır. Varsayılan `TM` (DB varsayılanıyla aynı). Kod öneki bu koddur (`HM-000001`, bkz. code-suggest.ts).
 */
export const ITEM_CARD_TYPES: readonly ItemCardType[] = ["HM", "YM", "MM", "TM"];
export const DEFAULT_CARD_TYPE: ItemCardType = "TM";

export function parseCardType(raw: unknown): ItemCardType {
  if (typeof raw !== "string" || !(ITEM_CARD_TYPES as readonly string[]).includes(raw)) throw new AppError("VALIDATION_FAILED");
  return raw as ItemCardType;
}

function parseTracking(raw: unknown): TrackingMode {
  if (typeof raw !== "string" || !(TRACKING as readonly string[]).includes(raw)) throw new AppError("VALIDATION_FAILED");
  return raw as TrackingMode;
}
function parsePick(raw: unknown): PickPolicy {
  if (typeof raw !== "string" || !(PICK as readonly string[]).includes(raw)) throw new AppError("VALIDATION_FAILED");
  return raw as PickPolicy;
}
function parseScale(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 6) throw new AppError("VALIDATION_FAILED");
  return raw;
}

export interface CreateItemInput {
  readonly code: string;
  readonly name: string;
  readonly baseUnitId: string;
  /** Varsayılan `NONE` (A-16). */
  readonly trackingMode?: TrackingMode;
  /** Varsayılan 0 (A-33). */
  readonly quantityScale?: number;
  /** Varsayılan `FIFO`. */
  readonly pickPolicy?: PickPolicy;
  /** Kart türü (T-911); varsayılan `TM`. */
  readonly cardType?: ItemCardType;
}

export interface UpdateItemInput {
  readonly itemId: string;
  /** Yeni ürün kodu (T-251): tenant içi benzersiz; değişimde `code_history` + `item.code_changed` aynı transaction'da yazılır. */
  readonly code?: string;
  readonly name?: string;
  readonly pickPolicy?: PickPolicy;
  /** Kart türü değiştirilebilir (T-911): sınıflandırmadır, stok/defter etkisi yoktur; değişim `item.updated` audit'ine yazılır. */
  readonly cardType?: ItemCardType;
  // Sabit alanlar (A-87, T-1129): yalnız kullanılmamış üründe değişir (bkz. dosya başlığı).
  readonly trackingMode?: TrackingMode;
  readonly baseUnitId?: string;
  readonly quantityScale?: number;
}

export interface ItemRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly baseUnitId: string;
  readonly trackingMode: TrackingMode;
  readonly quantityScale: number;
  readonly pickPolicy: PickPolicy;
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly cardType: ItemCardType;
  readonly sourceDisposition?: "NONE"|"PENDING"|"ARCHIVED"|"REMOVED";
}

function toRow(r: ItemHeader): ItemRow {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    baseUnitId: r.base_unit_id,
    trackingMode: r.tracking_mode as TrackingMode,
    quantityScale: r.quantity_scale,
    pickPolicy: r.pick_policy as PickPolicy,
    status: r.status,
    cardType: r.card_type as ItemCardType,
  };
}

export async function createItem(params: CatalogCommandParams, input: CreateItemInput): Promise<{ readonly itemId: string }> {
  const code = parseCode(input.code);
  const name = parseName(input.name);
  const baseUnitId = parseUuid(input.baseUnitId);
  const trackingMode = input.trackingMode === undefined ? "NONE" : parseTracking(input.trackingMode);
  const quantityScale = input.quantityScale === undefined ? 0 : parseScale(input.quantityScale);
  const pickPolicy = input.pickPolicy === undefined ? "FIFO" : parsePick(input.pickPolicy);
  const cardType = input.cardType === undefined ? DEFAULT_CARD_TYPE : parseCardType(input.cardType);
  const { requestId, writePermission, ...access } = params;
  return runTenantCommand({ ...access, permission: writePermission ?? "items.create" }, async (tx, actor) => {
    const unit = await tx.execute<{ status: string }>(
      sql`SELECT status FROM public.units WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${baseUnitId}::uuid`,
    );
    if (unit[0] === undefined) throw new AppError("NOT_FOUND");
    if (unit[0].status !== "ACTIVE") throw new AppError("VALIDATION_FAILED");
    const rows = await tx.execute<{ id: string }>(
      sql`INSERT INTO public.items (tenant_id, id, code, name, base_unit_id, tracking_mode, quantity_scale, pick_policy, card_type)
          VALUES (${actor.tenantId}::uuid, gen_random_uuid(), ${code}, ${name}, ${baseUnitId}::uuid, ${trackingMode},
                  ${quantityScale}::smallint, ${pickPolicy}, ${cardType})
          ON CONFLICT ON CONSTRAINT items_tenant_code_key DO NOTHING
          RETURNING id`,
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new AppError("VALIDATION_FAILED", { detail: "CODE_TAKEN" });
    await appendAudit(tx, {
      action: "item.created",
      actorUserId: actor.userId,
      entityType: "item",
      entityId: id,
      requestId: requestId ?? null,
      changeSummary: { code, name, base_unit_id: baseUnitId, tracking_mode: trackingMode, quantity_scale: quantityScale, pick_policy: pickPolicy, card_type: cardType },
    });
    return { itemId: id };
  });
}

/** T-1129: ürünün sabit alanlarını kilitleyen ilk kullanım türü (0065 `item_fixed_usage` kodları); `null` = hiç kullanılmamış. */
export const ITEM_FIXED_USAGES = ["STOCK", "DOCUMENT", "ORDER", "TRACKING", "UNIT", "TASK", "RECIPE", "POLICY"] as const;
export type ItemFixedUsage = (typeof ITEM_FIXED_USAGES)[number];
export interface ItemFixedState {
  readonly usage: ItemFixedUsage | null;
  /** Bağlı sistemden (ör. Paraşüt) gelen ürün: temel birim eşitlemede karşılaştırılır, değiştirilemez. */
  readonly sourceLinked: boolean;
}

async function readFixedState(tx: AccessTx, tenantId: string, itemId: string): Promise<ItemFixedState> {
  const r = await tx.execute<{ usage: string | null; linked: boolean }>(
    sql`SELECT public.item_fixed_usage(${tenantId}::uuid, ${itemId}::uuid) AS usage,
               EXISTS (SELECT 1 FROM public.external_refs r WHERE r.tenant_id = ${tenantId}::uuid AND r.entity_type = 'ITEM' AND r.entity_id = ${itemId}::uuid) AS linked`,
  );
  const usage = r[0]?.usage ?? null;
  // Bilinmeyen kod (fonksiyon genişlerse) kullanılmış sayılır: kapalı başarısız.
  return { usage: usage === null ? null : ((ITEM_FIXED_USAGES as readonly string[]).includes(usage) ? (usage as ItemFixedUsage) : "STOCK"), sourceLinked: r[0]?.linked === true };
}

/** 0065 tetikleyicisinin reddi (23514, `ITEM_FIXED_*`): domain denetimini atlatan yarış/yol → `IN_USE`. */
function isFixedGuard(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 6 && cur !== undefined && cur !== null; i++) {
    const o = cur as { code?: unknown; message?: unknown };
    if (o.code === "23514" && typeof o.message === "string" && (o.message.startsWith("ITEM_FIXED_") || o.message.startsWith("TRACKING_VIOLATION"))) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/** T-1129: ürün kartı düzenleme ekranı için sabit alan durumu (yalnız gösterim; karar yine `updateItem` + tetikleyicide). */
export async function getItemFixedState(params: Omit<CatalogCommandParams, "requestId">, input: { readonly itemId: string }): Promise<ItemFixedState> {
  const itemId = parseUuid(input.itemId);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, actor) => {
    if ((await loadItem(tx, actor.tenantId, itemId)) === undefined) throw new AppError("NOT_FOUND");
    return readFixedState(tx, actor.tenantId, itemId);
  });
}

function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 6 && cur !== undefined && cur !== null; i++) {
    if ((cur as { code?: unknown }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

export async function updateItem(params: CatalogCommandParams, input: UpdateItemInput): Promise<{ readonly itemId: string; readonly changed: boolean }> {
  const itemId = parseUuid(input.itemId);
  const code = input.code === undefined ? undefined : parseCode(input.code);
  const name = input.name === undefined ? undefined : parseName(input.name);
  const pickPolicy = input.pickPolicy === undefined ? undefined : parsePick(input.pickPolicy);
  const trackingMode = input.trackingMode === undefined ? undefined : parseTracking(input.trackingMode);
  const baseUnitId = input.baseUnitId === undefined ? undefined : parseUuid(input.baseUnitId);
  const quantityScale = input.quantityScale === undefined ? undefined : parseScale(input.quantityScale);
  const cardType = input.cardType === undefined ? undefined : parseCardType(input.cardType);
  // T-981b: Excel "Güncelle" kipi (`onboarding/import-apply`) ad güncellemesini `data.import` ile yapar (createItem ile aynı T-421 kuralı).
  const { requestId, writePermission, ...access } = params;
  return runTenantCommand({ ...access, permission: writePermission ?? "items.edit" }, async (tx, actor) => {
    const cur = await loadItem(tx, actor.tenantId, itemId, "update");
    if (cur === undefined) throw new AppError("NOT_FOUND");
    const newTracking = trackingMode ?? (cur.tracking_mode as TrackingMode);
    const newBase = baseUnitId ?? cur.base_unit_id;
    const newScale = quantityScale ?? cur.quantity_scale;
    const baseChanged = newBase !== cur.base_unit_id;
    const fixedChanged = baseChanged || newTracking !== cur.tracking_mode || newScale !== cur.quantity_scale;
    if (fixedChanged) {
      // T-1129: karar ürün satırı FOR UPDATE kilitliyken; ürüne satır ekleyen açık işlemler (FK KEY SHARE) bu kilidi bekletmişti.
      const state = await readFixedState(tx, actor.tenantId, itemId);
      if (state.usage !== null || (baseChanged && state.sourceLinked)) throw new AppError("VALIDATION_FAILED", { detail: "IN_USE" });
    }
    if (cur.status !== "ACTIVE") throw new AppError("VALIDATION_FAILED");
    if (baseChanged) {
      const unit = await tx.execute<{ status: string }>(
        sql`SELECT status FROM public.units WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${newBase}::uuid FOR SHARE`,
      );
      if (unit[0] === undefined) throw new AppError("NOT_FOUND");
      if (unit[0].status !== "ACTIVE") throw new AppError("VALIDATION_FAILED");
    }
    const newName = name ?? cur.name;
    const newPick = pickPolicy ?? (cur.pick_policy as PickPolicy);
    const newCode = code ?? cur.code;
    const newCard = cardType ?? (cur.card_type as ItemCardType);
    const codeChanged = newCode !== cur.code;
    const infoChanged = newName !== cur.name || newPick !== cur.pick_policy || newCard !== cur.card_type;
    if (!infoChanged && !codeChanged && !fixedChanged) return { itemId, changed: false };
    try {
      if (infoChanged || codeChanged) {
        await tx.execute(
          sql`UPDATE public.items SET name = ${newName}, pick_policy = ${newPick}, code = ${newCode}, card_type = ${newCard}
               WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${itemId}::uuid`,
        );
      }
      if (fixedChanged) {
        await tx.execute(
          sql`UPDATE public.items SET base_unit_id = ${newBase}::uuid, tracking_mode = ${newTracking}, quantity_scale = ${newScale}::smallint
               WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${itemId}::uuid`,
        );
      }
    } catch (e) {
      // Eşzamanlı aynı koda iki değişim: kaybeden `items_tenant_code_key` 23505 alır (tx zaten geri alınır).
      if (codeChanged && isUniqueViolation(e)) throw new AppError("VALIDATION_FAILED", { detail: "CODE_TAKEN" });
      if (fixedChanged && isFixedGuard(e)) throw new AppError("VALIDATION_FAILED", { detail: "IN_USE" });
      throw e;
    }
    if (codeChanged) {
      await tx.execute(
        sql`INSERT INTO public.code_history (tenant_id, id, entity_type, entity_id, old_code, new_code, changed_by)
            VALUES (${actor.tenantId}::uuid, gen_random_uuid(), 'item', ${itemId}::uuid, ${cur.code}, ${newCode}, ${actor.userId}::uuid)`,
      );
      await appendAudit(tx, {
        action: "item.code_changed",
        actorUserId: actor.userId,
        entityType: "item",
        entityId: itemId,
        requestId: requestId ?? null,
        changeSummary: { from_code: cur.code, to_code: newCode },
      });
    }
    if (!infoChanged && !fixedChanged) return { itemId, changed: true };
    await appendAudit(tx, {
      action: "item.updated",
      actorUserId: actor.userId,
      entityType: "item",
      entityId: itemId,
      requestId: requestId ?? null,
      changeSummary: {
        from_name: cur.name, to_name: newName, from_pick_policy: cur.pick_policy, to_pick_policy: newPick, from_card_type: cur.card_type, to_card_type: newCard,
        // T-1129 (I-12): sabit alan değişimi eski → yeni.
        ...(fixedChanged
          ? { from_base_unit_id: cur.base_unit_id, to_base_unit_id: newBase, from_tracking_mode: cur.tracking_mode, to_tracking_mode: newTracking, from_quantity_scale: cur.quantity_scale, to_quantity_scale: newScale }
          : {}),
      },
    });
    return { itemId, changed: true };
  });
}

export async function archiveItem(params: CatalogCommandParams, input: { readonly itemId: string }): Promise<{ readonly itemId: string; readonly changed: boolean }> {
  const itemId = parseUuid(input.itemId);
  const { requestId, ...access } = params;
  return runTenantCommand({ ...access, permission: "items.archive" }, async (tx, actor) => {
    const cur = await loadItem(tx, actor.tenantId, itemId, "update");
    if (cur === undefined) throw new AppError("NOT_FOUND");
    if (cur.status === "ARCHIVED") {
      const rows=await tx.execute(sql`UPDATE public.items SET source_managed_archive=false WHERE tenant_id=${actor.tenantId}::uuid AND id=${itemId}::uuid AND source_managed_archive RETURNING id`);
      if(rows.length)await appendAudit(tx,{action:"item.archived",actorUserId:actor.userId,entityType:"item",entityId:itemId,requestId:requestId??null,changeSummary:{code:cur.code,ownership:"local"}});
      return {itemId,changed:rows.length>0};
    }
    const positive = await tx.execute<{ x: number }>(
      sql`SELECT 1 AS x FROM public.stock_balances b
            JOIN public.stock_dimensions d ON d.tenant_id = b.tenant_id AND d.id = b.stock_dimension_id
           WHERE d.tenant_id = ${actor.tenantId}::uuid AND d.item_id = ${itemId}::uuid AND (b.quantity > 0 OR b.reserved_quantity > 0)
           LIMIT 1`,
    );
    if (positive[0] !== undefined) throw new AppError("VALIDATION_FAILED", { detail: "IN_USE" });
    const open = await tx.execute<{ x: number }>(
      sql`SELECT 1 AS x FROM public.reservations
           WHERE tenant_id = ${actor.tenantId}::uuid AND item_id = ${itemId}::uuid AND status = 'ACTIVE' LIMIT 1`,
    );
    if (open[0] !== undefined) throw new AppError("VALIDATION_FAILED", { detail: "IN_USE" });
    await tx.execute(
      sql`UPDATE public.items SET status = 'ARCHIVED', archived_at = now(), source_managed_archive=false, source_disposition=CASE WHEN source_state='ACTIVE' THEN 'NONE' ELSE 'ARCHIVED' END
           WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${itemId}::uuid`,
    );
    await appendAudit(tx, {
      action: "item.archived",
      actorUserId: actor.userId,
      entityType: "item",
      entityId: itemId,
      requestId: requestId ?? null,
      changeSummary: { code: cur.code },
    });
    return { itemId, changed: true };
  });
}

export async function getItem(params: Omit<CatalogCommandParams, "requestId">, input: { readonly itemId: string }): Promise<ItemRow> {
  const itemId = parseUuid(input.itemId);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, actor) => {
    const r = await loadItem(tx, actor.tenantId, itemId);
    if (r === undefined) throw new AppError("NOT_FOUND");
    return toRow(r);
  });
}

export async function listItems(params: Omit<CatalogCommandParams, "requestId">): Promise<readonly ItemRow[]> {
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, actor) => {
    const rows = await tx.execute<ItemHeader>(
      sql`SELECT id, code, name, base_unit_id, tracking_mode, quantity_scale, pick_policy, status, card_type FROM public.items
           WHERE tenant_id = ${actor.tenantId}::uuid ORDER BY code`,
    );
    return rows.map(toRow);
  });
}
