import { sql } from "drizzle-orm";
import { AppError } from "@wms/shared/errors";
import { resolveLabelPrinter, type PrinterResolution } from "@wms/shared/labels";
import { runTenantQuery, type AccessTx, type Membership } from "../identity/access.ts";
import { LABEL_CAPS, labelId, labelName, labelVersion, labelWrite, labelAudit, type LabelParams } from "./common.ts";

export interface SaveLabelPrinter {readonly id?:string;readonly expectedVersion:number;readonly name:string;readonly dpi:203|300|600;readonly offsetX:number;readonly offsetY:number;readonly active:boolean}
export async function saveLabelPrinter(p:LabelParams,input:SaveLabelPrinter):Promise<{id:string;version:number}>{
 const name=labelName(input.name),version=labelVersion(input.expectedVersion,true),id=input.id===undefined?null:labelId(input.id);
 if(![203,300,600].includes(input.dpi)||typeof input.active!=="boolean"||![input.offsetX,input.offsetY].every(v=>Number.isInteger(v)&&Math.abs(v)<=10000)||(id===null)!==(version===0))throw new AppError("VALIDATION_FAILED");
 return labelWrite(p,"labels.printers",async(tx,m)=>{
  let rows:{id:string;version:number}[];
  if(id===null){
   const n=await tx.execute<{n:number}>(sql`SELECT count(*)::int AS n FROM public.label_printers WHERE tenant_id=${m.tenantId}::uuid`);
   if((n[0]?.n??LABEL_CAPS.printers)>=LABEL_CAPS.printers)throw new AppError("VALIDATION_FAILED");
   rows=await tx.execute(sql`INSERT INTO public.label_printers(tenant_id,name,dpi,offset_x,offset_y,active,created_by) VALUES(${m.tenantId}::uuid,${name},${input.dpi},${input.offsetX},${input.offsetY},${input.active},${m.membershipId}::uuid) RETURNING id,version`);
  }else{
   const found=await tx.execute(sql`SELECT id FROM public.label_printers WHERE tenant_id=${m.tenantId}::uuid AND id=${id}::uuid`);if(!found[0])throw new AppError("NOT_FOUND");
   rows=await tx.execute(sql`UPDATE public.label_printers SET name=${name},dpi=${input.dpi},offset_x=${input.offsetX},offset_y=${input.offsetY},active=${input.active},version=version+1 WHERE tenant_id=${m.tenantId}::uuid AND id=${id}::uuid AND version=${version} RETURNING id,version`);
  }
  const result=rows[0];if(!result)throw new AppError("VERSION_CONFLICT");
  await labelAudit(tx,m,p,"label.printer_saved",result.id,{version:result.version,active:input.active,mode:"SYSTEM_DIALOG"});return result;
 });
}
export interface SetLabelPrinterPreference {readonly templateId:string|null;readonly deviceId:string|null;readonly printerId:string|null;readonly expectedVersion:number}
export async function setLabelPrinterPreference(p:LabelParams,input:SetLabelPrinterPreference):Promise<{id:string;version:number}>{
 const template=input.templateId===null?null:labelId(input.templateId),device=input.deviceId===null?null:labelId(input.deviceId),printer=input.printerId===null?null:labelId(input.printerId),version=labelVersion(input.expectedVersion,true);
 return labelWrite(p,"labels.printers",async(tx,m)=>{
  if(template!==null){const t=await tx.execute(sql`SELECT id FROM public.label_templates WHERE tenant_id=${m.tenantId}::uuid AND id=${template}::uuid AND archived_at IS NULL`);if(!t[0])throw new AppError("NOT_FOUND");}
  if(printer!==null){const t=await tx.execute(sql`SELECT id FROM public.label_printers WHERE tenant_id=${m.tenantId}::uuid AND id=${printer}::uuid AND active`);if(!t[0])throw new AppError("NOT_FOUND");}
  const member=device===null?null:m.membershipId;
  const old=await tx.execute<{id:string;version:number}>(sql`SELECT id,version FROM public.label_preferences WHERE tenant_id=${m.tenantId}::uuid AND template_id IS NOT DISTINCT FROM ${template}::uuid AND membership_id IS NOT DISTINCT FROM ${member}::uuid AND device_id IS NOT DISTINCT FROM ${device}::uuid`);
  let rows:{id:string;version:number}[];
  if(old[0]){
   if(old[0].version!==version)throw new AppError("VERSION_CONFLICT");
   rows=await tx.execute(sql`UPDATE public.label_preferences SET printer_id=${printer}::uuid,version=version+1,updated_at=now() WHERE tenant_id=${m.tenantId}::uuid AND id=${old[0].id}::uuid AND version=${version} RETURNING id,version`);
  }else{
   if(version!==0)throw new AppError("VERSION_CONFLICT");
   rows=await tx.execute(sql`INSERT INTO public.label_preferences(tenant_id,template_id,membership_id,device_id,printer_id) VALUES(${m.tenantId}::uuid,${template}::uuid,${member}::uuid,${device}::uuid,${printer}::uuid) RETURNING id,version`);
  }
  const result=rows[0];if(!result)throw new AppError("VERSION_CONFLICT");
  await labelAudit(tx,m,p,"label.preference_changed",result.id,{template:template,personal:device!==null,printer});return result;
 });
}
export async function resolveLabelPrinterInTx(tx:AccessTx,m:Membership,templateId:string,deviceId:string|null):Promise<PrinterResolution>{
 const rows=await tx.execute<{template_id:string|null;membership_id:string|null;printer_id:string|null}>(sql`SELECT template_id,membership_id,printer_id FROM public.label_preferences WHERE tenant_id=${m.tenantId}::uuid AND (template_id IS NULL OR template_id=${templateId}::uuid) AND (membership_id IS NULL OR (membership_id=${m.membershipId}::uuid AND device_id=${deviceId}::uuid))`);
 const find=(template:boolean,personal:boolean)=>rows.find(r=>(r.template_id!==null)===template&&(r.membership_id!==null)===personal)?.printer_id??null;
 const printers=await tx.execute<{id:string;name:string;mode:"SYSTEM_DIALOG";active:boolean}>(sql`SELECT id,name,mode,active FROM public.label_printers WHERE tenant_id=${m.tenantId}::uuid`);
 return resolveLabelPrinter({templateDevice:find(true,true),templateCompany:find(true,false),generalDevice:find(false,true),generalCompany:find(false,false)},printers.map(r=>({...r,bridgeReady:false})));
}
export async function getLabelPrinterChoice(p:LabelParams,input:{templateId:string;deviceId:string|null}):Promise<PrinterResolution>{
 const id=labelId(input.templateId),device=input.deviceId===null?null:labelId(input.deviceId);
 return runTenantQuery({...p,permission:"labels.print"},async(tx,m)=>{
  const found=await tx.execute(sql`SELECT id FROM public.label_templates WHERE tenant_id=${m.tenantId}::uuid AND id=${id}::uuid AND archived_at IS NULL`);if(!found[0])throw new AppError("NOT_FOUND");
  return resolveLabelPrinterInTx(tx,m,id,device);
 });
}
