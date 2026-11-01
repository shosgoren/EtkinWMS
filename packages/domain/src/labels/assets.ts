import { sql } from "drizzle-orm";
import { AppError } from "@wms/shared/errors";
import { runTenantQuery } from "../identity/access.ts";
import { normalizeLabelPng } from "./png.ts";
import { LABEL_CAPS, labelId, labelWrite, labelAudit, type LabelParams } from "./common.ts";

export async function uploadLabelLogo(p:LabelParams,input:Buffer):Promise<{id:string;width:number;height:number}>{
 return labelWrite(p,"labels.design",async(tx,m)=>{
  const logo=normalizeLabelPng(input);
  const old=await tx.execute<{id:string}>(sql`SELECT id FROM public.label_assets WHERE tenant_id=${m.tenantId}::uuid AND sha256=${logo.sha256}`);
  if(old[0])return{id:old[0].id,width:logo.width,height:logo.height};
  const count=await tx.execute<{n:number}>(sql`SELECT count(*)::int AS n FROM public.label_assets WHERE tenant_id=${m.tenantId}::uuid`);
  if((count[0]?.n??LABEL_CAPS.assets)>=LABEL_CAPS.assets)throw new AppError("VALIDATION_FAILED");
  const rows=await tx.execute<{id:string}>(sql`INSERT INTO public.label_assets(tenant_id,png,sha256,width,height,created_by) VALUES(${m.tenantId}::uuid,${logo.png},${logo.sha256},${logo.width},${logo.height},${m.membershipId}::uuid) RETURNING id`);
  const id=rows[0]?.id;if(!id)throw new AppError("INTERNAL");
  await labelAudit(tx,m,p,"label.asset_added",id,{width:logo.width,height:logo.height});return{id,width:logo.width,height:logo.height};
 });
}
export async function readLabelLogo(p:LabelParams,assetId:string):Promise<Buffer>{
 const id=labelId(assetId);
 return runTenantQuery({...p,permission:"labels.view"},async(tx,m)=>{
  const rows=await tx.execute<{png:Buffer}>(sql`SELECT png FROM public.label_assets WHERE tenant_id=${m.tenantId}::uuid AND id=${id}::uuid`);
  if(!rows[0])throw new AppError("NOT_FOUND");return normalizeLabelPng(rows[0].png).png;
 });
}
