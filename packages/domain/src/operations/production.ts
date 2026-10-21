import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { runTenantQuery,type AccessTx,type TenantAccessParams } from "../identity/access.ts";
import { hasPermission } from "../identity/permissions.ts";
import { assertItemsActive,EMPTY_LOCK_PLAN,executeStockCommand,postApprovedDocumentInTx,type StockDocCallParams } from "../stock/index.ts";
import { validatePackageReceiptInput, encodePackageQr, type PackageReceiptRow } from "./package-receipt-input.ts";
import { parsePackageMovementInput, readPackageState, assertPackageCurrent, packageQuantityForBase, packageWarehouseIds } from "./package-movement.ts";
import { buildPostCommand } from "../stock/posting.ts";
import { mapCodeConflict } from "../warehouse/warehouses.ts";
import { assertWarehouseVisible, pgUuidArray } from "../warehouse/scope.ts";
import { DECIMAL_RE,decimalToMicro,fieldReasonOf,microToDecimal,planFieldPosting,postFieldDocument,prepareFieldDocument,uuidOf,type FieldPostSpec } from "./field-posting.ts";
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
/** `withTotal: true` → aynı işlemde aynı arama süzgeciyle (imleç hariç) toplam reçete sayısı da döner (ALTIN-KURAL 15). */
export async function listProductionRecipes(params:ReadParams,input:{q?:string;after?:string;withTotal?:boolean}={}) {
 const q=input.q??"";if(typeof q!=="string" || q.length>128)throw new AppError("VALIDATION_FAILED");
 const pattern=`%${q.replace(/[\\%_]/g,"\\$&")}%`,after=input.after?uuidOf(input.after):null;
 return runTenantQuery({...params,permission:"stock.view"},async(tx,m)=>{
  const from=sql`FROM public.production_recipes r JOIN public.items i ON i.tenant_id=r.tenant_id AND i.id=r.output_item_id
  JOIN public.units u ON u.tenant_id=i.tenant_id AND u.id=i.base_unit_id
  WHERE r.tenant_id=${m.tenantId}::uuid AND (r.code ILIKE ${pattern} OR r.name ILIKE ${pattern})`;
  const rows=await tx.execute<Recipe>(sql`SELECT r.id,r.code,r.version,r.name,r.output_item_id AS "outputItemId",i.code AS "outputCode",i.name AS "outputName",u.code AS "unitCode",i.tracking_mode AS "outputTrackingMode",r.output_quantity::text AS "outputQuantity"
  ${from} AND (${after}::uuid IS NULL OR r.id>${after}::uuid)
  ORDER BY r.id LIMIT 51`);
  const items=rows.slice(0,50),last=items.at(-1);
  const total=input.withTotal===true?Number((await tx.execute<{n:number|string}>(sql`SELECT count(*)::int AS n ${from}`))[0]?.n??0):undefined;
  return {items,next:rows.length>50&&last?last.id:null,...(total===undefined?{}:{total}),canCreate:hasPermission(m.roles, "settings.manage", m.grants),canPost:hasPermission(m.roles, "stock.post", m.grants)};
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

// T-961: physical-package production transport accepts identities/versions, never server stock facts.
export interface ProducePackageInput {
 readonly recipeId:string; readonly recipeVersion:number; readonly outputQuantity:string; readonly targetLocationId:string;
 readonly inputs:readonly {readonly packageId:string;readonly predecessorVersion:number;readonly currentBalanceVersion:string;readonly baseQuantity:string}[];
 readonly outputs:{readonly kind:"KOLI"|"VARIL";readonly packages:unknown};readonly requestId?:string|null;
}
function packageProductionRecord(raw:unknown,keys:readonly string[]):Record<string,unknown> {
 if(raw===null||typeof raw!=="object"||Array.isArray(raw))throw new AppError("VALIDATION_FAILED");
 const proto:unknown=Object.getPrototypeOf(raw);if(proto!==Object.prototype&&proto!==null)throw new AppError("VALIDATION_FAILED");
 const r=raw as Record<string,unknown>;if(Object.keys(r).some(k=>!keys.includes(k)))throw new AppError("VALIDATION_FAILED");return r;
}
/** Canonical payload expands container quantities without issuing any output identity. */
export function parseProducePackageInput(raw:unknown) {
 const r=packageProductionRecord(raw,["recipeId","recipeVersion","outputQuantity","targetLocationId","inputs","outputs","requestId"]);
 if(typeof r.recipeVersion!=="number"||!Number.isSafeInteger(r.recipeVersion)||r.recipeVersion<1||r.recipeVersion>2147483647)throw new AppError("VALIDATION_FAILED");
 if(r.requestId!==undefined&&r.requestId!==null&&(typeof r.requestId!=="string"||r.requestId.length>200||/\p{C}/u.test(r.requestId)))throw new AppError("VALIDATION_FAILED");
 if(!Array.isArray(r.inputs)||r.inputs.length<1||r.inputs.length>200)throw new AppError("VALIDATION_FAILED");
 const inputs=r.inputs.map((rawInput:unknown)=>{
  const i=packageProductionRecord(rawInput,["packageId","predecessorVersion","currentBalanceVersion","baseQuantity"]);
  const v=parsePackageMovementInput({packageId:i.packageId,predecessorVersion:i.predecessorVersion,currentBalanceVersion:i.currentBalanceVersion},"QC_RELEASE");
  if(typeof i.baseQuantity!=="string")throw new AppError("VALIDATION_FAILED");
  return {packageId:v.packageId,predecessorVersion:v.predecessorVersion,currentBalanceVersion:v.currentBalanceVersion,baseQuantity:microToDecimal(decimalToMicro(positive(i.baseQuantity)))};
 }).sort((a,b)=>a.packageId.localeCompare(b.packageId));
 if(new Set(inputs.map(i=>i.packageId)).size!==inputs.length)throw new AppError("VALIDATION_FAILED");
 const output=packageProductionRecord(r.outputs,["kind","packages"]);if(output.kind!=="KOLI"&&output.kind!=="VARIL")throw new AppError("VALIDATION_FAILED");
 const packages=validatePackageReceiptInput(output.packages,{quantityScale:6,toBaseFactor:"1",trackingMode:"NONE"}).packages;
 if(typeof r.outputQuantity!=="string")throw new AppError("VALIDATION_FAILED");const outputQuantity=microToDecimal(decimalToMicro(positive(r.outputQuantity)));
 if(packages.reduce((sum,p)=>sum+decimalToMicro(p.quantity),0n)!==decimalToMicro(outputQuantity))throw new AppError("VALIDATION_FAILED");
 return {recipeId:uuidOf(r.recipeId),recipeVersion:r.recipeVersion,outputQuantity,targetLocationId:uuidOf(r.targetLocationId),inputs,outputs:{kind:output.kind,packages}};
}
type PackageProductionValue=ReturnType<typeof parseProducePackageInput>;
export interface PackageProductionPreview {
 readonly recipeId:string;readonly recipeVersion:number;readonly recipeCode:string;readonly outputItemId:string;readonly outputItemCode:string;readonly outputItemName:string;
 readonly outputQuantity:string;readonly outputUnitId:string;readonly outputUnitCode:string;readonly sourceWarehouseId:string;readonly targetWarehouseId:string;
 readonly components:readonly {readonly itemId:string;readonly itemCode:string;readonly itemName:string;readonly unitCode:string;readonly requiredBaseQuantity:string;readonly allocatedBaseQuantity:string}[];
 readonly inputs:readonly {readonly packageId:string;readonly warehouseId:string;readonly locationId:string;readonly itemId:string;readonly originBaseQuantity:string;readonly remainingBaseQuantity:string;readonly consumeBaseQuantity:string;readonly predecessorVersion:number;readonly currentBalanceVersion:string}[];
 readonly outputs:readonly {readonly packageNo:number;readonly kind:string;readonly baseQuantity:string;readonly lotCode:string|null;readonly producedOn:string|null;readonly expiresOn:string|null}[];
}

export interface ProductionPackageView {
 readonly id:string;readonly qr:string;readonly packageNo:number;readonly kind:string;readonly documentLineId:string;
 readonly itemId:string;readonly itemCode:string;readonly itemName:string;readonly unitId:string;readonly unitCode:string;readonly unitName:string;
 readonly quantity:string;readonly conversionFactor:string;readonly baseQuantity:string;readonly targetLocationId:string;readonly stockStatus:string;
 readonly lotId:string|null;readonly lotCode:string|null;readonly producedOn:string|null;readonly expiresOn:string|null;
}
export interface PackageProductionBatchView {
 readonly batchId:string;readonly documentId:string;readonly documentStatus:"APPROVED"|"POSTED";readonly documentVersion:number;readonly documentNumber:string|null;
 readonly recipeId:string;readonly recipeVersion:number;readonly recipeCode:string;readonly warehouseId:string;readonly targetLocationId:string;
 readonly outputQuantity:string;readonly packages:readonly ProductionPackageView[];
}
/** Read-only posted output labels: authorized output warehouse, sealed origin quantities, never a synthetic receipt. */
export async function getPackageProductionBatch(params:ReadParams,input:{readonly documentId:string}):Promise<PackageProductionBatchView> {
 const raw=packageProductionRecord(input,["documentId"]),documentId=uuidOf(raw.documentId);
 return runTenantQuery({...params,permission:"stock.view"},async(tx,m)=>{
  const heads=await tx.execute<{batch_id:string;document_status:string;document_version:number;source_status:string|null;document_number:string|null;recipe_id:string;recipe_version:number;recipe_code:string;warehouse_id:string;target_location_id:string;output_quantity:string}>(sql`SELECT b.id AS batch_id,d.status AS document_status,d.version AS document_version,s.status AS source_status,d.number AS document_number,b.recipe_id,r.version AS recipe_version,r.code AS recipe_code,d.warehouse_id,b.target_location_id,b.output_quantity::text
   FROM public.production_batches b JOIN public.documents d ON d.tenant_id=b.tenant_id AND d.id=b.output_document_id
   LEFT JOIN public.stock_document_links link ON link.tenant_id=b.tenant_id AND link.target_document_id=b.output_document_id AND link.kind='PRODUCTION'
   LEFT JOIN public.documents s ON s.tenant_id=link.tenant_id AND s.id=link.source_document_id
   JOIN public.production_recipes r ON r.tenant_id=b.tenant_id AND r.id=b.recipe_id WHERE b.tenant_id=${m.tenantId}::uuid AND d.id=${documentId}::uuid`);
  const h=heads[0];if(h===undefined)throw new AppError("NOT_FOUND");await assertWarehouseVisible(tx,m,[h.warehouse_id]);
  if((h.document_status!=="APPROVED"&&h.document_status!=="POSTED")||(h.document_status==="POSTED"&&(h.source_status!=="POSTED"||h.document_number===null)))throw new AppError("VALIDATION_FAILED",{detail:"DOCUMENT_STATE"});
  const rows=await tx.execute<{id:string;package_no:number;kind:string;document_line_id:string;item_id:string;item_code:string;item_name:string;unit_id:string;unit_code:string;unit_name:string;quantity:string;conversion_factor:string;base_quantity:string;target_location_id:string;stock_status:string;lot_id:string|null;lot_code:string|null;produced_on:string|null;expires_on:string|null}>(sql`SELECT p.id,p.package_no,hu.kind,p.document_line_id,l.item_id,i.code AS item_code,i.name AS item_name,l.unit_id,u.code AS unit_code,u.name AS unit_name,l.quantity::text,l.conversion_factor::text,l.base_quantity::text,l.target_location_id,l.stock_status,l.lot_id,p.lot_code,p.produced_on::text,p.expires_on::text
   FROM public.production_packages p JOIN public.document_lines l ON l.tenant_id=p.tenant_id AND l.id=p.document_line_id AND l.document_id=p.document_id
   JOIN public.handling_units hu ON hu.tenant_id=p.tenant_id AND hu.id=p.id
   JOIN public.items i ON i.tenant_id=l.tenant_id AND i.id=l.item_id JOIN public.units u ON u.tenant_id=l.tenant_id AND u.id=l.unit_id
   WHERE p.tenant_id=${m.tenantId}::uuid AND p.production_batch_id=${h.batch_id}::uuid ORDER BY p.package_no`);
  return {batchId:h.batch_id,documentId,documentStatus:h.document_status as "APPROVED"|"POSTED",documentVersion:Number(h.document_version),documentNumber:h.document_number,recipeId:h.recipe_id,recipeVersion:Number(h.recipe_version),recipeCode:h.recipe_code,warehouseId:h.warehouse_id,targetLocationId:h.target_location_id,outputQuantity:h.output_quantity,
   packages:rows.map(r=>({id:r.id,qr:encodePackageQr(r.id),packageNo:Number(r.package_no),kind:r.kind,documentLineId:r.document_line_id,itemId:r.item_id,itemCode:r.item_code,itemName:r.item_name,unitId:r.unit_id,unitCode:r.unit_code,unitName:r.unit_name,quantity:r.quantity,conversionFactor:r.conversion_factor,baseQuantity:r.base_quantity,targetLocationId:r.target_location_id,stockStatus:r.stock_status,lotId:r.lot_id,lotCode:r.lot_code,producedOn:r.produced_on,expiresOn:r.expires_on}))};
 });
}

type OutputSnapshot=PackageReceiptRow & {readonly lotId:string|null};
async function productionOutputSnapshots(tx:AccessTx,tenantId:string,itemId:string,rows:readonly PackageReceiptRow[],trackingMode:string):Promise<OutputSnapshot[]> {
 if(trackingMode==="NONE")return rows.map(r=>({...r,lotId:null}));
 const resolved=new Map<string,{id:string|null;produced:string|null;expires:string|null}>();
 for(const code of [...new Set(rows.map(r=>r.lotCode as string))].sort()){
  const same=rows.filter(r=>r.lotCode===code),produced=[...new Set(same.flatMap(r=>r.producedOn===undefined?[]:[r.producedOn]))],expires=[...new Set(same.flatMap(r=>r.expiresOn===undefined?[]:[r.expiresOn]))];
  if(produced.length>1||expires.length>1)throw new AppError("VALIDATION_FAILED");
  const found=await tx.execute<{id:string;produced:string|null;expires:string|null}>(sql`SELECT id,production_date::text AS produced,expiry_date::text AS expires FROM public.lots WHERE tenant_id=${tenantId}::uuid AND item_id=${itemId}::uuid AND lot_code=${code}`);
  const existing=found[0];if(existing!==undefined&&((produced[0]!==undefined&&produced[0]!==existing.produced)||(expires[0]!==undefined&&expires[0]!==existing.expires)))throw new AppError("VALIDATION_FAILED");
  resolved.set(code,existing??{id:null,produced:produced[0]??null,expires:expires[0]??null});
 }
 return rows.map(r=>{const lot=resolved.get(r.lotCode as string);if(lot===undefined)throw new AppError("INTERNAL");return {quantity:r.quantity,baseQuantity:r.baseQuantity,lotCode:r.lotCode,lotId:lot.id,...(lot.produced===null?{}:{producedOn:lot.produced}),...(lot.expires===null?{}:{expiresOn:lot.expires})};});
}
async function packageProductionContext(tx:AccessTx,tenantId:string,value:PackageProductionValue) {
 const recipe=await readRecipe(tx,tenantId,value.recipeId);if(recipe.version!==value.recipeVersion)throw new AppError("VERSION_CONFLICT",{retryable:true});
 const rows=await tx.execute<{base_unit_id:string;unit_code:string;quantity_scale:number;tracking_mode:"NONE"|"LOT"|"SERIAL"|"LOT_AND_SERIAL";status:string}>(sql`SELECT i.base_unit_id,u.code AS unit_code,i.quantity_scale,i.tracking_mode,i.status FROM public.items i JOIN public.units u ON u.tenant_id=i.tenant_id AND u.id=i.base_unit_id WHERE i.tenant_id=${tenantId}::uuid AND i.id=${recipe.outputItemId}::uuid`);
 const outputItem=rows[0];if(outputItem===undefined)throw new AppError("NOT_FOUND");if(outputItem.status!=="ACTIVE")throw new AppError("VALIDATION_FAILED");
 const outputRows=validatePackageReceiptInput({mode:"explicit",packages:value.outputs.packages.map(r=>({quantity:r.quantity,...(r.lotCode===undefined?{}:{lotCode:r.lotCode}),...(r.producedOn===undefined?{}:{producedOn:r.producedOn}),...(r.expiresOn===undefined?{}:{expiresOn:r.expiresOn})}))},{quantityScale:Number(outputItem.quantity_scale),toBaseFactor:"1",trackingMode:outputItem.tracking_mode}).packages;
 const outputs=await productionOutputSnapshots(tx,tenantId,recipe.outputItemId,outputRows,outputItem.tracking_mode);
 const targetRows=await tx.execute<{warehouse_id:string;kind:string;status:string}>(sql`SELECT warehouse_id,kind,status FROM public.locations WHERE tenant_id=${tenantId}::uuid AND id=${value.targetLocationId}::uuid`);
 const target=targetRows[0];if(target===undefined)throw new AppError("NOT_FOUND");if(target.status!=="ACTIVE"||target.kind!=="STORAGE")throw new AppError("VALIDATION_FAILED");
 const inputs:{allocation:PackageProductionValue["inputs"][number];state:Awaited<ReturnType<typeof readPackageState>>}[]=[];for(const allocation of value.inputs){
  const state=await readPackageState(tx,tenantId,allocation.packageId);
  if(state.sequence_no!==allocation.predecessorVersion||state.balance_version!==allocation.currentBalanceVersion)throw new AppError("VERSION_CONFLICT",{retryable:true});
  if(state.stock_status!=="AVAILABLE"||decimalToMicro(state.reserved_quantity)!==0n||decimalToMicro(allocation.baseQuantity)>decimalToMicro(state.remaining_base_quantity)||!recipe.lines.some(l=>l.itemId===state.item_id))throw new AppError("VALIDATION_FAILED");
  inputs.push({allocation,state});
 }
 const warehouseIds=[...new Set(inputs.map(i=>i.state.warehouse_id))];if(warehouseIds.length!==1||recipe.lines.length===0)throw new AppError("VALIDATION_FAILED");
 const sourceWarehouseId=warehouseIds[0];if(sourceWarehouseId===undefined)throw new AppError("INTERNAL");
 const components=recipe.lines.map(l=>{const requiredBaseQuantity=scaleRecipeQuantity(l.quantity,recipe.outputQuantity,value.outputQuantity),allocated=inputs.filter(i=>i.state.item_id===l.itemId).reduce((sum,i)=>sum+decimalToMicro(i.allocation.baseQuantity),0n);if(allocated!==decimalToMicro(requiredBaseQuantity))throw new AppError("VALIDATION_FAILED");return {itemId:l.itemId,itemCode:l.itemCode,itemName:l.itemName,unitCode:l.unitCode,requiredBaseQuantity,allocatedBaseQuantity:microToDecimal(allocated)};});
 return {recipe,outputItem,outputs,inputs,sourceWarehouseId,targetWarehouseId:target.warehouse_id,components};
}
export async function previewPackageProduction(params:ReadParams,input:ProducePackageInput):Promise<PackageProductionPreview> {
 const value=parseProducePackageInput(input);return runTenantQuery({...params,permission:"stock.view"},async(tx,m)=>{
  const c=await packageProductionContext(tx,m.tenantId,value);await assertWarehouseVisible(tx,m,[c.sourceWarehouseId,c.targetWarehouseId]);
  return {recipeId:c.recipe.id,recipeVersion:c.recipe.version,recipeCode:c.recipe.code,outputItemId:c.recipe.outputItemId,outputItemCode:c.recipe.outputCode,outputItemName:c.recipe.outputName,outputQuantity:value.outputQuantity,outputUnitId:c.outputItem.base_unit_id,outputUnitCode:c.outputItem.unit_code,sourceWarehouseId:c.sourceWarehouseId,targetWarehouseId:c.targetWarehouseId,components:c.components,
   inputs:c.inputs.map(({allocation,state})=>({packageId:allocation.packageId,warehouseId:state.warehouse_id,locationId:state.location_id,itemId:state.item_id,originBaseQuantity:state.base_quantity,remainingBaseQuantity:state.remaining_base_quantity,consumeBaseQuantity:allocation.baseQuantity,predecessorVersion:state.sequence_no,currentBalanceVersion:state.balance_version})),
   outputs:c.outputs.map((r,i)=>({packageNo:i+1,kind:value.outputs.kind,baseQuantity:r.baseQuantity,lotCode:r.lotCode??null,producedOn:r.producedOn??null,expiresOn:r.expiresOn??null}))};
 });
}

async function materializeProductionLots(tx:AccessTx,tenantId:string,itemId:string,rows:readonly OutputSnapshot[]):Promise<OutputSnapshot[]> {
 const lots=new Map<string,{id:string;produced:string|null;expires:string|null}>();
 for(const code of [...new Set(rows.filter(r=>r.lotCode!==undefined&&r.lotId===null).map(r=>r.lotCode as string))].sort()){
  const group=rows.filter(r=>r.lotCode===code),first=group[0];if(first===undefined)throw new AppError("INTERNAL");
  const lotId=randomUUID();await tx.execute(sql`INSERT INTO public.lots(tenant_id,id,item_id,lot_code,production_date,expiry_date) VALUES(${tenantId}::uuid,${lotId}::uuid,${itemId}::uuid,${code},${first.producedOn??null}::date,${first.expiresOn??null}::date) ON CONFLICT ON CONSTRAINT lots_tenant_item_lot_code_key DO NOTHING`);
  const found=await tx.execute<{id:string;produced:string|null;expires:string|null}>(sql`SELECT id,production_date::text AS produced,expiry_date::text AS expires FROM public.lots WHERE tenant_id=${tenantId}::uuid AND item_id=${itemId}::uuid AND lot_code=${code}`);
  const lot=found[0];if(lot===undefined)throw new AppError("VERSION_CONFLICT",{retryable:true});if((first.producedOn??null)!==lot.produced||(first.expiresOn??null)!==lot.expires)throw new AppError("VALIDATION_FAILED");lots.set(code,lot);
 }
 return rows.map(r=>r.lotCode!==undefined&&r.lotId===null?{...r,lotId:lots.get(r.lotCode)?.id??null}:r);
}
export async function preparePackageProduction(params:StockDocCallParams,input:ProducePackageInput) {
 const value=parseProducePackageInput(input);
 const outcome=await executeStockCommand({...params,commandType:"package.production.prepare",permission:"stock.post",input:value,
  // Planning authorizes current warehouses only. Mutable business validation belongs to NEW apply,
  // so completed identical prepares remain recoverable after an input version advances.
  plan:async(tx,_i,m)=>{
   const warehouseIds:string[]=[];
   for(const allocation of value.inputs)warehouseIds.push(...await packageWarehouseIds(tx,m.tenantId,allocation.packageId));
   const target=await tx.execute<{warehouse_id:string}>(sql`SELECT warehouse_id FROM public.locations WHERE tenant_id=${m.tenantId}::uuid AND id=${value.targetLocationId}::uuid`);
   warehouseIds.push(...target.map(row=>row.warehouse_id));
   return {warehouseIds:[...new Set(warehouseIds)],locks:EMPTY_LOCK_PLAN};
  },
  apply:async(tx,_locked,ctx)=>{
   const c=await packageProductionContext(tx,ctx.tenantId,value),batchId=randomUUID();
   const outputs=c.outputItem.tracking_mode==="LOT"?await materializeProductionLots(tx,ctx.tenantId,c.recipe.outputItemId,c.outputs):c.outputs;
   const allocated=outputs.map(row=>({...row,id:randomUUID()}));
   for(const row of allocated)await tx.execute(sql`INSERT INTO public.handling_units(tenant_id,id,kind,code,package_production_id) VALUES(${ctx.tenantId}::uuid,${row.id}::uuid,${value.outputs.kind},${row.id},${batchId}::uuid)`);
   const spec:FieldPostSpec={kind:"STOCK_IN",warehouseId:c.targetWarehouseId,sourceKind:null,sourceId:null,reason:"PACKAGE_PRODUCTION",lines:allocated.map(row=>({itemId:c.recipe.outputItemId,unitId:c.outputItem.base_unit_id,quantity:row.quantity,conversionFactor:"1.000000",baseQuantity:row.baseQuantity,handlingUnitId:row.id,lotId:row.lotId,sourceLocationId:null,targetLocationId:value.targetLocationId,stockStatus:"AVAILABLE",targetStockStatus:null,sourceLineId:null}))};
   const prepared=await prepareFieldDocument(tx,ctx,spec);
   await tx.execute(sql`INSERT INTO public.production_batches(tenant_id,id,recipe_id,output_document_id,target_location_id,output_quantity) VALUES(${ctx.tenantId}::uuid,${batchId}::uuid,${value.recipeId}::uuid,${prepared.documentId}::uuid,${value.targetLocationId}::uuid,${value.outputQuantity}::numeric)`);
   for(const [i,row] of allocated.entries()){
    const lineId=prepared.lineIds[i];if(lineId===undefined)throw new AppError("INTERNAL");
    await tx.execute(sql`INSERT INTO public.production_packages(tenant_id,id,production_batch_id,document_id,document_line_id,package_no,lot_code,produced_on,expires_on,catalog_lot_id) VALUES(${ctx.tenantId}::uuid,${row.id}::uuid,${batchId}::uuid,${prepared.documentId}::uuid,${lineId}::uuid,${i+1},${row.lotCode??null},${row.producedOn??null}::date,${row.expiresOn??null}::date,${row.lotId}::uuid)`);
   }
   for(const {allocation,state} of c.inputs)await tx.execute(sql`INSERT INTO public.production_inputs(tenant_id,production_batch_id,handling_unit_id,previous_document_line_id,sequence_no,current_balance_version,base_quantity)
    VALUES(${ctx.tenantId}::uuid,${batchId}::uuid,${allocation.packageId}::uuid,${state.previous_document_line_id}::uuid,${state.sequence_no+1},${state.balance_version}::bigint,${allocation.baseQuantity}::numeric)`);
   return {result:{documentId:prepared.documentId,status:"APPROVED" as const},audit:{action:"stock_document.created" as const,entityType:"stock_document",entityId:prepared.documentId,requestId:input.requestId??null,changeSummary:{kind:"STOCK_IN",lineCount:allocated.length,recipeId:value.recipeId,batchId}}};
  }});
 if(outcome.status!=="COMPLETED")throw new AppError("VERSION_CONFLICT",{retryable:true});return {...outcome.result,replayed:outcome.replayed};
}
export interface PostPackageProductionInput {readonly documentId:string;readonly expectedVersion:number;readonly requestId?:string|null}
async function preparedProduction(tx:AccessTx,tenantId:string,documentId:string) {
 const heads=await tx.execute<{id:string;recipe_id:string;recipe_version:number;output_quantity:string;target_location_id:string;warehouse_id:string;kind:"KOLI"|"VARIL"}>(sql`SELECT b.id,b.recipe_id,r.version AS recipe_version,b.output_quantity::text,b.target_location_id,d.warehouse_id,(SELECT hu.kind FROM public.production_packages p JOIN public.handling_units hu ON hu.tenant_id=p.tenant_id AND hu.id=p.id WHERE p.tenant_id=b.tenant_id AND p.production_batch_id=b.id ORDER BY p.package_no LIMIT 1) AS kind FROM public.production_batches b JOIN public.production_recipes r ON r.tenant_id=b.tenant_id AND r.id=b.recipe_id JOIN public.documents d ON d.tenant_id=b.tenant_id AND d.id=b.output_document_id WHERE b.tenant_id=${tenantId}::uuid AND b.output_document_id=${documentId}::uuid`);
 const h=heads[0];if(h===undefined)throw new AppError("NOT_FOUND");
 const inputs=await tx.execute<{package_id:string;sequence_no:number;version:string;base_quantity:string;previous_document_line_id:string;warehouse_id:string}>(sql`SELECT p.handling_unit_id AS package_id,p.sequence_no,p.current_balance_version::text AS version,p.base_quantity::text,p.previous_document_line_id,loc.warehouse_id FROM public.production_inputs p JOIN public.document_lines l ON l.tenant_id=p.tenant_id AND l.id=p.previous_document_line_id JOIN public.locations loc ON loc.tenant_id=l.tenant_id AND loc.id=coalesce(l.target_location_id,l.source_location_id) WHERE p.tenant_id=${tenantId}::uuid AND p.production_batch_id=${h.id}::uuid ORDER BY p.handling_unit_id`);
 const outputs=await tx.execute<{quantity:string;lot_code:string|null;produced_on:string|null;expires_on:string|null}>(sql`SELECT l.quantity::text,p.lot_code,p.produced_on::text,p.expires_on::text FROM public.production_packages p JOIN public.document_lines l ON l.tenant_id=p.tenant_id AND l.id=p.document_line_id WHERE p.tenant_id=${tenantId}::uuid AND p.production_batch_id=${h.id}::uuid ORDER BY p.package_no`);
 const value=parseProducePackageInput({recipeId:h.recipe_id,recipeVersion:Number(h.recipe_version),outputQuantity:h.output_quantity,targetLocationId:h.target_location_id,inputs:inputs.map(i=>({packageId:i.package_id,predecessorVersion:Number(i.sequence_no)-1,currentBalanceVersion:i.version,baseQuantity:i.base_quantity})),outputs:{kind:h.kind,packages:{mode:"explicit",packages:outputs.map(o=>({quantity:o.quantity,...(o.lot_code===null?{}:{lotCode:o.lot_code}),...(o.produced_on===null?{}:{producedOn:o.produced_on}),...(o.expires_on===null?{}:{expiresOn:o.expires_on})}))}}});
 return {h,inputs,value};
}
export async function postPackageProduction(params:StockDocCallParams,input:PostPackageProductionInput) {
 const raw=packageProductionRecord(input,["documentId","expectedVersion","requestId"]),documentId=uuidOf(raw.documentId);
 if(raw.requestId!==undefined&&raw.requestId!==null&&(typeof raw.requestId!=="string"||raw.requestId.length>200||/\p{C}/u.test(raw.requestId)))throw new AppError("VALIDATION_FAILED");
 if(typeof raw.expectedVersion!=="number"||!Number.isSafeInteger(raw.expectedVersion)||raw.expectedVersion<1)throw new AppError("VALIDATION_FAILED");
 const expectedVersion=raw.expectedVersion;
 const outcome=await executeStockCommand({...params,commandType:"package.production.post",permission:"stock.post",input:{documentId,expectedVersion},
  plan:async(tx,_i,m)=>{
   const saved=await preparedProduction(tx,m.tenantId,documentId),existing=await buildPostCommand({documentId,expectedVersion,moves:undefined,requestId:input.requestId??null,worker:false}).plan(tx,{},m);
   try{const c=await packageProductionContext(tx,m.tenantId,saved.value),source:FieldPostSpec={kind:"STOCK_OUT",warehouseId:c.sourceWarehouseId,sourceKind:null,sourceId:null,reason:"PACKAGE_PRODUCTION",lines:c.inputs.map(({allocation,state})=>({itemId:state.item_id,unitId:state.unit_id,quantity:packageQuantityForBase(state,allocation.baseQuantity),conversionFactor:state.conversion_factor,baseQuantity:allocation.baseQuantity,lotId:state.lot_id,handlingUnitId:allocation.packageId,sourceLocationId:state.location_id,targetLocationId:null,stockStatus:"AVAILABLE",targetStockStatus:null,sourceLineId:null}))};
    const merged=mergeFieldPlans([existing,await planFieldPosting(tx,m.tenantId,source)]);return {warehouseIds:merged.warehouseIds,locks:{...merged.locks,document:existing.locks.document}};
   }catch(e){if(!(e instanceof AppError))throw e;return {warehouseIds:[saved.h.warehouse_id,...new Set(saved.inputs.map(i=>i.warehouse_id))],locks:existing.locks};}
  },
  apply:async(tx,locked,ctx)=>{
   const saved=await preparedProduction(tx,ctx.tenantId,documentId),c=await packageProductionContext(tx,ctx.tenantId,saved.value);
   if(locked.document?.id!==documentId||locked.document.status!=="APPROVED")throw new AppError("VALIDATION_FAILED",{detail:"DOCUMENT_STATE"});
   for(const {allocation,state} of c.inputs)assertPackageCurrent(locked,allocation,state);
   const source:FieldPostSpec={kind:"STOCK_OUT",warehouseId:c.sourceWarehouseId,sourceKind:null,sourceId:null,reason:"PACKAGE_PRODUCTION",lines:c.inputs.map(({allocation,state})=>({itemId:state.item_id,unitId:state.unit_id,quantity:packageQuantityForBase(state,allocation.baseQuantity),conversionFactor:state.conversion_factor,baseQuantity:allocation.baseQuantity,lotId:state.lot_id,handlingUnitId:allocation.packageId,sourceLocationId:state.location_id,targetLocationId:null,stockStatus:"AVAILABLE",targetStockStatus:null,sourceLineId:null}))};
   const out=await prepareFieldDocument(tx,ctx,source);
   for(const [i,{allocation,state}] of c.inputs.entries()){
    const lineId=out.lineIds[i],plan=saved.inputs.find(p=>p.package_id===allocation.packageId);if(lineId===undefined||plan===undefined||state.previous_document_line_id!==plan.previous_document_line_id)throw new AppError("VERSION_CONFLICT",{retryable:true});
    await tx.execute(sql`INSERT INTO public.package_movement_steps(tenant_id,handling_unit_id,document_id,document_line_id,operation,sequence_no,previous_document_line_id,source_location_id,target_location_id,source_stock_status,target_stock_status,base_quantity,production_batch_id) VALUES(${ctx.tenantId}::uuid,${allocation.packageId}::uuid,${out.documentId}::uuid,${lineId}::uuid,'CONSUME',${state.sequence_no+1},${state.previous_document_line_id}::uuid,${state.location_id}::uuid,${state.location_id}::uuid,'AVAILABLE','AVAILABLE',${allocation.baseQuantity}::numeric,${saved.h.id}::uuid)`);
   }
   await tx.execute(sql`INSERT INTO public.stock_document_links(tenant_id,source_document_id,target_document_id,kind,recipe_id) VALUES(${ctx.tenantId}::uuid,${out.documentId}::uuid,${documentId}::uuid,'PRODUCTION',${saved.h.recipe_id}::uuid)`);
   const removed=await postApprovedDocumentInTx(tx,locked,ctx,out.documentId,{requestId:input.requestId??null,consumes:out.consumes}),received=await postApprovedDocumentInTx(tx,locked,ctx,documentId,{requestId:input.requestId??null});
   if(removed.numbering===undefined||received.numbering===undefined||removed.audit===null)throw new AppError("INTERNAL");await appendAudit(tx,{...removed.audit,actorUserId:ctx.userId});return {...received,additionalNumbering:[removed.numbering]};
  }});
 if(outcome.status!=="COMPLETED")throw new AppError("VERSION_CONFLICT",{retryable:true});return {...outcome.result,replayed:outcome.replayed};
}
