import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({packagePreview:vi.fn(),packagePrepare:vi.fn(),packagePost:vi.fn(),packageBatch:vi.fn(),limit:vi.fn(),access:vi.fn(),ip:undefined as string|undefined,transfer:vi.fn(),create:vi.fn(),approve:vi.fn(),post:vi.fn(),cancel:vi.fn(),choices:vi.fn(),principal:vi.fn(),item:vi.fn(),origin:"https://app.example.test"}));
vi.mock("next/headers",()=>({headers:()=>Promise.resolve(new Headers({...{origin:mocks.origin},...(mocks.ip===undefined?{}:{"fly-client-ip":mocks.ip})}))}));
vi.mock("../../../../lib/auth-service.ts",()=>({getAuthService:()=>({getPrincipal:mocks.principal})}));
vi.mock("@wms/db",()=>({getAppDb:()=>({})}));
vi.mock("@wms/domain/operations",()=>({previewPackageProduction:mocks.packagePreview,preparePackageProduction:mocks.packagePrepare,postPackageProduction:mocks.packagePost,getPackageProductionBatch:mocks.packageBatch,produceFromRecipe:mocks.post,createProductionRecipe:mocks.create,getProductionRecipe:mocks.item,scaleRecipeQuantity:()=>"0.100001",cancelSalesOrder:mocks.cancel}));
vi.mock("@wms/domain/catalog",()=>({getItem:mocks.item}));
vi.mock("@wms/domain/stock",()=>({createStockDocument:mocks.create,approveDocument:mocks.approve,postDocument:mocks.post,cancelDocument:mocks.cancel,searchStockChoices:mocks.choices}));
vi.mock("../../../../lib/rate-limit.ts",async original=>({...await original<object>(),createProductionLimiter:()=>({check:mocks.limit})}));
vi.mock("next-intl/server",()=>({getTranslations:()=>Promise.resolve((key:string)=>key)}));
vi.mock("@wms/domain/identity/access",()=>({runTenantQuery:mocks.access}));
import { produceAction,createRecipeAction,previewProductionAction,previewPackageProductionAction,preparePackageProductionAction,postPackageProductionAction,getPackageProductionBatchAction } from "./actions.ts";
import { shippingOrderAction } from "../shipping/actions.ts";
import { AppError } from "@wms/shared/errors";
const id="11111111-1111-4111-8111-111111111111",key="22222222-2222-4222-8222-222222222222";
const input={slug:"pilot",clientKey:key,recipeId:id,outputQuantity:"0.100001",targetLocationId:id,sources:[{lineNo:1,locationId:key}],reason:"Batch"};
let original:string|undefined;
beforeEach(()=>{original=process.env.BETTER_AUTH_URL;process.env.BETTER_AUTH_URL="https://app.example.test";mocks.origin="https://app.example.test";mocks.ip=undefined;mocks.limit.mockResolvedValue(undefined);mocks.access.mockResolvedValue("verified-tenant");mocks.principal.mockResolvedValue({userId:"user",mfaVerified:true});mocks.item.mockResolvedValue({id,baseUnitId:"server-unit"});mocks.create.mockResolvedValue({documentId:id});});
afterEach(()=>{if(original===undefined)delete process.env.BETTER_AUTH_URL;else process.env.BETTER_AUTH_URL=original;vi.clearAllMocks();vi.unstubAllEnvs();});
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

