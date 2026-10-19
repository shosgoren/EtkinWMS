import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS,type DbClient } from "../../../packages/db/src/client.ts";
import { listStockOverview,reverseDocument,getReversalCapacity } from "../../../packages/domain/src/stock/index.ts";
import { newRegistry,seedWorld,type TenantWorld } from "../fixtures/tenants.ts";
import { transferBetweenWarehouses } from "../../../packages/domain/src/operations/index.ts";
import { createWarehouse,createLocation,setMembershipWarehouseScopes } from "../../../packages/domain/src/warehouse/index.ts";
import { readIntEnv } from "../harness/env.ts";
const env=readIntEnv(process.env); let app:DbClient,adm:pg.Client,A:TenantWorld,B:TenantWorld,target:string;
const params=(world=A)=>({db:app,principal:{userId:world.ownerUserId,mfaVerified:true},tenantSlug:world.slug});
const command=()=>({...params(),clientKey:randomUUID(),retry:{sleep:async()=>undefined}});
beforeAll(async()=>{
 app=createDbClient({url:env.databaseUrl,poolMax:DB_CLIENT_SETTINGS.poolMax,prepare:env.prepare??DB_CLIENT_SETTINGS.prepare});
 adm=new pg.Client({connectionString:env.databaseUrlDirect});adm.on("error",()=>undefined);await adm.connect();
 const reg=newRegistry();A=await seedWorld(adm,reg,"TR903A");B=await seedWorld(adm,reg,"TR903B");

 const warehouse=(await createWarehouse(params(),{code:"DEST",name:"Target"})).warehouseId;
 target=(await createLocation(params(),{warehouseId:warehouse,code:"R1",name:"Target shelf",kind:"STORAGE"})).locationId;
},120000);
afterAll(async()=>{await adm.end();await app.close();});

const move=(quantity:string,clientKey=randomUUID())=>transferBetweenWarehouses({...command(),clientKey},{sourceLocationId:A.rootLocationId,targetLocationId:target,itemId:A.itemNoneId,quantity,reason:"Transfer test"});
async function documentCount(){return (await adm.query<{n:string}>("SELECT count(*)::text AS n FROM public.documents WHERE tenant_id=$1",[A.tenantId])).rows[0]!.n;}
describe("atomic warehouse transfer",()=>{
 it("moves both sides, conserves total, numbers and links both documents, replays concurrent retries once",async()=>{
  const key=randomUUID(),before=await documentCount();
  const [a,b]=await Promise.all([move("2",key),move("2",key)]);
  expect(a.documentId).toBe(b.documentId);expect([a.replayed,b.replayed].sort()).toEqual([false,true]);
  const rows=(await listStockOverview(params())).items.filter(r=>r.itemId===A.itemNoneId);
  expect(rows.map(r=>r.physical).sort()).toEqual(["2.000000","8.000000"]);
  expect(Number(await documentCount())-Number(before)).toBe(2);
  await expect(reverseDocument(command(),{documentId:a.documentId as string,lines:"ALL",reason:"Cannot undo one leg"})).rejects.toMatchObject({code:"REVERSAL_BLOCKED",detail:"SOURCE_LINKED"});
  await expect(getReversalCapacity(params(),a.documentId as string)).rejects.toMatchObject({code:"REVERSAL_BLOCKED",detail:"SOURCE_LINKED"});
  const links=await adm.query<{kind:string;source_status:string;target_status:string;source_number:string;target_number:string}>("SELECT l.kind,s.status AS source_status,t.status AS target_status,s.number AS source_number,t.number AS target_number FROM public.stock_document_links l JOIN public.documents s ON s.id=l.source_document_id JOIN public.documents t ON t.id=l.target_document_id WHERE l.tenant_id=$1 AND l.source_document_id=$2",[A.tenantId,a.documentId]);
  expect(links.rows).toEqual([expect.objectContaining({kind:"TRANSFER",source_status:"POSTED",target_status:"POSTED",source_number:expect.stringMatching(/^CKS-/),target_number:expect.stringMatching(/^GRS-/)})]);
 });
 it("insufficient source and a failure at the target roll back both documents and balances",async()=>{
  const before=await listStockOverview(params()),count=await documentCount();
  await expect(move("999")).rejects.toMatchObject({code:"INSUFFICIENT_STOCK"});
  expect(await listStockOverview(params())).toEqual(before);expect(await documentCount()).toBe(count);
  await adm.query("UPDATE public.locations SET status='ARCHIVED',archived_at=now() WHERE tenant_id=$1 AND id=$2",[A.tenantId,target]);
  try{await expect(move("1")).rejects.toMatchObject({code:"VALIDATION_FAILED"});
   expect(await listStockOverview(params())).toEqual(before);expect(await documentCount()).toBe(count);
  }finally{await adm.query("UPDATE public.locations SET status='ACTIVE',archived_at=NULL WHERE tenant_id=$1 AND id=$2",[A.tenantId,target]);}
 });
 it("rejects tenant intrusion, both warehouse scope violations, same-warehouse transfer and missing MFA",async()=>{
  const input={sourceLocationId:A.rootLocationId,targetLocationId:target,itemId:A.itemNoneId,quantity:"1",reason:"Scope test"};
  await expect(transferBetweenWarehouses({...params(B),clientKey:randomUUID()},input)).rejects.toMatchObject({code:"NOT_FOUND"});
  await expect(transferBetweenWarehouses({...command(),principal:{userId:A.ownerUserId,mfaVerified:false}},input)).rejects.toMatchObject({code:"FORBIDDEN"});
  await expect(transferBetweenWarehouses(command(),{...input,targetLocationId:A.childLocationId})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
  await setMembershipWarehouseScopes({ ...params(), recentAuth: async () => undefined },{membershipId:A.memberMembershipId,warehouseIds:[A.warehouseId]});
  const prior=process.env.WAREHOUSE_SCOPE_ENABLED;
  try{process.env.WAREHOUSE_SCOPE_ENABLED="true";
   await expect(transferBetweenWarehouses({...command(),principal:{userId:A.memberUserId,mfaVerified:true}},input)).rejects.toMatchObject({code:"FORBIDDEN",detail:"WAREHOUSE_OUT_OF_SCOPE"});
  }finally{if(prior===undefined)delete process.env.WAREHOUSE_SCOPE_ENABLED;else process.env.WAREHOUSE_SCOPE_ENABLED=prior;}
 });
 it("validates amounts and rejects reuse with changed quantity",async()=>{
  for(const quantity of ["0","-1","0.0000001","NaN"]) await expect(move(quantity)).rejects.toMatchObject({code:"VALIDATION_FAILED"});
  const key=randomUUID();await move("1",key);await expect(move("2",key)).rejects.toMatchObject({code:"IDEMPOTENCY_MISMATCH"});
 });
});
