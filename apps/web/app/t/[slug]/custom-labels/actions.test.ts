import{beforeEach,expect,it,vi}from'vitest';
const s=vi.hoisted(()=>({authenticated:true,origin:'https://wms.test',limit:vi.fn(),tenant:vi.fn(),log:vi.fn(),preview:vi.fn(),prepare:vi.fn(),packages:false}));
vi.mock('next/headers',()=>({headers:()=>Promise.resolve(new Headers({origin:s.origin}))}));
vi.mock('@wms/db',()=>({getAppDb:()=>({fixture:true})}));
vi.mock('@wms/domain/labels/print',async()=>{const{AppError}=await import('@wms/shared/errors');return{previewCustomLabels:s.preview,prepareCustomLabels:s.prepare,LabelPrintError:class extends AppError{constructor(readonly reason:string){super('VALIDATION_FAILED');}}};});
vi.mock('../../../../lib/package-receiving-config.ts',()=>({packageReceivingEnabled:()=>s.packages}));
vi.mock('../../../../lib/action-guard.ts',async()=>{const a=await vi.importActual<typeof import('../../../../lib/action-guard.ts')>('../../../../lib/action-guard.ts');return{...a,limitVerifiedTenant:s.tenant,createProductionGuard:(getHeaders:()=>Promise<Headers>)=>a.createActionGuard({getHeaders,resolvePrincipal:()=>Promise.resolve(s.authenticated?{userId:'11111111-1111-4111-8111-111111111111',mfaVerified:true}:null),appUrl:'https://wms.test',socketIp:()=> '127.0.0.1',production:false,newRequestId:()=> '22222222-2222-4222-8222-222222222222',log:s.log,limiter:{check:s.limit}})};});
import{LabelPrintError}from'@wms/domain/labels/print';
import{LabelDesignError}from'@wms/shared/labels';
import{customLabelPrepareAction,customLabelPreviewAction}from'./actions.ts';
const id='33333333-3333-4333-8333-333333333333',input={slug:'motive',source:{kind:'PRODUCT',ids:[id]},locale:'tr'};
beforeEach(()=>{vi.clearAllMocks();s.authenticated=true;s.origin='https://wms.test';s.packages=false;s.limit.mockResolvedValue(undefined);s.tenant.mockResolvedValue(undefined);s.preview.mockResolvedValue({pages:['trusted-svg']});s.prepare.mockResolvedValue({jobId:id,pages:['trusted-svg']});});
it('preview/prepare use verified tenant, actor, print permission and server feature state',async()=>{
 const p=await customLabelPreviewAction(input);expect(p.ok).toBe(true);expect(s.tenant).toHaveBeenCalledWith(expect.objectContaining({tenantSlug:'motive',permission:'labels.print',principal:{userId:'11111111-1111-4111-8111-111111111111',mfaVerified:true}}),expect.anything());expect(s.preview).toHaveBeenCalledWith(expect.objectContaining({tenantSlug:'motive'}),{source:input.source,locale:'tr'},false);
 s.packages=true;const r=await customLabelPrepareAction({...input,jobId:id,copies:1});expect(r.ok).toBe(true);expect(s.prepare).toHaveBeenCalledWith(expect.objectContaining({requestId:'22222222-2222-4222-8222-222222222222'}),{source:input.source,locale:'tr',jobId:id,copies:1},true);
});
it('actor, tenant, printer, snapshot and preview overrides are rejected before domain',async()=>{
 for(const extra of[{tenantId:id},{userId:id},{printerId:id},{snapshot:[]},{values:{barcode:'FORGED'}},{dpi:203},{preview:true},{packagesEnabled:true},{url:'http://localhost:9100'}])expect((await customLabelPrepareAction({...input,jobId:id,copies:1,...extra})).ok).toBe(false);
 expect(s.prepare).not.toHaveBeenCalled();expect(s.tenant).not.toHaveBeenCalled();
});
it('untrusted Origin, missing session and current tenant denial never reach print preparation',async()=>{
 s.origin='https://foreign.test';expect((await customLabelPrepareAction({...input,jobId:id,copies:1})).ok).toBe(false);s.origin='https://wms.test';s.authenticated=false;expect((await customLabelPreviewAction(input)).ok).toBe(false);s.authenticated=true;s.tenant.mockRejectedValue(new Error('denied'));expect((await customLabelPrepareAction({...input,jobId:id,copies:1})).ok).toBe(false);expect(s.prepare).not.toHaveBeenCalled();expect(s.preview).not.toHaveBeenCalled();
});
it('known print/design failures return a closed reason without raw details or successful print claim',async()=>{
 s.prepare.mockRejectedValueOnce(new LabelPrintError('PRINTER_UNAVAILABLE'));const a=await customLabelPrepareAction({...input,jobId:id,copies:1});expect(a.ok&&a.data).toEqual({ready:false,reason:'PRINTER_UNAVAILABLE'});
 s.preview.mockRejectedValueOnce(new LabelDesignError('OUTSIDE_LABEL','private-element'));const b=await customLabelPreviewAction(input);expect(b.ok&&b.data).toEqual({ready:false,reason:'DESIGN_INVALID'});
});
it('invalid copies, unknown locale and missing stable job key fail schema validation',async()=>{
 for(const patch of[{copies:0},{copies:101},{copies:1.1},{locale:'unknown'},{jobId:undefined}])expect((await customLabelPrepareAction({...input,jobId:id,copies:1,...patch})).ok).toBe(false);expect(s.prepare).not.toHaveBeenCalled();
});
