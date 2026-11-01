// Versioned tenant metadata only. Publishing changes no item, package, lot, document or stock identity.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { AppError } from "@wms/shared/errors";
import { LABEL_CONTEXTS, parseLabelDesign, type LabelContext, type LabelTemplateSummary, type LabelTemplateDetail, type LabelWorkspace } from "@wms/shared/labels";
import { runTenantQuery, type AccessTx } from "../identity/access.ts";
import { LABEL_CAPS, labelId, labelName, labelVersion, labelWrite, labelRights, labelAudit, assertLabelAssets, type LabelParams } from "./common.ts";
export type { LabelParams } from "./common.ts";
export * from "./assets.ts";
export * from "./printer-store.ts";

type TemplateRow = {id:string;name:string;context:LabelContext;version:number;published_version_id:string|null;archived_at:string|null;draft:unknown}
const summary=(r:TemplateRow):LabelTemplateSummary=>({id:r.id,name:r.name,context:r.context,version:r.version,publishedVersionId:r.published_version_id,archived:r.archived_at!==null});
async function template(tx:AccessTx,tenant:string,id:string):Promise<TemplateRow>{
 const rows=await tx.execute<TemplateRow>(sql`SELECT id,name,context,version,published_version_id,archived_at::text,draft FROM public.label_templates WHERE tenant_id=${tenant}::uuid AND id=${id}::uuid`);
 if(!rows[0])throw new AppError("NOT_FOUND");return rows[0];
}
function contextOf(value:unknown):LabelContext {if(typeof value!=="string"||!(LABEL_CONTEXTS as readonly string[]).includes(value))throw new AppError("VALIDATION_FAILED");return value as LabelContext;}
export async function getLabelWorkspace(p:LabelParams,input:{context?:LabelContext;archived?:boolean;after?:string;deviceId?:string;q?:string}={}):Promise<LabelWorkspace>{
 const context=input.context===undefined?null:contextOf(input.context),after=input.after===undefined?null:labelId(input.after),device=input.deviceId===undefined?null:labelId(input.deviceId);
 if(input.archived!==undefined&&typeof input.archived!=="boolean")throw new AppError("VALIDATION_FAILED");
 if(input.q!==undefined&&(typeof input.q!=="string"||input.q.length>80||/[\u0000-\u001f\u007f]/.test(input.q)))throw new AppError("VALIDATION_FAILED");
 const term=input.q?.trim()??"",like=term===""?null:`%${term.replace(/[\\%_]/g,c=>`\\${c}`)}%`;
 return runTenantQuery({...p,permission:"labels.view"},async(tx,m)=>{
  const rows=await tx.execute<TemplateRow>(sql`SELECT id,name,context,version,published_version_id,archived_at::text,draft FROM public.label_templates WHERE tenant_id=${m.tenantId}::uuid AND (${context}::text IS NULL OR context=${context}) AND (archived_at IS NOT NULL)=${input.archived===true} AND (${like}::text IS NULL OR name ILIKE ${like}) AND (${after}::uuid IS NULL OR id>${after}::uuid) ORDER BY id LIMIT 51`);
  const defs=await tx.execute<{context:LabelContext;template_id:string;version_id:string;version:number}>(sql`SELECT context,template_id,version_id,version FROM public.label_defaults WHERE tenant_id=${m.tenantId}::uuid`);
  const printers=await tx.execute<{id:string;name:string;mode:"SYSTEM_DIALOG";active:boolean;dpi:203|300|600;offset_x:number;offset_y:number;version:number}>(sql`SELECT id,name,mode,active,dpi,offset_x,offset_y,version FROM public.label_printers WHERE tenant_id=${m.tenantId}::uuid ORDER BY name,id LIMIT ${LABEL_CAPS.printers}`);
  const prefs=await tx.execute<{id:string;template_id:string|null;membership_id:string|null;printer_id:string|null;version:number}>(sql`SELECT id,template_id,membership_id,printer_id,version FROM public.label_preferences WHERE tenant_id=${m.tenantId}::uuid AND (membership_id IS NULL OR (membership_id=${m.membershipId}::uuid AND device_id=${device}::uuid))`);
  const assets=await tx.execute<{id:string;width:number;height:number}>(sql`SELECT id,width,height FROM public.label_assets WHERE tenant_id=${m.tenantId}::uuid ORDER BY id LIMIT ${LABEL_CAPS.assets}`);
  return{templates:rows.slice(0,50).map(summary),next:rows.length>50?(rows[49]?.id??null):null,defaults:defs.map(r=>({context:r.context,templateId:r.template_id,versionId:r.version_id,version:r.version})),printers:printers.map(r=>({id:r.id,name:r.name,mode:r.mode,active:r.active,bridgeReady:false,dpi:r.dpi,offsetX:r.offset_x,offsetY:r.offset_y,version:r.version})),preferences:prefs.map(r=>({id:r.id,templateId:r.template_id,personal:r.membership_id!==null,printerId:r.printer_id,version:r.version})),assets,rights:labelRights(m)};
 });
}
export async function getLabelTemplate(p:LabelParams,idValue:string):Promise<LabelTemplateDetail>{
 const id=labelId(idValue);
 return runTenantQuery({...p,permission:"labels.view"},async(tx,m)=>{
  const r=await template(tx,m.tenantId,id);
  const versions=await tx.execute<{id:string;revision:number}>(sql`SELECT id,revision FROM public.label_template_versions WHERE tenant_id=${m.tenantId}::uuid AND template_id=${id}::uuid ORDER BY revision DESC LIMIT 20`);
  const live=r.published_version_id===null?[]:await tx.execute<{design:unknown}>(sql`SELECT design FROM public.label_template_versions WHERE tenant_id=${m.tenantId}::uuid AND template_id=${id}::uuid AND id=${r.published_version_id}::uuid`);
  return{...summary(r),draft:parseLabelDesign(r.draft,"DRAFT"),published:live[0]?parseLabelDesign(live[0].design):null,revisions:versions.map(v=>({id:v.id,revision:v.revision}))};
 });
}
export interface SaveLabelTemplateInput {readonly id?:string;readonly expectedVersion:number;readonly name:string;readonly design:unknown}
export async function saveLabelTemplate(p:LabelParams,input:SaveLabelTemplateInput):Promise<{id:string;version:number}>{
 const version=labelVersion(input.expectedVersion,true),id=input.id===undefined?randomUUID():labelId(input.id),name=labelName(input.name),design=parseLabelDesign(input.design,"DRAFT");
 if(input.id===undefined&&version!==0)throw new AppError("VALIDATION_FAILED");
 return labelWrite(p,"labels.design",async(tx,m)=>{
  await assertLabelAssets(tx,m.tenantId,design);
  let rows:{id:string;version:number}[];
  if(version===0){
   const existing=await tx.execute<TemplateRow>(sql`SELECT id,name,context,version,published_version_id,archived_at::text,draft FROM public.label_templates WHERE tenant_id=${m.tenantId}::uuid AND id=${id}::uuid`);
   if(existing[0]){const old=existing[0];if(old.archived_at===null&&old.name===name&&JSON.stringify(parseLabelDesign(old.draft,"DRAFT"))===JSON.stringify(design))return{id,version:old.version};throw new AppError("VERSION_CONFLICT");}
   const n=await tx.execute<{n:number}>(sql`SELECT count(*)::int AS n FROM public.label_templates WHERE tenant_id=${m.tenantId}::uuid`);
   if((n[0]?.n??LABEL_CAPS.templates)>=LABEL_CAPS.templates)throw new AppError("VALIDATION_FAILED");
   rows=await tx.execute(sql`INSERT INTO public.label_templates(tenant_id,id,name,context,draft,created_by) VALUES(${m.tenantId}::uuid,${id}::uuid,${name},${design.context},${JSON.stringify(design)}::jsonb,${m.membershipId}::uuid) RETURNING id,version`);
  }else{
   const before=await template(tx,m.tenantId,id);
   if(before.archived_at!==null)throw new AppError("VALIDATION_FAILED");
   if(before.context!==design.context)throw new AppError("VALIDATION_FAILED");
   if(before.version!==version)throw new AppError("VERSION_CONFLICT");
   if(before.name===name&&JSON.stringify(parseLabelDesign(before.draft,"DRAFT"))===JSON.stringify(design))return{id,version};
   rows=await tx.execute(sql`UPDATE public.label_templates SET name=${name},draft=${JSON.stringify(design)}::jsonb,version=version+1,updated_at=now() WHERE tenant_id=${m.tenantId}::uuid AND id=${id}::uuid AND version=${version} RETURNING id,version`);
  }
  const result=rows[0];if(!result)throw new AppError("VERSION_CONFLICT");
  await labelAudit(tx,m,p,"label.template_saved",result.id,{context:design.context,version:result.version});return result;
 });
}
export async function publishLabelTemplate(p:LabelParams,input:{id:string;expectedVersion:number;expectedDefaultVersion?:number}):Promise<{id:string;version:number;publishedVersionId:string;defaultVersion:number|null}>{
 const id=labelId(input.id),version=labelVersion(input.expectedVersion),expectedDefault=input.expectedDefaultVersion===undefined?null:labelVersion(input.expectedDefaultVersion,true);
 return labelWrite(p,"labels.publish",async(tx,m)=>{
  const r=await template(tx,m.tenantId,id);if(r.archived_at!==null)throw new AppError("VALIDATION_FAILED");if(r.version!==version)throw new AppError("VERSION_CONFLICT");
  const design=parseLabelDesign(r.draft);await assertLabelAssets(tx,m.tenantId,design);
  const changed=await tx.execute<{version:number}>(sql`UPDATE public.label_templates SET version=version+1,updated_at=now() WHERE tenant_id=${m.tenantId}::uuid AND id=${id}::uuid AND version=${version} RETURNING version`);
  const next=changed[0]?.version;if(!next)throw new AppError("VERSION_CONFLICT");
  const versions=await tx.execute<{id:string}>(sql`INSERT INTO public.label_template_versions(tenant_id,template_id,context,revision,design,created_by) VALUES(${m.tenantId}::uuid,${id}::uuid,${r.context},${next},${JSON.stringify(design)}::jsonb,${m.membershipId}::uuid) RETURNING id`);
  const live=versions[0]?.id;if(!live)throw new AppError("INTERNAL");
  await tx.execute(sql`UPDATE public.label_templates SET published_version_id=${live}::uuid WHERE tenant_id=${m.tenantId}::uuid AND id=${id}::uuid`);
  const defaultVersion=expectedDefault===null?null:(await setDefaultInTx(tx,m,p,{...r,published_version_id:live},expectedDefault)).version;
  await labelAudit(tx,m,p,"label.template_published",id,{context:r.context,version:next,published_version:live});return{id,version:next,publishedVersionId:live,defaultVersion};
 });
}
export async function assignLabelDefault(p:LabelParams,input:{id:string;expectedDefaultVersion:number}):Promise<{version:number}>{
 const id=labelId(input.id),expected=labelVersion(input.expectedDefaultVersion,true);
 return labelWrite(p,"labels.publish",async(tx,m)=>{
  const r=await template(tx,m.tenantId,id);if(r.archived_at!==null||r.published_version_id===null)throw new AppError("VALIDATION_FAILED");
  return setDefaultInTx(tx,m,p,r,expected);
 });
}
async function setDefaultInTx(tx:AccessTx,m:Parameters<typeof labelAudit>[1],p:LabelParams,r:TemplateRow,expected:number):Promise<{version:number}>{
  const old=await tx.execute<{version:number}>(sql`SELECT version FROM public.label_defaults WHERE tenant_id=${m.tenantId}::uuid AND context=${r.context}`);
  let rows:{version:number}[];
  if(old[0]){
   if(old[0].version!==expected)throw new AppError("VERSION_CONFLICT");
   rows=await tx.execute(sql`UPDATE public.label_defaults SET template_id=${r.id}::uuid,version_id=${r.published_version_id}::uuid,version=version+1,updated_at=now() WHERE tenant_id=${m.tenantId}::uuid AND context=${r.context} AND version=${expected} RETURNING version`);
  }else{
   if(expected!==0)throw new AppError("VERSION_CONFLICT");
   rows=await tx.execute(sql`INSERT INTO public.label_defaults(tenant_id,context,template_id,version_id) VALUES(${m.tenantId}::uuid,${r.context},${r.id}::uuid,${r.published_version_id}::uuid) RETURNING version`);
  }
  if(!rows[0])throw new AppError("VERSION_CONFLICT");
  await labelAudit(tx,m,p,"label.default_changed",r.id,{context:r.context,published_version:r.published_version_id});return rows[0];
}

