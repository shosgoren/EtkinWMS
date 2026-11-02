import {randomBytes,randomUUID} from "node:crypto";
import pg from "pg";
import {afterAll,beforeAll,expect,it} from "vitest";
import {createDbClient,withSystemTenant} from "../../../packages/db/src/index.ts";
import type {DbClient} from "../../../packages/db/src/client.ts";
import {createSealer} from "../../../packages/shared/src/seal.ts";
import {sealSecrets} from "../../../packages/domain/src/integrations/secrets.ts";
import {runIntegrationSync} from "../../../packages/domain/src/integrations/sync.ts";
import {ParasutClient} from "../../../packages/domain/src/integrations/parasut.ts";
import {assertLifecycleBinding,lifecycleBinding,observeProduct} from "../../../packages/domain/src/integrations/product-lifecycle.ts";
import {archiveItem} from "../../../packages/domain/src/catalog/items.ts";
import {searchItems} from "../../../packages/domain/src/catalog/reads.ts";
import {approveDocument,cancelDocument,createStockDocument,postDocument} from "../../../packages/domain/src/stock/index.ts";
import {newRegistry,seedWorld,type TenantWorld} from "../fixtures/tenants.ts";
import {readIntEnv} from "../harness/env.ts";
const env=readIntEnv(process.env);let adm:pg.Client,app:DbClient,A:TenantWorld,B:TenantWorld;const ids=new Map<string,string>();
beforeAll(async()=>{adm=new pg.Client({connectionString:env.databaseUrlDirect});await adm.connect();app=createDbClient({url:env.databaseUrl,poolMax:2,prepare:false});A=await seedWorld(adm,newRegistry(),"LC1068A");B=await seedWorld(adm,newRegistry(),"LC1068B");
 for(const w of [A,B]){
  const id=randomUUID();ids.set(w.tenantId,id);
  await adm.query("INSERT INTO integration_oauth_apps(tenant_id,credentials) VALUES($1,'{\"v\":2,\"kid\":\"synthetic\",\"iv\":\"synthetic\",\"tag\":\"synthetic\",\"ct\":\"synthetic\"}')",[w.tenantId]);
  await adm.query("INSERT INTO integrations(tenant_id,id,provider,status,account_ref,connected_by,connected_membership_id,connected_at,credentials) VALUES($1,$2,'PARASUT','CONNECTED','115',$3,$4,clock_timestamp(),$5::jsonb)",[w.tenantId,id,w.ownerUserId,w.ownerMembershipId,JSON.stringify({v:2,kid:"synthetic",iv:"synthetic",tag:"synthetic",ct:"synthetic"})]);
  await adm.query("INSERT INTO integration_flows(tenant_id,integration_id,flow,direction,enabled,enabled_at) VALUES($1,$2,'PRODUCTS','PULL',true,clock_timestamp())",[w.tenantId,id]);
 }
},120000);
afterAll(async()=>{await adm?.end();await app?.close();});
const ac=(w:TenantWorld)=>({tenantId:w.tenantId,system:"PARASUT",actorUserId:w.ownerUserId,membershipId:w.ownerMembershipId});
const params=(w=A)=>({db:app,principal:{userId:w.ownerUserId,mfaVerified:true},tenantSlug:w.slug});
const command=(w=A)=>({...params(w),clientKey:randomUUID(),retry:{sleep:async()=>undefined}});
async function fresh(code:string,w=A){const id=randomUUID();await adm.query("INSERT INTO items(tenant_id,id,code,name,base_unit_id,tracking_mode,quantity_scale) VALUES($1,$2,$3,$3,$4,'NONE',6)",[w.tenantId,id,code,w.unitId]);await link(id,code,w);return id;}
async function link(id:string,ext:string,w=A){await adm.query("INSERT INTO external_refs(tenant_id,system,entity_type,entity_id,external_id) VALUES($1,'PARASUT','ITEM',$2,$3)",[w.tenantId,id,ext]);}
async function observe(ext:string,observation:{exists:true;archived:unknown}|{exists:false},time=Date.now(),w=A){return withSystemTenant(app,w.tenantId,"test.lifecycle",async tx=>{const b=await lifecycleBinding(tx,w.tenantId,ids.get(w.tenantId)!,true);expect(b).not.toBeNull();return observeProduct(tx,b!,ac(w),ext,observation,time);});}
async function row(id:string,w=A){return (await adm.query("SELECT status,source_state,source_disposition,source_managed_archive FROM items WHERE tenant_id=$1 AND id=$2",[w.tenantId,id])).rows[0];}
it("archives an unused source card and restores only integration-owned archives",async()=>{
 const id=await fresh("unused");await observe("unused",{exists:true,archived:true});expect(await row(id)).toMatchObject({status:"ARCHIVED",source_managed_archive:true,source_disposition:"ARCHIVED"});
 await observe("unused",{exists:true,archived:false});expect(await row(id)).toMatchObject({status:"ACTIVE",source_disposition:"NONE"});
 await observe("unused",{exists:true,archived:true});
 // T-1201: "Paraşüt'ten al" yönünde bağlı ürünün arşivi kullanıcıya kapalı; sahiplik kuralı iki yönlüde geçerli.
 await expect(archiveItem(params(),{itemId:id})).rejects.toMatchObject({detail:"SOURCE_MANAGED_ARCHIVE"});
 await adm.query("UPDATE integration_flows SET direction='BOTH' WHERE tenant_id=$1 AND flow='PRODUCTS'",[A.tenantId]);
 try{await archiveItem(params(),{itemId:id});}finally{await adm.query("UPDATE integration_flows SET direction='PULL' WHERE tenant_id=$1 AND flow='PRODUCTS'",[A.tenantId]);}
 await observe("unused",{exists:true,archived:false});expect(await row(id)).toMatchObject({status:"ARCHIVED",source_managed_archive:false});
});
it("requires two spaced exact-identity missing observations and exposes removed separately",async()=>{
 const id=await fresh("missing"),t=Date.now();await observe("missing",{exists:false},t);expect((await row(id)).status).toBe("ACTIVE");
 await observe("missing",{exists:false},t+29999);expect((await row(id)).status).toBe("ACTIVE");
 await observe("missing",{exists:false},t+30000);expect(await row(id)).toMatchObject({status:"ARCHIVED",source_state:"DELETED",source_disposition:"REMOVED"});
 expect((await searchItems(params(),{q:"missing",status:"REMOVED",withTotal:true})).total).toBe(1);
 expect((await searchItems(params(),{q:"missing",status:"ARCHIVED",withTotal:true})).total).toBe(0);
 expect((await searchItems(params(B),{q:"missing",status:"REMOVED",withTotal:true})).total).toBe(0);
 await observe("missing",{exists:true,archived:false},t+31000);expect((await row(id)).status).toBe("ACTIVE");
});
it("positive evidence resets missing history and unknown archived never reopens a source archive",async()=>{
 const id=await fresh("positive"),t=Date.now();await observe("positive",{exists:false},t);await observe("positive",{exists:true,archived:undefined},t+40000);await observe("positive",{exists:false},t+50000);expect((await row(id)).status).toBe("ACTIVE");
 await observe("positive",{exists:true,archived:true});await observe("positive",{exists:true,archived:undefined});expect((await row(id)).status).toBe("ARCHIVED");
});
it("reconnect/config changes invalidate old evidence and stale binding",async()=>{
 const id=await fresh("reconnect"),t=Date.now();await observe("reconnect",{exists:false},t);
 const old=await withSystemTenant(app,A.tenantId,"test.lifecycle",tx=>lifecycleBinding(tx,A.tenantId,ids.get(A.tenantId)!));
 await adm.query("UPDATE integration_oauth_apps SET version=gen_random_uuid() WHERE tenant_id=$1",[A.tenantId]);
 await expect(withSystemTenant(app,A.tenantId,"test.lifecycle",tx=>assertLifecycleBinding(tx,old!))).resolves.toBe(false);
 await observe("reconnect",{exists:false},t+40000);expect((await row(id)).status).toBe("ACTIVE");
 await adm.query("UPDATE integration_flows SET enabled=false WHERE tenant_id=$1 AND integration_id=$2",[A.tenantId,ids.get(A.tenantId)]);
 await expect(withSystemTenant(app,A.tenantId,"test.lifecycle",tx=>lifecycleBinding(tx,A.tenantId,ids.get(A.tenantId)!,true))).resolves.toBeNull();
 await adm.query("UPDATE integration_flows SET enabled=true WHERE tenant_id=$1 AND integration_id=$2",[A.tenantId,ids.get(A.tenantId)]);
});
it("pending preserves current stock; depletion completes and next observation archives without altering the ledger",async()=>{
 const itemId=await fresh("stocked");
 const incoming=await createStockDocument(command(),{kind:"STOCK_IN",warehouseId:A.warehouseId,lines:[{itemId,unitId:A.unitId,targetLocationId:A.rootLocationId,quantity:"10",baseQuantity:"10",conversionFactor:"1"}]});
 const n=async()=>(await adm.query("SELECT count(*)::int n FROM stock_ledger WHERE tenant_id=$1",[A.tenantId])).rows[0]?.n;
 const before=await n();await observe("stocked",{exists:true,archived:true});expect(await n()).toBe(before);expect(await row(itemId)).toMatchObject({status:"ACTIVE",source_disposition:"PENDING"});
 await approveDocument(command(),{documentId:incoming.documentId as string,expectedVersion:1});await postDocument(command(),{documentId:incoming.documentId as string,expectedVersion:2});
 const d=await createStockDocument(command(),{kind:"STOCK_OUT",warehouseId:A.warehouseId,lines:[{itemId,unitId:A.unitId,sourceLocationId:A.rootLocationId,quantity:"10",baseQuantity:"10",conversionFactor:"1"}]});
 await approveDocument(command(),{documentId:d.documentId as string,expectedVersion:1});await postDocument(command(),{documentId:d.documentId as string,expectedVersion:2});
 const after=await n();await observe("stocked",{exists:true,archived:true});expect(await n()).toBe(after);expect(await row(itemId)).toMatchObject({status:"ARCHIVED",source_disposition:"ARCHIVED"});
});
it("an open document defers archival even with no balance, and cancelling it allows archival",async()=>{
 const id=await fresh("openwork");const d=await createStockDocument(command(),{kind:"STOCK_IN",warehouseId:A.warehouseId,lines:[{itemId:id,unitId:A.unitId,targetLocationId:A.rootLocationId,quantity:"1",baseQuantity:"1",conversionFactor:"1"}]});
 await observe("openwork",{exists:true,archived:true});expect((await row(id)).source_disposition).toBe("PENDING");
 // Existing draft remains eligible. Its command cancellation is exercised by common stock regressions; fixture closes the header here.
 await cancelDocument(command(),{documentId:d.documentId as string,expectedVersion:1});await observe("openwork",{exists:true,archived:true});expect((await row(id)).status).toBe("ARCHIVED");
});

