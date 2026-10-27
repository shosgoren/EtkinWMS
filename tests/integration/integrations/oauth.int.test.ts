// T-1066: real RLS/database and HTTP provider, synthetic credentials only.
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {beforeAll,afterAll,beforeEach,describe,it,expect} from 'vitest';
import {createDbClient} from '../../../packages/db/src/index.ts';
import type {DbClient} from '../../../packages/db/src/client.ts';
import {createSealer} from '../../../packages/shared/src/seal.ts';
import {beginParasutOAuth,completeParasutOAuth,getParasutOAuthSelection,selectParasutOAuthCompany,saveParasutOAuthSettings,getParasutOAuthSettings,disconnectIntegration,getIntegrationOverview,checkIntegration,ParasutClient,encodeOAuthBinding,parseOAuthBinding,matchesOAuthState,type OAuthBinding} from '../../../packages/domain/src/integrations/index.ts';
import {startFakeParasut,type FakeParasut} from '../fixtures/fake-parasut.ts';
import {seedWorld,newRegistry,type TenantWorld} from '../fixtures/tenants.ts';
import {readIntEnv} from '../harness/env.ts';
const env=readIntEnv(process.env),reg=newRegistry(),sealer=createSealer(randomBytes(32).toString('hex'));
let db:DbClient,adm:pg.Client,A:TenantWorld,B:TenantWorld,fake:FakeParasut;
const prior=process.env.BETTER_AUTH_URL;
const params=(w=A)=>({db,principal:{userId:w.ownerUserId,mfaVerified:true},tenantSlug:w.slug,recentAuth:async()=>undefined});
const deps=()=>({sealer,client:new ParasutClient({baseUrl:fake.url,sleep:async()=>undefined})});
const input=(callbackUrl=fake.opts.redirectUri)=>({clientId:fake.opts.clientId,clientSecret:fake.opts.clientSecret,callbackUrl});
async function start(w=A){await saveParasutOAuthSettings(params(w),input(),deps());const r=await beginParasutOAuth(params(w),deps());if(!r.ok)throw new Error('begin failed');return r;}
const finish=(binding:OAuthBinding,w=A)=>completeParasutOAuth(params(w),{binding,code:fake.opts.authorizationCode},deps());
const grants=()=>fake.requests.filter(r=>r.path==='/oauth/token').length;
beforeAll(async()=>{process.env.BETTER_AUTH_URL='https://wms.example.test';db=createDbClient({url:env.databaseUrl,poolMax:4,prepare:false});adm=new pg.Client({connectionString:env.databaseUrlDirect});await adm.connect();A=await seedWorld(adm,reg,'OA');B=await seedWorld(adm,reg,'OB');});
afterAll(async()=>{await fake?.close();await db?.close();await adm?.end();if(prior===undefined)delete process.env.BETTER_AUTH_URL;else process.env.BETTER_AUTH_URL=prior;});
beforeEach(async()=>{await fake?.close();fake=await startFakeParasut();await adm.query("UPDATE integration_oauth_attempts SET phase='FAILED',token_box=NULL,companies='[]'");});
describe('tenant OAuth configuration',()=>{
 it('stores three customer values encrypted, returns no application secrets and keeps tenants separate',async()=>{
  await saveParasutOAuthSettings(params(),input('https://customer.example.test/return?app=warehouse'),deps());
  const row=(await adm.query('SELECT credentials FROM integration_oauth_apps WHERE tenant_id=$1',[A.tenantId])).rows[0];
  expect(JSON.stringify(row)).not.toContain(fake.opts.clientSecret);expect(JSON.stringify(row)).not.toContain(fake.opts.clientId);
  expect(await getParasutOAuthSettings(params())).toEqual({configured:true,callbackUrl:'https://wms.example.test/api/integrations/parasut/callback'});
  const r=await beginParasutOAuth(params(),deps());expect(r.ok).toBe(true);if(r.ok){expect(new URL(r.authorizationUrl).searchParams.get('redirect_uri')).toBe('https://customer.example.test/return?app=warehouse');expect(r.manual).toBe(true);}
  const b=await beginParasutOAuth(params(B),deps());expect(b).toEqual({ok:false,reason:'CONFIG'});
 });
 it.each(['http://example.test/back','javascript:alert(1)','https://user:pass@example.test','https://example.test/#token','not a URI'])('rejects unsafe callback %s',async callback=>{
  await expect(saveParasutOAuthSettings(params(),input(callback),deps())).rejects.toMatchObject({code:'VALIDATION_FAILED'});
 });
 it('accepts OOB without customer password and never puts secret in authorization URL',async()=>{
  await saveParasutOAuthSettings(params(),input('urn:ietf:wg:oauth:2.0:oob'),deps());const r=await beginParasutOAuth(params(),deps());expect(r.ok).toBe(true);if(r.ok){expect(r.manual).toBe(true);expect(new URL(r.authorizationUrl).searchParams.get('redirect_uri')).toBe('urn:ietf:wg:oauth:2.0:oob');expect(r.authorizationUrl).not.toContain(fake.opts.clientSecret);}
 });
 it('requires role, MFA and recent authentication for saving',async()=>{
  await expect(saveParasutOAuthSettings({...params(),recentAuth:undefined},input(),deps())).rejects.toMatchObject({code:'UNAUTHENTICATED'});
  await expect(saveParasutOAuthSettings({...params(),principal:{userId:A.memberUserId,mfaVerified:true}},input(),deps())).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(saveParasutOAuthSettings({...params(),principal:{userId:A.ownerUserId,mfaVerified:false}},input(),deps())).rejects.toMatchObject({code:'FORBIDDEN'});
 });
});
describe('single use authorization',()=>{
 it('connects one company, enables only quantity-free product pull and writes no stock',async()=>{
  const before=(await adm.query("SELECT count(*)::int AS n FROM stock_ledger WHERE tenant_id=$1",[A.tenantId])).rows[0].n;
  const r=await start();expect(r.manual).toBe(false);
  expect(await finish(r.binding)).toEqual({ok:true,status:'CONNECTED',label:fake.opts.companyName});
  expect(grants()).toBe(1);const o=await getIntegrationOverview(params());expect(o.providers[0]?.flows.filter(f=>f.enabled).map(f=>[f.flow,f.direction])).toEqual([["PRODUCTS","PULL"]]);
  const row=(await adm.query('SELECT phase,token_box FROM integration_oauth_attempts WHERE id=$1',[r.binding.id])).rows[0];expect(row).toEqual({phase:'COMPLETE',token_box:null});
  const audits=(await adm.query("SELECT change_summary FROM audit_logs WHERE tenant_id=$1",[A.tenantId])).rows;
  expect(JSON.stringify(audits)).not.toContain(fake.opts.clientSecret);expect(JSON.stringify(audits)).not.toContain(fake.accessToken);
  expect((await adm.query('SELECT count(*)::int AS n FROM stock_ledger WHERE tenant_id=$1',[A.tenantId])).rows[0].n).toBe(before);
  await expect(finish(r.binding)).rejects.toMatchObject({code:'VALIDATION_FAILED'});expect(grants()).toBe(1);
 });
 it('offers only provider company names; seals temporary token; rejects unknown company and selection replay',async()=>{
  const r=await start();fake.companies.push({id:'116',name:'Other company'});const done=await finish(r.binding);expect(done.ok&&done.status).toBe('SELECT');
  expect(await getParasutOAuthSelection(params(),r.binding,deps())).toHaveLength(2);
  const rows=(await adm.query('SELECT token_box FROM integration_oauth_attempts WHERE id=$1',[r.binding.id])).rows;expect(JSON.stringify(rows)).not.toContain(fake.accessToken);
  await expect(selectParasutOAuthCompany(params(),{binding:r.binding,companyId:'999'},deps())).rejects.toMatchObject({code:'VALIDATION_FAILED'});
  expect((await selectParasutOAuthCompany(params(),{binding:r.binding,companyId:fake.opts.companyId},deps())).ok).toBe(true);
  await expect(selectParasutOAuthCompany(params(),{binding:r.binding,companyId:fake.opts.companyId},deps())).rejects.toMatchObject({code:'VALIDATION_FAILED'});expect(grants()).toBe(1);
 });
 it('rejects cross tenant, altered nonce/state and concurrent replay before grant',async()=>{
  const r=await start();await expect(finish({...r.binding,slug:B.slug},B)).rejects.toMatchObject({code:'VALIDATION_FAILED'});
  await expect(finish({...r.binding,nonce:'a'.repeat(64)})).rejects.toMatchObject({code:'VALIDATION_FAILED'});
  await expect(finish({...r.binding,state:'b'.repeat(64)})).rejects.toMatchObject({code:'VALIDATION_FAILED'});expect(grants()).toBe(0);
  const results=await Promise.allSettled([finish(r.binding),finish(r.binding)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(grants()).toBe(1);
 });
 it('cancelled permission is consumed without token request',async()=>{
  const r=await start();expect(await completeParasutOAuth(params(),{binding:r.binding,denied:true},deps())).toEqual({ok:false,reason:'DENIED'});expect(grants()).toBe(0);await expect(finish(r.binding)).rejects.toMatchObject({code:'VALIDATION_FAILED'});
 });
 it('configuration replacement cancels pending attempt',async()=>{
  const r=await start();await saveParasutOAuthSettings(params(),input(),deps());await expect(finish(r.binding)).rejects.toMatchObject({code:'VALIDATION_FAILED'});expect(grants()).toBe(0);
 });
 it('disconnect cancels SELECT and clears sealed tokens without reconnecting',async()=>{
  const r=await start();fake.companies.push({id:'116',name:'Other'});await finish(r.binding);
  await disconnectIntegration(params(),{provider:'PARASUT'});await expect(selectParasutOAuthCompany(params(),{binding:r.binding,companyId:fake.opts.companyId},deps())).rejects.toMatchObject({code:'VALIDATION_FAILED'});
  expect((await adm.query('SELECT phase,token_box FROM integration_oauth_attempts WHERE id=$1',[r.binding.id])).rows[0]).toEqual({phase:'FAILED',token_box:null});
 });
 it('disconnect during exchange prevents final write',async()=>{
  const r=await start();let cancelled=false;
  const client=new ParasutClient({baseUrl:fake.url,fetch:async(url,init)=>{const response=await fetch(url,init);if(String(url).includes('/oauth/token')&&!cancelled){cancelled=true;await disconnectIntegration(params(),{provider:'PARASUT'});}return response;}});
  await expect(completeParasutOAuth(params(),{binding:r.binding,code:fake.opts.authorizationCode},{sealer,client})).rejects.toMatchObject({code:'VALIDATION_FAILED'});
 });
 it('expired SELECT clears token on next access',async()=>{
  const r=await start();fake.companies.push({id:'116',name:'Other'});await finish(r.binding);
  await adm.query("UPDATE integration_oauth_attempts SET created_at=now()-interval '11 minutes',expires_at=now()-interval '1 minute' WHERE id=$1",[r.binding.id]);
  expect(await getParasutOAuthSelection(params(),r.binding,deps())).toBe(null);expect((await adm.query('SELECT token_box,phase FROM integration_oauth_attempts WHERE id=$1',[r.binding.id])).rows[0]).toEqual({token_box:null,phase:'FAILED'});
 });
 it('does not retry rate-limited authorization code grant',async()=>{
  const r=await start();fake.rateLimitNext=1;const result=await finish(r.binding);expect(result.ok).toBe(false);expect(grants()).toBe(1);
 });
 it.each([{enabled:false,direction:'PULL'},{enabled:true,direction:'PUSH'},{enabled:true,direction:'BOTH'}])('reauthorization preserves existing flow $enabled/$direction',async chosen=>{
  const r=await start();await adm.query("UPDATE integration_flows SET enabled=$2,direction=$3 WHERE tenant_id=$1 AND flow='PRODUCTS'",[A.tenantId,chosen.enabled,chosen.direction]);
  expect((await finish(r.binding)).ok).toBe(true);
  expect((await adm.query("SELECT enabled,direction FROM integration_flows WHERE tenant_id=$1 AND flow='PRODUCTS'",[A.tenantId])).rows[0]).toEqual(chosen);
 });
 it('OAuth refresh token uses existing refresh mechanism',async()=>{
  const r=await start();expect((await finish(r.binding)).ok).toBe(true);fake.expireAccess();
  // Force access token expiry to invoke the existing encrypted refresh path.
  const row=(await adm.query("SELECT credentials FROM integrations WHERE tenant_id=$1 AND provider='PARASUT'",[A.tenantId])).rows[0];
  const aad={jobType:'integration.credentials',template:'PARASUT',tenantId:A.tenantId};const values=sealer.open(row.credentials,aad);values.accessExpiresAt='1';
  await adm.query("UPDATE integrations SET credentials=$2::jsonb WHERE tenant_id=$1",[A.tenantId,JSON.stringify(sealer.seal(values,aad))]);
  expect((await checkIntegration(params(),{provider:'PARASUT'},deps())).ok).toBe(true);expect(fake.requests.some(r=>r.body.includes('grant_type=refresh_token'))).toBe(true);
 });
 it.each(['disconnect','config','membership'])('rejects %s during CONNECTING before final write',async kind=>{
  const w=await seedWorld(adm,reg,'OC');const r=await start(w);let calls=0;
  const client=new ParasutClient({baseUrl:fake.url,fetch:async(url,init)=>{const response=await fetch(url,init);if(String(url).includes('/v4/me')&&++calls===2){
    if(kind==='disconnect')await disconnectIntegration(params(w),{provider:'PARASUT'});
    if(kind==='config')await saveParasutOAuthSettings(params(w),input(),deps());
    if(kind==='membership')await adm.query("UPDATE tenant_memberships SET status='REMOVED',removed_at=now() WHERE id=$1",[w.ownerMembershipId]);
  }return response;}});
  await expect(completeParasutOAuth(params(w),{binding:r.binding,code:fake.opts.authorizationCode},{sealer,client})).rejects.toMatchObject({code:kind==='membership'?'NOT_FOUND':'VALIDATION_FAILED'});
  expect((await adm.query("SELECT count(*)::int AS n FROM integrations WHERE tenant_id=$1 AND status='CONNECTED'",[w.tenantId])).rows[0].n).toBe(0);
 });
 it('rejects a copied encrypted application from another tenant',async()=>{
  await saveParasutOAuthSettings(params(B),input(),deps());await saveParasutOAuthSettings(params(),input(),deps());
  await adm.query('UPDATE integration_oauth_apps SET credentials=(SELECT credentials FROM integration_oauth_apps WHERE tenant_id=$2) WHERE tenant_id=$1',[A.tenantId,B.tenantId]);
  await expect(beginParasutOAuth(params(),deps())).rejects.toThrow();expect(grants()).toBe(0);
 });
 it('strict cookie parser and constant-time state comparison reject malformed bindings',async()=>{
  const r=await start();expect(parseOAuthBinding(encodeOAuthBinding(r.binding))).toEqual(r.binding);expect(matchesOAuthState(r.binding,r.binding.state)).toBe(true);expect(matchesOAuthState(r.binding,'short')).toBe(false);expect(parseOAuthBinding(Buffer.from(JSON.stringify({...r.binding,extra:true})).toString('base64url'))).toBe(null);expect(parseOAuthBinding('not-json')).toBe(null);
 });
});
