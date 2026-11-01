import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import type { LabelDesign, LabelRights } from "@wms/shared/labels";
import { runTenantCommand, type TenantAccessParams, type AccessTx, type Membership } from "../identity/access.ts";
import { hasPermission, type Permission } from "../identity/permissions.ts";
export type LabelParams=Omit<TenantAccessParams,"permission">&{readonly requestId?:string};
export const LABEL_CAPS={templates:200,assets:100,printers:30} as const;
export function labelId(v:unknown):string {if(typeof v!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))throw new AppError("VALIDATION_FAILED");return v;}
export function labelVersion(v:unknown,initial=false):number {if(typeof v!=="number"||!Number.isSafeInteger(v)||v<(initial?0:1)||v>2147483646)throw new AppError("VALIDATION_FAILED");return v;}
export function labelName(v:unknown):string {if(typeof v!=="string")throw new AppError("VALIDATION_FAILED");const s=v.trim();if(!s||s.length>80||/[\u0000-\u001f\u007f]/.test(s))throw new AppError("VALIDATION_FAILED");return s;}
export function labelRights(m:Membership):LabelRights {return{view:hasPermission(m.roles,"labels.view",m.grants),design:hasPermission(m.roles,"labels.design",m.grants),publish:hasPermission(m.roles,"labels.publish",m.grants),print:hasPermission(m.roles,"labels.print",m.grants),printers:hasPermission(m.roles,"labels.printers",m.grants)};}
export async function labelWrite<T>(p:LabelParams,permission:Permission,fn:(tx:AccessTx,m:Membership)=>Promise<T>):Promise<T>{
 const{requestId:_requestId,...access}=p;void _requestId;
 return runTenantCommand({...access,permission},async(tx,m)=>{
  // Metadata namespace, never a stock lock. Serializes finite label quotas and preferences without stock mutations.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${m.tenantId}:label-metadata`},0))`);
  return fn(tx,m);
 });
}
export async function assertLabelAssets(tx:AccessTx,tenant:string,design:LabelDesign):Promise<void>{
 const ids=[...new Set(design.elements.flatMap(e=>e.kind==="logo"?[e.assetId]:[]))];if(ids.length===0)return;
 const rows=await tx.execute<{id:string}>(sql`SELECT id FROM public.label_assets WHERE tenant_id=${tenant}::uuid AND id IN (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`, `)})`);
 if(rows.length!==ids.length)throw new AppError("NOT_FOUND");
}
export async function labelAudit(tx:AccessTx,m:Membership,p:LabelParams,action:Parameters<typeof appendAudit>[1]["action"],id:string,summary:Record<string,string|number|boolean|null>):Promise<void>{
 await appendAudit(tx,{action,actorUserId:m.userId,entityType:"label",entityId:id,requestId:p.requestId??null,changeSummary:summary});
}
