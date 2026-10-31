// Source lifecycle changes catalog metadata only. Stable item/ref/QR identities and all stock history survive.
import {productLifecycleBusy} from "./product-lifecycle-reads.ts";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import type { AccessTx } from "../identity/access.ts";
import type { ApplyContext } from "./apply.ts";
import { SHARED_OAUTH_CONFIG_VERSION } from "./oauth.ts";

export interface LifecycleBinding {
 readonly tenantId:string; readonly integrationId:string; readonly companyId:string;
 readonly userId:string; readonly membershipId:string; readonly connectedAt:string; readonly configVersion:string|null;
 /** T-1140: cari / depo yaşam döngüsü bağlamı (yalnız o akış açıkken). Ürün bağlamında alan yoktur (eski bağlam özetleri değişmesin). */
 readonly flow?:"CONTACTS"|"WAREHOUSES";
}
export type LifecycleFlow="PRODUCTS"|"CONTACTS"|"WAREHOUSES";
/** Configuration first, then connection/flow/member; no network while locked. A stale run cannot mutate a reconnected tenant. */
export async function lifecycleBinding(tx:AccessTx,tenantId:string,integrationId:string,lock=false,flow:LifecycleFlow="PRODUCTS"):Promise<LifecycleBinding|null> {
 const app=await tx.execute<{version:string}>(sql`SELECT version FROM public.integration_oauth_apps WHERE tenant_id=${tenantId}::uuid ${lock?sql`FOR SHARE`:sql``}`);
 let configVersion=app[0]?.version??null;
 if(configVersion===null){
  // T-1133: ortak uygulama — bağlantı, yetki kodu akışıyla TAMAMLANAN (COMPLETE) ve bağlanma anını kapsayan bir denemeden geldiyse sürüm ortak
  // sabittir. Böyle deneme yoksa (T-1139 öncesi eski yöntem bağlantısı; 0068 bunları kesti) yaşam döngüsü kapalı kalır (sürümsüz bağlam çıkarılmaz).
  const shared=await tx.execute<{id:string}>(sql`
  SELECT a.id FROM public.integration_oauth_attempts a JOIN public.integrations i ON i.tenant_id=a.tenant_id AND i.connected_by=a.user_id AND i.connected_membership_id=a.membership_id
  WHERE a.tenant_id=${tenantId}::uuid AND i.id=${integrationId}::uuid AND i.provider='PARASUT' AND a.phase='COMPLETE' AND a.config_version=${SHARED_OAUTH_CONFIG_VERSION}::uuid
  AND a.created_at<=i.connected_at AND i.connected_at<=a.expires_at ${lock?sql`FOR SHARE OF a`:sql``} LIMIT 1`);
  if(!shared[0])return null;
  configVersion=SHARED_OAUTH_CONFIG_VERSION;
 }
 const rows=await tx.execute<{account_ref:string;connected_by:string;connected_membership_id:string;connected_at:string}>(sql`
 SELECT i.account_ref,i.connected_by,i.connected_membership_id,i.connected_at::text
 FROM public.integrations i JOIN public.integration_flows f ON f.tenant_id=i.tenant_id AND f.integration_id=i.id
 JOIN public.tenant_memberships m ON m.tenant_id=i.tenant_id AND m.id=i.connected_membership_id AND m.user_id=i.connected_by
 JOIN public.membership_roles r ON r.tenant_id=m.tenant_id AND r.membership_id=m.id
 WHERE i.tenant_id=${tenantId}::uuid AND i.id=${integrationId}::uuid AND i.provider='PARASUT' AND i.status='CONNECTED' AND i.account_ref IS NOT NULL
 AND f.flow=${flow} AND f.enabled AND f.direction IN ('PULL','BOTH') AND m.status='ACTIVE' AND r.role_key='TENANT_ADMIN'
 ${lock?sql`FOR SHARE OF i,f,m,r`:sql``}`);
 const r=rows[0];return r?{tenantId,integrationId,companyId:r.account_ref,userId:r.connected_by,membershipId:r.connected_membership_id,connectedAt:r.connected_at,configVersion,...(flow==="PRODUCTS"?{}:{flow})}:null;
}
export async function assertLifecycleBinding(tx:AccessTx,b:LifecycleBinding):Promise<boolean> {
 const now=await lifecycleBinding(tx,b.tenantId,b.integrationId,true,b.flow??"PRODUCTS");return now!==null&&JSON.stringify(now)===JSON.stringify(b);
}
export function context(b:LifecycleBinding,itemId:string,externalId:string):string {
 return createHash("sha256").update(JSON.stringify([b,itemId,externalId])).digest("hex");
}
/** Explicit references, discovered from actual item FKs, conservatively count as use (metadata labels/conversions excluded). */
async function used(tx:AccessTx,tenantId:string,itemId:string):Promise<boolean> {
 const refs=await tx.execute<{table_name:string;column_name:string}>(sql`
 SELECT DISTINCT t.relname AS table_name,a.attname AS column_name FROM pg_constraint c
 JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
 JOIN LATERAL unnest(c.conkey,c.confkey) AS k(local_key,remote_key) ON true
 JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.local_key
 JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attnum=k.remote_key
 WHERE c.contype='f' AND c.confrelid='public.items'::regclass AND b.attname='id' AND n.nspname='public'
 AND t.relname NOT IN ('item_barcodes','unit_conversions') ORDER BY t.relname,a.attname`);
 for(const ref of refs){
  const hit=await tx.execute(sql`SELECT 1 FROM public.${sql.identifier(ref.table_name)} WHERE tenant_id=${tenantId}::uuid AND ${sql.identifier(ref.column_name)}=${itemId}::uuid LIMIT 1`);
  if(hit.length)return true;
 }return false;
}

