import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {sql} from '../../../packages/db/node_modules/drizzle-orm/index.js';
import {createDbClient,withSystemTenant} from '../../../packages/db/src/index.ts';
import type {DbClient} from '../../../packages/db/src/client.ts';
import {createSealer} from '../../../packages/shared/src/seal.ts';
import {applyProduct} from '../../../packages/domain/src/integrations/apply.ts';
import {lifecycleBinding,observeProduct,type LifecycleBinding} from '../../../packages/domain/src/integrations/product-lifecycle.ts';
import {reconnectRecreatedProduct} from '../../../packages/domain/src/integrations/product-recreate.ts';
import {ParasutClient} from '../../../packages/domain/src/integrations/parasut.ts';
import {runIntegrationSync} from '../../../packages/domain/src/integrations/sync.ts';
import {sealSecrets} from '../../../packages/domain/src/integrations/secrets.ts';
import {archiveItem} from '../../../packages/domain/src/catalog/items.ts';
import {createStockDocument} from '../../../packages/domain/src/stock/index.ts';
import {newRegistry,seedWorld,type TenantWorld} from '../fixtures/tenants.ts';
import {readIntEnv} from '../harness/env.ts';
const env=readIntEnv(process.env);let adm:pg.Client,app:DbClient,A:TenantWorld,B:TenantWorld;let sequence=71000;const ids=new Map<string,string>();
const inTenant=<T>(w:TenantWorld,fn:Parameters<typeof withSystemTenant<T>>[3])=>withSystemTenant(app,w.tenantId,'test.recreate',fn);
const ac=(w=A)=>({tenantId:w.tenantId,system:'PARASUT',actorUserId:w.ownerUserId,membershipId:w.ownerMembershipId});
beforeAll(async()=>{
 adm=new pg.Client({connectionString:env.databaseUrlDirect});await adm.connect();app=createDbClient({url:env.databaseUrl,poolMax:4,prepare:false});
 A=await seedWorld(adm,newRegistry(),'RECREATE1071A');B=await seedWorld(adm,newRegistry(),'RECREATE1071B');
 for(const w of [A,B]){
  const id=randomUUID();ids.set(w.tenantId,id);
  await adm.query(`INSERT INTO integration_oauth_apps(tenant_id,credentials) VALUES($1,'{"v":2,"kid":"synthetic","iv":"synthetic","tag":"synthetic","ct":"synthetic"}')`,[w.tenantId]);
  await adm.query(`INSERT INTO integrations(tenant_id,id,provider,status,account_ref,connected_by,connected_membership_id,connected_at,credentials) VALUES($1,$2,'PARASUT','CONNECTED','115',$3,$4,clock_timestamp(),'{"v":2,"kid":"synthetic","iv":"synthetic","tag":"synthetic","ct":"synthetic"}')`,[w.tenantId,id,w.ownerUserId,w.ownerMembershipId]);
  await adm.query(`INSERT INTO integration_flows(tenant_id,integration_id,flow,direction,enabled,enabled_at) VALUES($1,$2,'PRODUCTS','PULL',true,clock_timestamp())`,[w.tenantId,id]);
 }
},120000);
afterAll(async()=>{await app?.close();await adm?.end();});
const response=(b:unknown,status=200)=>new Response(JSON.stringify(b),{status,headers:{'content-type':'application/json'}});
async function deleted(code?:string){
 const old=String(++sequence),next=String(++sequence),c=code??`RC-${old}`;
 await inTenant(A,tx=>applyProduct(tx,ac(),{externalId:old,code:c,name:'Before',unit:'adet'}));
 const r=(await adm.query(`SELECT i.id,r.id ref_id FROM items i JOIN external_refs r ON r.tenant_id=i.tenant_id AND r.entity_id=i.id WHERE i.tenant_id=$1 AND i.code=$2`,[A.tenantId,c])).rows[0] as {id:string;ref_id:string};
 const b=await inTenant(A,tx=>lifecycleBinding(tx,A.tenantId,ids.get(A.tenantId)!,true));expect(b).not.toBeNull();
 const t=Date.now()-40000;
 await inTenant(A,tx=>observeProduct(tx,b!,ac(),old,{exists:false},t));await inTenant(A,tx=>observeProduct(tx,b!,ac(),old,{exists:false},t+30000));
 return {...r,old,next,code:c,b:b!,product:{externalId:next,code:c,name:'After',unit:'adet'}};
}
type Fixture=Awaited<ReturnType<typeof deleted>>;
async function state(f:Fixture){return (await adm.query(`SELECT i.id,i.name,i.status,i.source_state,i.source_disposition,i.base_unit_id,r.id ref_id,r.external_id,r.retired_external_ids,
 (SELECT array_agg(barcode ORDER BY barcode) FROM item_barcodes WHERE tenant_id=i.tenant_id AND item_id=i.id) barcodes
 FROM items i JOIN external_refs r ON r.tenant_id=i.tenant_id AND r.entity_id=i.id WHERE i.tenant_id=$1 AND i.id=$2`,[A.tenantId,f.id])).rows[0];}
