import {randomUUID} from "node:crypto";
import pg from "pg";
import {afterAll,beforeAll,expect,it} from "vitest";
import {createDbClient,withSystemTenant} from "../../../packages/db/src/index.ts";
import type {DbClient} from "../../../packages/db/src/client.ts";
import {createStockDocument} from "../../../packages/domain/src/stock/documents.ts";
import {createProductionRecipe,produceFromRecipe} from "../../../packages/domain/src/operations/production.ts";
import {assertItemsActive} from "../../../packages/domain/src/stock/reservation-reads.ts";
import {newRegistry,seedWorld,type TenantWorld} from "../fixtures/tenants.ts";
import {readIntEnv} from "../harness/env.ts";
const env=readIntEnv(process.env);
let adm:pg.Client,app:DbClient,A:TenantWorld,B:TenantWorld;
beforeAll(async()=>{
 adm=new pg.Client({connectionString:env.databaseUrlDirect});await adm.connect();
 app=createDbClient({url:env.databaseUrl,poolMax:2,prepare:false});
 A=await seedWorld(adm,newRegistry(),"LCELIGA");B=await seedWorld(adm,newRegistry(),"LCELIGB");
 await adm.query("UPDATE items SET source_state='ARCHIVED',source_disposition='PENDING',source_changed_at=now() WHERE tenant_id=$1 AND id=$2",[A.tenantId,A.itemId]);
},120_000);
afterAll(async()=>{await adm?.end();await app?.close();});
const check=(tenant:string,id:string,opts:Parameters<typeof assertItemsActive>[3]={})=>withSystemTenant(app,tenant,"test.lifecycle",tx=>assertItemsActive(tx,tenant,[id],opts));
it("pending source blocks new use but explicit stock depletion remains possible",async()=>{
 await expect(check(A.tenantId,A.itemId)).rejects.toMatchObject({code:"VALIDATION_FAILED",detail:"IN_USE"});
 await expect(check(A.tenantId,A.itemId,{allowSourcePending:true})).resolves.toBeUndefined();
});
it("preexisting document can finish; an unrelated document or tenant cannot authorize use",async()=>{
 await expect(check(A.tenantId,A.itemId,{existingDocumentId:A.documentId})).resolves.toBeUndefined();
 await expect(check(A.tenantId,A.itemId,{existingDocumentId:randomUUID()})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
 await expect(check(B.tenantId,A.itemId,{existingDocumentId:A.documentId,allowSourcePending:true})).rejects.toMatchObject({code:"NOT_FOUND"});
});
it("pending inbound draft cannot expand original quantities",async()=>{
 await expect(check(A.tenantId,A.itemId,{existingDocumentId:A.documentId,pendingQuantities:[{itemId:A.itemId,baseQuantity:"999999999"}]})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
 await expect(check(A.tenantId,A.itemId,{existingDocumentId:A.documentId,pendingQuantities:[{itemId:A.itemId,baseQuantity:"0.000001"}]})).resolves.toBeUndefined();
});
it("native archive cannot be bypassed by the existing-work exception",async()=>{
 await adm.query("UPDATE items SET status='ARCHIVED',archived_at=now(),source_disposition='ARCHIVED' WHERE tenant_id=$1 AND id=$2",[A.tenantId,A.itemId]);
 try {await expect(check(A.tenantId,A.itemId,{allowSourcePending:true,existingDocumentId:A.documentId})).rejects.toMatchObject({code:"VALIDATION_FAILED"});}
 finally {await adm.query("UPDATE items SET status='ACTIVE',archived_at=NULL,source_disposition='PENDING' WHERE tenant_id=$1 AND id=$2",[A.tenantId,A.itemId]);}
});
it("ordinary active items keep their existing eligibility",async()=>{
 await expect(check(B.tenantId,B.itemId)).resolves.toBeUndefined();
});

const actor=(w:TenantWorld)=>({db:app,principal:{userId:w.ownerUserId,mfaVerified:true},tenantSlug:w.slug,clientKey:randomUUID()});
it("pending item cannot open a new receipt or recipe but can open a stock depletion draft",async()=>{
 const line={itemId:A.itemId,unitId:A.unitId,quantity:"1",baseQuantity:"1",conversionFactor:"1",lotId:A.lotId,serialId:A.serialId};
 await expect(createStockDocument(actor(A),{kind:"STOCK_IN",warehouseId:A.warehouseId,lines:[{...line,targetLocationId:A.rootLocationId}]})).rejects.toMatchObject({code:"VALIDATION_FAILED",detail:"IN_USE"});
 await expect(createProductionRecipe(actor(A),{code:randomUUID(),version:1,name:"Pending recipe",outputItemId:A.itemTwoId,outputQuantity:"1",lines:[{itemId:A.itemId,quantity:"1"}]})).rejects.toMatchObject({code:"VALIDATION_FAILED",detail:"IN_USE"});
 const before=(await adm.query("SELECT count(*)::int AS n FROM stock_ledger WHERE tenant_id=$1",[A.tenantId])).rows[0]?.n;
 await expect(createStockDocument(actor(A),{kind:"STOCK_OUT",warehouseId:A.warehouseId,lines:[{...line,sourceLocationId:A.rootLocationId}]})).resolves.toHaveProperty("documentId");
 expect((await adm.query("SELECT count(*)::int AS n FROM stock_ledger WHERE tenant_id=$1",[A.tenantId])).rows[0]?.n).toBe(before);
});
it("an old recipe cannot start a new production using a pending component",async()=>{
 const output=randomUUID();
 await adm.query("INSERT INTO items(tenant_id,id,code,name,base_unit_id,tracking_mode,quantity_scale) VALUES($1,$2,$3,'Lifecycle output',$4,'NONE',6)",[B.tenantId,output,randomUUID(),B.unitId]);
 const recipe=await createProductionRecipe(actor(B),{code:randomUUID(),version:1,name:"Existing recipe",outputItemId:output,outputQuantity:"1",lines:[{itemId:B.itemNoneId,quantity:"1"}]});
 await adm.query("UPDATE items SET source_state='ARCHIVED',source_disposition='PENDING',source_changed_at=now() WHERE tenant_id=$1 AND id=$2",[B.tenantId,B.itemNoneId]);
 try {await expect(produceFromRecipe(actor(B),{recipeId:recipe.recipeId,outputQuantity:"1",targetLocationId:B.rootLocationId,reason:"test",sources:[{lineNo:1,locationId:B.rootLocationId}]})).rejects.toMatchObject({code:"VALIDATION_FAILED",detail:"IN_USE"});}
 finally {await adm.query("UPDATE items SET source_state='ACTIVE',source_disposition='NONE',source_changed_at=NULL WHERE tenant_id=$1 AND id=$2",[B.tenantId,B.itemNoneId]);}
});