export async function archiveLabelTemplate(p:LabelParams,input:{id:string;expectedVersion:number;archived:boolean}):Promise<{id:string;version:number}>{
 const id=labelId(input.id),expected=labelVersion(input.expectedVersion);if(typeof input.archived!=="boolean")throw new AppError("VALIDATION_FAILED");
 return labelWrite(p,"labels.publish",async(tx,m)=>{
  const r=await template(tx,m.tenantId,id);if(r.version!==expected)throw new AppError("VERSION_CONFLICT");
  if(input.archived===(r.archived_at!==null))return{id,version:expected};
  if(input.archived){const use=await tx.execute(sql`SELECT context FROM public.label_defaults WHERE tenant_id=${m.tenantId}::uuid AND template_id=${id}::uuid`);if(use[0])throw new AppError("VALIDATION_FAILED");}
  const rows=await tx.execute<{version:number}>(sql`UPDATE public.label_templates SET archived_at=CASE WHEN ${input.archived} THEN now() ELSE NULL END,version=version+1,updated_at=now() WHERE tenant_id=${m.tenantId}::uuid AND id=${id}::uuid AND version=${expected} RETURNING version`);
  if(!rows[0])throw new AppError("VERSION_CONFLICT");await labelAudit(tx,m,p,"label.template_archived",id,{archived:input.archived,version:rows[0].version});return{id,version:rows[0].version};
 });
}
export async function restoreLabelDraft(p:LabelParams,input:{id:string;expectedVersion:number;versionId:string}):Promise<{id:string;version:number}>{
 const id=labelId(input.id),source=labelId(input.versionId),expected=labelVersion(input.expectedVersion);
 return labelWrite(p,"labels.design",async(tx,m)=>{
  const r=await template(tx,m.tenantId,id);if(r.archived_at!==null)throw new AppError("VALIDATION_FAILED");if(r.version!==expected)throw new AppError("VERSION_CONFLICT");
  const old=await tx.execute<{design:unknown}>(sql`SELECT design FROM public.label_template_versions WHERE tenant_id=${m.tenantId}::uuid AND template_id=${id}::uuid AND id=${source}::uuid`);if(!old[0])throw new AppError("NOT_FOUND");
  const design=parseLabelDesign(old[0].design);await assertLabelAssets(tx,m.tenantId,design);
  const rows=await tx.execute<{version:number}>(sql`UPDATE public.label_templates SET draft=${JSON.stringify(design)}::jsonb,version=version+1,updated_at=now() WHERE tenant_id=${m.tenantId}::uuid AND id=${id}::uuid AND version=${expected} RETURNING version`);
  if(!rows[0])throw new AppError("VERSION_CONFLICT");await labelAudit(tx,m,p,"label.template_saved",id,{restored_version:source,version:rows[0].version});return{id,version:rows[0].version};
 });
}
/** Tenant data access, without billing/feature flags. Keyset pages include all historical versions; no long transaction. */
export async function exportLabelDesigns(p:LabelParams,input:{kind:"TEMPLATES"|"VERSIONS"|"ASSETS";after?:string}):Promise<{rows:readonly unknown[];next:string|null}>{
 const after=input.after===undefined?null:labelId(input.after);
 if(!["TEMPLATES","VERSIONS","ASSETS"].includes(input.kind))throw new AppError("VALIDATION_FAILED");
 return runTenantQuery({...p,permission:"labels.view"},async(tx,m)=>{
  const finish=async(rows:readonly unknown[],next:string|null)=>{await labelAudit(tx,m,p,"data.exported",m.tenantId,{kind:`LABEL_${input.kind}`,rows:rows.length,more:next!==null});return{rows,next};};
  if(input.kind==="ASSETS"){
   const rows=await tx.execute<{id:string;png:Buffer;width:number;height:number}>(sql`SELECT id,png,width,height FROM public.label_assets WHERE tenant_id=${m.tenantId}::uuid AND (${after}::uuid IS NULL OR id>${after}::uuid) ORDER BY id LIMIT 11`);
   return finish(rows.slice(0,10).map(a=>({id:a.id,width:a.width,height:a.height,png:a.png.toString("base64")})),rows.length>10?(rows[9]?.id??null):null);
  }
  const rows=input.kind==="TEMPLATES"
   ?await tx.execute<{id:string}>(sql`SELECT id,name,context,draft,published_version_id,archived_at::text,version FROM public.label_templates WHERE tenant_id=${m.tenantId}::uuid AND (${after}::uuid IS NULL OR id>${after}::uuid) ORDER BY id LIMIT 26`)
   :await tx.execute<{id:string}>(sql`SELECT id,template_id,context,revision,design FROM public.label_template_versions WHERE tenant_id=${m.tenantId}::uuid AND (${after}::uuid IS NULL OR id>${after}::uuid) ORDER BY id LIMIT 26`);
  return finish(rows.slice(0,25),rows.length>25?(rows[24]?.id??null):null);
 });
}

