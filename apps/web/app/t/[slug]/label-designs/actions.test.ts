import{beforeEach,describe,expect,it,vi}from"vitest";
const state=vi.hoisted(()=>({authenticated:true,origin:"https://wms.test",limit:vi.fn(),recent:vi.fn(),tenant:vi.fn(),log:vi.fn(),db:{fixture:true},calls:Object.fromEntries(['getLabelWorkspace','getLabelTemplate','saveLabelTemplate','publishLabelTemplate','assignLabelDefault','archiveLabelTemplate','restoreLabelDraft','uploadLabelLogo','readLabelLogo','saveLabelPrinter','setLabelPrinterPreference','exportLabelDesigns'].map(k=>[k,vi.fn()])) as Record<string,ReturnType<typeof vi.fn>>}));
vi.mock('next/headers',()=>({headers:()=>Promise.resolve(new Headers({'origin':state.origin,'x-test-ip':'127.0.0.1'}))}));
vi.mock('@wms/db',()=>({getAppDb:()=>state.db}));
vi.mock('@wms/domain/labels/store',()=>state.calls);
vi.mock('../../../../lib/auth-service.ts',()=>({ensureRecentAuth:state.recent}));
vi.mock('../../../../lib/action-guard.ts',async()=>{
 const actual=await vi.importActual<typeof import('../../../../lib/action-guard.ts')>('../../../../lib/action-guard.ts');
 return{...actual,limitVerifiedTenant:state.tenant,createProductionGuard:(getHeaders:()=>Promise<Headers>)=>actual.createActionGuard({getHeaders,resolvePrincipal:()=>Promise.resolve(state.authenticated?{userId:'11111111-1111-4111-8111-111111111111',mfaVerified:true}:null),appUrl:'https://wms.test',socketIp:()=> '127.0.0.1',production:false,newRequestId:()=> '22222222-2222-4222-8222-222222222222',log:state.log,limiter:{check:state.limit}})};
});
import{labelWorkspaceAction,labelTemplateAction,labelSaveAction,labelPublishAction,labelAssignAction,labelArchiveAction,labelRestoreAction,labelLogoUploadAction,labelLogoReadAction,labelPrinterSaveAction,labelPreferenceAction,labelExportAction}from'./actions.ts';
const id='33333333-3333-4333-8333-333333333333',base={slug:'motive',id};
beforeEach(()=>{vi.clearAllMocks();state.authenticated=true;state.origin='https://wms.test';state.tenant.mockReset().mockResolvedValue(undefined);for(const f of Object.values(state.calls))f.mockResolvedValue({id,version:1});state.calls.readLabelLogo!.mockResolvedValue(Buffer.from('canonical-png'));});
describe('label action trusted boundary',()=>{
 it.each([
  [labelWorkspaceAction,{slug:'motive',deviceId:id},'getLabelWorkspace','labels.view'],
  [labelTemplateAction,base,'getLabelTemplate','labels.view'],
  [labelSaveAction,{...base,name:'Raf',expectedVersion:1,design:{}},'saveLabelTemplate','labels.design'],
  [labelPublishAction,{...base,expectedVersion:1,expectedDefaultVersion:0},'publishLabelTemplate','labels.publish'],
  [labelAssignAction,{...base,expectedDefaultVersion:0},'assignLabelDefault','labels.publish'],
  [labelArchiveAction,{...base,expectedVersion:1,archived:true},'archiveLabelTemplate','labels.publish'],
  [labelRestoreAction,{...base,expectedVersion:1,versionId:id},'restoreLabelDraft','labels.design'],
  [labelLogoReadAction,base,'readLabelLogo','labels.view'],
  [labelPrinterSaveAction,{slug:'motive',name:'Epson',expectedVersion:0,dpi:300,offsetX:0,offsetY:0,active:true},'saveLabelPrinter','labels.printers'],
  [labelPreferenceAction,{slug:'motive',templateId:id,deviceId:id,printerId:id,expectedVersion:0},'setLabelPrinterPreference','labels.printers'],
  [labelExportAction,{slug:'motive',kind:'TEMPLATES'},'exportLabelDesigns','labels.view'],
 ] as const)('%s uses the verified actor, tenant limiter and exact domain permission',async(action,input,name,permission)=>{
  const r=await action(input);expect(r.ok).toBe(true);expect(state.tenant).toHaveBeenCalledWith(expect.objectContaining({tenantSlug:'motive',permission,principal:{userId:'11111111-1111-4111-8111-111111111111',mfaVerified:true}}),expect.objectContaining({origin:'https://wms.test'}));
  expect(state.calls[name]).toHaveBeenCalled();const p=state.calls[name]!.mock.calls[0]?.[0];expect(p).toMatchObject({tenantSlug:'motive',requestId:'22222222-2222-4222-8222-222222222222'});await p.recentAuth();expect(state.recent).toHaveBeenCalledWith(expect.any(Headers));expect(state.limit).toHaveBeenCalledWith('user','11111111-1111-4111-8111-111111111111');
 });
 it('rejects actor/tenant override, unsafe printer endpoints and unknown inputs before domain calls',async()=>{
  for(const extra of[{tenantId:id},{actorUserId:id},{requestId:id},{preview:true},{url:'http://localhost:9100'}])expect((await labelSaveAction({...base,name:'test',expectedVersion:1,design:{},...extra})).ok).toBe(false);
  expect(state.calls.saveLabelTemplate).not.toHaveBeenCalled();expect(state.tenant).not.toHaveBeenCalled();
 });
 it('authentication, foreign Origin and verified-tenant rejection cannot reach a domain operation',async()=>{
  state.authenticated=false;expect((await labelTemplateAction(base)).ok).toBe(false);state.authenticated=true;state.origin='https://foreign.test';expect((await labelTemplateAction(base)).ok).toBe(false);state.origin='https://wms.test';state.tenant.mockRejectedValueOnce(new Error('blocked'));expect((await labelTemplateAction(base)).ok).toBe(false);expect(state.calls.getLabelTemplate).not.toHaveBeenCalled();
 });

 it('publication-only precheck archives without demanding a design grant',async()=>{
  state.tenant.mockImplementation(async(access)=>{if(access.permission==='labels.design')throw new Error('no design grant');});
  const r=await labelArchiveAction({...base,expectedVersion:1,archived:true});expect(r.ok).toBe(true);expect(state.calls.archiveLabelTemplate).toHaveBeenCalledTimes(1);expect(state.tenant).toHaveBeenCalledWith(expect.objectContaining({permission:'labels.publish'}),expect.anything());
 });
 it('known missing view permission rejects an upload before any asset is committed',async()=>{
  state.tenant.mockImplementation(async(access)=>{if(access.permission==='labels.view')throw new Error('no view grant');});
  const r=await labelLogoUploadAction({slug:'motive',png:Buffer.alloc(80,4).toString('base64')});expect(r.ok).toBe(false);expect(state.calls.uploadLabelLogo).not.toHaveBeenCalled();expect(state.calls.readLabelLogo).not.toHaveBeenCalled();
 });
 it('uploads bounded decoded bytes and returns only the canonical server asset',async()=>{
  const bytes=Buffer.alloc(80,4),r=await labelLogoUploadAction({slug:'motive',png:bytes.toString('base64')});expect(r.ok).toBe(true);if(r.ok)expect(r.data.uri).toBe('data:image/png;base64,'+Buffer.from('canonical-png').toString('base64'));expect(state.calls.uploadLabelLogo).toHaveBeenCalledWith(expect.objectContaining({tenantSlug:'motive'}),bytes);expect(state.calls.readLabelLogo).toHaveBeenCalledWith(expect.anything(),id);
  expect((await labelLogoUploadAction({slug:'motive',png:'data:image/svg+xml,<svg/>'})).ok).toBe(false);expect((await labelLogoUploadAction({slug:'motive',png:Buffer.alloc(128*1024+1).toString('base64')})).ok).toBe(false);expect(state.calls.uploadLabelLogo).toHaveBeenCalledTimes(1);
 });
});
