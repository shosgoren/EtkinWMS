import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({transfer:vi.fn(),create:vi.fn(),approve:vi.fn(),post:vi.fn(),cancel:vi.fn(),choices:vi.fn(),principal:vi.fn(),item:vi.fn(),origin:"https://app.example.test"}));
vi.mock("next/headers",()=>({headers:()=>Promise.resolve(new Headers({origin:mocks.origin}))}));
vi.mock("../../../../lib/auth-service.ts",()=>({getAuthService:()=>({getPrincipal:mocks.principal})}));
vi.mock("@wms/db",()=>({getAppDb:()=>({})}));
vi.mock("@wms/domain/operations",()=>({produceFromRecipe:mocks.post,createProductionRecipe:mocks.create,getProductionRecipe:mocks.item,scaleRecipeQuantity:()=>"0.100001",cancelSalesOrder:mocks.cancel}));
vi.mock("@wms/domain/catalog",()=>({getItem:mocks.item}));
vi.mock("@wms/domain/stock",()=>({createStockDocument:mocks.create,approveDocument:mocks.approve,postDocument:mocks.post,cancelDocument:mocks.cancel,searchStockChoices:mocks.choices}));
vi.mock("../../../../lib/rate-limit.ts",async original=>({...await original<object>(),createProductionLimiter:()=>({check:()=>Promise.resolve()})}));
vi.mock("next-intl/server",()=>({getTranslations:()=>Promise.resolve((key:string)=>key)}));
vi.mock("@wms/domain/identity/access",()=>({runTenantQuery:()=>Promise.resolve("tenant")}));
import { produceAction,createRecipeAction,previewProductionAction } from "./actions.ts";
import { shippingOrderAction } from "../shipping/actions.ts";
import { AppError } from "@wms/shared/errors";
const id="11111111-1111-4111-8111-111111111111",key="22222222-2222-4222-8222-222222222222";
const input={slug:"pilot",clientKey:key,recipeId:id,outputQuantity:"0.100001",targetLocationId:id,sources:[{lineNo:1,locationId:key}],reason:"Batch"};
let original:string|undefined;
beforeEach(()=>{original=process.env.BETTER_AUTH_URL;process.env.BETTER_AUTH_URL="https://app.example.test";mocks.origin="https://app.example.test";mocks.principal.mockResolvedValue({userId:"user",mfaVerified:true});mocks.item.mockResolvedValue({id,baseUnitId:"server-unit"});mocks.create.mockResolvedValue({documentId:id});});
afterEach(()=>{if(original===undefined)delete process.env.BETTER_AUTH_URL;else process.env.BETTER_AUTH_URL=original;vi.clearAllMocks();});
describe("production and cancellation action boundaries",()=>{
 it("preserves exact production quantities, source mapping, identity and retry key",async()=>{
  mocks.post.mockResolvedValue({documentId:id});expect((await produceAction(input)).ok).toBe(true);
  expect(mocks.post).toHaveBeenCalledWith(expect.objectContaining({principal:{userId:"user",mfaVerified:true},clientKey:key}),expect.objectContaining({outputQuantity:"0.100001",sources:input.sources}));
 });
 it("rejects actor injection, numeric quantities, missing keys, wrong Origin and missing session",async()=>{
  for(const raw of [{...input,userId:"other"},{...input,outputQuantity:0.1},{...input,clientKey:undefined}])expect((await produceAction(raw)).ok).toBe(false);
  mocks.origin="https://evil.example.test";expect((await produceAction(input)).ok).toBe(false);
  mocks.origin="https://app.example.test";mocks.principal.mockResolvedValue(null);expect((await produceAction(input)).ok).toBe(false);
  expect(mocks.post).not.toHaveBeenCalled();
 });
 it("previews from the stored recipe without posting and guards recipe creation",async()=>{
  mocks.item.mockResolvedValue({outputQuantity:"1",lines:[{lineNo:1,quantity:"1"}]});
  expect(await previewProductionAction({slug:"pilot",recipeId:id,outputQuantity:"0.100001"})).toMatchObject({ok:true,data:[{lineNo:1,quantity:"0.100001"}]});expect(mocks.post).not.toHaveBeenCalled();
  const recipe={slug:"pilot",clientKey:key,code:"R1",version:1,name:"Recipe",outputItemId:id,outputQuantity:"1",lines:[{itemId:key,quantity:"0.100001"}]};
  expect((await createRecipeAction(recipe)).ok).toBe(true);
  expect((await createRecipeAction({...recipe,tenantId:id})).ok).toBe(false);
 });
 it("requires the user's observed cancellation version and preserves stale-version rejection",async()=>{
  const raw={slug:"pilot",clientKey:key,orderId:id,operation:"cancel"};
  for(const expectedVersion of [undefined,0,-1,1.5,"2"])expect((await shippingOrderAction({...raw,expectedVersion})).ok).toBe(false);
  expect(mocks.cancel).not.toHaveBeenCalled();mocks.cancel.mockResolvedValue({documentId:id});
  expect((await shippingOrderAction({...raw,expectedVersion:2})).ok).toBe(true);
  expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({clientKey:key}),expect.objectContaining({expectedVersion:2}));
  mocks.cancel.mockRejectedValue(new AppError("VERSION_CONFLICT"));
  expect(await shippingOrderAction({...raw,expectedVersion:2})).toMatchObject({ok:false,error:{code:"VERSION_CONFLICT"}});
 });
});
