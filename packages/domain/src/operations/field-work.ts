// T-977 (B-51 / B-52 / B-63 saha): saha toplama ve sayım ekranlarının SALT OKUMA sorguları. Stok, görev ya da oturum YAZMAZ; yazma
// `confirmPick` / `shipOrder` / `recordCount` / `submitCount` komutlarındadır (I-06 idempotency, I-15 kilitleri orada).
//
// - `getPickWork` (`stock.view`): bir PICK görevinin saha kartı — ürün, kaynak raf, sevk alanı (A-307-1 ile aynı seçim), sipariş, kalan miktar ve aynı
//   siparişte bana görünen sıradaki toplama. Başkasına atanmış görev yalnız `document.approve` sahibine görünür (aksi `NOT_FOUND`, varlık sızmaz; confirmPick
//   kuralıyla aynı). Depo kapsamı (A-46) `assertWarehouseVisible` ile.
// - `findFieldWork` (`stock.view`): OKUT'ta okutulan raf ya da ürünün bekleyen saha işi: açık PICK görevi (izin `stock.post`) ve oturum kaynaklı açık COUNT
//   görevi (izin `document.create`, oturum `COUNTING`). Yalnız üstlenilebilir (OPEN) ya da BANA atanmış görev döner; bana atanmış olan önce gelir.
//   Kapsam dışı depo ve başka kiracı görünmez (sorguda açık `tenant_id` + kapsam süzgeci; RLS ikinci savunma).
import { sql } from "drizzle-orm";
import { AppError } from "@wms/shared/errors";
import { runTenantQuery } from "../identity/access.ts";
import { hasPermission } from "../identity/permissions.ts";
import { assertWarehouseVisible, pgUuidArray, resolveWarehouseScope } from "../warehouse/scope.ts";
import type { TaskCallParams } from "./tasks.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(v: unknown): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new AppError("VALIDATION_FAILED");
  return v.toLowerCase();
}

export interface PickWork {
  readonly task: { readonly id: string; readonly version: number; readonly status: string; readonly assignedToMe: boolean; readonly quantity: string };
  readonly item: { readonly id: string; readonly code: string; readonly name: string; readonly unitCode: string };
  readonly location: { readonly id: string; readonly code: string; readonly name: string };
  readonly staging: { readonly code: string; readonly name: string } | null;
  readonly warehouse: { readonly id: string; readonly name: string };
  readonly order: { readonly id: string; readonly number: string; readonly customerRef: string | null; readonly status: string };
  /** Aynı siparişte (görev hariç) bana görünen açık toplama görevi sayısı ve ilki (lokasyon kodu sırası). */
  readonly remaining: number;
  readonly nextTaskId: string | null;
}

/** Saha toplama kartı. Yok / başka kiracı / kapsam dışı / başkasına atanmış (onay yetkisi yoksa) → `NOT_FOUND`; PICK değilse `VALIDATION_FAILED`. */
export async function getPickWork(params: TaskCallParams, input: { readonly taskId: string }): Promise<PickWork> {
  const taskId = uuid(input.taskId);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, m) => {
    const rows = await tx.execute<{
      id: string; version: number | string; status: string; kind: string; warehouse_id: string; warehouse_name: string; assigned_membership_id: string | null;
      quantity: string | null; source_kind: string | null; source_id: string | null; item_id: string | null; item_code: string | null; item_name: string | null;
      unit_code: string | null; location_id: string | null; location_code: string | null; location_name: string | null;
    }>(
      sql`SELECT t.id, t.version, t.status, t.kind, t.warehouse_id, w.name AS warehouse_name, t.assigned_membership_id, t.quantity::text AS quantity,
                 t.source_kind, t.source_id, t.item_id, i.code AS item_code, i.name AS item_name, u.code AS unit_code,
                 t.location_id, l.code AS location_code, l.name AS location_name
            FROM public.warehouse_tasks t
            JOIN public.warehouses w ON w.tenant_id = t.tenant_id AND w.id = t.warehouse_id
            LEFT JOIN public.items i ON i.tenant_id = t.tenant_id AND i.id = t.item_id
            LEFT JOIN public.units u ON u.tenant_id = i.tenant_id AND u.id = i.base_unit_id
            LEFT JOIN public.locations l ON l.tenant_id = t.tenant_id AND l.id = t.location_id
           WHERE t.tenant_id = ${m.tenantId}::uuid AND t.id = ${taskId}::uuid`,
    );
    const t = rows[0];
    if (t === undefined) throw new AppError("NOT_FOUND");
    await assertWarehouseVisible(tx, m, [t.warehouse_id]);
    const assignedToMe = t.assigned_membership_id !== null && t.assigned_membership_id.toLowerCase() === m.membershipId.toLowerCase();
    if (t.assigned_membership_id !== null && !assignedToMe && !hasPermission(m.roles, "document.approve", m.grants)) throw new AppError("NOT_FOUND");
    if (
      t.kind !== "PICK" || t.source_kind !== "SALES_ORDER" || t.source_id === null || t.item_id === null || t.location_id === null || t.quantity === null ||
      t.item_code === null || t.item_name === null || t.unit_code === null || t.location_code === null || t.location_name === null
    ) {
      throw new AppError("VALIDATION_FAILED");
    }
    const orders = await tx.execute<{ id: string; number: string; customer_ref: string | null; status: string }>(
      sql`SELECT id, number, customer_ref, status FROM public.sales_orders WHERE tenant_id = ${m.tenantId}::uuid AND id = ${t.source_id}::uuid`,
    );
    const o = orders[0];
    if (o === undefined) throw new AppError("NOT_FOUND");
    const staging = await tx.execute<{ code: string; name: string }>(
      sql`SELECT code, name FROM public.locations WHERE tenant_id = ${m.tenantId}::uuid AND warehouse_id = ${t.warehouse_id}::uuid AND kind = 'STAGING' AND status = 'ACTIVE'
           ORDER BY code, id LIMIT 1`,
    );
    const scope = await resolveWarehouseScope(tx, m);
    const others = await tx.execute<{ id: string; total: string }>(
      sql`SELECT t.id, count(*) OVER ()::text AS total
            FROM public.warehouse_tasks t
            JOIN public.locations l ON l.tenant_id = t.tenant_id AND l.id = t.location_id
           WHERE t.tenant_id = ${m.tenantId}::uuid AND t.kind = 'PICK' AND t.source_kind = 'SALES_ORDER' AND t.source_id = ${o.id}::uuid AND t.id <> ${taskId}::uuid
             AND (t.status = 'OPEN' OR (t.status = 'ASSIGNED' AND t.assigned_membership_id = ${m.membershipId}::uuid))
             AND (${scope === null}::boolean OR t.warehouse_id = ANY(${pgUuidArray(scope ?? [])}::uuid[]))
           ORDER BY l.code, t.id
           LIMIT 1`,
    );
    return {
      task: { id: t.id, version: Number(t.version), status: t.status, assignedToMe, quantity: t.quantity },
      item: { id: t.item_id, code: t.item_code, name: t.item_name, unitCode: t.unit_code },
      location: { id: t.location_id, code: t.location_code, name: t.location_name },
      staging: staging[0] === undefined ? null : { code: staging[0].code, name: staging[0].name },
      warehouse: { id: t.warehouse_id, name: t.warehouse_name },
      order: { id: o.id, number: o.number, customerRef: o.customer_ref, status: o.status },
      remaining: Number(others[0]?.total ?? 0),
      nextTaskId: others[0]?.id ?? null,
    };
  });
}