const packageInput={slug:"pilot",recipeId:id,recipeVersion:2,outputQuantity:"50",targetLocationId:key,
 inputs:[{packageId:id,predecessorVersion:0,currentBalanceVersion:"3",baseQuantity:"50"}],
 outputs:{kind:"VARIL",packages:{mode:"equal",count:1,quantity:"50",lotCode:"OUT-1",producedOn:"2026-10-14"}},
};
describe("physical package production action boundary",()=>{
 beforeEach(()=>{vi.stubEnv("PACKAGE_RECEIVING_ENABLED","true");mocks.packagePreview.mockResolvedValue({outputs:[]});mocks.packagePrepare.mockResolvedValue({documentId:id,status:"APPROVED"});mocks.packagePost.mockResolvedValue({documentId:id,status:"POSTED"});mocks.packageBatch.mockResolvedValue({documentId:id,documentStatus:"POSTED",packages:[]});});
 it("previews without minting identities, prepares once with prepare key and posts existing IN using independent post key",async()=>{
  expect((await previewPackageProductionAction(packageInput)).ok).toBe(true);
  expect(mocks.packagePrepare).not.toHaveBeenCalled();expect(mocks.packagePost).not.toHaveBeenCalled();
  expect(mocks.packagePreview).toHaveBeenCalledWith(expect.objectContaining({tenantSlug:"pilot",principal:{userId:"user",mfaVerified:true}}),expect.objectContaining({recipeVersion:2,inputs:packageInput.inputs,outputs:packageInput.outputs}));
  const prepared={...packageInput,clientKey:key};
  expect((await preparePackageProductionAction(prepared)).ok).toBe(true);
  expect(mocks.packagePrepare).toHaveBeenCalledWith(expect.objectContaining({clientKey:key}),expect.objectContaining({recipeVersion:2,outputQuantity:"50"}));
  const posted={slug:"pilot",clientKey:id,documentId:id,expectedVersion:1};
  expect((await postPackageProductionAction(posted)).ok).toBe(true);
  expect(mocks.packagePost).toHaveBeenCalledWith(expect.objectContaining({clientKey:id}),expect.objectContaining({documentId:id,expectedVersion:1}));
  expect(mocks.packagePost.mock.calls[0]?.[1]).not.toHaveProperty("inputs");
  expect(mocks.access).toHaveBeenCalledWith(expect.objectContaining({permission:"stock.post",tenantSlug:"pilot"}),expect.any(Function));
  expect(mocks.limit).toHaveBeenCalledWith("tenant","verified-tenant");
 });
 it("rejects injected stock/source/identity facts at every nested boundary before domain calls",async()=>{
  for(const raw of [{...packageInput,clientKey:key,tenantId:id},{...packageInput,clientKey:key,sources:[]},
   {...packageInput,clientKey:key,inputs:[{...packageInput.inputs[0],warehouseId:key}]},
   {...packageInput,clientKey:key,outputs:{...packageInput.outputs,packages:{...packageInput.outputs.packages,id:key}}},
   {...packageInput,clientKey:key,outputs:{...packageInput.outputs,packages:{...packageInput.outputs.packages,conversionFactor:"1"}}}])expect((await preparePackageProductionAction(raw)).ok).toBe(false);
  expect((await previewPackageProductionAction({...packageInput,clientKey:key})).ok).toBe(false);
  expect((await postPackageProductionAction({slug:"pilot",clientKey:key,documentId:id,expectedVersion:1,outputIds:[key]})).ok).toBe(false);
  expect(mocks.packagePrepare).not.toHaveBeenCalled();expect(mocks.packagePreview).not.toHaveBeenCalled();expect(mocks.packagePost).not.toHaveBeenCalled();
 });
 it("fails closed for disabled flag, missing MFA, foreign tenant and wrong Origin",async()=>{
  const raw={...packageInput,clientKey:key};
  vi.stubEnv("PACKAGE_RECEIVING_ENABLED","false");expect((await preparePackageProductionAction(raw)).ok).toBe(false);
  vi.stubEnv("PACKAGE_RECEIVING_ENABLED","true");mocks.principal.mockResolvedValue({userId:"user",mfaVerified:false});
  expect(await preparePackageProductionAction(raw)).toMatchObject({ok:false,error:{code:"FORBIDDEN",detail:"MFA_REQUIRED"}});
  expect(mocks.access).not.toHaveBeenCalled();expect(mocks.limit).not.toHaveBeenCalledWith("tenant",expect.anything());
  mocks.principal.mockResolvedValue({userId:"user",mfaVerified:true});mocks.access.mockRejectedValueOnce(new AppError("FORBIDDEN"));
  expect((await preparePackageProductionAction(raw)).ok).toBe(false);expect(mocks.limit).not.toHaveBeenCalledWith("tenant",expect.anything());
  mocks.origin="https://evil.example.test";expect((await preparePackageProductionAction(raw)).ok).toBe(false);
  expect(mocks.packagePrepare).not.toHaveBeenCalled();
 });
 it("requires resolvable production IP before principal and verifies stock.view for readonly batch lookup",async()=>{
  vi.stubEnv("WMS_ENV","production");mocks.principal.mockClear();
  expect((await getPackageProductionBatchAction({slug:"pilot",documentId:id})).ok).toBe(false);expect(mocks.principal).not.toHaveBeenCalled();
  mocks.ip="203.0.113.4";expect((await getPackageProductionBatchAction({slug:"pilot",documentId:id})).ok).toBe(true);
  expect(mocks.limit).toHaveBeenCalledWith("ip","203.0.113.4");expect(mocks.access).toHaveBeenCalledWith(expect.objectContaining({permission:"stock.view"}),expect.any(Function));
  expect(mocks.packageBatch).toHaveBeenCalledWith(expect.objectContaining({tenantSlug:"pilot"}),{documentId:id});expect(mocks.packagePost).not.toHaveBeenCalled();
 });
 it("requires observed document version and preserves stale post rejection",async()=>{
  for(const expectedVersion of [undefined,0,-1,1.5,"1"])expect((await postPackageProductionAction({slug:"pilot",clientKey:key,documentId:id,expectedVersion})).ok).toBe(false);
  expect(mocks.packagePost).not.toHaveBeenCalled();mocks.packagePost.mockRejectedValueOnce(new AppError("VERSION_CONFLICT"));
  expect(await postPackageProductionAction({slug:"pilot",clientKey:key,documentId:id,expectedVersion:1})).toMatchObject({ok:false,error:{code:"VERSION_CONFLICT"}});
 });
});
