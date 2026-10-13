import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({transfer:vi.fn(),create:vi.fn(),approve:vi.fn(),post:vi.fn(),cancel:vi.fn(),choices:vi.fn(),principal:vi.fn(),item:vi.fn(),origin:"https://app.example.test"}));
vi.mock("next/headers",()=>({headers:()=>Promise.resolve(new Headers({origin:mocks.origin}))}));
vi.mock("../../../../lib/auth-service.ts",()=>({getAuthService:()=>({getPrincipal:mocks.principal})}));
vi.mock("@wms/db",()=>({getAppDb:()=>({})}));
vi.mock("@wms/domain/operations",()=>({createSalesOrder:mocks.create,reserveOrder:mocks.approve,createPickAssignment:mocks.transfer,confirmPick:mocks.post,shipOrder:mocks.cancel,previewShippingPick:mocks.choices}));
vi.mock("@wms/domain/catalog",()=>({getItem:mocks.item}));
vi.mock("@wms/domain/stock",()=>({createStockDocument:mocks.create,approveDocument:mocks.approve,postDocument:mocks.post,cancelDocument:mocks.cancel,searchStockChoices:mocks.choices}));
vi.mock("../../../../lib/rate-limit.ts",async original=>({...await original<object>(),createProductionLimiter:()=>({check:()=>Promise.resolve()})}));
vi.mock("next-intl/server",()=>({getTranslations:()=>Promise.resolve((key:string)=>key)}));
vi.mock("@wms/domain/identity/access",()=>({runTenantQuery:()=>Promise.resolve("tenant")}));
import { createShippingOrderAction,shippingOrderAction,confirmShippingPickAction,postShipmentAction,previewShippingPickAction } from "./actions.ts";
const id="11111111-1111-4111-8111-111111111111",key="22222222-2222-4222-8222-222222222222";
const input={slug:"pilot",clientKey:key,customerRef:"Pilot",lines:[{itemId:id,quantity:"0.100001"}]};
let original:string|undefined;
beforeEach(()=>{original=process.env.BETTER_AUTH_URL;process.env.BETTER_AUTH_URL="https://app.example.test";mocks.origin="https://app.example.test";mocks.principal.mockResolvedValue({userId:"user",mfaVerified:true});mocks.item.mockResolvedValue({id,baseUnitId:"server-unit",trackingMode:"NONE"});mocks.create.mockResolvedValue({documentId:id});});
afterEach(()=>{if(original===undefined)delete process.env.BETTER_AUTH_URL;else process.env.BETTER_AUTH_URL=original;vi.clearAllMocks();});
describe("shipping action boundary",()=>{
 it("uses server base units and rejects tracked items before creating an unfulfillable order",async()=>{
  expect((await createShippingOrderAction(input)).ok).toBe(true);
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({clientKey:key,principal:{userId:"user",mfaVerified:true}}),expect.objectContaining({lines:[{itemId:id,quantity:"0.100001",unitId:"server-unit"}]}));
  mocks.create.mockClear();mocks.item.mockResolvedValue({id,baseUnitId:"server-unit",trackingMode:"LOT"});
  expect((await createShippingOrderAction(input)).ok).toBe(false);expect(mocks.create).not.toHaveBeenCalled();
 });
 it("rejects actor/unit injection, invalid quantity types and missing retry keys",async()=>{
  for(const raw of [{...input,userId:"other"},{...input,clientKey:undefined},{...input,lines:[{itemId:id,quantity:1}]},{...input,lines:[{itemId:id,quantity:"1",unitId:key}]}])expect((await createShippingOrderAction(raw)).ok).toBe(false);
  expect(mocks.create).not.toHaveBeenCalled();
 });
 it("guards pick and shipment Origin/session and forwards exact confirmed barcode quantities",async()=>{
  const pick={slug:"pilot",clientKey:key,taskId:id,foundQuantity:"2",scannedLocationCode:"R1",scannedItemBarcode:"PAIR"};
  mocks.post.mockResolvedValue({documentId:id});expect((await confirmShippingPickAction(pick)).ok).toBe(true);
  expect(mocks.post).toHaveBeenCalledWith(expect.objectContaining({clientKey:key}),expect.objectContaining({foundQuantity:"2",scannedItemBarcode:"PAIR"}));
  const ship={slug:"pilot",clientKey:key,orderId:id,warehouseId:key,lineId:id,quantity:"0.100001"};
  mocks.cancel.mockResolvedValue({documentId:id});expect((await postShipmentAction(ship)).ok).toBe(true);
  expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({clientKey:key}),expect.objectContaining({warehouseId:key,lines:[{orderLineId:id,quantity:"0.100001"}]}));
  mocks.post.mockClear();mocks.cancel.mockClear();mocks.origin="https://evil.example.test";expect((await confirmShippingPickAction(pick)).ok).toBe(false);
  mocks.origin="https://app.example.test";mocks.principal.mockResolvedValue(null);expect((await postShipmentAction(ship)).ok).toBe(false);
  expect(mocks.post).not.toHaveBeenCalled();expect(mocks.cancel).not.toHaveBeenCalled();
 });
 it("routes reservation and assignment separately; preview does not mutate",async()=>{
  mocks.approve.mockResolvedValue({documentId:id});mocks.transfer.mockResolvedValue({taskIds:[id]});
  expect((await shippingOrderAction({slug:"pilot",clientKey:key,orderId:id,operation:"reserve"})).ok).toBe(true);
  expect((await shippingOrderAction({slug:"pilot",clientKey:key,orderId:id,operation:"assign"})).ok).toBe(true);
  expect(mocks.transfer).toHaveBeenCalledWith(expect.objectContaining({clientKey:key}),expect.objectContaining({orderIds:[id]}));
  mocks.choices.mockResolvedValue({baseQuantity:"4.000000",unitCode:"ADET"});
  expect(await previewShippingPickAction({slug:"pilot",taskId:id,barcode:"PAIR",quantity:"2"})).toMatchObject({ok:true,data:{baseQuantity:"4.000000"}});
  expect(mocks.post).not.toHaveBeenCalled();expect(mocks.cancel).not.toHaveBeenCalled();
 });
});
