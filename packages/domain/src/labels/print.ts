// Metadata-only print preparation. No stock command, UUID allocation for physical goods, fetch, bridge or printer socket.
import{createHash}from'node:crypto';
import{sql}from'drizzle-orm';
import{AppError}from'@wms/shared/errors';
import{LABEL_CONTEXTS,CONTEXT_FIELDS,parseLabelDesign,prepareLabelForPrint,renderLabelSvg,type LabelContext,type LabelDesign,type LabelField,type LabelRenderValues,type PrinterResolution,type LabelPrintPreview,type LabelPrepared}from'@wms/shared/labels';
import{runTenantQuery,type AccessTx,type Membership}from'../identity/access.ts';
import{labelId,labelVersion,labelAudit,type LabelParams}from'./common.ts';
import{normalizeLabelPng}from'./png.ts';
import{resolveLabelPrinterInTx}from'./printer-store.ts';
import{readLabelSourcesInTx,parseLabelSourceRequest,type LabelPrintLocale,type LabelSourceRow,type LabelSourceFact,type LabelSourceRequest}from'./print-source.ts';
export type LabelPrintReason='PRINTER_UNAVAILABLE'|'REQUIRED_VALUE'|'REQUIRED_CODE'|'PRINTER_CHANGED'|'SOURCE_CHANGED';
export class LabelPrintError extends AppError{constructor(readonly reason:LabelPrintReason){super(reason==='PRINTER_CHANGED'||reason==='SOURCE_CHANGED'?'VERSION_CONFLICT':'VALIDATION_FAILED');}}
export interface LabelPreviewInput{readonly source:unknown;readonly templateId?:string;readonly deviceId?:string;readonly locale:LabelPrintLocale}
export interface LabelPrepareInput extends LabelPreviewInput{readonly jobId:string;readonly copies:number;readonly reprintOf?:string;readonly reason?:string}
interface Calibration{readonly dpi:203|300|600;readonly offsetX:number;readonly offsetY:number}
interface Snapshot extends LabelSourceRow{readonly schema:1;readonly requestHash:string;readonly calibration:Calibration;readonly locale:LabelPrintLocale}
interface Template{readonly id:string;readonly versionId:string;readonly name:string;readonly design:LabelDesign}
export type{LabelPrintPreview,LabelPrepared}from'@wms/shared/labels';
const object=(raw:unknown):Record<string,unknown>=>{if(raw===null||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))throw new AppError('VALIDATION_FAILED');return raw as Record<string,unknown>;};
const keys=(r:Record<string,unknown>,allowed:readonly string[])=>{if(Object.keys(r).some(k=>!allowed.includes(k)))throw new AppError('VALIDATION_FAILED');};
const localeOf=(v:unknown):LabelPrintLocale=>{if(v!=='tr'&&v!=='en')throw new AppError('VALIDATION_FAILED');return v;};
/** Stable for equivalent property/ID order. Never hashes or accepts client-provided source values. */
export function labelRequestFingerprint(raw:LabelPrepareInput):string{
 const source=parseLabelSourceRequest(raw.source),sorted={...source,...('ids'in source&&source.ids?{ids:[...source.ids].sort()}:{})};
 return createHash('sha256').update(JSON.stringify({source:sorted,templateId:raw.templateId??null,deviceId:raw.deviceId??null,locale:raw.locale,copies:raw.copies,reprintOf:raw.reprintOf??null,reason:raw.reason??null})).digest('hex');
}
function inputOf(raw:unknown,prepare:boolean):LabelPreviewInput&{jobId?:string;copies?:number;reprintOf?:string;reason?:string}{
 const r=object(raw);keys(r,prepare?['source','templateId','deviceId','locale','jobId','copies','reprintOf','reason']:['source','templateId','deviceId','locale']);const source=parseLabelSourceRequest(r.source),locale=localeOf(r.locale);
 const result={source,locale,...(r.templateId===undefined?{}:{templateId:labelId(r.templateId)}),...(r.deviceId===undefined?{}:{deviceId:labelId(r.deviceId)})};if(!prepare)return result;
 const copies=labelVersion(r.copies);if(copies>100)throw new AppError('VALIDATION_FAILED');
 const reprintOf=r.reprintOf===undefined?undefined:labelId(r.reprintOf);if(r.reason!==undefined&&(typeof r.reason!=='string'||r.reason.trim().length<1||r.reason.length>120||/[\u0000-\u001f\u007f]/.test(r.reason)))throw new AppError('VALIDATION_FAILED');if(reprintOf!==undefined&&(!('ids'in source)||source.ids===undefined))throw new AppError('VALIDATION_FAILED');if(reprintOf!==undefined&&r.reason===undefined)throw new AppError('VALIDATION_FAILED');
 return{...result,jobId:labelId(r.jobId),copies,...(reprintOf===undefined?{}:{reprintOf}),...(r.reason===undefined?{}:{reason:(r.reason as string).trim()})};
}
export function parseLabelSnapshot(raw:unknown,context:LabelContext):readonly Snapshot[]{
 if(!Array.isArray(raw)||raw.length<1||raw.length>100)throw new AppError('VALIDATION_FAILED');
 const result=raw.map((value):Snapshot=>{
  const r=object(value);keys(r,['schema','requestHash','source','values','required','packageCodeRequired','calibration','locale']);if(r.schema!==1||typeof r.requestHash!=='string'||!/^[0-9a-f]{64}$/.test(r.requestHash)||typeof r.packageCodeRequired!=='boolean')throw new AppError('VALIDATION_FAILED');
  const s=object(r.source);keys(s,['kind','id','warehouseId','documentId','version']);const source:LabelSourceFact={kind:s.kind as LabelSourceFact['kind'],id:labelId(s.id),...(s.warehouseId===undefined?{}:{warehouseId:labelId(s.warehouseId)}),...(s.documentId===undefined?{}:{documentId:labelId(s.documentId)}),...(s.version===undefined?{}:{version:labelVersion(s.version)})};
  sourceQuery([source]);const expected=source.kind==='PRODUCT'?'PRODUCT':source.kind==='LOCATION'?'LOCATION':source.kind==='SHIPMENT'?'SHIPMENT':'RECEIPT';if(expected!==context)throw new AppError('VALIDATION_FAILED');const values=object(r.values);if(Object.keys(values).some(k=>!(CONTEXT_FIELDS[context] as readonly string[]).includes(k))||Object.values(values).some(v=>typeof v!=='string'||v.length>512))throw new AppError('VALIDATION_FAILED');
  if(!Array.isArray(r.required)||r.required.some(v=>typeof v!=='string'||!(CONTEXT_FIELDS[context] as readonly string[]).includes(v))||new Set(r.required).size!==r.required.length)throw new AppError('VALIDATION_FAILED');
  const c=object(r.calibration);keys(c,['dpi','offsetX','offsetY']);if(![203,300,600].includes(c.dpi as number)||![c.offsetX,c.offsetY].every(v=>typeof v==='number'&&Number.isInteger(v)&&Math.abs(v)<=10000))throw new AppError('VALIDATION_FAILED');
  return{schema:1,requestHash:r.requestHash,source,values:values as LabelRenderValues,required:r.required as LabelField[],packageCodeRequired:r.packageCodeRequired,calibration:c as unknown as Calibration,locale:localeOf(r.locale)};
 });
 sourceQuery(result.map(r=>r.source));if(result.some(r=>r.requestHash!==result[0]!.requestHash||r.locale!==result[0]!.locale||JSON.stringify(r.calibration)!==JSON.stringify(result[0]!.calibration)))throw new AppError('VALIDATION_FAILED');return result;
}
function sourceQuery(sources:readonly LabelSourceFact[]):LabelSourceRequest{
 const first=sources[0];if(!first)throw new AppError('VALIDATION_FAILED');if(sources.some(s=>s.kind!==first.kind||s.documentId!==first.documentId||s.warehouseId!==first.warehouseId))throw new AppError('VALIDATION_FAILED');
 const ids=sources.map(s=>s.id);return parseLabelSourceRequest(first.kind==='PRODUCT'?{kind:first.kind,ids}:first.kind==='LOCATION'?{kind:first.kind,warehouseId:first.warehouseId,ids}:{kind:first.kind,documentId:first.documentId,ids});
}
async function authorizeSaved(tx:AccessTx,m:Membership,snapshots:readonly Snapshot[],packagesEnabled:boolean,liveCodes=true){
 const fresh=await readLabelSourcesInTx(tx,m,sourceQuery(snapshots.map(s=>s.source)),snapshots[0]!.locale,packagesEnabled);const actual=new Map(fresh.rows.map(r=>[r.source.id,r]));
 if(snapshots.some(s=>!actual.has(s.source.id)||(s.values.packageQr??null)!==(actual.get(s.source.id)?.values.packageQr??null)))throw new AppError('NOT_FOUND');
 if(liveCodes)for(const s of snapshots){const now=actual.get(s.source.id)!;
  if(s.source.kind==='LOCATION'&&s.values.locationCode!==now.values.locationCode)throw new LabelPrintError('SOURCE_CHANGED');
  if(s.source.kind==='PRODUCT'&&s.values.barcode!==now.values.barcode){
   const aliases=await tx.execute(sql`SELECT ib.id FROM public.item_barcodes ib JOIN public.items i ON i.tenant_id=ib.tenant_id AND i.id=ib.item_id
    WHERE ib.tenant_id=${m.tenantId}::uuid AND ib.item_id=${s.source.id}::uuid AND ib.barcode=${s.values.barcode??null} AND coalesce(ib.unit_id,i.base_unit_id)=i.base_unit_id AND coalesce(ib.quantity,1)=1
    AND NOT EXISTS(SELECT 1 FROM public.item_barcodes other JOIN public.items oi ON oi.tenant_id=other.tenant_id AND oi.id=other.item_id WHERE other.tenant_id=i.tenant_id AND other.barcode=ib.barcode AND oi.status='ACTIVE' AND (other.item_id<>i.id OR coalesce(other.unit_id,oi.base_unit_id)<>i.base_unit_id OR coalesce(other.quantity,1)<>1)) LIMIT 1`);
   if(!aliases[0])throw new LabelPrintError('SOURCE_CHANGED');
  }
 }

}
async function template(tx:AccessTx,tenant:string,context:LabelContext,id?:string,versionId?:string):Promise<Template>{
 type R={id:string;version_id:string;name:string;design:unknown};let rows:R[];
 if(versionId!==undefined)rows=await tx.execute<R>(sql`SELECT t.id,v.id AS version_id,t.name,v.design FROM public.label_template_versions v JOIN public.label_templates t ON t.tenant_id=v.tenant_id AND t.id=v.template_id WHERE v.tenant_id=${tenant}::uuid AND v.id=${versionId}::uuid AND v.template_id=${id}::uuid AND v.context=${context}`);
 else rows=await tx.execute<R>(sql`SELECT t.id,v.id AS version_id,t.name,v.design FROM public.label_templates t LEFT JOIN public.label_defaults d ON d.tenant_id=t.tenant_id AND d.context=t.context JOIN public.label_template_versions v ON v.tenant_id=t.tenant_id AND v.template_id=t.id AND v.context=t.context AND v.id=CASE WHEN ${id??null}::uuid IS NULL THEN d.version_id ELSE t.published_version_id END WHERE t.tenant_id=${tenant}::uuid AND t.context=${context} AND t.archived_at IS NULL AND ((${id??null}::uuid IS NOT NULL AND t.id=${id??null}::uuid) OR (${id??null}::uuid IS NULL AND d.template_id=t.id))`);
 if(rows.length!==1)throw new AppError('NOT_FOUND');const r=rows[0]!;return{id:r.id,versionId:r.version_id,name:r.name,design:parseLabelDesign(r.design)};
}
async function render(tx:AccessTx,m:Membership,t:Template,rows:readonly LabelSourceRow[],printer:PrinterResolution,calibration:Calibration,next:string|null):Promise<LabelPrintPreview>{
 if(printer.kind!=='dialog')throw new LabelPrintError('PRINTER_UNAVAILABLE');
 const ids=[...new Set(t.design.elements.flatMap(e=>e.kind==='logo'?[e.assetId]:[]))],assets:Record<string,string>={};let size=0;
 if(ids.length){const logos=await tx.execute<{id:string;png:Buffer}>(sql`SELECT id,png FROM public.label_assets WHERE tenant_id=${m.tenantId}::uuid AND id IN (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`, `)})`);if(logos.length!==ids.length)throw new AppError('NOT_FOUND');for(const l of logos){const png=normalizeLabelPng(l.png).png;size+=png.length;if(size>1024*1024)throw new AppError('VALIDATION_FAILED');assets[l.id]=`data:image/png;base64,${png.toString('base64')}`;}}
 const pages:string[]=[];let bytes=0;for(const r of rows){
  prepareLabelForPrint(t.design,r.required);
  for(const field of r.required)if(!r.values[field])throw new LabelPrintError('REQUIRED_VALUE');
  const field=r.packageCodeRequired?'packageQr':t.design.context==='PRODUCT'?'barcode':t.design.context==='LOCATION'?'locationCode':'documentNo';
  if(!t.design.elements.some(e=>(e.kind==='qr'||e.kind==='barcode')&&e.field===field))throw new LabelPrintError('REQUIRED_CODE');
  // preview is deliberately never passed. DPI/offset only come from the current authorized server profile or saved job.
  const page=renderLabelSvg(t.design,r.values,{...calibration,assets});bytes+=Buffer.byteLength(page,'utf8');
  if(bytes>8*1024*1024)throw new AppError('VALIDATION_FAILED');pages.push(page);
 }
 return{templateId:t.id,versionId:t.versionId,name:t.name,context:t.design.context,width:t.design.width/1000,height:t.design.height/1000,pages,next,printer};
}
async function printer(tx:AccessTx,m:Membership,templateId:string,deviceId:string|null,savedId?:string|null):Promise<{resolution:PrinterResolution;calibration:Calibration}>{
 const resolution=savedId===undefined?await resolveLabelPrinterInTx(tx,m,templateId,deviceId):{kind:'dialog' as const,profileId:savedId,name:null,requiresSelection:true as const};
 if(resolution.kind!=='dialog')throw new LabelPrintError('PRINTER_UNAVAILABLE');
 if(resolution.profileId===null)return{resolution,calibration:{dpi:203,offsetX:0,offsetY:0}};
 const rows=await tx.execute<{id:string;name:string;dpi:203|300|600;offset_x:number;offset_y:number;active:boolean;mode:string}>(sql`SELECT id,name,dpi,offset_x,offset_y,active,mode FROM public.label_printers WHERE tenant_id=${m.tenantId}::uuid AND id=${resolution.profileId}::uuid`);
 const r=rows[0];if(!r||!r.active||r.mode!=='SYSTEM_DIALOG')throw new LabelPrintError('PRINTER_UNAVAILABLE');
 return{resolution:{...resolution,name:r.name},calibration:{dpi:r.dpi,offsetX:r.offset_x,offsetY:r.offset_y}};
}
export async function getLabelPrintChoices(p:LabelParams,context:LabelContext){
 if(!(LABEL_CONTEXTS as readonly string[]).includes(context))throw new AppError('VALIDATION_FAILED');return runTenantQuery({...p,permission:'labels.print'},async(tx,m)=>{
  const rows=await tx.execute<{id:string;name:string;version_id:string;is_default:boolean;assigned_version_id:string|null}>(sql`SELECT t.id,t.name,t.published_version_id AS version_id,coalesce(d.template_id=t.id,false) AS is_default,CASE WHEN d.template_id=t.id THEN d.version_id ELSE NULL END AS assigned_version_id FROM public.label_templates t LEFT JOIN public.label_defaults d ON d.tenant_id=t.tenant_id AND d.context=t.context WHERE t.tenant_id=${m.tenantId}::uuid AND t.context=${context} AND t.archived_at IS NULL AND t.published_version_id IS NOT NULL ORDER BY t.name,t.id LIMIT 200`);return rows.map(r=>({id:r.id,name:r.name,versionId:r.version_id,isDefault:r.is_default,assignedVersionId:r.assigned_version_id}));
 });
}
async function fresh(tx:AccessTx,m:Membership,input:LabelPreviewInput,packagesEnabled:boolean){
 const batch=await readLabelSourcesInTx(tx,m,input.source,input.locale,packagesEnabled),t=await template(tx,m.tenantId,batch.context,input.templateId),settings=await printer(tx,m,t.id,input.deviceId??null);
 return{t,rows:batch.rows,next:batch.next,...settings};
}
export async function previewCustomLabels(p:LabelParams,raw:LabelPreviewInput,packagesEnabled=false):Promise<LabelPrintPreview>{
 const input=inputOf(raw,false);return runTenantQuery({...p,permission:'labels.print'},async(tx,m)=>{const b=await fresh(tx,m,input,packagesEnabled);return render(tx,m,b.t,b.rows,b.resolution,b.calibration,b.next);});
}
type Job={id:string;template_id:string;version_id:string;context:LabelContext;snapshot:unknown;copies:number;printer_id:string|null;created_by:string;reprint_of:string|null};
async function readJob(tx:AccessTx,tenant:string,id:string):Promise<Job>{const rows=await tx.execute<Job>(sql`SELECT id,template_id,version_id,context,snapshot,copies,printer_id,created_by,reprint_of FROM public.label_print_jobs WHERE tenant_id=${tenant}::uuid AND id=${id}::uuid`);if(!rows[0])throw new AppError('NOT_FOUND');return rows[0];}
async function savedResult(tx:AccessTx,m:Membership,job:Job,packagesEnabled:boolean,replayed:boolean,forPrint=true):Promise<LabelPrepared>{
 const snapshots=parseLabelSnapshot(job.snapshot,job.context);await authorizeSaved(tx,m,snapshots,forPrint?packagesEnabled:true,forPrint);const t=await template(tx,m.tenantId,job.context,job.template_id,job.version_id),calibration=snapshots[0]!.calibration;
 const settings=forPrint?await printer(tx,m,t.id,null,job.printer_id):{resolution:{kind:'dialog' as const,profileId:job.printer_id,name:null,requiresSelection:true as const},calibration};
 if(forPrint&&JSON.stringify(settings.calibration)!==JSON.stringify(calibration))throw new LabelPrintError('PRINTER_CHANGED');
 if(snapshots.some(s=>JSON.stringify(s.calibration)!==JSON.stringify(calibration)))throw new AppError('VALIDATION_FAILED');
 const output=await render(tx,m,t,snapshots,settings.resolution,calibration,null);return{...output,jobId:job.id,copies:job.copies,replayed,reprintOf:job.reprint_of,source:sourceQuery(snapshots.map(s=>s.source))};
}
export async function prepareCustomLabels(p:LabelParams,raw:LabelPrepareInput,packagesEnabled=false):Promise<LabelPrepared>{
 const input=inputOf(raw,true) as LabelPrepareInput,hash=labelRequestFingerprint(input);
 // Read/export access is not gated by billing. This transaction only adds immutable print metadata and audit, never stock.
 return runTenantQuery({...p,permission:'labels.print'},async(tx,m)=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${m.tenantId}:label-print:${input.jobId}`},0))`);
  const old=await tx.execute<Job>(sql`SELECT id,template_id,version_id,context,snapshot,copies,printer_id,created_by,reprint_of FROM public.label_print_jobs WHERE tenant_id=${m.tenantId}::uuid AND id=${input.jobId}::uuid`);
  if(old[0]){if(old[0].created_by!==m.membershipId)throw new AppError('NOT_FOUND');const snapshots=parseLabelSnapshot(old[0].snapshot,old[0].context);if(snapshots.some(s=>s.requestHash!==hash))throw new AppError('VERSION_CONFLICT');return savedResult(tx,m,old[0],packagesEnabled,true);}
  let b:Awaited<ReturnType<typeof fresh>>;
  if(input.reprintOf){const old=await readJob(tx,m.tenantId,input.reprintOf),snapshots=parseLabelSnapshot(old.snapshot,old.context);await authorizeSaved(tx,m,snapshots,packagesEnabled);
   const expected=sourceQuery(snapshots.map(s=>s.source)),requested=parseLabelSourceRequest(input.source);
   const canonical=(q:LabelSourceRequest)=>JSON.stringify({...q,...('ids'in q&&q.ids?{ids:[...q.ids].sort()}:{})});
   if(canonical(expected)!==canonical(requested))throw new AppError('VALIDATION_FAILED');
   if(input.templateId!==undefined&&input.templateId!==old.template_id)throw new AppError('VALIDATION_FAILED');
   const t=await template(tx,m.tenantId,old.context,old.template_id,old.version_id),settings=await printer(tx,m,t.id,input.deviceId??null);b={t,rows:snapshots,next:null,...settings};
  }else b=await fresh(tx,m,input,packagesEnabled);
  if(b.rows.length*input.copies>500)throw new AppError('VALIDATION_FAILED');
  const result=await render(tx,m,b.t,b.rows,b.resolution,b.calibration,b.next),snapshots=b.rows.map(r=>({schema:1,requestHash:hash,source:r.source,values:r.values,required:r.required,packageCodeRequired:r.packageCodeRequired,calibration:b.calibration,locale:input.locale}));
  const snapshot=JSON.stringify(snapshots);if(Buffer.byteLength(snapshot)>524288)throw new AppError('VALIDATION_FAILED');
  const profile=b.resolution.kind==='dialog'?b.resolution.profileId:null;
  await tx.execute(sql`INSERT INTO public.label_print_jobs(tenant_id,id,template_id,version_id,context,snapshot,copies,printer_id,created_by,reprint_of,reason) VALUES(${m.tenantId}::uuid,${input.jobId}::uuid,${b.t.id}::uuid,${b.t.versionId}::uuid,${b.t.design.context},${snapshot}::jsonb,${input.copies},${profile}::uuid,${m.membershipId}::uuid,${input.reprintOf??null}::uuid,${input.reason??null})`);
  await labelAudit(tx,m,p,'label.print_prepared',input.jobId,{context:b.t.design.context,labels:b.rows.length,copies:input.copies,reprint:input.reprintOf!==undefined});
  return{...result,jobId:input.jobId,copies:input.copies,replayed:false,reprintOf:input.reprintOf??null,source:sourceQuery(b.rows.map(r=>r.source))};
 });
}
export async function readPreparedLabels(p:LabelParams,id:string,packagesEnabled=false):Promise<LabelPrepared>{labelId(id);return runTenantQuery({...p,permission:'labels.print'},async(tx,m)=>savedResult(tx,m,await readJob(tx,m.tenantId,id),packagesEnabled,false,false));}

export{parseLabelSourceRequest}from'./print-source.ts';
