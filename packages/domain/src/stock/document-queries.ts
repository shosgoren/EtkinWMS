import { sql } from "drizzle-orm";
import { AppError } from "@wms/shared/errors";
import { runTenantQuery, type TenantAccessParams } from "../identity/access.ts";
import { hasPermission } from "../identity/permissions.ts";
import { assertWarehouseVisible, pgUuidArray, resolveWarehouseScope } from "../warehouse/scope.ts";
import { yearOfBusinessDate } from "./numbering.ts";

type Params = Omit<TenantAccessParams, "permission" | "recentAuth">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function id(v: string) { if (!UUID.test(v)) throw new AppError("VALIDATION_FAILED"); return v.toLowerCase(); }
export type DocumentSummary = { id: string; kind: string; status: string; version: number; number: string | null; warehouseId: string; warehouseName: string; businessDate: string; reason: string | null; processing: boolean };
export type DocumentLineView = { id: string; itemCode: string; itemName: string; quantity: string; unitCode: string; sourceCode: string | null; targetCode: string | null; lotCode: string | null; serialNo: string | null };
export type StockChoice = { id: string; code: string; name: string; unitCode: string | null; trackingMode: string | null };

/** Bounded warehouse-scoped document history. No writes, including when loading a draft. `withTotal` adds the same-scope count (cursor ignored). */
export async function listStockDocuments(params: Params, input: { after?: string; withTotal?: boolean } = {}) {
  const parts = input.after?.split(":");
  if (parts && parts.length !== 2) throw new AppError("VALIDATION_FAILED");
  const date = parts?.[0] ?? null;
  const afterId = parts ? id(parts[1] ?? "") : null;
  if (date !== null) yearOfBusinessDate(date);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, m) => {
    const allowed = await resolveWarehouseScope(tx, m);
    const scope = allowed === null ? null : pgUuidArray(allowed);
    const from = sql`FROM public.documents d JOIN public.warehouses w ON w.tenant_id=d.tenant_id AND w.id=d.warehouse_id
      WHERE d.tenant_id=${m.tenantId}::uuid AND d.kind IN ('STOCK_IN','STOCK_OUT')
        AND (${scope}::uuid[] IS NULL OR d.warehouse_id=ANY(${scope}::uuid[]))`;
    const rows = await tx.execute<DocumentSummary>(sql`
      SELECT d.id,d.kind,d.status,d.version,d.number,d.warehouse_id AS "warehouseId",w.name AS "warehouseName",
        d.business_date::text AS "businessDate",d.reason,(d.posting_job_id IS NOT NULL) AS processing
      ${from}
        AND (${date}::date IS NULL OR (d.business_date,d.id)<(${date}::date,${afterId}::uuid))
      ORDER BY d.business_date DESC,d.id DESC LIMIT 51`);
    const items = rows.slice(0,50), last = items.at(-1);
    const total = input.withTotal === true ? Number((await tx.execute<{ n: number | string }>(sql`SELECT count(*)::int AS n ${from}`))[0]?.n ?? 0) : undefined;
    return { items, next: rows.length > 50 && last ? `${last.businessDate}:${last.id}` : null, ...(total === undefined ? {} : { total }),
      permissions: { create: hasPermission(m.roles, "document.create", m.grants), approve: hasPermission(m.roles, "document.approve", m.grants), post: hasPermission(m.roles, "stock.post", m.grants) } };
  });
}
export async function getStockDocument(params: Params, documentId: string) {
  const document = id(documentId);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx,m) => {
    const rows = await tx.execute<DocumentSummary>(sql`
      SELECT d.id,d.kind,d.status,d.version,d.number,d.warehouse_id AS "warehouseId",w.name AS "warehouseName",
        d.business_date::text AS "businessDate",d.reason,(d.posting_job_id IS NOT NULL) AS processing
      FROM public.documents d JOIN public.warehouses w ON w.tenant_id=d.tenant_id AND w.id=d.warehouse_id
      WHERE d.tenant_id=${m.tenantId}::uuid AND d.id=${document}::uuid AND d.kind IN ('STOCK_IN','STOCK_OUT')`);
    const header=rows[0]; if (!header) throw new AppError("NOT_FOUND");
    await assertWarehouseVisible(tx,m,[header.warehouseId]);
    const lines=await tx.execute<DocumentLineView>(sql`
      SELECT dl.id,i.code AS "itemCode",i.name AS "itemName",dl.quantity::text AS quantity,u.code AS "unitCode",
        src.code AS "sourceCode",dst.code AS "targetCode",lot.lot_code AS "lotCode",ser.serial_no AS "serialNo"
      FROM public.document_lines dl
      JOIN public.items i ON i.tenant_id=dl.tenant_id AND i.id=dl.item_id
      JOIN public.units u ON u.tenant_id=dl.tenant_id AND u.id=dl.unit_id
      LEFT JOIN public.locations src ON src.tenant_id=dl.tenant_id AND src.id=dl.source_location_id
      LEFT JOIN public.locations dst ON dst.tenant_id=dl.tenant_id AND dst.id=dl.target_location_id
      LEFT JOIN public.lots lot ON lot.tenant_id=dl.tenant_id AND lot.id=dl.lot_id
      LEFT JOIN public.serials ser ON ser.tenant_id=dl.tenant_id AND ser.id=dl.serial_id
      WHERE dl.tenant_id=${m.tenantId}::uuid AND dl.document_id=${document}::uuid ORDER BY dl.line_no LIMIT 2000`);
    const allowed=await resolveWarehouseScope(tx,m), scope=allowed===null?null:pgUuidArray(allowed);
    const related=await tx.execute<{id:string;number:string|null;warehouseName:string;kind:string}>(sql`
      SELECT other.id,other.number,w.name AS "warehouseName",link.kind
      FROM public.stock_document_links link
      JOIN public.documents other ON other.tenant_id=link.tenant_id AND other.id=CASE WHEN link.source_document_id=${document}::uuid THEN link.target_document_id ELSE link.source_document_id END
      JOIN public.warehouses w ON w.tenant_id=other.tenant_id AND w.id=other.warehouse_id
      WHERE link.tenant_id=${m.tenantId}::uuid AND (link.source_document_id=${document}::uuid OR link.target_document_id=${document}::uuid)
        AND (${scope}::uuid[] IS NULL OR other.warehouse_id=ANY(${scope}::uuid[])) LIMIT 101`);
    return { ...header, lines, related };
  });
}
/** Search is bounded; any number of warehouses is reachable by code/name. */
export async function searchStockChoices(params: Params,input: { kind: "warehouse"|"item"|"location"|"lot"|"serial"; q: string; warehouseId?: string; itemId?: string }) {
  if (typeof input.q !== "string" || input.q.length>128) throw new AppError("VALIDATION_FAILED");
  const pattern=`%${input.q.trim().replace(/[\\%_]/g,"\\$&")}%`;
  const warehouse=input.warehouseId === undefined ? null : id(input.warehouseId);
  const item=input.itemId === undefined ? null : id(input.itemId);
  return runTenantQuery({ ...params, permission:"stock.view" },async(tx,m)=>{
    if (input.kind === "warehouse") {
      const allowed=await resolveWarehouseScope(tx,m), scope=allowed===null?null:pgUuidArray(allowed);
      return tx.execute<StockChoice>(sql`SELECT id,code,name,NULL::text AS "unitCode",NULL::text AS "trackingMode" FROM public.warehouses
        WHERE tenant_id=${m.tenantId}::uuid AND status='ACTIVE' AND (code ILIKE ${pattern} OR name ILIKE ${pattern})
        AND (${scope}::uuid[] IS NULL OR id=ANY(${scope}::uuid[])) ORDER BY code,id LIMIT 20`);
    }
    if(input.kind === "item") return tx.execute<StockChoice>(sql`SELECT i.id,i.code,i.name,u.code AS "unitCode",i.tracking_mode AS "trackingMode"
      FROM public.items i JOIN public.units u ON u.tenant_id=i.tenant_id AND u.id=i.base_unit_id
      WHERE i.tenant_id=${m.tenantId}::uuid AND i.status='ACTIVE' AND (i.code ILIKE ${pattern} OR i.name ILIKE ${pattern}) ORDER BY i.code,i.id LIMIT 20`);
    if(input.kind === "location") {
      if(!warehouse) throw new AppError("VALIDATION_FAILED");
      await assertWarehouseVisible(tx,m,[warehouse]);
      return tx.execute<StockChoice>(sql`SELECT id,code,name,NULL::text AS "unitCode",NULL::text AS "trackingMode" FROM public.locations
        WHERE tenant_id=${m.tenantId}::uuid AND warehouse_id=${warehouse}::uuid AND status='ACTIVE'
        AND (code ILIKE ${pattern} OR name ILIKE ${pattern}) ORDER BY code,id LIMIT 20`);
    }
    if(!item) throw new AppError("VALIDATION_FAILED");
    if(input.kind === "lot") return tx.execute<StockChoice>(sql`SELECT id,lot_code AS code,lot_code AS name,NULL::text AS "unitCode",NULL::text AS "trackingMode"
      FROM public.lots WHERE tenant_id=${m.tenantId}::uuid AND item_id=${item}::uuid AND lot_code ILIKE ${pattern} ORDER BY lot_code,id LIMIT 20`);
    if(input.kind !== "serial") throw new AppError("VALIDATION_FAILED");
    return tx.execute<StockChoice>(sql`SELECT id,serial_no AS code,serial_no AS name,NULL::text AS "unitCode",NULL::text AS "trackingMode"
      FROM public.serials WHERE tenant_id=${m.tenantId}::uuid AND item_id=${item}::uuid AND serial_no ILIKE ${pattern} ORDER BY serial_no,id LIMIT 20`);
  });
}
