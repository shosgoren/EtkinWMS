import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import type { AccessTx } from "../identity/access.ts";
import { executeStockCommand,type StockDocCallParams,type StockCommandPlan } from "../stock/index.ts";
import { pgUuidArray } from "../warehouse/scope.ts";
import { DECIMAL_RE,decimalToMicro,fieldReasonOf,planFieldPosting,postFieldDocument,uuidOf,type FieldPostSpec } from "./field-posting.ts";
export interface WarehouseTransferInput {
 readonly sourceLocationId:string;readonly targetLocationId:string;readonly itemId:string;readonly quantity:string;
 readonly lotId?:string;readonly serialId?:string;readonly reason:string;readonly requestId?:string|null;
}
async function specifications(tx:AccessTx,tenantId:string,input:WarehouseTransferInput):Promise<readonly [FieldPostSpec,FieldPostSpec]> {
 const locations=await tx.execute<{id:string;warehouse_id:string}>(sql`SELECT id,warehouse_id FROM public.locations
  WHERE tenant_id=${tenantId}::uuid AND id=ANY(${pgUuidArray([input.sourceLocationId,input.targetLocationId])}::uuid[])`);
 const source=locations.find(l=>l.id===input.sourceLocationId),target=locations.find(l=>l.id===input.targetLocationId);
 if(!source || !target) throw new AppError("NOT_FOUND");
 if(source.warehouse_id===target.warehouse_id) throw new AppError("VALIDATION_FAILED");
 const items=await tx.execute<{base_unit_id:string}>(sql`SELECT base_unit_id FROM public.items WHERE tenant_id=${tenantId}::uuid AND id=${input.itemId}::uuid`);
 if(!items[0]) throw new AppError("NOT_FOUND");
 const line={itemId:input.itemId,unitId:items[0].base_unit_id,quantity:input.quantity,baseQuantity:input.quantity,conversionFactor:"1",stockStatus:"AVAILABLE" as const,targetStockStatus:null,sourceLineId:null,
  lotId:input.lotId??null,serialId:input.serialId??null};
 return [{kind:"STOCK_OUT",warehouseId:source.warehouse_id,sourceKind:null,sourceId:null,reason:input.reason,lines:[{...line,sourceLocationId:source.id,targetLocationId:null}]},
 {kind:"STOCK_IN",warehouseId:target.warehouse_id,sourceKind:null,sourceId:null,reason:input.reason,lines:[{...line,sourceLocationId:null,targetLocationId:target.id}]}];
}
export function mergeFieldPlans(plans:readonly StockCommandPlan[]):StockCommandPlan {
 return {warehouseIds:[...new Set(plans.flatMap(p=>p.warehouseIds))],locks:{locationIds:plans.flatMap(p=>p.locks.locationIds),dimensions:plans.flatMap(p=>p.locks.dimensions),reservationIds:plans.flatMap(p=>p.locks.reservationIds),serialIds:plans.flatMap(p=>p.locks.serialIds)}};
}
/** Both warehouse guards, both stock effects and both numbered documents commit or roll back together. */
export async function transferBetweenWarehouses(params:StockDocCallParams,input:WarehouseTransferInput) {
 const normalized={sourceLocationId:uuidOf(input.sourceLocationId),targetLocationId:uuidOf(input.targetLocationId),itemId:uuidOf(input.itemId),quantity:input.quantity,
  reason:fieldReasonOf(input.reason)??"",...(input.lotId?{lotId:uuidOf(input.lotId)}:{}),...(input.serialId?{serialId:uuidOf(input.serialId)}:{})};
 if(!normalized.reason || typeof input.quantity!=="string" || !DECIMAL_RE.test(input.quantity) || decimalToMicro(input.quantity)<=0n || normalized.sourceLocationId===normalized.targetLocationId) throw new AppError("VALIDATION_FAILED");
 const outcome=await executeStockCommand({...params,commandType:"stock.warehouse_transfer",permission:"stock.post",input:normalized,
  plan:async(tx,_i,m)=>{
   const specs=await specifications(tx,m.tenantId,normalized);
   const plans=[];for(const spec of specs)plans.push(await planFieldPosting(tx,m.tenantId,spec));return mergeFieldPlans(plans);
  },
  apply:async(tx,locked,ctx)=>{
   const [source,target]=await specifications(tx,ctx.tenantId,normalized);
   const out=await postFieldDocument(tx,locked,ctx,source,input.requestId??null);
   const into=await postFieldDocument(tx,locked,ctx,target,input.requestId??null);
   if(!out.numbering || !into.numbering || !into.audit) throw new AppError("INTERNAL");
   await tx.execute(sql`INSERT INTO public.stock_document_links(tenant_id,source_document_id,target_document_id,kind)
    VALUES(${ctx.tenantId}::uuid,${out.result.documentId}::uuid,${into.result.documentId}::uuid,'TRANSFER')`);
   await appendAudit(tx,{...into.audit,actorUserId:ctx.userId});
   return {...out,additionalNumbering:[into.numbering]};
  }});
 if(outcome.status!=="COMPLETED") throw new AppError("VERSION_CONFLICT");
 return {...outcome.result,replayed:outcome.replayed};
}
