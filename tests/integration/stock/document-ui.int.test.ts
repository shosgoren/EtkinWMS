import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS,type DbClient } from "../../../packages/db/src/client.ts";
import { approveDocument,cancelDocument,createStockDocument,getStockDocument,listStockDocuments,listStockOverview,postDocument,searchStockChoices } from "../../../packages/domain/src/stock/index.ts";
import { newRegistry,seedWorld,type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";
const env=readIntEnv(process.env); let app:DbClient,adm:pg.Client,A:TenantWorld,B:TenantWorld,unit:string;
const params=(world=A)=>({db:app,principal:{userId:world.ownerUserId,mfaVerified:true},tenantSlug:world.slug});
const command=()=>({...params(),clientKey:randomUUID(),retry:{sleep:async()=>undefined}});
async function create(kind:"STOCK_IN"|"STOCK_OUT",quantity:string,clientKey=randomUUID()) {
 return createStockDocument({...command(),clientKey},{kind,warehouseId:A.warehouseId,reason:"Pilot UI test",lines:[{itemId:A.itemNoneId,unitId:unit,quantity,baseQuantity:quantity,conversionFactor:"1",...(kind === "STOCK_IN"?{targetLocationId:A.rootLocationId}:{sourceLocationId:A.rootLocationId})}]});
}
beforeAll(async()=>{
 app=createDbClient({url:env.databaseUrl,poolMax:DB_CLIENT_SETTINGS.poolMax,prepare:env.prepare??DB_CLIENT_SETTINGS.prepare});
 adm=new pg.Client({connectionString:env.databaseUrlDirect});adm.on("error",()=>undefined);await adm.connect();
 const reg=newRegistry();A=await seedWorld(adm,reg,"DOC903A");B=await seedWorld(adm,reg,"DOC903B");
 unit=(await adm.query<{base_unit_id:string}>("SELECT base_unit_id FROM public.items WHERE tenant_id=$1 AND id=$2",[A.tenantId,A.itemNoneId])).rows[0]!.base_unit_id;
},120000);
afterAll(async()=>{await adm.end();await app.close();});
describe("manual stock document UI contract",()=>{
 it("creates only one draft on retry, keeps stock unchanged until post and posts once",async()=>{
  const before=await listStockOverview(params()),key=randomUUID();
  const created=await create("STOCK_IN","2",key),replay=await create("STOCK_IN","2",key),documentId=created.documentId as string;
  expect(replay.documentId).toBe(documentId);expect(replay.replayed).toBe(true);
  expect(await listStockOverview(params())).toEqual(before);
  expect(await getStockDocument(params(),documentId)).toMatchObject({status:"DRAFT",version:1,reason:"Pilot UI test",lines:[{quantity:"2.000000",unitCode:"ADET"}]});
  await approveDocument(command(),{documentId,expectedVersion:1});
  expect(await listStockOverview(params())).toEqual(before);
  const postKey=command();await postDocument(postKey,{documentId,expectedVersion:2});
  expect((await postDocument(postKey,{documentId,expectedVersion:2})).replayed).toBe(true);
  const detail=await getStockDocument(params(),documentId);
  expect(detail.status).toBe("POSTED");expect(detail.number).toMatch(/^GRS-/);
  expect((await listStockOverview(params())).items.find(r=>r.itemId===A.itemNoneId)?.physical).toBe("12.000000");
 });
 it("posts a manual issue once and preserves its numbered history",async()=>{
  const documentId=(await create("STOCK_OUT","1.000000")).documentId as string;
  await approveDocument(command(),{documentId,expectedVersion:1});
  const key=command();await postDocument(key,{documentId,expectedVersion:2});
  expect((await postDocument(key,{documentId,expectedVersion:2})).replayed).toBe(true);
  expect(await getStockDocument(params(),documentId)).toMatchObject({status:"POSTED",number:expect.stringMatching(/^CKS-/),lines:[{quantity:"1.000000"}]});
  expect((await listStockOverview(params())).items.find(r=>r.itemId===A.itemNoneId)?.physical).toBe("11.000000");
 });
 it("insufficient stock keeps the approved document and all balances unchanged; cancellation is recoverable",async()=>{
  const documentId=(await create("STOCK_OUT","999")).documentId as string;
  await approveDocument(command(),{documentId,expectedVersion:1});
  const before=await listStockOverview(params());
  await expect(postDocument(command(),{documentId,expectedVersion:2})).rejects.toMatchObject({code:"INSUFFICIENT_STOCK"});
  expect(await listStockOverview(params())).toEqual(before);
  expect((await getStockDocument(params(),documentId)).status).toBe("APPROVED");
  await cancelDocument(command(),{documentId,expectedVersion:2});
  expect((await getStockDocument(params(),documentId)).status).toBe("CANCELLED");
 });
 it("reads history with human labels and enforces tenant, MFA and read-only permissions",async()=>{
  const history=await listStockDocuments(params());expect(history.items.length).toBeGreaterThan(0);
  expect(history.permissions).toEqual({create:true,approve:true,post:true});
  // ALTIN-KURAL 15: toplam yalnız istenince; aynı tenant/kapsam süzgeci; imleçten bağımsız.
  expect(history.total).toBeUndefined();
  const counted=await listStockDocuments(params(),{withTotal:true});
  expect(counted.total).toBe(Number((await adm.query<{n:string}>("SELECT count(*)::text AS n FROM public.documents WHERE tenant_id=$1 AND kind IN ('STOCK_IN','STOCK_OUT')",[A.tenantId])).rows[0]!.n));
  if(counted.next)expect((await listStockDocuments(params(),{after:counted.next,withTotal:true})).total).toBe(counted.total);
  const documentId=history.items[0]!.id;
  await expect(getStockDocument(params(B),documentId)).rejects.toMatchObject({code:"NOT_FOUND"});
  await expect(getStockDocument({...params(),principal:{userId:A.ownerUserId,mfaVerified:false}},documentId)).rejects.toMatchObject({code:"FORBIDDEN"});
  const member={...params(),principal:{userId:A.memberUserId,mfaVerified:true}};
  expect((await listStockDocuments(member)).permissions.create).toBe(false);
  await expect(createStockDocument({...member,clientKey:randomUUID()},{kind:"STOCK_IN",warehouseId:A.warehouseId})).rejects.toMatchObject({code:"FORBIDDEN"});
 });
 it("bounded choice search cannot read another tenant's locations, lots or serials",async()=>{
  const choices=await searchStockChoices(params(),{kind:"warehouse",q:""});expect(choices.some(c=>c.id===A.warehouseId)).toBe(true);expect(choices.some(c=>c.id===B.warehouseId)).toBe(false);
  const items=await searchStockChoices(params(),{kind:"item",q:""});expect(items.find(c=>c.id===A.itemNoneId)?.unitCode).toBe("ADET");
  expect(await searchStockChoices(params(),{kind:"location",q:"",warehouseId:B.warehouseId})).toEqual([]);
  expect(await searchStockChoices(params(),{kind:"lot",q:"",itemId:B.itemNoneId})).toEqual([]);
  expect(await searchStockChoices(params(),{kind:"serial",q:"",itemId:B.itemNoneId})).toEqual([]);
  expect(await searchStockChoices(params(),{kind:"item",q:"' OR 1=1 --"})).toEqual([]);
  await expect(searchStockChoices(params(),{kind:"location",q:""})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
  await expect(listStockDocuments(params(),{after:"bad"})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
 });
});