/** User+membership+tenant introduction state. Uses the existing immutable audit metadata, never a browser-only seen flag. */
export async function getLabelGuideSeen(p:LabelParams):Promise<boolean>{
 return runTenantQuery({...p,permission:'labels.view'},async(tx,m)=>{
  const rows=await tx.execute(sql`SELECT id FROM public.audit_logs WHERE tenant_id=${m.tenantId}::uuid AND entity_id=${m.membershipId}::text AND actor_user_id=${m.userId}::uuid AND action='label.guide_seen' AND change_summary @> '{"guideVersion":1}'::jsonb LIMIT 1`);return rows.length>0;
 });
}
export async function markLabelGuideSeen(p:LabelParams):Promise<void>{
 return labelWrite(p,'labels.design',async(tx,m)=>{
  if(!labelRights(m).view)throw new AppError('FORBIDDEN');
  const rows=await tx.execute(sql`SELECT id FROM public.audit_logs WHERE tenant_id=${m.tenantId}::uuid AND entity_id=${m.membershipId}::text AND actor_user_id=${m.userId}::uuid AND action='label.guide_seen' AND change_summary @> '{"guideVersion":1}'::jsonb LIMIT 1`);
  if(!rows[0])await labelAudit(tx,m,p,'label.guide_seen',m.membershipId,{guideVersion:1});
 });
}
