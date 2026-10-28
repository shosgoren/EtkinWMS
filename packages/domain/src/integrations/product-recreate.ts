// T-1071: a new source identity can replace only a proven-deleted one. Network stays outside DB locks.
import {sql} from "drizzle-orm";
import {appendAudit} from "@wms/db";
import {applyProduct,lockProductIdentityNamespace,type ApplyContext,type ProviderProduct} from "./apply.ts";
import {assertLifecycleBinding,lifecycleContext,observeProduct,type LifecycleBinding} from "./product-lifecycle.ts";
import type {ParasutClient} from "./parasut.ts";
import {productSourceInfo} from "./product-info.ts";
import type {RunTx} from "./store.ts";

type Candidate={item_id:string;ref_id:string;external_id:string;version:number};
export async function reconnectRecreatedProduct(inTenant:RunTx,client:ParasutClient,token:string,b:LifecycleBinding,c:ApplyContext,p:ProviderProduct,now=Date.now()):Promise<boolean> {
 if(c.system!=='PARASUT'||!p.code||p.code.length>64||!/^[0-9]{1,18}$/.test(p.externalId))return false;
 const candidate=await inTenant(async tx=>{
  if(!(await assertLifecycleBinding(tx,b)))return null;
  const rows=await tx.execute<Candidate>(sql`SELECT i.id AS item_id,r.id AS ref_id,r.external_id,r.version FROM public.items i
   JOIN public.external_refs r ON r.tenant_id=i.tenant_id AND r.entity_id=i.id AND r.entity_type='ITEM' AND r.system='PARASUT'
   WHERE i.tenant_id=${b.tenantId}::uuid AND i.code=${p.code} AND i.source_state='DELETED'
   AND (i.source_managed_archive OR (i.status='ACTIVE' AND i.source_disposition='PENDING'))
   AND r.external_id<>${p.externalId} AND r.external_id ~ '^[0-9]{1,18}$'
   AND NOT (${p.externalId}=ANY(r.retired_external_ids))`);
  return rows[0]??null;
 });
 if(!candidate)return false;
 // Exact old identity is still absent; the caller has just verified access to this company.
 if(await client.product(token,b.companyId,candidate.external_id)!==null)return false;
 const unique=await client.uniqueActiveProductByCode(token,b.companyId,p.code);
 if(unique?.id!==p.externalId)return false;
 const fresh=await client.product(token,b.companyId,p.externalId);
 if(!fresh||fresh.attributes.code!==p.code||fresh.attributes.archived!==false)return false;
 return inTenant(async tx=>{
  if(!(await assertLifecycleBinding(tx,b)))return false;
  await lockProductIdentityNamespace(tx,c);
  const rows=await tx.execute<{source_missing_context:string|null;source_missing_since:Date|string|null}>(sql`SELECT source_missing_context,source_missing_since FROM public.items
   WHERE tenant_id=${b.tenantId}::uuid AND id=${candidate.item_id}::uuid AND code=${p.code} AND source_state='DELETED'
   AND (source_managed_archive OR (status='ACTIVE' AND source_disposition='PENDING')) FOR UPDATE`);
  if(rows[0]?.source_missing_context!==lifecycleContext(b,candidate.item_id,candidate.external_id)||!rows[0].source_missing_since||now-new Date(rows[0].source_missing_since).getTime()<30_000)return false;
  const refs=await tx.execute(sql`SELECT 1 FROM public.external_refs WHERE tenant_id=${b.tenantId}::uuid AND id=${candidate.ref_id}::uuid
   AND entity_id=${candidate.item_id}::uuid AND external_id=${candidate.external_id} AND version=${candidate.version} FOR UPDATE`);
  if(!refs.length)return false;
  const setting=await tx.execute<{enabled:boolean}>(sql`SELECT pull_product_barcodes AS enabled FROM public.integrations WHERE tenant_id=${b.tenantId}::uuid AND id=${b.integrationId}::uuid`);
  const replacement=await tx.execute<{ok:boolean}>(sql`SELECT public.replace_deleted_product_identity(${candidate.ref_id}::uuid,${candidate.version}::integer,${fresh.id}) AS ok`);
  if(replacement[0]?.ok!==true)return false;
  await observeProduct(tx,b,c,fresh.id,{exists:true,archived:false},now);
  const outcome=await applyProduct(tx,{...c,pullProductBarcodes:setting[0]?.enabled===true},{externalId:fresh.id,code:p.code,name:typeof fresh.attributes.name==='string'?fresh.attributes.name:null,
   unit:typeof fresh.attributes.unit==='string'?fresh.attributes.unit:null,barcode:typeof fresh.attributes.barcode==='string'?fresh.attributes.barcode:null,sourceInfo:productSourceInfo(fresh)});
  if(outcome==='SKIPPED')throw new Error('PRODUCT_RECONNECT_INVALID'); // Roll the mapping and status back with invalid card metadata.
  await appendAudit(tx,{action:'external_ref.linked',actorUserId:c.actorUserId,entityType:'external_ref',entityId:candidate.ref_id,
   changeSummary:{system:c.system,linkedEntityType:'ITEM',linkedEntityId:candidate.item_id,change:'source_recreated',via:'integration'}});
  return true;
 });
}