export interface FieldWorkTask {
  readonly taskId: string;
  /** Bana atanmış (true) ya da üstlenilebilir (false). */
  readonly mine: boolean;
}
export interface FieldWork {
  readonly pick: FieldWorkTask | null;
  readonly count: FieldWorkTask | null;
}

/**
 * OKUT yönlendirmesi: okutulan raf (`locationId`) ya da ürün (`itemId`) için bekleyen saha işi. Raf → o rafta açık PICK ve oturum kaynaklı COUNT görevi;
 * ürün → o ürünün açık PICK görevi (sayım raf işidir). Yetkisi olmayan tür hiç sorgulanmaz (`null`). Kimlikler istemciden gelse de yalnız kiracı ve kapsam
 * süzgeciyle eşleşir: başka kiracının/kapsam dışının görevi dönmez.
 */
export async function findFieldWork(params: TaskCallParams, input: { readonly locationId: string } | { readonly itemId: string }): Promise<FieldWork> {
  const locationId = "locationId" in input ? uuid(input.locationId) : null;
  const itemId = "itemId" in input ? uuid(input.itemId) : null;
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, m) => {
    const scope = await resolveWarehouseScope(tx, m);
    const inScope = scope === null ? null : pgUuidArray(scope);
    const me = m.membershipId;
    let pick: FieldWorkTask | null = null;
    if (hasPermission(m.roles, "stock.post", m.grants)) {
      const rows = await tx.execute<{ id: string; mine: boolean }>(
        sql`SELECT t.id, (t.status = 'ASSIGNED') AS mine
              FROM public.warehouse_tasks t
              JOIN public.sales_orders o ON o.tenant_id = t.tenant_id AND o.id = t.source_id AND o.status = 'OPEN'
             WHERE t.tenant_id = ${m.tenantId}::uuid AND t.kind = 'PICK' AND t.source_kind = 'SALES_ORDER'
               AND (t.status = 'OPEN' OR (t.status = 'ASSIGNED' AND t.assigned_membership_id = ${me}::uuid))
               AND (${locationId}::uuid IS NULL OR t.location_id = ${locationId}::uuid)
               AND (${itemId}::uuid IS NULL OR t.item_id = ${itemId}::uuid)
               AND (${inScope}::uuid[] IS NULL OR t.warehouse_id = ANY(${inScope}::uuid[]))
             ORDER BY (t.status = 'ASSIGNED') DESC, t.created_at, t.id
             LIMIT 1`,
      );
      pick = rows[0] === undefined ? null : { taskId: rows[0].id, mine: rows[0].mine };
    }
    let count: FieldWorkTask | null = null;
    if (locationId !== null && hasPermission(m.roles, "document.create", m.grants)) {
      const rows = await tx.execute<{ id: string; mine: boolean }>(
        sql`SELECT t.id, (t.status = 'ASSIGNED') AS mine
              FROM public.warehouse_tasks t
              JOIN public.count_sessions s ON s.tenant_id = t.tenant_id AND s.id = t.source_id AND s.status = 'COUNTING'
             WHERE t.tenant_id = ${m.tenantId}::uuid AND t.kind = 'COUNT' AND t.source_kind = 'COUNT_SESSION' AND t.location_id = ${locationId}::uuid
               AND (t.status = 'OPEN' OR (t.status = 'ASSIGNED' AND t.assigned_membership_id = ${me}::uuid))
               AND (${inScope}::uuid[] IS NULL OR t.warehouse_id = ANY(${inScope}::uuid[]))
             ORDER BY (t.status = 'ASSIGNED') DESC, t.created_at, t.id
             LIMIT 1`,
      );
      count = rows[0] === undefined ? null : { taskId: rows[0].id, mine: rows[0].mine };
    }
    return { pick, count };
  });
}