function client(f:Fixture,options:{oldStatus?:number;duplicates?:boolean;archived?:boolean;unit?:string;barcode?:string;companies?:boolean;beforeNew?:()=>Promise<void>}={}){
 return new ParasutClient({sleep:async()=>undefined,fetch:async raw=>{
  const url=new URL(String(raw)),fresh={id:f.next,type:'products',attributes:{code:f.code,name:'After',unit:options.unit??'adet',archived:options.archived??false,...(options.barcode?{barcode:options.barcode}:{})}};
  if(url.pathname==='/v4/me')return response({data:{id:'1',type:'users'},included:options.companies===false?[]:[{id:'115',type:'companies',attributes:{name:'Synthetic'}}]});
  if(url.pathname.endsWith('/products/'+f.old))return response(options.oldStatus===200?{data:{id:f.old,type:'products',attributes:{archived:false}}}:{errors:[]},options.oldStatus??404);
  if(url.pathname.endsWith('/products/'+f.next)){await options.beforeNew?.();return response({data:fresh});}
  if(url.pathname.includes('/products/'))return response({errors:[]},404);
  return response({data:options.duplicates?[fresh,{...fresh,id:String(++sequence)}]:[fresh],meta:{total_pages:1,total_count:options.duplicates?2:1}});
 }});
}
const reconnect=(f:Fixture,c=client(f),b:LifecycleBinding=f.b)=>reconnectRecreatedProduct(fn=>inTenant(A,fn),c,'synthetic',b,ac(),f.product);
it('same-code 0001 returns with the same item/ref IDs and labels, once, without inventory writes',async()=>{
 const f=await deleted('0001'),before=await state(f),stock=await adm.query('SELECT count(*)::int n FROM stock_ledger WHERE tenant_id=$1',[A.tenantId]);
 expect(await reconnect(f)).toBe(true);expect(await state(f)).toMatchObject({id:f.id,ref_id:f.ref_id,name:'After',status:'ACTIVE',source_state:'ACTIVE',source_disposition:'NONE',external_id:f.next,retired_external_ids:[f.old],barcodes:before.barcodes,base_unit_id:before.base_unit_id});
 expect(await reconnect(f)).toBe(false);expect((await state(f)).retired_external_ids).toEqual([f.old]);
 expect((await adm.query('SELECT count(*)::int n FROM stock_ledger WHERE tenant_id=$1',[A.tenantId])).rows).toEqual(stock.rows);
 expect(await inTenant(A,tx=>observeProduct(tx,f.b,ac(),f.old,{exists:false},Date.now()+60000))).toBe(false);expect((await state(f)).status).toBe('ACTIVE');
});
it('old source still exists, is forbidden, rate limited or unavailable: no replacement',async()=>{
 for(const status of [200,403,429,500]){const f=await deleted();await reconnect(f,client(f,{oldStatus:status})).catch(()=>false);expect((await state(f)).external_id).toBe(f.old);}
});
it('ambiguous or archived new source never rebinds',async()=>{
 for(const options of [{duplicates:true},{archived:true}]){const f=await deleted();expect(await reconnect(f,client(f,options))).toBe(false);expect((await state(f)).retired_external_ids).toEqual([]);}
});
it('local manual archive remains closed',async()=>{
 const f=await deleted();await archiveItem({db:app,principal:{userId:A.ownerUserId,mfaVerified:true},tenantSlug:A.slug},{itemId:f.id});
 expect(await reconnect(f)).toBe(false);expect((await state(f)).external_id).toBe(f.old);
});
it('different unit or barcode conflict rolls mapping, metadata and archive status back together',async()=>{
 for(const options of [{unit:'koli'},{barcode:'SYNTHETIC-CONFLICT'}]){
  const f=await deleted();
  await adm.query('UPDATE integrations SET pull_product_barcodes=true WHERE tenant_id=$1',[A.tenantId]);
  if(options.barcode)await adm.query('INSERT INTO item_barcodes(tenant_id,id,item_id,barcode) VALUES($1,$2,$3,$4)',[A.tenantId,randomUUID(),A.itemId,options.barcode]);
  const before=await state(f);await expect(reconnect(f,client(f,options))).rejects.toBeDefined();expect(await state(f)).toEqual(before);
 }
});
it('reconnected OAuth generation during network calls cannot write old evidence',async()=>{
 const f=await deleted(),before=await state(f);
 expect(await reconnect(f,client(f,{beforeNew:async()=>{await adm.query('UPDATE integration_oauth_apps SET version=gen_random_uuid() WHERE tenant_id=$1',[A.tenantId]);}}))).toBe(false);
 expect(await state(f)).toEqual(before);
});
it('retired aliases cannot create another card; raw updates/history edits are denied and tenant B cannot invoke A mapping',async()=>{
 const f=await deleted();expect(await reconnect(f)).toBe(true);
 expect(await inTenant(A,tx=>applyProduct(tx,ac(),{externalId:f.old,code:'OTHER-'+f.old,name:'Old identity',unit:'adet'}))).toBe('SKIPPED');
 await expect(inTenant(A,tx=>tx.execute(sql`UPDATE external_refs SET external_id='999' WHERE id=${f.ref_id}::uuid`))).rejects.toBeDefined();
 await expect(inTenant(A,tx=>tx.execute(sql`UPDATE external_refs SET retired_external_ids='{}'::text[] WHERE id=${f.ref_id}::uuid`))).rejects.toBeDefined();
 expect(await inTenant(B,tx=>tx.execute<{ok:boolean}>(sql`SELECT wms_probe.replace_deleted_product_identity(${f.ref_id}::uuid,2,'999') ok`))).toEqual([{ok:false}]);
 await expect(inTenant(A,tx=>tx.execute(sql`INSERT INTO external_refs(tenant_id,system,entity_type,entity_id,external_id) VALUES(${A.tenantId}::uuid,'PARASUT','ITEM',${A.itemTwoId}::uuid,${f.old})`))).rejects.toBeDefined();
});
it('concurrent attempts change one mapping once and preserve append-only alias history',async()=>{
 const f=await deleted();const results=await Promise.all([reconnect(f),reconnect(f)]);expect(results.filter(Boolean)).toHaveLength(1);expect((await state(f)).retired_external_ids).toEqual([f.old]);
});
it('existing open work remains attached when a deleted source gets a new identity',async()=>{
 const f=await deleted();
 await inTenant(A,tx=>observeProduct(tx,f.b,ac(),f.old,{exists:true,archived:false}));
 const document=await createStockDocument({db:app,principal:{userId:A.ownerUserId,mfaVerified:true},tenantSlug:A.slug,clientKey:randomUUID()},
 {kind:'STOCK_IN',warehouseId:A.warehouseId,lines:[{itemId:f.id,unitId:A.unitId,targetLocationId:A.rootLocationId,quantity:'2',baseQuantity:'2',conversionFactor:'1'}]});
 const t=Date.now()-40000;await inTenant(A,tx=>observeProduct(tx,f.b,ac(),f.old,{exists:false},t));await inTenant(A,tx=>observeProduct(tx,f.b,ac(),f.old,{exists:false},t+30000));
 expect((await state(f)).source_disposition).toBe('PENDING');expect(await reconnect(f)).toBe(true);
 expect((await adm.query('SELECT item_id FROM document_lines WHERE tenant_id=$1 AND document_id=$2',[A.tenantId,document.documentId])).rows[0]?.item_id).toBe(f.id);
});
it('normal scheduled pull reconnects the skipped new row and refuses inaccessible company',async()=>{
 for(const company of [false,true]){
  const f=await deleted(),sealer=createSealer(randomBytes(32).toString('hex'));
  const box=sealSecrets(sealer,A.tenantId,'PARASUT',{clientId:'synthetic',clientSecret:'synthetic',accessToken:'synthetic',refreshToken:'synthetic',accessExpiresAt:String(Date.now()+7200000)});
  await adm.query('UPDATE integrations SET credentials=$2::jsonb WHERE tenant_id=$1',[A.tenantId,JSON.stringify(box)]);
  const result=await runIntegrationSync({inTenant:fn=>inTenant(A,fn),client:client(f,{companies:company}),sealer},{integrationId:ids.get(A.tenantId)!,flow:'PRODUCTS',trigger:'SCHEDULE'},null);
  expect((await state(f)).external_id).toBe(company?f.next:f.old);
  if(company)expect(result).toMatchObject({kind:'ran',flows:[{status:'SUCCESS',counts:{updated:1,skipped:0,failed:0}}]});
 }
});

