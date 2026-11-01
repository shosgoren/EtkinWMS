// Ürün min/maks stok (T-1145; tablo `item_stock_policies` 0017, A-131: depo × ürün). Yazma `items.edit` (ürün kartı), okuma `stock.view`;
// ikisi de depo kapsamına uyar (A-46/A-77: kapsam dışı depo görünmez ve yazılamaz). Şema değişikliği yok: wms_app'in sütun düzeyi
// INSERT/UPDATE yetkisi 0017'den; DELETE yoktur — "minimum yok" = 0 / 0 (okumalar `min_quantity > 0` süzer).
//
// - Miktarlar decimal dizgi (I-09): `assertQuantityScale` (≥ 0, ürünün ondalık hassasiyeti, ≤ 14 tam hane); min ≤ maks
//   `compareDecimal` ile (kayan nokta yok). DB CHECK `min_quantity >= 0 AND min_quantity <= max_quantity` aynı kuralı ayrıca zorlar.
// - Değişmeyen değer yazılmaz ve audit üretmez (idempotent); değişiklik `item_stock_policy.set` audit'i (önceki ve yeni değer; I-12).
// - Stok defterine ve kilitlere dokunulmaz (I-04, I-15): politika yalnız eşiktir.
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { runTenantCommand, runTenantQuery } from "../identity/access.ts";
import { assertWarehouseInScope, pgUuidArray, resolveWarehouseScope } from "../warehouse/scope.ts";
import { assertQuantityScale, compareDecimal } from "./quantity.ts";
import { loadItem, parseUuid, type CatalogCommandParams } from "./units.ts";

export interface ItemStockPolicyView {
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly warehouseName: string;
  /** Kanonik decimal dizgi; politika yoksa `null`. */
  readonly min: string | null;
  readonly max: string | null;
}

const canonical = (v: string | null): string | null => (v === null ? null : v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v);

/** Ürünün kapsamdaki etkin depolardaki min/maks değerleri (politikası olmayan depo `null` değerle; en çok 100 depo). */
export async function listItemStockPolicies(params: Omit<CatalogCommandParams, "requestId">, itemIdRaw: string): Promise<readonly ItemStockPolicyView[]> {
  const itemId = parseUuid(itemIdRaw);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, actor) => {
    if ((await loadItem(tx, actor.tenantId, itemId)) === undefined) throw new AppError("NOT_FOUND");
    const allowed = await resolveWarehouseScope(tx, actor);
    const scope = allowed === null ? null : pgUuidArray(allowed);
    const rows = await tx.execute<{ id: string; code: string; name: string; min: string | null; max: string | null }>(sql`
      SELECT w.id, w.code, w.name, p.min_quantity::text AS min, p.max_quantity::text AS max
        FROM public.warehouses w
        LEFT JOIN public.item_stock_policies p ON p.tenant_id = w.tenant_id AND p.warehouse_id = w.id AND p.item_id = ${itemId}::uuid
       WHERE w.tenant_id = ${actor.tenantId}::uuid AND w.status = 'ACTIVE'
         AND (${scope}::uuid[] IS NULL OR w.id = ANY(${scope}::uuid[]))
       ORDER BY w.code, w.id
       LIMIT 100`);
    return rows.map((r) => ({ warehouseId: r.id, warehouseCode: r.code, warehouseName: r.name, min: canonical(r.min), max: canonical(r.max) }));
  });
}

/**
 * Bir depoda ürünün min/maks stoğu. İkisi de ≥ 0, ürünün ondalık hassasiyetinde (aksi `QUANTITY_SCALE`), min ≤ maks (aksi
 * `MIN_MAX_INVALID`). 0 / 0 "minimum yok" demektir (satır yoksa yazılmaz).
 */
export async function setItemStockPolicy(
  params: CatalogCommandParams,
  input: { readonly itemId: string; readonly warehouseId: string; readonly min: string; readonly max: string },
): Promise<{ readonly changed: boolean; readonly min: string; readonly max: string }> {
  const itemId = parseUuid(input.itemId);
  const warehouseId = parseUuid(input.warehouseId);
  if (typeof input.min !== "string" || typeof input.max !== "string") throw new AppError("VALIDATION_FAILED");
  const { requestId, ...access } = params;
  return runTenantCommand({ ...access, permission: "items.edit" }, async (tx, actor) => {
    const t = actor.tenantId;
    const item = await loadItem(tx, t, itemId, "share");
    if (item === undefined) throw new AppError("NOT_FOUND");
    if (item.status !== "ACTIVE") throw new AppError("VALIDATION_FAILED");
    const min = assertQuantityScale(input.min.trim(), item.quantity_scale, "nonNegative");
    const max = assertQuantityScale(input.max.trim(), item.quantity_scale, "nonNegative");
    if (compareDecimal(min, max) > 0) throw new AppError("VALIDATION_FAILED", { detail: "MIN_MAX_INVALID" });
    const wh = await tx.execute<{ status: string }>(sql`SELECT status FROM public.warehouses WHERE tenant_id = ${t}::uuid AND id = ${warehouseId}::uuid`);
    if (wh[0] === undefined) throw new AppError("NOT_FOUND");
    if (wh[0].status !== "ACTIVE") throw new AppError("VALIDATION_FAILED");
    await assertWarehouseInScope(tx, actor, [warehouseId]);
    const prev = await tx.execute<{ min: string; max: string }>(sql`
      SELECT min_quantity::text AS min, max_quantity::text AS max FROM public.item_stock_policies
       WHERE tenant_id = ${t}::uuid AND warehouse_id = ${warehouseId}::uuid AND item_id = ${itemId}::uuid FOR UPDATE`);
    const before = prev[0];
    if (before === undefined && compareDecimal(min, "0") === 0 && compareDecimal(max, "0") === 0) return { changed: false, min, max };
    if (before !== undefined && compareDecimal(before.min, min) === 0 && compareDecimal(before.max, max) === 0) return { changed: false, min, max };
    await tx.execute(sql`
      INSERT INTO public.item_stock_policies (tenant_id, id, warehouse_id, item_id, min_quantity, max_quantity)
      VALUES (${t}::uuid, gen_random_uuid(), ${warehouseId}::uuid, ${itemId}::uuid, ${min}::numeric, ${max}::numeric)
      ON CONFLICT ON CONSTRAINT item_stock_policies_tenant_warehouse_item_key
      DO UPDATE SET min_quantity = EXCLUDED.min_quantity, max_quantity = EXCLUDED.max_quantity`);
    await appendAudit(tx, {
      action: "item_stock_policy.set",
      actorUserId: actor.userId,
      entityType: "item",
      entityId: itemId,
      requestId: requestId ?? null,
      changeSummary: { warehouse_id: warehouseId, min, max, previous_min: canonical(before?.min ?? null), previous_max: canonical(before?.max ?? null) },
    });
    return { changed: true, min, max };
  });
}
