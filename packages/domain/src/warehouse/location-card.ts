// T-1082: raf yeri (lokasyon) kartı için SALT OKUMA özet — kimlik (kod, ad, tür, durum, toplama kilidi), üst raf yerleri yolu,
// raftaki ürünler (ürün başına eldeki / ayrılmış; sıfır olmayan) ve rafa dokunan son 5 hareket (belge başına).
// Tenant + depo kapsamlı (`stock.view`; `assertWarehouseVisible`): başka tenant, kapsam dışı depo, depoya ait olmayan lokasyon ve geçersiz
// kimlik aynı `NOT_FOUND` (varlık sızmaz). Miktarlar PostgreSQL decimal dizgisidir (kayan nokta yok). Her okuma sınırlıdır.
import { sql } from "drizzle-orm";
import { AppError } from "@wms/shared/errors";
import { runTenantQuery } from "../identity/access.ts";
import type { LocationKindValue } from "./locations.ts";
import { assertWarehouseVisible } from "./scope.ts";
import { parseUuid, type WarehouseCallParams } from "./warehouses.ts";

/** Kartta gösterilen ürün satırı üst sınırı; fazlası `contentsMore` ile bildirilir. */
export const LOCATION_CARD_CONTENTS_MAX = 50;

export interface LocationCardInfo {
  readonly id: string;
  readonly warehouseId: string;
  readonly code: string;
  readonly name: string;
  readonly depth: number;
  readonly kind: LocationKindValue;
  readonly pickBlocked: boolean;
  readonly status: "ACTIVE" | "ARCHIVED";
}

export type LocationPathStep = { readonly id: string; readonly code: string };

export type LocationContentRow = {
  readonly itemId: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly unitCode: string;
  readonly physical: string;
  readonly reserved: string;
};

export type LocationMoveRow = {
  readonly documentId: string;
  readonly kind: string;
  readonly number: string | null;
  readonly occurredAt: string;
  readonly actorName: string | null;
  /** Bu raftaki net değişim (transferde rafa giren − çıkan). */
  readonly net: string;
  readonly items: string;
};

export interface LocationCard {
  readonly location: LocationCardInfo;
  /** Kökten ebeveyne üst raf yerleri (kendisi hariç). */
  readonly path: readonly LocationPathStep[];
  readonly contents: readonly LocationContentRow[];
  readonly contentsMore: boolean;
  readonly moves: readonly LocationMoveRow[];
}

type InfoRow = { id: string; warehouse_id: string; code: string; name: string; depth: number | string; kind: LocationKindValue; pick_blocked: boolean; status: "ACTIVE" | "ARCHIVED" };

export async function getLocationCard(params: WarehouseCallParams, input: { readonly warehouseId: string; readonly locationId: string }): Promise<LocationCard> {
  const warehouseId = parseUuid(input.warehouseId);
  const locationId = parseUuid(input.locationId);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, m) => {
    const t = m.tenantId;
    // Kapsam dışı depo: lokasyon satırı okunmadan NOT_FOUND.
    await assertWarehouseVisible(tx, m, [warehouseId]);
    const info = await tx.execute<InfoRow>(sql`
      SELECT l.id, l.warehouse_id, l.code, l.name, l.depth, l.kind, l.pick_blocked, l.status
        FROM public.locations l
        JOIN public.warehouses w ON w.tenant_id = l.tenant_id AND w.id = l.warehouse_id
       WHERE l.tenant_id = ${t}::uuid AND l.warehouse_id = ${warehouseId}::uuid AND l.id = ${locationId}::uuid`);
    const row = info[0];
    if (row === undefined) throw new AppError("NOT_FOUND");
    const path = await tx.execute<LocationPathStep>(sql`
      WITH RECURSIVE up(id, parent_id, code, depth) AS (
        SELECT p.id, p.parent_id, p.code, p.depth FROM public.locations p
         WHERE p.tenant_id = ${t}::uuid AND p.id = (SELECT parent_id FROM public.locations WHERE tenant_id = ${t}::uuid AND id = ${locationId}::uuid)
        UNION ALL
        SELECT p.id, p.parent_id, p.code, p.depth FROM public.locations p JOIN up ON p.tenant_id = ${t}::uuid AND p.id = up.parent_id
      )
      SELECT id, code FROM up ORDER BY depth`);
    const contents = await tx.execute<LocationContentRow>(sql`
      SELECT i.id AS "itemId", i.code AS "itemCode", i.name AS "itemName", u.code AS "unitCode",
             sum(b.quantity)::text AS physical, sum(b.reserved_quantity)::text AS reserved
        FROM public.stock_balances b
        JOIN public.stock_dimensions d ON d.tenant_id = b.tenant_id AND d.id = b.stock_dimension_id
        JOIN public.items i ON i.tenant_id = d.tenant_id AND i.id = d.item_id
        JOIN public.units u ON u.tenant_id = i.tenant_id AND u.id = i.base_unit_id
       WHERE b.tenant_id = ${t}::uuid AND d.location_id = ${locationId}::uuid
       GROUP BY i.id, i.code, i.name, u.code
      HAVING sum(b.quantity) <> 0 OR sum(b.reserved_quantity) <> 0
       ORDER BY i.code COLLATE "C", i.id
       LIMIT ${LOCATION_CARD_CONTENTS_MAX + 1}`);
    const moves = await tx.execute<LocationMoveRow>(sql`
      SELECT g.document_id AS "documentId", doc.kind, doc.number, to_json(max(g.occurred_at)) #>> '{}' AS "occurredAt", u.name AS "actorName",
             sum(g.quantity)::text AS net, string_agg(DISTINCT i.code, ', ') AS items
        FROM public.stock_ledger g
        JOIN public.documents doc ON doc.tenant_id = g.tenant_id AND doc.id = g.document_id
        JOIN public.stock_dimensions d ON d.tenant_id = g.tenant_id AND d.id = g.stock_dimension_id
        JOIN public.items i ON i.tenant_id = g.tenant_id AND i.id = g.item_id
        LEFT JOIN public.users u ON u.id = g.actor_user_id
       WHERE g.tenant_id = ${t}::uuid AND d.location_id = ${locationId}::uuid
       GROUP BY g.document_id, doc.kind, doc.number, u.name
       ORDER BY max(g.occurred_at) DESC, g.document_id
       LIMIT 5`);
    return {
      location: {
        id: row.id,
        warehouseId: row.warehouse_id,
        code: row.code,
        name: row.name,
        depth: Number(row.depth),
        kind: row.kind,
        pickBlocked: row.pick_blocked,
        status: row.status,
      },
      path,
      contents: contents.slice(0, LOCATION_CARD_CONTENTS_MAX),
      contentsMore: contents.length > LOCATION_CARD_CONTENTS_MAX,
      moves,
    };
  });
}
