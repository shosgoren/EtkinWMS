// T-1002 (B-62): Etkin — eşleştirme adayları ve salt okuma sonuçları. Her sorgu `runTenantQuery` (I-01/I-02: doğrulanmış üyelik, RLS,
// transaction-yerel bağlam) + açık `tenant_id` süzgeci + depo kapsamı (A-46: raf/depo yalnız üyenin görebildiği depolardan). İzin `stock.view`.
// Yazma yok. Listeler sınırlıdır (I-14: kısa okuma; büyük katalogda en çok VOICE_*_MAX satır).
import { sql } from "drizzle-orm";
import { AppError } from "@wms/shared/errors";
import { runTenantQuery, type TenantAccessParams } from "../identity/access.ts";
import { assertWarehouseVisible, pgUuidArray, resolveWarehouseScope } from "../warehouse/scope.ts";
import type { Candidate } from "@wms/shared/voice";

export type VoiceParams = Omit<TenantAccessParams, "permission" | "recentAuth">;

export type VoiceItem = Candidate & {
  readonly unitCode: string;
  readonly unitName: string;
};
export type VoiceLocation = Candidate & {
  readonly warehouseId: string;
  readonly warehouseName: string;
};
export type VoiceOrder = Candidate & {
  readonly status: string;
};
export interface VoiceCatalog {
  readonly items: readonly VoiceItem[];
  readonly locations: readonly VoiceLocation[];
  readonly warehouses: readonly Candidate[];
  readonly parties: readonly Candidate[];
  readonly people: readonly Candidate[];
  readonly orders: readonly VoiceOrder[];
}
export interface VoiceNeed {
  readonly items?: boolean;
  readonly locations?: boolean;
  readonly warehouses?: boolean;
  readonly parties?: boolean;
  readonly people?: boolean;
  readonly orders?: boolean;
}

export const VOICE_ITEMS_MAX = 5000;
export const VOICE_LOCATIONS_MAX = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Yalnız istenen listeler; kapsam dışı depo/raf hiç dönmez. Başka kiracının satırı RLS + `tenant_id` süzgeciyle dönmez. */
export async function loadVoiceCatalog(params: VoiceParams, need: VoiceNeed): Promise<VoiceCatalog> {
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, m) => {
    const allowed = need.locations === true || need.warehouses === true ? await resolveWarehouseScope(tx, m) : null;
    const scope = allowed === null ? null : pgUuidArray(allowed);
    const items =
      need.items === true
        ? await tx.execute<VoiceItem>(sql`SELECT i.id, i.code, i.name, u.code AS "unitCode", u.name AS "unitName"
            FROM public.items i JOIN public.units u ON u.tenant_id = i.tenant_id AND u.id = i.base_unit_id
            WHERE i.tenant_id = ${m.tenantId}::uuid AND i.status = 'ACTIVE' ORDER BY i.code, i.id LIMIT ${VOICE_ITEMS_MAX}`)
        : [];
    const locations =
      need.locations === true
        ? await tx.execute<VoiceLocation>(sql`SELECT l.id, l.code, l.name, l.warehouse_id AS "warehouseId", w.name AS "warehouseName"
            FROM public.locations l JOIN public.warehouses w ON w.tenant_id = l.tenant_id AND w.id = l.warehouse_id
            WHERE l.tenant_id = ${m.tenantId}::uuid AND l.status = 'ACTIVE' AND w.status = 'ACTIVE'
              AND (${scope}::uuid[] IS NULL OR l.warehouse_id = ANY(${scope}::uuid[]))
            ORDER BY l.code, l.id LIMIT ${VOICE_LOCATIONS_MAX}`)
        : [];
    const warehouses =
      need.warehouses === true
        ? await tx.execute<Candidate>(sql`SELECT id, code, name FROM public.warehouses
            WHERE tenant_id = ${m.tenantId}::uuid AND status = 'ACTIVE' AND (${scope}::uuid[] IS NULL OR id = ANY(${scope}::uuid[]))
            ORDER BY code, id LIMIT 200`)
        : [];
    const parties =
      need.parties === true
        ? await tx.execute<Candidate>(sql`SELECT id, code, name FROM public.parties
            WHERE tenant_id = ${m.tenantId}::uuid AND archived_at IS NULL ORDER BY code, id LIMIT 2000`)
        : [];
    const people =
      need.people === true
        ? await tx.execute<Candidate>(sql`SELECT tm.id, '' AS code, u.name FROM public.tenant_memberships tm
            JOIN public.users u ON u.id = tm.user_id
            WHERE tm.tenant_id = ${m.tenantId}::uuid AND tm.status = 'ACTIVE' ORDER BY u.name, tm.id LIMIT 500`)
        : [];
    const orders =
      need.orders === true
        ? await tx.execute<VoiceOrder>(sql`SELECT id, COALESCE(number, '') AS code, customer_ref AS name, status FROM public.sales_orders
            WHERE tenant_id = ${m.tenantId}::uuid ORDER BY created_at DESC, id LIMIT 1000`)
        : [];
    return { items, locations, warehouses, parties, people, orders };
  });
}