type Row={id:string;status:string;source_state:string;source_disposition:string;source_managed_archive:boolean;source_missing_since:Date|string|null;source_missing_context:string|null};
/** Called only with a currently locked binding. Positive identity evidence clears missing observations; absent archived flag never means active. */
export async function observeProduct(tx:AccessTx,b:LifecycleBinding,c:ApplyContext,externalId:string,observation:{exists:true;archived:unknown}|{exists:false},now=Date.now()):Promise<boolean> {
 const refs=await tx.execute<{entity_id:string}>(sql`SELECT entity_id FROM public.external_refs WHERE tenant_id=${b.tenantId}::uuid AND system=${c.system} AND entity_type='ITEM' AND external_id=${externalId} FOR SHARE`);
 const id=refs[0]?.entity_id;if(!id)return false;
 const rows=await tx.execute<Row>(sql`SELECT id,status,source_state,source_disposition,source_managed_archive,source_missing_since,source_missing_context FROM public.items WHERE tenant_id=${b.tenantId}::uuid AND id=${id}::uuid FOR UPDATE`);
 const row=rows[0];if(!row)return false;
 let state=row.source_state;
 const key=context(b,id,externalId);
 if(observation.exists){
  if(typeof observation.archived==='boolean'){
   state=observation.archived?'ARCHIVED':'ACTIVE';
   await tx.execute(sql`UPDATE public.items SET source_product_info=jsonb_set(source_product_info,ARRAY[${c.system}]::text[],coalesce(source_product_info->${c.system},'{}'::jsonb)||${JSON.stringify({archived:observation.archived})}::jsonb) WHERE tenant_id=${b.tenantId}::uuid AND id=${id}::uuid`);
  }
  await tx.execute(sql`UPDATE public.items SET source_missing_since=NULL,source_missing_context=NULL,source_checked_at=to_timestamp(${now}/1000.0) WHERE tenant_id=${b.tenantId}::uuid AND id=${id}::uuid`);
 }else{
  if(row.source_missing_context!==key||row.source_missing_since===null){
   await tx.execute(sql`UPDATE public.items SET source_missing_since=to_timestamp(${now}/1000.0),source_missing_context=${key},source_checked_at=to_timestamp(${now}/1000.0) WHERE tenant_id=${b.tenantId}::uuid AND id=${id}::uuid`);return false;
  }
  if(now-new Date(row.source_missing_since).getTime()<30_000)return false;
  state='DELETED';
 }
 let status=row.status,disposition='NONE',managed=row.source_managed_archive;
 if(state==='ACTIVE'){
  if(managed)status='ACTIVE';managed=false;
 }else if(row.status==='ACTIVE'&&await productLifecycleBusy(tx,b.tenantId,id)){
  disposition='PENDING';managed=false;
 }else{
  disposition=state==='DELETED'&&!(await used(tx,b.tenantId,id))?'REMOVED':'ARCHIVED';
  managed=row.status==='ACTIVE'||managed;status='ARCHIVED';
 }
 const changed=row.source_state!==state||row.source_disposition!==disposition||row.status!==status||row.source_managed_archive!==managed;
 await tx.execute(sql`UPDATE public.items SET source_state=${state},source_disposition=${disposition},source_managed_archive=${managed},status=${status},
 archived_at=CASE WHEN ${status}='ACTIVE' THEN NULL ELSE coalesce(archived_at,clock_timestamp()) END,
 source_changed_at=CASE WHEN ${state}='ACTIVE' THEN NULL ELSE coalesce(source_changed_at,clock_timestamp()) END,
 source_checked_at=to_timestamp(${now}/1000.0) WHERE tenant_id=${b.tenantId}::uuid AND id=${id}::uuid`);
 if(changed)await appendAudit(tx,{action:status==='ARCHIVED'?'item.archived':'item.updated',actorUserId:c.actorUserId,entityType:'item',entityId:id,changeSummary:{via:'integration',system:c.system,sourceState:state,disposition}});
 return changed;
}
export async function lifecycleCandidates(tx:AccessTx,b:LifecycleBinding,started:number):Promise<readonly {external_id:string}[]> {
 return tx.execute<{external_id:string}>(sql`SELECT r.external_id FROM public.external_refs r JOIN public.items i ON i.tenant_id=r.tenant_id AND i.id=r.entity_id
 WHERE r.tenant_id=${b.tenantId}::uuid AND r.system='PARASUT' AND r.entity_type='ITEM' AND r.external_id ~ '^[0-9]{1,18}$'
 AND (i.source_checked_at IS NULL OR i.source_checked_at<to_timestamp(${started}/1000.0))
 AND (i.source_state<>'DELETED' OR i.source_disposition='PENDING' OR i.source_checked_at<to_timestamp(${started-300_000}/1000.0))
 ORDER BY i.source_checked_at NULLS FIRST,i.id LIMIT 10`);
}