async function syncWith(w:TenantWorld,fetcher:NonNullable<ConstructorParameters<typeof ParasutClient>[0]>["fetch"],now=Date.now()){
 const sealer=createSealer(randomBytes(32).toString("hex"));const box=sealSecrets(sealer,w.tenantId,"PARASUT",{clientId:"synthetic",clientSecret:"synthetic",accessToken:"synthetic",refreshToken:"synthetic",accessExpiresAt:String(now+7200000)});
 await adm.query("UPDATE integrations SET credentials=$2::jsonb WHERE tenant_id=$1",[w.tenantId,JSON.stringify(box)]);
 const client=new ParasutClient({fetch:fetcher!,sleep:async()=>undefined});
 const deps={inTenant:<T>(fn:Parameters<typeof withSystemTenant<T>>[3])=>withSystemTenant(app,w.tenantId,"test.lifecycle",fn),sealer,client,now:()=>now};
 return runIntegrationSync(deps,{integrationId:ids.get(w.tenantId)!,flow:'PRODUCTS',trigger:'SCHEDULE'},null);
}
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const companyBody={data:{id:'1',type:'users'},included:[{id:'115',type:'companies',attributes:{name:'Synthetic'}}]};
it("a wrong resource type cannot drive lifecycle; valid sync still archives without changing stock",async()=>{
 const id=await fresh("991",B);let correct=false;
 const fetcher=async(url:URL|string)=>{
  const path=new URL(String(url)).pathname;
  return response(path==='/v4/me'?companyBody:
    path.endsWith('/products/991')?{data:{id:'991',type:'products',attributes:{archived:false}}}:
    {data:[{id:'991',type:correct?'products':'contacts',attributes:{name:'Typed',unit:'adet',archived:true}}],meta:{total_pages:1}});
 };
 const wrong=await syncWith(B,fetcher);expect(wrong).toMatchObject({kind:'ran',flows:[{status:'PARTIAL'}]});expect((await row(id,B)).status).toBe('ACTIVE');
 correct=true;expect(await syncWith(B,fetcher)).toMatchObject({kind:'ran',flows:[{status:'SUCCESS'}]});expect((await row(id,B)).status).toBe('ARCHIVED');
});
it("failed company access and provider errors never create a missing/deleted observation",async()=>{
 const id=await fresh("992",B);
 const run=async(status:number,company=true)=>syncWith(B,async url=>{
  const path=new URL(String(url)).pathname;
  if(path==='/v4/me')return response(company?companyBody:{data:{id:'1',type:'users'},included:[]});
  if(path.includes('/products/'))return response({errors:[{title:'Synthetic refusal'}]},status);
  return response({data:[],meta:{total_pages:1}});
 }).catch(()=>null);
 for(const status of [401,403,500]){await run(status);expect((await row(id,B)).status).toBe('ACTIVE');expect((await adm.query('SELECT source_missing_since FROM items WHERE id=$1',[id])).rows[0]?.source_missing_since).toBeNull();}
 await run(404,false);expect((await row(id,B)).source_state).toBe('ACTIVE');
});
it("source archival serializes against a concurrent new receipt without stock writes",async()=>{
 const id=await fresh("race"),b=await withSystemTenant(app,A.tenantId,"test.lifecycle",tx=>lifecycleBinding(tx,A.tenantId,ids.get(A.tenantId)!));
 let release!:()=>void,held!:()=>void;const barrier=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>held=r);
 const archive=withSystemTenant(app,A.tenantId,"test.lifecycle",async tx=>{expect(await assertLifecycleBinding(tx,b!)).toBe(true);await observeProduct(tx,b!,ac(A),'race',{exists:true,archived:true});held();await barrier;});
 await ready;let settled=false;
 const incoming=createStockDocument(command(),{kind:'STOCK_IN',warehouseId:A.warehouseId,lines:[{itemId:id,unitId:A.unitId,targetLocationId:A.rootLocationId,quantity:'1',baseQuantity:'1',conversionFactor:'1'}]}).then(()=>({ok:true}),()=>({ok:false})).finally(()=>{settled=true;});
 try {await new Promise(r=>setTimeout(r,80));expect(settled).toBe(false);}finally{release();}
 await archive;expect(await incoming).toEqual({ok:false});
 expect((await adm.query('SELECT count(*)::int n FROM stock_dimensions WHERE tenant_id=$1 AND item_id=$2',[A.tenantId,id])).rows[0]?.n).toBe(0);
});

