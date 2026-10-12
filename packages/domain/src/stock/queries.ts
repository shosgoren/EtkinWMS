import { sql } from "drizzle-orm";
import { AppError } from "@wms/shared/errors";
import { runTenantQuery, type TenantAccessParams } from "../identity/access.ts";
import { pgUuidArray, resolveWarehouseScope } from "../warehouse/scope.ts";

export type StockOverviewRow = {
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly warehouseName: string;
  readonly itemId: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly unitCode: string;
  /** PostgreSQL decimal strings; never converted to JS floating point. */
  readonly physical: string;
  readonly reserved: string;
  readonly available: string;
};

export interface StockOverviewInput {
  readonly q?: string;
  readonly warehouseId?: string;
  readonly after?: string;
  readonly limit?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new AppError("VALIDATION_FAILED");
  return value.toLowerCase();
}

/** One row per warehouse/item/base unit. Read-only, tenant and warehouse scoped, bounded keyset paging. */
export async function listStockOverview(
  params: Omit<TenantAccessParams, "permission" | "recentAuth">,
  input: StockOverviewInput = {},
): Promise<{ readonly items: readonly StockOverviewRow[]; readonly next: string | null }> {
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError("VALIDATION_FAILED");
  if (input.q !== undefined && (typeof input.q !== "string" || input.q.length > 128)) throw new AppError("VALIDATION_FAILED");
  const query = input.q?.trim() ?? "";
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const warehouse = input.warehouseId === undefined ? null : uuid(input.warehouseId);
  let afterWarehouse: string | null = null;
  let afterItem: string | null = null;
  if (input.after !== undefined) {
    if (typeof input.after !== "string") throw new AppError("VALIDATION_FAILED");
    const parts = input.after.split(":");
    if (parts.length !== 2) throw new AppError("VALIDATION_FAILED");
    afterWarehouse = uuid(parts[0] ?? "");
    afterItem = uuid(parts[1] ?? "");
  }
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, member) => {
    const allowed = await resolveWarehouseScope(tx, member);
    const scope = allowed === null ? null : pgUuidArray(allowed);
    const rows = await tx.execute<StockOverviewRow>(sql`
      SELECT w.id AS "warehouseId", w.code AS "warehouseCode", w.name AS "warehouseName",
             i.id AS "itemId", i.code AS "itemCode", i.name AS "itemName", u.code AS "unitCode",
             sum(b.quantity)::text AS physical, sum(b.reserved_quantity)::text AS reserved,
             coalesce(sum(b.quantity - b.reserved_quantity) FILTER (
               WHERE d.stock_status = 'AVAILABLE' AND l.kind IN ('STORAGE', 'STAGING') AND l.pick_blocked = false
             ), 0)::text AS available
        FROM public.stock_balances b
        JOIN public.stock_dimensions d ON d.tenant_id = b.tenant_id AND d.id = b.stock_dimension_id
        JOIN public.locations l ON l.tenant_id = d.tenant_id AND l.id = d.location_id
        JOIN public.warehouses w ON w.tenant_id = l.tenant_id AND w.id = l.warehouse_id
        JOIN public.items i ON i.tenant_id = d.tenant_id AND i.id = d.item_id
        JOIN public.units u ON u.tenant_id = i.tenant_id AND u.id = i.base_unit_id
       WHERE b.tenant_id = ${member.tenantId}::uuid
         AND (${scope}::uuid[] IS NULL OR w.id = ANY(${scope}::uuid[]))
         AND (${warehouse}::uuid IS NULL OR w.id = ${warehouse}::uuid)
         AND (${query} = '' OR i.code ILIKE ${pattern} OR i.name ILIKE ${pattern} OR w.code ILIKE ${pattern} OR w.name ILIKE ${pattern})
         AND (${afterWarehouse}::uuid IS NULL OR (w.id, i.id) > (${afterWarehouse}::uuid, ${afterItem}::uuid))
       GROUP BY w.id, w.code, w.name, i.id, i.code, i.name, u.code
      HAVING sum(b.quantity) <> 0 OR sum(b.reserved_quantity) <> 0
       ORDER BY w.id, i.id
       LIMIT ${limit + 1}`);
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return { items, next: rows.length > limit && last !== undefined ? `${last.warehouseId}:${last.itemId}` : null };
  });
}