it('multi-row pull and another product rebind share namespace-before-item lock order',async()=>{
 const f=await deleted();let release!:()=>void,held!:()=>void,reached!:()=>void;
 const barrier=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>held=r),networkReady=new Promise<void>(r=>reached=r);
 const newId=String(++sequence);
 const batch=inTenant(A,async tx=>{
  await applyProduct(tx,ac(),{externalId:newId,code:'BATCH-'+newId,name:'Batch',unit:'adet'});held();await barrier;
  await applyProduct(tx,ac(),{externalId:f.old,code:f.code,name:'Before',unit:'adet'});
 });
 await ready;
 const replacement=reconnect(f,client(f,{beforeNew:async()=>{reached();}}));
 await networkReady;
 try{await new Promise(r=>setTimeout(r,100));}finally{release();}
 await batch;expect(await replacement).toBe(true);expect((await state(f)).external_id).toBe(f.next);
});
it('PUBLIC cannot execute the definer, FORCE RLS stays enabled and function owner is the dedicated probe role',async()=>{
 const result=(await adm.query(`SELECT c.relforcerowsecurity force_rls, r.rolsuper, r.rolbypassrls,
 has_function_privilege('wms_ops','wms_probe.replace_deleted_product_identity(uuid,integer,text)','EXECUTE') ops,
 has_function_privilege('wms_app','wms_probe.replace_deleted_product_identity(uuid,integer,text)','EXECUTE') app,
 r.rolname owner FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
 CROSS JOIN pg_class c WHERE p.oid='wms_probe.replace_deleted_product_identity(uuid,integer,text)'::regprocedure AND c.oid='public.external_refs'::regclass`)).rows[0];
 expect(result).toMatchObject({force_rls:true,ops:false,app:true,owner:'wms_identity_probe',rolsuper:false,rolbypassrls:false});
 // Dedicated NOLOGIN non-super/non-BYPASS definer plus explicit predicates and FORCE RLS.
 expect(await inTenant(B,tx=>tx.execute(sql`SELECT id FROM external_refs WHERE tenant_id=${A.tenantId}::uuid`))).toHaveLength(0);
});

it('first absence in a new OAuth generation cannot reuse old DELETED state as two observations',async()=>{
 const f=await deleted();await adm.query('UPDATE integration_oauth_apps SET version=gen_random_uuid() WHERE tenant_id=$1',[A.tenantId]);
 const b=await inTenant(A,tx=>lifecycleBinding(tx,A.tenantId,ids.get(A.tenantId)!,true));expect(b).not.toBeNull();
 await inTenant(A,tx=>observeProduct(tx,b!,ac(),f.old,{exists:false},Date.now()));
 expect(await reconnect(f,client(f),b!)).toBe(false);expect((await state(f)).external_id).toBe(f.old);
});
