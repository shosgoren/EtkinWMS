import pg from "pg";
import {sqlstateOf} from "../../../packages/domain/src/stock/retry.ts";
import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS,type DbClient } from "../../../packages/db/src/client.ts";
import { createProductionRecipe,getProductionRecipe,listProductionRecipes,produceFromRecipe } from "../../../packages/domain/src/operations/index.ts";
import { approveDocument,createStockDocument,listStockOverview,postDocument,reverseDocument } from "../../../packages/domain/src/stock/index.ts";
import { createWarehouse,createLocation,setMembershipWarehouseScopes } from "../../../packages/domain/src/warehouse/index.ts";
import { newRegistry,seedWorld,type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";
const env=readIntEnv(process.env);let app:DbClient,adm:pg.Client,A:TenantWorld,B:TenantWorld,ingredient:string,output:string,source:string,target:string,recipeId:string,unit:string;
const params=(w=A)=>({db:app,principal:{userId:w.ownerUserId,mfaVerified:true},tenantSlug:w.slug});
const command=()=>({...params(),clientKey:randomUUID(),retry:{sleep:async()=>undefined}});
beforeAll(async()=>{
 app=createDbClient({url:env.databaseUrl,poolMax:DB_CLIENT_SETTINGS.poolMax,prepare:env.prepare??DB_CLIENT_SETTINGS.prepare});adm=new pg.Client({connectionString:env.databaseUrlDirect});adm.on("error",()=>undefined);await adm.connect();
 const reg=newRegistry();A=await seedWorld(adm,reg,"PROD903A");B=await seedWorld(adm,reg,"PROD903B");
 unit=(await adm.query<{base_unit_id:string}>("SELECT base_unit_id FROM public.items WHERE tenant_id=$1 AND id=$2",[A.tenantId,A.itemNoneId])).rows[0]!.base_unit_id;
 ingredient=randomUUID();output=randomUUID();
 await adm.query("INSERT INTO public.items(tenant_id,id,code,name,base_unit_id,tracking_mode,quantity_scale) VALUES($1,$2,'ING','Ingredient',$4,'NONE',6),($1,$3,'OUT','Output',$4,'NONE',0)",[A.tenantId,ingredient,output,unit]);
 const warehouse=(await createWarehouse(params(),{code:"RAW2",name:"Second raw warehouse"})).warehouseId;
 source=(await createLocation(params(),{warehouseId:warehouse,code:"RAW",name:"Raw material",kind:"STORAGE"})).locationId;
 target=(await createLocation(params(),{warehouseId:A.warehouseId,code:"FIN",name:"Finished goods",kind:"STORAGE"})).locationId;
 const documentId=(await createStockDocument(command(),{kind:"STOCK_IN",warehouseId:warehouse,lines:[{itemId:ingredient,unitId:unit,targetLocationId:source,quantity:"4",baseQuantity:"4",conversionFactor:"1"}]})).documentId as string;
 await approveDocument(command(),{documentId,expectedVersion:1});await postDocument(command(),{documentId,expectedVersion:2});
},120000);
afterAll(async()=>{await adm.end();await app.close();});
const recipe=()=>({code:"RUBBER",version:1,name:"Test recipe",outputItemId:output,outputQuantity:"2",lines:[{itemId:A.itemNoneId,quantity:"2"},{itemId:ingredient,quantity:"0.5"}]});
const produce=(outputQuantity:string,clientKey=randomUUID(),targetLocationId=target)=>produceFromRecipe({...command(),clientKey},{recipeId,outputQuantity,targetLocationId,sources:[{lineNo:1,locationId:A.rootLocationId},{lineNo:2,locationId:source}],reason:"Pilot production"});
async function counts(){return (await adm.query<{n:string}>("SELECT count(*)::text AS n FROM public.documents WHERE tenant_id=$1",[A.tenantId])).rows[0]!.n;}
describe("atomic recipe production",()=>{
 it("stores one immutable recipe revision with exact quantities; tenant and role boundaries hold",async()=>{
  const key=randomUUID(),[one,two]=await Promise.all([createProductionRecipe({...command(),clientKey:key},recipe()),createProductionRecipe({...command(),clientKey:key},recipe())]);
  recipeId=one.recipeId;expect(two.recipeId).toBe(recipeId);expect([one.replayed,two.replayed].sort()).toEqual([false,true]);
  const saved=await getProductionRecipe(params(),recipeId);expect(saved).toMatchObject({version:1,outputQuantity:"2.000000",lines:[{quantity:"2.000000"},{quantity:"0.500000"}]});
  expect((await listProductionRecipes(params(),{q:"RUBBER"})).items).toHaveLength(1);
  // ALTIN-KURAL 15: toplam yalnız istenince; arama süzgeciyle; başka tenant sayılmaz.
  expect((await listProductionRecipes(params(),{q:"RUBBER"})).total).toBeUndefined();
  expect((await listProductionRecipes(params(),{q:"RUBBER",withTotal:true})).total).toBe(1);
  expect((await listProductionRecipes(params(B),{q:"RUBBER",withTotal:true})).total).toBe(0);
  const application=new pg.Client({connectionString:env.databaseUrl});await application.connect();
  try{await application.query("BEGIN");expect((await application.query("SELECT current_user AS role")).rows[0]?.role).toBe("wms_app");
   await application.query("SELECT set_config('app.current_tenant_id',$1,true)",[A.tenantId]);
   const appendError=await application.query("INSERT INTO public.production_recipe_lines(tenant_id,recipe_id,line_no,item_id,quantity) VALUES($1,$2,3,$3,1)",[A.tenantId,recipeId,output]).then(()=>null,e=>e as unknown);
   expect(sqlstateOf(appendError)).toBe("23514");
  }finally{await application.query("ROLLBACK");await application.end();}
  expect((await getProductionRecipe(params(),recipeId)).lines).toHaveLength(2);
  await expect(getProductionRecipe(params(B),recipeId)).rejects.toMatchObject({code:"NOT_FOUND"});
  await expect(createProductionRecipe({...command(),principal:{userId:A.memberUserId,mfaVerified:true}},recipe())).rejects.toMatchObject({code:"FORBIDDEN"});
 });
 it("consumes materials from two warehouses and creates output exactly once with linked numbered documents",async()=>{
  const key=randomUUID(),before=await counts(),[one,two]=await Promise.all([produce("4",key),produce("4",key)]);
  expect(one.documentId).toBe(two.documentId);expect([one.replayed,two.replayed].sort()).toEqual([false,true]);
  const rows=(await listStockOverview(params())).items;
  expect(rows.find(r=>r.itemId===A.itemNoneId)?.physical).toBe("6.000000");expect(rows.find(r=>r.itemId===ingredient)?.physical).toBe("3.000000");expect(rows.find(r=>r.itemId===output)?.physical).toBe("4.000000");
  expect(Number(await counts())-Number(before)).toBe(3);
  const links=await adm.query<{kind:string;recipe_id:string}>("SELECT kind,recipe_id FROM public.stock_document_links WHERE tenant_id=$1 AND target_document_id=$2",[A.tenantId,one.documentId]);
  expect(links.rows).toEqual([{kind:"PRODUCTION",recipe_id:recipeId},{kind:"PRODUCTION",recipe_id:recipeId}]);
  await expect(reverseDocument(command(),{documentId:one.documentId as string,lines:"ALL",reason:"Do not split production"})).rejects.toMatchObject({code:"REVERSAL_BLOCKED"});
 });
 it("insufficient material or failed output rolls back all consumption and creates no finished stock",async()=>{
  const before=await listStockOverview(params()),n=await counts();
  await expect(produce("999")).rejects.toMatchObject({code:"INSUFFICIENT_STOCK"});expect(await listStockOverview(params())).toEqual(before);expect(await counts()).toBe(n);
  await adm.query("UPDATE public.locations SET status='ARCHIVED',archived_at=now() WHERE tenant_id=$1 AND id=$2",[A.tenantId,target]);
  try{await expect(produce("1")).rejects.toMatchObject({code:"VALIDATION_FAILED"});expect(await listStockOverview(params())).toEqual(before);expect(await counts()).toBe(n);}
  finally{await adm.query("UPDATE public.locations SET status='ACTIVE',archived_at=NULL WHERE tenant_id=$1 AND id=$2",[A.tenantId,target]);}
 });
 it("rejects tenant, MFA, posting-role and every source/target warehouse scope violation without writes",async()=>{
  const input={recipeId,outputQuantity:"1",targetLocationId:target,sources:[{lineNo:1,locationId:A.rootLocationId},{lineNo:2,locationId:source}],reason:"Boundary test"};
  const before=await listStockOverview(params()),n=await counts();
  await expect(produceFromRecipe({...params(B),clientKey:randomUUID()},input)).rejects.toMatchObject({code:"NOT_FOUND"});
  await expect(produceFromRecipe({...command(),principal:{userId:A.ownerUserId,mfaVerified:false}},input)).rejects.toMatchObject({code:"FORBIDDEN",detail:"MFA_REQUIRED"});
  const member=()=>({...command(),principal:{userId:A.memberUserId,mfaVerified:true}});
  await adm.query("UPDATE public.membership_roles SET role_key='READ_ONLY' WHERE tenant_id=$1 AND membership_id=$2",[A.tenantId,A.memberMembershipId]);
  try{await expect(produceFromRecipe(member(),input)).rejects.toMatchObject({code:"FORBIDDEN"});}
  finally{await adm.query("UPDATE public.membership_roles SET role_key='PICKER' WHERE tenant_id=$1 AND membership_id=$2",[A.tenantId,A.memberMembershipId]);}
  const sourceWarehouse=(await adm.query<{warehouse_id:string}>("SELECT warehouse_id FROM public.locations WHERE tenant_id=$1 AND id=$2",[A.tenantId,source])).rows[0]!.warehouse_id;
  const outside=(await createWarehouse(params(),{code:"OUTSIDE",name:"Out of scope output"})).warehouseId;
  const outsideLocation=(await createLocation(params(),{warehouseId:outside,code:"FIN",name:"Other output",kind:"STORAGE"})).locationId;
  const prior=process.env.WAREHOUSE_SCOPE_ENABLED;
  try{process.env.WAREHOUSE_SCOPE_ENABLED="true";
   await setMembershipWarehouseScopes({ ...params(), recentAuth: async () => undefined },{membershipId:A.memberMembershipId,warehouseIds:[A.warehouseId]});
   await expect(produceFromRecipe(member(),input)).rejects.toMatchObject({code:"FORBIDDEN",detail:"WAREHOUSE_OUT_OF_SCOPE"});
   await setMembershipWarehouseScopes({ ...params(), recentAuth: async () => undefined },{membershipId:A.memberMembershipId,warehouseIds:[A.warehouseId,sourceWarehouse]});
   await expect(produceFromRecipe(member(),{...input,targetLocationId:outsideLocation})).rejects.toMatchObject({code:"FORBIDDEN",detail:"WAREHOUSE_OUT_OF_SCOPE"});
  }finally{if(prior===undefined)delete process.env.WAREHOUSE_SCOPE_ENABLED;else process.env.WAREHOUSE_SCOPE_ENABLED=prior;}
  expect(await listStockOverview(params())).toEqual(before);expect(await counts()).toBe(n);
 });
 it("rejects incomplete component mapping and recursive/duplicate recipe components",async()=>{
  await expect(produceFromRecipe(command(),{recipeId,outputQuantity:"1",targetLocationId:target,sources:[{lineNo:1,locationId:A.rootLocationId}],reason:"Missing source"})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
  await expect(createProductionRecipe(command(),{...recipe(),lines:[{itemId:output,quantity:"1"}]})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
  await expect(createProductionRecipe(command(),{...recipe(),lines:[{itemId:ingredient,quantity:"1"},{itemId:ingredient,quantity:"1"}]})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
 });
});
