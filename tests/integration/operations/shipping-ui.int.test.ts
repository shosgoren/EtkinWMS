import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { createDbClient } from "../../../packages/db/src/index.ts";
import { DB_CLIENT_SETTINGS,type DbClient } from "../../../packages/db/src/client.ts";
import { createSalesOrder,reserveOrder,createPickAssignment,confirmPick,shipOrder,cancelSalesOrder,getShippingOrder,listShippingOrders,previewShippingPick } from "../../../packages/domain/src/operations/index.ts";
import { listStockOverview } from "../../../packages/domain/src/stock/index.ts";
import { createLocation,createWarehouse,setMembershipWarehouseScopes } from "../../../packages/domain/src/warehouse/index.ts";
import { addBarcode } from "../../../packages/domain/src/catalog/index.ts";
import { newRegistry,seedWorld,type TenantWorld } from "../fixtures/tenants.ts";
import { readIntEnv } from "../harness/env.ts";
const env=readIntEnv(process.env);let app:DbClient,adm:pg.Client,A:TenantWorld,B:TenantWorld,orderId:string,unit:string,taskId:string;
const params=(w=A)=>({db:app,principal:{userId:w.ownerUserId,mfaVerified:true},tenantSlug:w.slug});
const command=()=>({...params(),clientKey:randomUUID(),retry:{sleep:async()=>undefined}});
beforeAll(async()=>{
 app=createDbClient({url:env.databaseUrl,poolMax:DB_CLIENT_SETTINGS.poolMax,prepare:env.prepare??DB_CLIENT_SETTINGS.prepare});adm=new pg.Client({connectionString:env.databaseUrlDirect});adm.on("error",()=>undefined);await adm.connect();
 const reg=newRegistry();A=await seedWorld(adm,reg,"SHIPUIA");B=await seedWorld(adm,reg,"SHIPUIB");
 unit=(await adm.query<{base_unit_id:string}>("SELECT base_unit_id FROM public.items WHERE tenant_id=$1 AND id=$2",[A.tenantId,A.itemNoneId])).rows[0]!.base_unit_id;
 await createLocation(params(),{warehouseId:A.warehouseId,code:"SHIP",name:"Shipping area",kind:"STAGING"});
 await addBarcode(params(),{itemId:A.itemNoneId,barcode:"SHIP-PAIR",quantity:"2"});
},120000);
afterAll(async()=>{await adm.end();await app.close();});
describe("shipping UI query and command contract",()=>{
 it("shows actual reservation and picking state, converts barcode units without writing stock",async()=>{
  orderId=(await createSalesOrder(command(),{customerRef:"Pilot UI",lines:[{itemId:A.itemNoneId,unitId:unit,quantity:"4"}]})).documentId as string;
  expect((await getShippingOrder(params(),orderId)).lines).toMatchObject([{requested:"4.000000",shipped:"0.000000",open:"4.000000",reserved:"0"}]);
  await reserveOrder(command(),{orderId});await createPickAssignment(command(),{orderIds:[orderId]});
  const detail=await getShippingOrder(params(),orderId);taskId=detail.tasks[0]!.id;
  expect(detail.lines[0]?.reserved).toBe("4.000000");expect(detail.tasks).toMatchObject([{quantity:"4.000000",sourceCode:"Z1",targetCode:"SHIP",canPick:true}]);
  const before=await listStockOverview(params());
  expect(await previewShippingPick(params(),{taskId,barcode:"SHIP-PAIR",quantity:"2"})).toEqual({baseQuantity:"4.000000",unitCode:"ADET"});
  expect(await listStockOverview(params())).toEqual(before);expect(detail.staged).toEqual([]);
 });
 it("keeps tenant/MFA/warehouse boundaries on tasks, staging, history and preview",async()=>{
  await expect(getShippingOrder(params(B),orderId)).rejects.toMatchObject({code:"NOT_FOUND"});
  await expect(previewShippingPick(params(B),{taskId,barcode:"SHIP-PAIR",quantity:"2"})).rejects.toMatchObject({code:"NOT_FOUND"});
  await expect(getShippingOrder({...params(),principal:{userId:A.ownerUserId,mfaVerified:false}},orderId)).rejects.toMatchObject({code:"FORBIDDEN"});
  expect((await listShippingOrders(params(B),{q:"Pilot UI"})).items).toEqual([]);
  // ALTIN-KURAL 15: toplam yalnız istenince; arama süzgeciyle; başka tenant sayılmaz.
  expect((await listShippingOrders(params(),{q:"Pilot UI"})).total).toBeUndefined();
  expect((await listShippingOrders(params(),{q:"Pilot UI",withTotal:true})).total).toBe(1);
  expect((await listShippingOrders(params(B),{q:"Pilot UI",withTotal:true})).total).toBe(0);
  const other=(await createWarehouse(params(),{code:"OTHER",name:"Other"})).warehouseId;
  await setMembershipWarehouseScopes({ ...params(), recentAuth: async () => undefined },{membershipId:A.memberMembershipId,warehouseIds:[other]});
  const prior=process.env.WAREHOUSE_SCOPE_ENABLED;
  try{process.env.WAREHOUSE_SCOPE_ENABLED="true";const scoped={...params(),principal:{userId:A.memberUserId,mfaVerified:true}};
   expect(await getShippingOrder(scoped,orderId)).toMatchObject({tasks:[],staged:[],posted:[],lines:[{reserved:"0"}]});
   await expect(previewShippingPick(scoped,{taskId,barcode:"SHIP-PAIR",quantity:"2"})).rejects.toMatchObject({code:"NOT_FOUND"});
  }finally{if(prior===undefined)delete process.env.WAREHOUSE_SCOPE_ENABLED;else process.env.WAREHOUSE_SCOPE_ENABLED=prior;}
 });
 it("picks, partially ships once on replay, then completes the order with numbered history",async()=>{
  const before=await listStockOverview(params());
  await expect(confirmPick(command(),{taskId,foundQuantity:"2",scannedLocationCode:"WRONG",scannedItemBarcode:"SHIP-PAIR"})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
  expect(await listStockOverview(params())).toEqual(before);
  await confirmPick(command(),{taskId,foundQuantity:"2",scannedLocationCode:"Z1",scannedItemBarcode:"SHIP-PAIR"});
  let detail=await getShippingOrder(params(),orderId);expect(detail.tasks).toEqual([]);expect(detail.staged).toMatchObject([{quantity:"4.000000",unitCode:"ADET"}]);
  const lineId=detail.lines[0]!.id,key=command(),input={orderId,warehouseId:A.warehouseId,lines:[{orderLineId:lineId,quantity:"1"}]};
  await shipOrder(key,input);expect((await shipOrder(key,input)).replayed).toBe(true);
  detail=await getShippingOrder(params(),orderId);expect(detail).toMatchObject({status:"OPEN",lines:[{shipped:"1.000000",open:"3.000000"}],staged:[{quantity:"3.000000"}]});
  await shipOrder(command(),{...input,lines:[{orderLineId:lineId,quantity:"3"}]});
  detail=await getShippingOrder(params(),orderId);expect(detail).toMatchObject({status:"CLOSED",lines:[{shipped:"4.000000",open:"0.000000"}],staged:[]});
  expect(detail.posted).toHaveLength(2);expect(detail.posted.every(doc=>/^CKS-/.test(doc.number))).toBe(true);
  expect((await listStockOverview(params())).items.find(row=>row.itemId===A.itemNoneId)?.physical).toBe("6.000000");
 });
 it("rejects invalid cursors and stale cancellation versions",async()=>{
  for(const input of [{taskAfter:"bad"},{stageAfter:"bad"}])await expect(getShippingOrder(params(),orderId,input)).rejects.toMatchObject({code:"VALIDATION_FAILED"});
  await expect(listShippingOrders(params(),{after:"bad"})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
  const id=(await createSalesOrder(command(),{customerRef:"Cancel UI",lines:[{itemId:A.itemNoneId,unitId:unit,quantity:"1"}]})).documentId as string;
  const version=(await getShippingOrder(params(),id)).version;
  await expect(cancelSalesOrder(command(),{orderId:id,expectedVersion:version+1})).rejects.toMatchObject({code:"VERSION_CONFLICT"});
  expect((await getShippingOrder(params(),id)).status).toBe("OPEN");
  await cancelSalesOrder(command(),{orderId:id,expectedVersion:version});expect((await getShippingOrder(params(),id)).status).toBe("CANCELLED");
 });
});