export type LocationContentRow = {
  readonly itemId: string;
  readonly code: string;
  readonly name: string;
  readonly quantity: string;
  readonly unitCode: string;
};

/** Bir rafta ne var: ürün başına eldeki (fiziksel) miktar, en çok 20 satır + toplam ürün sayısı. Kapsam dışı raf → NOT_FOUND. */
export async function locationContents(params: VoiceParams, locationId: string): Promise<{ readonly rows: readonly LocationContentRow[]; readonly total: number }> {
  if (!UUID.test(locationId)) throw new AppError("VALIDATION_FAILED");
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, m) => {
    const loc = await tx.execute<{ warehouse_id: string }>(
      sql`SELECT warehouse_id FROM public.locations WHERE tenant_id = ${m.tenantId}::uuid AND id = ${locationId}::uuid`,
    );
    if (loc[0] === undefined) throw new AppError("NOT_FOUND");
    await assertWarehouseVisible(tx, m, [loc[0].warehouse_id]);
    const rows = await tx.execute<LocationContentRow & { total: string }>(sql`
      SELECT i.id AS "itemId", i.code, i.name, sum(b.quantity)::text AS quantity, u.code AS "unitCode", count(*) OVER ()::text AS total
        FROM public.stock_dimensions s
        JOIN public.stock_balances b ON b.tenant_id = s.tenant_id AND b.stock_dimension_id = s.id
        JOIN public.items i ON i.tenant_id = s.tenant_id AND i.id = s.item_id
        JOIN public.units u ON u.tenant_id = i.tenant_id AND u.id = i.base_unit_id
       WHERE s.tenant_id = ${m.tenantId}::uuid AND s.location_id = ${locationId}::uuid
       GROUP BY i.id, i.code, i.name, u.code
      HAVING sum(b.quantity) <> 0
       ORDER BY i.code, i.id LIMIT 20`);
    return { rows: rows.map((r) => ({ itemId: r.itemId, code: r.code, name: r.name, quantity: r.quantity, unitCode: r.unitCode })), total: Number(rows[0]?.total ?? 0) };
  });
}

/** Görev satırlarına ürün adı ve raf kodu (yalnız aynı kiracı; görevler zaten kapsamla süzülmüş listeden gelir). */
export async function describeTaskRefs(
  params: VoiceParams,
  itemIds: readonly string[],
  locationIds: readonly string[],
): Promise<{ readonly items: ReadonlyMap<string, string>; readonly locations: ReadonlyMap<string, string> }> {
  const ii = [...new Set(itemIds)].filter((v) => UUID.test(v)).slice(0, 50);
  const ll = [...new Set(locationIds)].filter((v) => UUID.test(v)).slice(0, 50);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, m) => {
    const items = ii.length === 0 ? [] : await tx.execute<{ id: string; name: string }>(
      sql`SELECT id, name FROM public.items WHERE tenant_id = ${m.tenantId}::uuid AND id = ANY(${pgUuidArray(ii)}::uuid[])`,
    );
    const locs = ll.length === 0 ? [] : await tx.execute<{ id: string; code: string }>(
      sql`SELECT id, code FROM public.locations WHERE tenant_id = ${m.tenantId}::uuid AND id = ANY(${pgUuidArray(ll)}::uuid[])`,
    );
    return { items: new Map(items.map((r) => [r.id, r.name])), locations: new Map(locs.map((r) => [r.id, r.code])) };
  });
}
