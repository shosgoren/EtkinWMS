// Real tenant data only, called inside the same authorized label-preparation transaction. Never allocates stock/barcode/package IDs.
import{sql}from'drizzle-orm';
import{AppError}from'@wms/shared/errors';
import type{LabelContext,LabelField,LabelRenderValues,LabelSourceRequest}from'@wms/shared/labels';
import type{AccessTx,Membership}from'../identity/access.ts';
import{hasPermission}from'../identity/permissions.ts';
import{assertWarehouseVisible}from'../warehouse/scope.ts';
export type{LabelSourceRequest}from'@wms/shared/labels';
export type LabelPrintLocale='tr'|'en';
export interface LabelSourceFact{readonly kind:LabelSourceRequest['kind'];readonly id:string;readonly warehouseId?:string;readonly documentId?:string;readonly version?:number}
export interface LabelSourceRow{readonly source:LabelSourceFact;readonly values:LabelRenderValues;readonly required:readonly LabelField[];readonly packageCodeRequired:boolean}
export interface LabelSourceBatch{readonly context:LabelContext;readonly rows:readonly LabelSourceRow[];readonly next:string|null}
export function parseLabelSourceRequest(raw:unknown):LabelSourceRequest{
 if(raw===null||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))throw new AppError('VALIDATION_FAILED');
 const r=raw as Record<string,unknown>,kind=r.kind;
 if(!['PRODUCT','LOCATION','RECEIPT','PRODUCTION','SHIPMENT'].includes(kind as string))throw new AppError('VALIDATION_FAILED');
 const allowed=kind==='PRODUCT'?['kind','ids']:kind==='LOCATION'?['kind','warehouseId','locationId','subtree','after','ids']:['kind','documentId','after','ids'];
 if(Object.keys(r).some(k=>!allowed.includes(k)))throw new AppError('VALIDATION_FAILED');
 const uuid=(v:unknown):string=>{if(typeof v!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))throw new AppError('VALIDATION_FAILED');return v.toLowerCase();};
 const ids=r.ids===undefined?undefined:Array.isArray(r.ids)&&r.ids.length>=1&&r.ids.length<=100?r.ids.map(uuid):invalid();
 if(ids&&new Set(ids).size!==ids.length)return invalid();
 if(kind==='PRODUCT'){if(!ids)return invalid();return{kind,ids};}
 const page={...(ids===undefined?{}:{ids}),...(r.after===undefined?{}:{after:uuid(r.after)})};
 if(kind==='LOCATION'){if(r.subtree!==undefined&&typeof r.subtree!=='boolean')return invalid();return{kind,warehouseId:uuid(r.warehouseId),...(r.locationId===undefined?{}:{locationId:uuid(r.locationId)}),...(r.subtree===undefined?{}:{subtree:r.subtree as boolean}),...page};}
 return{kind:kind as 'RECEIPT'|'PRODUCTION'|'SHIPMENT',documentId:uuid(r.documentId),...page};
}
const missing=():never=>{throw new AppError('NOT_FOUND');};
const invalid=():never=>{throw new AppError('VALIDATION_FAILED');};
function localeTag(locale:LabelPrintLocale){if(locale!=='tr'&&locale!=='en')return invalid();return locale==='en'?'en-GB':'tr-TR';}
/** Formatting only, never Number(quantity): preserve every decimal digit, including values beyond the safe-integer range. */
export function formatLabelQuantity(raw:string,locale:LabelPrintLocale):string{
 if(!/^\d{1,24}(?:\.\d{1,6})?$/.test(raw))return invalid();const tag=localeTag(locale),[whole='0',frac='']=raw.split('.'),tail=frac.replace(/0+$/,'');
 const integer=new Intl.NumberFormat(tag,{maximumFractionDigits:0}).format(BigInt(whole));
 const dot=new Intl.NumberFormat(tag).formatToParts(1.1).find(p=>p.type==='decimal')?.value??'.';return integer+(tail?dot+tail:'');
}
export function formatLabelDate(raw:string|null,locale:LabelPrintLocale):string{
 if(raw===null)return'';const tag=localeTag(locale);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return invalid();const d=new Date(raw+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==raw)return invalid();return new Intl.DateTimeFormat(tag,{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'UTC'}).format(d);
}
const selected=(query:LabelSourceRequest)=>'ids'in query&&query.ids?sql` AND p.id IN (${sql.join(query.ids.map(v=>sql`${v}::uuid`),sql`, `)})`:sql``;
// This helper does not authorize or query by itself. Every SQL relation remains tenant-bound.
function finish(context:LabelContext,rows:LabelSourceRow[],query:LabelSourceRequest):LabelSourceBatch{
 if(rows.length===0)return missing();if('ids'in query&&query.ids&&rows.length!==query.ids.length)return missing();
 return{context,rows:rows.slice(0,100),next:rows.length>100?rows[99]?.source.id??null:null};
}

