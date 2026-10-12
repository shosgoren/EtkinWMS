import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { runTenantQuery,type AccessTx,type TenantAccessParams } from "../identity/access.ts";
import { hasPermission } from "../identity/permissions.ts";
import { assertItemsActive,EMPTY_LOCK_PLAN,executeStockCommand,type StockDocCallParams } from "../stock/index.ts";
import { mapCodeConflict } from "../warehouse/warehouses.ts";
import { pgUuidArray } from "../warehouse/scope.ts";
import { DECIMAL_RE,decimalToMicro,fieldReasonOf,microToDecimal,planFieldPosting,postFieldDocument,uuidOf,type FieldPostSpec } from "./field-posting.ts";
import { mergeFieldPlans } from "./warehouse-transfer.ts";
type ReadParams=Omit<TenantAccessParams,"permission"|"recentAuth">;
type RecipeLine={lineNo:number;itemId:string;itemCode:string;itemName:string;unitCode:string;trackingMode:string;quantity:string};
type Recipe={id:string;code:string;version:number;name:string;outputItemId:string;outputCode:string;outputName:string;unitCode:string;outputTrackingMode:string;outputQuantity:string};
function positive(value:string):string {
 if(typeof value!=="string" || !DECIMAL_RE.test(value) || decimalToMicro(value)<=0n)throw new AppError("VALIDATION_FAILED");return value;
}
function text(value:string,max:number):string {
 if(typeof value!=="string" || !value.trim() || Array.from(value.trim()).length>max || /\p{C}/u.test(value))throw new AppError("VALIDATION_FAILED");return value.trim();
}
/** Exact recipe scaling in micro-units; silently rounded consumption is forbidden. */
export function scaleRecipeQuantity(component:string,recipeOutput:string,requestedOutput:string):string {
 const numerator=decimalToMicro(positive(component))*decimalToMicro(positive(requestedOutput));
 const denominator=decimalToMicro(positive(recipeOutput));
 if(numerator%denominator!==0n)throw new AppError("VALIDATION_FAILED",{detail:"QUANTITY_SCALE"});
 return positive(microToDecimal(numerator/denominator));
}
async function readRecipe(tx:AccessTx,tenantId:string,recipeId:string) {
 const rows=await tx.execute<Recipe>(sql`SELECT r.id,r.code,r.version,r.name,r.output_item_id AS "outputItemId",i.code AS "outputCode",i.name AS "outputName",u.code AS "unitCode",i.tracking_mode AS "outputTrackingMode",r.output_quantity::text AS "outputQuantity"
 FROM public.production_recipes r JOIN public.items i ON i.tenant_id=r.tenant_id AND i.id=r.output_item_id
 JOIN public.units u ON u.tenant_id=i.tenant_id AND u.id=i.base_unit_id WHERE r.tenant_id=${tenantId}::uuid AND r.id=${recipeId}::uuid`);
 if(!rows[0])throw new AppError("NOT_FOUND");
 const lines=await tx.execute<RecipeLine>(sql`SELECT l.line_no AS "lineNo",l.item_id AS "itemId",i.code AS "itemCode",i.name AS "itemName",u.code AS "unitCode",i.tracking_mode AS "trackingMode",l.quantity::text AS quantity
 FROM public.production_recipe_lines l JOIN public.items i ON i.tenant_id=l.tenant_id AND i.id=l.item_id
 JOIN public.units u ON u.tenant_id=i.tenant_id AND u.id=i.base_unit_id WHERE l.tenant_id=${tenantId}::uuid AND l.recipe_id=${recipeId}::uuid ORDER BY l.line_no LIMIT 100`);
 return {...rows[0],lines};
}
export async function getProductionRecipe(params:ReadParams,recipeId:string) {
 const id=uuidOf(recipeId);return runTenantQuery({...params,permission:"stock.view"},(tx,m)=>readRecipe(tx,m.tenantId,id));
}
export async function listProductionRecipes(params:ReadParams,input:{q?:string;after?:string}={}) {
 const q=input.q??"";if(typeof q!=="string" || q.length>128)throw new AppError("VALIDATION_FAILED");
 const pattern=`%${q.replace(/[\\%_]/g,"\\$&")}%`,after=input.after?uuidOf(input.after):null;
 return runTenantQuery({...params,permission:"stock.view"},async(tx,m)=>{
  const rows=await tx.execute<Recipe>(sql`SELECT r.id,r.code,r.version,r.name,r.output_item_id AS "outputItemId",i.code AS "outputCode",i.name AS "outputName",u.code AS "unitCode",i.tracking_mode AS "outputTrackingMode",r.output_quantity::text AS "outputQuantity"
  FROM public.production_recipes r JOIN public.items i ON i.tenant_id=r.tenant_id AND i.id=r.output_item_id
  JOIN public.units u ON u.tenant_id=i.tenant_id AND u.id=i.base_unit_id
  WHERE r.tenant_id=${m.tenantId}::uuid AND (r.code ILIKE ${pattern} OR r.name ILIKE ${pattern}) AND (${after}::uuid IS NULL OR r.id>${after}::uuid)
  ORDER BY r.id LIMIT 51`);
  const items=rows.slice(0,50),last=items.at(-1);
  return {items,next:rows.length>50&&last?last.id:null,canCreate:hasPermission(m.roles,"settings.manage"),canPost:hasPermission(m.roles,"stock.post")};
 });
}
export interface CreateRecipeInput {readonly code:string;readonly version:number;readonly name:string;readonly outputItemId:string;readonly outputQuantity:string;readonly lines:readonly {readonly itemId:string;readonly quantity:string}[];readonly requestId?:string|null}
export async function createProductionRecipe(params:StockDocCallParams,input:CreateRecipeInput) {
 if(!Number.isSafeInteger(input.version)||input.version<1||input.version>2147483647||!Array.isArray(input.lines)||input.lines.length<1||input.lines.length>100)throw new AppError("VALIDATION_FAILED");
 const normalized={code:text(input.code,64),version:input.version,name:text(input.name,200),outputItemId:uuidOf(input.outputItemId),outputQuantity:positive(input.outputQuantity),lines:input.lines.map(l=>({itemId:uuidOf(l.itemId),quantity:positive(l.quantity)}))};
 if(normalized.lines.some(l=>l.itemId===normalized.outputItemId)||new Set(normalized.lines.map(l=>l.itemId)).size!==normalized.lines.length)throw new AppError("VALIDATION_FAILED");
 const outcome=await executeStockCommand({...params,commandType:"stock.production_recipe.create",permission:"settings.manage",input:normalized,
  plan:async()=>({warehouseIds:[],locks:EMPTY_LOCK_PLAN}),apply:async(tx,_locked,ctx)=>{
   const ids=[normalized.outputItemId,...normalized.lines.map(l=>l.itemId)].sort();await assertItemsActive(tx,ctx.tenantId,ids);
   const id=randomUUID();
   await tx.execute(sql`INSERT INTO public.production_recipes(tenant_id,id,code,version,name,output_item_id,output_quantity,created_by)
   VALUES(${ctx.tenantId}::uuid,${id}::uuid,${normalized.code},${normalized.version},${normalized.name},${normalized.outputItemId}::uuid,${normalized.outputQuantity}::numeric,${ctx.userId}::uuid)`);
   for(const [i,l] of normalized.lines.entries())await tx.execute(sql`INSERT INTO public.production_recipe_lines(tenant_id,recipe_id,line_no,item_id,quantity)
    VALUES(${ctx.tenantId}::uuid,${id}::uuid,${i+1},${l.itemId}::uuid,${l.quantity}::numeric)`);
   return {result:{documentId:id},audit:{action:"production_recipe.created",entityType:"production_recipe",entityId:id,requestId:input.requestId??null,changeSummary:{code:normalized.code,version:normalized.version,lineCount:normalized.lines.length}}};
  }}).catch((e:unknown)=>{throw mapCodeConflict(e);});
 if(outcome.status!=="COMPLETED")throw new AppError("VERSION_CONFLICT");return {recipeId:outcome.result.documentId as string,replayed:outcome.replayed};
}
export interface ProduceInput {readonly recipeId:string;readonly outputQuantity:string;readonly targetLocationId:string;readonly sources:readonly {readonly lineNo:number;readonly locationId:string;readonly lotId?:string;readonly serialId?:string}[];readonly outputLotId?:string;readonly outputSerialId?:string;readonly reason:string;readonly requestId?:string|null}
async function productionSpecs(tx:AccessTx,tenantId:string,input:ProduceInput):Promise<readonly FieldPostSpec[]> {
 const recipe=await readRecipe(tx,tenantId,input.recipeId);
 if(recipe.lines.length!==input.sources.length)throw new AppError("VALIDATION_FAILED");
 const locations=await tx.execute<{id:string;warehouse_id:string}>(sql`SELECT id,warehouse_id FROM public.locations WHERE tenant_id=${tenantId}::uuid AND id=ANY(${pgUuidArray([...input.sources.map(s=>s.locationId),input.targetLocationId])}::uuid[])`);
 const target=locations.find(l=>l.id===input.targetLocationId);if(!target)throw new AppError("NOT_FOUND");
 const items=await tx.execute<{id:string;base_unit_id:string}>(sql`SELECT id,base_unit_id FROM public.items WHERE tenant_id=${tenantId}::uuid AND id=ANY(${pgUuidArray([recipe.outputItemId,...recipe.lines.map(l=>l.itemId)])}::uuid[])`);
 const base=(itemId:string,quantity:string)=>{const item=items.find(i=>i.id===itemId);if(!item)throw new AppError("NOT_FOUND");return {itemId,unitId:item.base_unit_id,quantity,baseQuantity:quantity,conversionFactor:"1",stockStatus:"AVAILABLE" as const,targetStockStatus:null,sourceLineId:null};};
 const groups=new Map<string,FieldPostSpec["lines"][number][]>();
 for(const l of recipe.lines){const source=input.sources.find(s=>s.lineNo===l.lineNo),location=locations.find(loc=>loc.id===source?.locationId);
  if(!location)throw new AppError("NOT_FOUND");const group=groups.get(location.warehouse_id)??[];
  group.push({...base(l.itemId,scaleRecipeQuantity(l.quantity,recipe.outputQuantity,input.outputQuantity)),sourceLocationId:location.id,targetLocationId:null,lotId:source?.lotId??null,serialId:source?.serialId??null});groups.set(location.warehouse_id,group);}
 return [...[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([warehouseId,lines]):FieldPostSpec=>({kind:"STOCK_OUT",warehouseId,sourceKind:null,sourceId:null,reason:input.reason,lines})),
 {kind:"STOCK_IN",warehouseId:target.warehouse_id,sourceKind:null,sourceId:null,reason:input.reason,lines:[{...base(recipe.outputItemId,input.outputQuantity),sourceLocationId:null,targetLocationId:target.id,lotId:input.outputLotId??null,serialId:input.outputSerialId??null}]}];
}
export async function produceFromRecipe(params:StockDocCallParams,input:ProduceInput) {
 if(!Array.isArray(input.sources)||input.sources.length<1||input.sources.length>100)throw new AppError("VALIDATION_FAILED");
 const normalized={recipeId:uuidOf(input.recipeId),outputQuantity:positive(input.outputQuantity),targetLocationId:uuidOf(input.targetLocationId),reason:fieldReasonOf(input.reason)??"",
 ...(input.outputLotId?{outputLotId:uuidOf(input.outputLotId)}:{}),...(input.outputSerialId?{outputSerialId:uuidOf(input.outputSerialId)}:{}),
 sources:input.sources.map(s=>{if(!Number.isInteger(s.lineNo)||s.lineNo<1||s.lineNo>100)throw new AppError("VALIDATION_FAILED");return {lineNo:s.lineNo,locationId:uuidOf(s.locationId),...(s.lotId?{lotId:uuidOf(s.lotId)}:{}),...(s.serialId?{serialId:uuidOf(s.serialId)}:{})};}).sort((a,b)=>a.lineNo-b.lineNo)};
 if(!normalized.reason||new Set(normalized.sources.map(s=>s.lineNo)).size!==normalized.sources.length)throw new AppError("VALIDATION_FAILED");
 const outcome=await executeStockCommand({...params,commandType:"stock.production.post",permission:"stock.post",input:normalized,
 plan:async(tx,_i,m)=>{const specs=await productionSpecs(tx,m.tenantId,normalized),plans=[];for(const spec of specs)plans.push(await planFieldPosting(tx,m.tenantId,spec));return mergeFieldPlans(plans);},
 apply:async(tx,locked,ctx)=>{
  const specs=await productionSpecs(tx,ctx.tenantId,normalized),applied=[];
  for(const spec of specs)applied.push(await postFieldDocument(tx,locked,ctx,spec,input.requestId??null));
  const into=applied.pop();if(!into?.numbering)throw new AppError("INTERNAL");
  const numberings=[];
  for(const out of applied){
   if(!out.numbering||!out.audit)throw new AppError("INTERNAL");
   await tx.execute(sql`INSERT INTO public.stock_document_links(tenant_id,source_document_id,target_document_id,kind,recipe_id)
    VALUES(${ctx.tenantId}::uuid,${out.result.documentId}::uuid,${into.result.documentId}::uuid,'PRODUCTION',${normalized.recipeId}::uuid)`);
   await appendAudit(tx,{...out.audit,actorUserId:ctx.userId});numberings.push(out.numbering);
  }
  return {...into,additionalNumbering:numberings};
 }});
 if(outcome.status!=="COMPLETED")throw new AppError("VERSION_CONFLICT");return {...outcome.result,replayed:outcome.replayed};
}
