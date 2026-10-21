import { sql } from "drizzle-orm";
import { AppError } from "@wms/shared/errors";
import { runTenantQuery,type TenantAccessParams } from "../identity/access.ts";
import { hasPermission } from "../identity/permissions.ts";
import { assertWarehouseVisible,pgUuidArray,resolveWarehouseScope } from "../warehouse/scope.ts";
import { resolveBarcode } from "../catalog/barcodes.ts";
import { microToDecimal,uuidOf } from "./field-posting.ts";
import { scaledBaseQuantity } from "./picking.ts";
type Params=Omit<TenantAccessParams,"permission"|"recentAuth">;
type Order={id:string;number:string;customerRef:string|null;status:string;version:number};
/** `withTotal: true` → aynı işlemde aynı arama süzgeciyle (imleç hariç) toplam sipariş sayısı da döner (ALTIN-KURAL 15). */
export async function listShippingOrders(params:Params,input:{q?:string;after?:string;withTotal?:boolean}={}){
 const q=input.q??"";if(typeof q!=="string"||q.length>128)throw new AppError("VALIDATION_FAILED");
 const after=input.after?uuidOf(input.after):null,pattern=`%${q.replace(/[\\%_]/g,"\\$&")}%`;
 return runTenantQuery({...params,permission:"stock.view"},async(tx,m)=>{
  const where=sql`tenant_id=${m.tenantId}::uuid AND (number ILIKE ${pattern} OR customer_ref ILIKE ${pattern})`;
  const rows=await tx.execute<Order>(sql`SELECT id,number,customer_ref AS "customerRef",status,version FROM public.sales_orders
   WHERE ${where} AND (${after}::uuid IS NULL OR id>${after}::uuid) ORDER BY id LIMIT 51`);
  const items=rows.slice(0,50),last=items.at(-1);
  const total=input.withTotal===true?Number((await tx.execute<{n:number|string}>(sql`SELECT count(*)::int AS n FROM public.sales_orders WHERE ${where}`))[0]?.n??0):undefined;
  return {items,next:rows.length>50&&last?last.id:null,...(total===undefined?{}:{total}),permissions:{create:hasPermission(m.roles, "document.create", m.grants),approve:hasPermission(m.roles, "document.approve", m.grants),post:hasPermission(m.roles, "stock.post", m.grants)}};
 });
}
export async function getShippingOrder(params:Params,orderId:string,input:{taskAfter?:string;stageAfter?:string}={}){
 const id=uuidOf(orderId),taskAfter=input.taskAfter?uuidOf(input.taskAfter):null;
 const stage=input.stageAfter?.split(":");if(stage&&stage.length!==2)throw new AppError("VALIDATION_FAILED");
 const stageLine=stage?uuidOf(stage[0]??""):null,stageWarehouse=stage?uuidOf(stage[1]??""):null;
 return runTenantQuery({...params,permission:"stock.view"},async(tx,m)=>{
  const headers=await tx.execute<Order>(sql`SELECT id,number,customer_ref AS "customerRef",status,version FROM public.sales_orders WHERE tenant_id=${m.tenantId}::uuid AND id=${id}::uuid`);
  if(!headers[0])throw new AppError("NOT_FOUND");
  const allowed=await resolveWarehouseScope(tx,m),scope=allowed===null?null:pgUuidArray(allowed);
  const lines=await tx.execute<{id:string;itemName:string;unitCode:string;requested:string;reserved:string;shipped:string;open:string}>(sql`
   SELECT l.id,i.name AS "itemName",u.code AS "unitCode",l.requested_quantity::text AS requested,l.shipped_quantity::text AS shipped,
    (SELECT coalesce(sum(r.quantity),0)::text FROM public.reservations r JOIN public.stock_dimensions d ON d.tenant_id=r.tenant_id AND d.id=r.stock_dimension_id
     JOIN public.locations loc ON loc.tenant_id=d.tenant_id AND loc.id=d.location_id
     WHERE r.tenant_id=l.tenant_id AND r.order_line_id=l.id AND r.status='ACTIVE' AND (${scope}::uuid[] IS NULL OR loc.warehouse_id=ANY(${scope}::uuid[]))) AS reserved,
    (l.requested_quantity-l.shipped_quantity-l.cancelled_quantity)::text AS open
   FROM public.sales_order_lines l JOIN public.items i ON i.tenant_id=l.tenant_id AND i.id=l.item_id JOIN public.units u ON u.tenant_id=i.tenant_id AND u.id=i.base_unit_id
   WHERE l.tenant_id=${m.tenantId}::uuid AND l.order_id=${id}::uuid ORDER BY l.line_no LIMIT 200`);
  const tasks=await tx.execute<{id:string;itemName:string;unitCode:string;warehouseName:string;sourceCode:string;targetCode:string|null;quantity:string;canPick:boolean}>(sql`
   SELECT t.id,i.name AS "itemName",u.code AS "unitCode",w.name AS "warehouseName",loc.code AS "sourceCode",t.quantity::text AS quantity,
    (SELECT code FROM public.locations st WHERE st.tenant_id=t.tenant_id AND st.warehouse_id=t.warehouse_id AND st.kind='STAGING' AND st.status='ACTIVE' ORDER BY code LIMIT 1) AS "targetCode",
    (t.status='OPEN' OR t.assigned_membership_id=${m.membershipId}::uuid OR ${hasPermission(m.roles, "document.approve", m.grants)}) AS "canPick"
   FROM public.warehouse_tasks t JOIN public.items i ON i.tenant_id=t.tenant_id AND i.id=t.item_id
   JOIN public.units u ON u.tenant_id=i.tenant_id AND u.id=i.base_unit_id JOIN public.locations loc ON loc.tenant_id=t.tenant_id AND loc.id=t.location_id
   JOIN public.warehouses w ON w.tenant_id=t.tenant_id AND w.id=t.warehouse_id
   WHERE t.tenant_id=${m.tenantId}::uuid AND t.source_kind='SALES_ORDER' AND t.source_id=${id}::uuid AND t.kind='PICK' AND t.status IN ('OPEN','ASSIGNED')
    AND (${scope}::uuid[] IS NULL OR t.warehouse_id=ANY(${scope}::uuid[])) AND (${taskAfter}::uuid IS NULL OR t.id>${taskAfter}::uuid) ORDER BY t.id LIMIT 51`);
  const staged=await tx.execute<{lineId:string;warehouseId:string;warehouseName:string;itemName:string;unitCode:string;quantity:string}>(sql`
   SELECT l.id AS "lineId",w.id AS "warehouseId",w.name AS "warehouseName",i.name AS "itemName",u.code AS "unitCode",sum(r.quantity)::text AS quantity
   FROM public.sales_order_lines l JOIN public.items i ON i.tenant_id=l.tenant_id AND i.id=l.item_id JOIN public.units u ON u.tenant_id=i.tenant_id AND u.id=i.base_unit_id
   JOIN public.reservations r ON r.tenant_id=l.tenant_id AND r.order_line_id=l.id
   JOIN public.stock_dimensions d ON d.tenant_id=r.tenant_id AND d.id=r.stock_dimension_id
   JOIN public.locations loc ON loc.tenant_id=d.tenant_id AND loc.id=d.location_id JOIN public.warehouses w ON w.tenant_id=loc.tenant_id AND w.id=loc.warehouse_id
   WHERE l.tenant_id=${m.tenantId}::uuid AND l.order_id=${id}::uuid AND r.status='ACTIVE' AND loc.kind='STAGING'
    AND d.stock_status='AVAILABLE' AND d.lot_id IS NULL AND d.serial_id IS NULL AND d.inventory_owner_id IS NULL AND d.handling_unit_id IS NULL
    AND (${scope}::uuid[] IS NULL OR w.id=ANY(${scope}::uuid[])) AND (${stageLine}::uuid IS NULL OR (l.id,w.id)>(${stageLine}::uuid,${stageWarehouse}::uuid))
   GROUP BY l.id,w.id,w.name,i.name,u.code ORDER BY l.id,w.id LIMIT 51`);
  const posted=await tx.execute<{id:string;number:string;warehouseName:string;date:string}>(sql`SELECT d.id,d.number,w.name AS "warehouseName",d.business_date::text AS date
   FROM public.documents d JOIN public.warehouses w ON w.tenant_id=d.tenant_id AND w.id=d.warehouse_id
   WHERE d.tenant_id=${m.tenantId}::uuid AND d.source_kind='SALES_ORDER' AND d.source_id=${id}::uuid AND d.status='POSTED'
    AND (${scope}::uuid[] IS NULL OR d.warehouse_id=ANY(${scope}::uuid[])) ORDER BY d.created_at DESC,d.id DESC LIMIT 50`);
  const visibleTasks=tasks.slice(0,50),visibleStaged=staged.slice(0,50),lastStage=visibleStaged.at(-1);
  return {...headers[0],lines,tasks:visibleTasks,taskNext:tasks.length>50?visibleTasks.at(-1)!.id:null,staged:visibleStaged,stageNext:staged.length>50&&lastStage?`${lastStage.lineId}:${lastStage.warehouseId}`:null,posted};
 });
}
export async function previewShippingPick(params:Params,input:{taskId:string;barcode:string;quantity:string}){
 const taskId=uuidOf(input.taskId);
 return runTenantQuery({...params,permission:"stock.view"},async(tx,m)=>{
  const rows=await tx.execute<{item_id:string;warehouse_id:string;unit_code:string;quantity_scale:number}>(sql`SELECT t.item_id,t.warehouse_id,u.code AS unit_code,i.quantity_scale FROM public.warehouse_tasks t
   JOIN public.items i ON i.tenant_id=t.tenant_id AND i.id=t.item_id JOIN public.units u ON u.tenant_id=i.tenant_id AND u.id=i.base_unit_id
   WHERE t.tenant_id=${m.tenantId}::uuid AND t.id=${taskId}::uuid AND t.kind='PICK'`);
  const task=rows[0];if(!task)throw new AppError("NOT_FOUND");await assertWarehouseVisible(tx,m,[task.warehouse_id]);
  const barcode=await resolveBarcode(tx,m.tenantId,input.barcode);if(barcode.itemId!==task.item_id)throw new AppError("VALIDATION_FAILED",{detail:"SCAN_MISMATCH"});
  const quantity=scaledBaseQuantity(input.quantity,barcode.quantity,barcode.unitFactor);
  if(quantity%10n**BigInt(6-task.quantity_scale)!==0n)throw new AppError("VALIDATION_FAILED",{detail:"QUANTITY_SCALE"});
  return {baseQuantity:microToDecimal(quantity),unitCode:task.unit_code};
 });
}