async function readProducts(tx:AccessTx,tenant:string,ids:readonly string[]){
 return await tx.execute<{id:string;code:string;name:string;unit:string;barcode:string|null}>(sql`SELECT i.id,i.code,i.name,u.code AS unit,b.barcode FROM public.items i JOIN public.units u ON u.tenant_id=i.tenant_id AND u.id=i.base_unit_id
   LEFT JOIN LATERAL(SELECT ib.barcode FROM public.item_barcodes ib WHERE ib.tenant_id=i.tenant_id AND ib.item_id=i.id AND coalesce(ib.unit_id,i.base_unit_id)=i.base_unit_id AND coalesce(ib.quantity,1)=1
    AND NOT EXISTS(SELECT 1 FROM public.item_barcodes other JOIN public.items oi ON oi.tenant_id=other.tenant_id AND oi.id=other.item_id WHERE other.tenant_id=i.tenant_id AND other.barcode=ib.barcode AND oi.status='ACTIVE' AND (other.item_id<>i.id OR coalesce(other.unit_id,oi.base_unit_id)<>i.base_unit_id OR coalesce(other.quantity,1)<>1)) ORDER BY ib.barcode,ib.id LIMIT 1) b ON true
   WHERE i.tenant_id=${tenant}::uuid AND i.id IN (${sql.join(ids.map(v=>sql`${v}::uuid`),sql`, `)}) ORDER BY i.code,i.id`);
}
export async function readLabelSourcesInTx(tx:AccessTx,m:Membership,raw:unknown,locale:LabelPrintLocale,packagesEnabled:boolean):Promise<LabelSourceBatch>{
 const q=parseLabelSourceRequest(raw);localeTag(locale);if(!hasPermission(m.roles,'stock.view',m.grants))throw new AppError('FORBIDDEN');
 if(q.kind==='PRODUCT'){
  const rows=await readProducts(tx,m.tenantId,q.ids);
  return finish('PRODUCT',rows.map(r=>({source:{kind:q.kind,id:r.id},values:{name:r.name,code:r.code,unit:r.unit,barcode:r.barcode??''},required:['name','barcode'],packageCodeRequired:false})),q);
 }
 if(q.kind==='LOCATION'){
  await assertWarehouseVisible(tx,m,[q.warehouseId]);const warehouses=await tx.execute<{name:string}>(sql`SELECT name FROM public.warehouses WHERE tenant_id=${m.tenantId}::uuid AND id=${q.warehouseId}::uuid`);if(!warehouses[0])return missing();
  if(q.locationId){const exists=await tx.execute(sql`SELECT id FROM public.locations WHERE tenant_id=${m.tenantId}::uuid AND warehouse_id=${q.warehouseId}::uuid AND id=${q.locationId}::uuid`);if(!exists[0])return missing();}
  const rows=await tx.execute<{id:string;code:string;name:string}>(sql`WITH RECURSIVE chosen AS(
   SELECT id,parent_id FROM public.locations WHERE tenant_id=${m.tenantId}::uuid AND warehouse_id=${q.warehouseId}::uuid AND (${q.locationId??null}::uuid IS NULL OR id=${q.locationId??null}::uuid)
   UNION SELECT l.id,l.parent_id FROM public.locations l JOIN chosen p ON l.parent_id=p.id WHERE ${q.subtree===true} AND ${q.locationId??null}::uuid IS NOT NULL AND l.tenant_id=${m.tenantId}::uuid AND l.warehouse_id=${q.warehouseId}::uuid
  ) SELECT l.id,l.code,l.name FROM public.locations l JOIN chosen p ON p.id=l.id WHERE l.tenant_id=${m.tenantId}::uuid AND l.warehouse_id=${q.warehouseId}::uuid AND (${q.after??null}::uuid IS NULL OR l.id>${q.after??null}::uuid) ${q.ids?sql`AND l.id IN (${sql.join(q.ids.map(v=>sql`${v}::uuid`),sql`, `)})`:sql``} ORDER BY l.id LIMIT 101`);
  return finish('LOCATION',rows.map(r=>({source:{kind:q.kind,id:r.id,warehouseId:q.warehouseId},values:{locationCode:r.code,locationName:r.name,warehouseName:warehouses[0]!.name},required:['locationCode'],packageCodeRequired:false})),q);
 }
 if(q.kind!=='SHIPMENT'&&packagesEnabled!==true)throw new AppError('FORBIDDEN');
 type Header={warehouse_id:string;status:string;version:number;number:string|null;receipt_status:string|null;source_status:string|null};
 let heads:Header[];
 if(q.kind==='RECEIPT')heads=await tx.execute<Header>(sql`SELECT d.warehouse_id,d.status,d.version,d.number,r.status AS receipt_status,NULL::text AS source_status FROM public.documents d JOIN public.inbound_receipts r ON r.tenant_id=d.tenant_id AND r.package_document_id=d.id AND r.warehouse_id=d.warehouse_id WHERE d.tenant_id=${m.tenantId}::uuid AND d.id=${q.documentId}::uuid`);
 else if(q.kind==='PRODUCTION')heads=await tx.execute<Header>(sql`SELECT d.warehouse_id,d.status,d.version,d.number,NULL::text AS receipt_status,s.status AS source_status FROM public.documents d JOIN public.production_batches b ON b.tenant_id=d.tenant_id AND b.output_document_id=d.id LEFT JOIN public.stock_document_links link ON link.tenant_id=d.tenant_id AND link.target_document_id=d.id AND link.kind='PRODUCTION' LEFT JOIN public.documents s ON s.tenant_id=link.tenant_id AND s.id=link.source_document_id WHERE d.tenant_id=${m.tenantId}::uuid AND d.id=${q.documentId}::uuid`);
 else heads=await tx.execute<Header>(sql`SELECT warehouse_id,status,version,number,NULL::text AS receipt_status,NULL::text AS source_status FROM public.documents WHERE tenant_id=${m.tenantId}::uuid AND id=${q.documentId}::uuid AND kind='STOCK_OUT' AND reversal_of_document_id IS NULL`);
 const h=heads[0];if(!h)return missing();await assertWarehouseVisible(tx,m,[h.warehouse_id]);if(h.status!=='POSTED'||!h.number||(q.kind==='RECEIPT'&&h.receipt_status!=='CLOSED')||(q.kind==='PRODUCTION'&&h.source_status!=='POSTED'))return invalid();
 type Row={id:string;item_id:string;code:string;name:string;unit:string;quantity:string;tracking_mode:string;lot_code:string|null;produced_on:string|null;expires_on:string|null;package_id:string|null;has_origin:boolean};
 let rows:Row[];
 if(q.kind==='SHIPMENT'){
  rows=await tx.execute<Row>(sql`SELECT p.id,p.item_id,i.code,i.name,u.code AS unit,p.quantity::text,i.tracking_mode,l.lot_code,l.production_date::text AS produced_on,l.expiry_date::text AS expires_on,p.handling_unit_id AS package_id,EXISTS(SELECT 1 FROM public.package_origin(${m.tenantId}::uuid,p.handling_unit_id)) AS has_origin
   FROM public.document_lines p JOIN public.items i ON i.tenant_id=p.tenant_id AND i.id=p.item_id JOIN public.units u ON u.tenant_id=p.tenant_id AND u.id=p.unit_id LEFT JOIN public.lots l ON l.tenant_id=p.tenant_id AND l.id=p.lot_id WHERE p.tenant_id=${m.tenantId}::uuid AND p.document_id=${q.documentId}::uuid AND (${q.after??null}::uuid IS NULL OR p.id>${q.after??null}::uuid) ${selected(q)} ORDER BY p.id LIMIT 101`);
 }else{
  const table=q.kind==='RECEIPT'?sql`public.receipt_packages`:sql`public.production_packages`;
  rows=await tx.execute<Row>(sql`SELECT p.id,l.item_id,i.code,i.name,u.code AS unit,l.quantity::text,i.tracking_mode,p.lot_code,p.produced_on::text,p.expires_on::text,p.id AS package_id,true AS has_origin
   FROM ${table} p JOIN public.document_lines l ON l.tenant_id=p.tenant_id AND l.document_id=p.document_id AND l.id=p.document_line_id JOIN public.handling_units hu ON hu.tenant_id=p.tenant_id AND hu.id=p.id JOIN public.items i ON i.tenant_id=l.tenant_id AND i.id=l.item_id JOIN public.units u ON u.tenant_id=l.tenant_id AND u.id=l.unit_id
   WHERE p.tenant_id=${m.tenantId}::uuid AND p.document_id=${q.documentId}::uuid AND (${q.after??null}::uuid IS NULL OR p.id>${q.after??null}::uuid) ${selected(q)} ORDER BY p.id LIMIT 101`);
 }
 const products=rows.length===0?[]:await readProducts(tx,m.tenantId,[...new Set(rows.map(r=>r.item_id))]);const barcodes=new Map(products.map(p=>[p.id,p.barcode]));
 const result=rows.map((r):LabelSourceRow=>{
  if(r.package_id!==null&&packagesEnabled!==true)throw new AppError('FORBIDDEN');
  if(r.package_id!==null&&!r.has_origin)return invalid();
  const required:LabelField[]=['name','quantity','unit','documentNo'];if(q.kind!=='SHIPMENT'||r.package_id!==null)required.push('packageQr');
  if(r.tracking_mode==='LOT'||r.tracking_mode==='LOT_AND_SERIAL'||r.lot_code!==null)required.push('lot');if(r.produced_on!==null&&q.kind!=='SHIPMENT')required.push('productionDate');if(r.expires_on!==null)required.push('expiryDate');
  if(required.includes('lot')&&!r.lot_code)return invalid();
  const values:Record<string,string>={name:r.name,code:r.code,unit:r.unit,barcode:barcodes.get(r.item_id)??'',quantity:formatLabelQuantity(r.quantity,locale),lot:r.lot_code??'',expiryDate:formatLabelDate(r.expires_on,locale),documentNo:h.number!};
  if(q.kind!=='SHIPMENT')values.productionDate=formatLabelDate(r.produced_on,locale);
  if(r.package_id!==null)values.packageQr=`EWMS:PKG:1:${r.package_id}`;
  if(q.kind==='SHIPMENT')values.trackingCode=values.packageQr??h.number!;
  return{source:{kind:q.kind,id:r.id,documentId:q.documentId,warehouseId:h.warehouse_id,version:h.version},values,required,packageCodeRequired:r.package_id!==null};
 });
 return finish(q.kind==='SHIPMENT'?'SHIPMENT':'RECEIPT',result,q);
}