it("token selection cannot bind an old response to a new OAuth configuration generation",async()=>{
 for(const phase of ['token','after-token'] as const){
  const code=phase==='token'?'993':'994',id=await fresh(code,B),sealer=createSealer(randomBytes(32).toString('hex'));
  const box=sealSecrets(sealer,B.tenantId,'PARASUT',{clientId:'synthetic',clientSecret:'synthetic',accessToken:'synthetic',refreshToken:'synthetic',accessExpiresAt:String(Date.now()+7200000)});
  await adm.query('UPDATE integrations SET credentials=$2::jsonb WHERE tenant_id=$1',[B.tenantId,JSON.stringify(box)]);
  let changed=false;
  const inTenant=async<T>(fn:Parameters<typeof withSystemTenant<T>>[3]):Promise<T>=>{
    const value=await withSystemTenant(app,B.tenantId,'test.lifecycle',fn);
    if(!changed&&((phase==='token'&&typeof value==='object'&&value!==null&&'credentials' in value)||(phase==='after-token'&&value===true))){
      changed=true;await adm.query('UPDATE integration_oauth_apps SET version=gen_random_uuid() WHERE tenant_id=$1',[B.tenantId]);
    }return value;
  };
  const client=new ParasutClient({fetch:async url=>response(new URL(String(url)).pathname==='/v4/me'?companyBody:{data:[{id:code,type:'products',attributes:{name:code,unit:'adet',archived:true}}],meta:{total_pages:1}})});
  await runIntegrationSync({inTenant,client,sealer},{integrationId:ids.get(B.tenantId)!,flow:'PRODUCTS',trigger:'SCHEDULE'},null);
  expect(changed).toBe(true);expect((await row(id,B)).status).toBe('ACTIVE');expect((await row(id,B)).source_state).toBe('ACTIVE');
 }
});
