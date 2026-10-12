import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({transfer:vi.fn(),create:vi.fn(),approve:vi.fn(),post:vi.fn(),cancel:vi.fn(),choices:vi.fn(),principal:vi.fn(),item:vi.fn(),origin:"https://app.example.test"}));
vi.mock("next/headers",()=>({headers:()=>Promise.resolve(new Headers({origin:mocks.origin}))}));
vi.mock("../../../../../lib/auth-service.ts",()=>({getAuthService:()=>({getPrincipal:mocks.principal})}));
vi.mock("@wms/db",()=>({getAppDb:()=>({})}));
vi.mock("@wms/domain/operations",()=>({transferBetweenWarehouses:mocks.transfer}));
vi.mock("@wms/domain/catalog",()=>({getItem:mocks.item}));
vi.mock("@wms/domain/stock",()=>({createStockDocument:mocks.create,approveDocument:mocks.approve,postDocument:mocks.post,cancelDocument:mocks.cancel,searchStockChoices:mocks.choices}));
vi.mock("../../../../../lib/rate-limit.ts",async original=>({...await original<object>(),createProductionLimiter:()=>({check:()=>Promise.resolve()})}));
vi.mock("next-intl/server",()=>({getTranslations:()=>Promise.resolve((key:string)=>key)}));
vi.mock("@wms/domain/identity/access",()=>({runTenantQuery:()=>Promise.resolve("tenant")}));
import { createManualStockAction,transitionManualStockAction,transferStockAction } from "./actions.ts";
const id="11111111-1111-4111-8111-111111111111",key="22222222-2222-4222-8222-222222222222";
const input={slug:"pilot",clientKey:key,kind:"STOCK_IN",warehouseId:id,itemId:id,locationId:id,quantity:"0.100001",reason:"Opening"};
let original:string|undefined;
beforeEach(()=>{original=process.env.BETTER_AUTH_URL;process.env.BETTER_AUTH_URL="https://app.example.test";mocks.origin="https://app.example.test";mocks.principal.mockResolvedValue({userId:"user",mfaVerified:true});mocks.item.mockResolvedValue({id,baseUnitId:"server-unit"});mocks.create.mockResolvedValue({documentId:id});});
afterEach(()=>{if(original===undefined)delete process.env.BETTER_AUTH_URL;else process.env.BETTER_AUTH_URL=original;vi.clearAllMocks();});
describe("manual stock action boundary",()=>{
 it("transfers with the authenticated actor, exact quantity and retry key; rejects untrusted fields and origin",async()=>{
  const raw={slug:"pilot",clientKey:key,sourceLocationId:id,targetLocationId:key,itemId:id,quantity:"0.100001",reason:"Move"};
  mocks.transfer.mockResolvedValue({documentId:id});
  expect((await transferStockAction(raw)).ok).toBe(true);
  expect(mocks.transfer).toHaveBeenCalledWith(expect.objectContaining({clientKey:key,principal:{userId:"user",mfaVerified:true}}),expect.objectContaining({sourceLocationId:id,targetLocationId:key,quantity:"0.100001"}));
  mocks.transfer.mockClear();
  for(const invalid of [{...raw,userId:"other"},{...raw,quantity:0.1},{...raw,clientKey:undefined}])expect((await transferStockAction(invalid)).ok).toBe(false);
  mocks.origin="https://evil.example.test";expect((await transferStockAction(raw)).ok).toBe(false);
  mocks.origin="https://app.example.test";mocks.principal.mockResolvedValue(null);expect((await transferStockAction(raw)).ok).toBe(false);
  expect(mocks.transfer).not.toHaveBeenCalled();
 });
 it("takes the base unit from the server and preserves decimal text and idempotency key",async()=>{
  expect((await createManualStockAction(input)).ok).toBe(true);
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({clientKey:key,principal:{userId:"user",mfaVerified:true}}),expect.objectContaining({lines:[expect.objectContaining({unitId:"server-unit",quantity:"0.100001",baseQuantity:"0.100001",conversionFactor:"1",targetLocationId:id})]}));
 });
 it("rejects actor/unit injection, numeric quantities and missing keys before invoking domain",async()=>{
  for(const raw of [{...input,userId:"other"},{...input,unitId:id},{...input,quantity:0.1},{...input,clientKey:undefined}]) expect((await createManualStockAction(raw)).ok).toBe(false);
  expect(mocks.create).not.toHaveBeenCalled();
 });
 it("rejects unauthenticated and wrong-origin mutations",async()=>{
  mocks.principal.mockResolvedValue(null);expect((await createManualStockAction(input)).ok).toBe(false);
  mocks.principal.mockResolvedValue({userId:"user",mfaVerified:true});mocks.origin="https://evil.example.test";
  expect((await createManualStockAction(input)).ok).toBe(false);expect(mocks.create).not.toHaveBeenCalled();
 });
 it("passes the expected version and operation to the existing guarded command",async()=>{
  mocks.post.mockResolvedValue({documentId:id,status:"POSTED"});
  expect((await transitionManualStockAction({slug:"pilot",clientKey:key,documentId:id,expectedVersion:2,operation:"post"})).ok).toBe(true);
  expect(mocks.post).toHaveBeenCalledWith(expect.objectContaining({clientKey:key}),expect.objectContaining({documentId:id,expectedVersion:2}));
  expect(mocks.approve).not.toHaveBeenCalled();expect(mocks.cancel).not.toHaveBeenCalled();
 });
});
