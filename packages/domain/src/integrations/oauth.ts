// T-1066: confidential-client OAuth authorization-code flow; no password, open redirect or replay.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import type { Sealer } from "@wms/shared/seal";
import { runTenantCommand, runTenantQuery, type AccessTx } from "../identity/access.ts";
import { connectParasutAuthorized, type ConnectionCallParams, type IntegrationDeps } from "./connections.ts";
import { integrationSealer } from "./secrets.ts";
import { ParasutClient, ProviderError, parseCompanyId, type Company, type TokenSet } from "./parasut.ts";

export const PARASUT_CALLBACK_PATH = "/api/integrations/parasut/callback";
export const OAUTH_TTL_SECONDS = 600;
const HEX = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const invalid = () => new AppError("VALIDATION_FAILED");
export interface OAuthBinding { readonly slug: string; readonly id: string; readonly state: string; readonly nonce: string }
export interface OAuthConfig { readonly clientId: string; readonly clientSecret: string; readonly redirectUri: string; readonly version?: string }
export interface OAuthDeps extends IntegrationDeps { readonly oauth?: OAuthConfig | null }
export type OAuthOutcome = { readonly ok: true; readonly status: "SELECT"; readonly id: string; readonly companies: readonly Company[] }
  | { readonly ok: true; readonly status: "CONNECTED"; readonly label: string }
  | { readonly ok: false; readonly reason: string };

export function oauthApplicationOrigin(env: Readonly<Record<string,string|undefined>> = process.env): string | null {
  try {
    const u = new URL(env.BETTER_AUTH_URL ?? "");
    if (u.username || u.password || u.search || u.hash || u.pathname !== "/") return null;
    if (u.protocol !== "https:" && !(u.protocol === "http:" && ["127.0.0.1","localhost","[::1]"].includes(u.hostname))) return null;
    return u.origin;
  } catch { return null; }
}
export function parasutOAuthConfig(env: Readonly<Record<string,string|undefined>> = process.env): OAuthConfig | null {
  const origin = oauthApplicationOrigin(env);
  const clientId = env.PARASUT_OAUTH_CLIENT_ID?.trim(); const clientSecret = env.PARASUT_OAUTH_CLIENT_SECRET?.trim();
  if (origin === null || !clientId || !clientSecret || clientId.length > 200 || clientSecret.length > 200 || /[\p{C}\s]/u.test(clientId+clientSecret)) return null;
  return { clientId, clientSecret, redirectUri: origin+PARASUT_CALLBACK_PATH };
}
export function oauthCookieName(origin: string): string { return origin.startsWith("https:") ? "__Host-etkin-parasut-oauth" : "etkin-parasut-oauth"; }
export function encodeOAuthBinding(b: OAuthBinding): string { return Buffer.from(JSON.stringify(b)).toString("base64url"); }
export function parseOAuthBinding(raw: string | undefined): OAuthBinding | null {
  try {
    if (raw === undefined || raw.length > 700 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
    const b: unknown = JSON.parse(Buffer.from(raw,"base64url").toString("utf8"));
    if (b === null || typeof b !== "object" || Array.isArray(b) || Object.keys(b).sort().join(",") !== "id,nonce,slug,state") return null;
    const v = b as Record<string,unknown>;
    if (typeof v.slug !== "string" || !SLUG.test(v.slug) || typeof v.id !== "string" || !UUID.test(v.id) || typeof v.state !== "string" || !HEX.test(v.state) || typeof v.nonce !== "string" || !HEX.test(v.nonce)) return null;
    return v as unknown as OAuthBinding;
  } catch { return null; }
}
export function matchesOAuthState(binding: OAuthBinding, state: string): boolean {
  return HEX.test(binding.state) && HEX.test(state) && timingSafeEqual(Buffer.from(binding.state,"hex"),Buffer.from(state,"hex"));
}
const APP_AAD = (tenantId: string) => ({jobType:"integration.oauth.application",template:"PARASUT",tenantId});
function validApp(clientId:string,clientSecret:string):boolean { return clientId.length>0 && clientId.length<=200 && clientSecret.length>0 && clientSecret.length<=200 && !/[\p{C}\s]/u.test(clientId+clientSecret); }
async function config(tx:AccessTx,tenantId:string,deps:OAuthDeps):Promise<OAuthConfig|null>{
  if(deps.oauth!==undefined)return deps.oauth;
  const origin=oauthApplicationOrigin(); if(origin===null)return null;
  const rows=await tx.execute<{version:string;credentials:unknown}>(sql`SELECT version,credentials FROM public.integration_oauth_apps WHERE tenant_id=${tenantId}::uuid FOR SHARE`);
  if(rows[0]===undefined)return null;
  const v=sealer(deps).open(rows[0].credentials,APP_AAD(tenantId));
  if(typeof v.clientId!=="string"||typeof v.clientSecret!=="string"||!validApp(v.clientId,v.clientSecret))throw invalid();
  return {clientId:v.clientId,clientSecret:v.clientSecret,version:rows[0].version,redirectUri:typeof v.callbackUrl==="string"&&validCallback(v.callbackUrl)?v.callbackUrl:(()=>{throw invalid();})()};
}
function validCallback(value:string):boolean {
 if(value==="urn:ietf:wg:oauth:2.0:oob")return true;
 if(value.length>300||/[\p{C}\s]/u.test(value))return false;
 try{const u=new URL(value);return u.protocol==="https:"&&!u.username&&!u.password&&!u.hash;}catch{return false;}
}
const configVersion=(cfg:OAuthConfig)=>cfg.version??"00000000-0000-4000-8000-000000000001";
export async function getParasutOAuthSettings(params:ConnectionCallParams):Promise<{configured:boolean;callbackUrl:string|null}>{
 return runTenantQuery({...params,permission:"settings.manage"},async(tx,m)=>{
 const rows=await tx.execute(sql`SELECT version FROM public.integration_oauth_apps WHERE tenant_id=${m.tenantId}::uuid`);
 const origin=oauthApplicationOrigin();return {configured:rows.length===1,callbackUrl:origin===null?null:origin+PARASUT_CALLBACK_PATH};
 });
}
export async function saveParasutOAuthSettings(params:ConnectionCallParams,input:{clientId:string;clientSecret:string;callbackUrl:string},deps:OAuthDeps={}):Promise<{ok:true}|{ok:false;reason:string}>{
 if(params.recentAuth===undefined)throw new AppError("UNAUTHENTICATED",{detail:"RECENT_AUTH_REQUIRED"});
 if(!validCallback(input.callbackUrl)||!validApp(input.clientId,input.clientSecret))throw invalid();
 return runTenantCommand({...params,permission:"settings.manage"},async(tx,m)=>{
 const demo=await tx.execute<{is_demo:boolean}>(sql`SELECT is_demo FROM public.tenants WHERE id=${m.tenantId}::uuid`);
 if(demo[0]?.is_demo)return {ok:false,reason:"DEMO"} as const;
 const box=sealer(deps).seal({clientId:input.clientId,clientSecret:input.clientSecret,callbackUrl:input.callbackUrl},APP_AAD(m.tenantId));
 // App lock precedes attempt locks in every path; existing connected credentials remain unchanged.
 await tx.execute(sql`INSERT INTO public.integration_oauth_apps(tenant_id,version,credentials) VALUES(${m.tenantId}::uuid,${randomUUID()}::uuid,${JSON.stringify(box)}::jsonb) ON CONFLICT(tenant_id) DO UPDATE SET version=EXCLUDED.version,credentials=EXCLUDED.credentials,updated_at=now()`);
 await tx.execute(sql`UPDATE public.integration_oauth_attempts SET phase='FAILED',token_box=NULL,companies='[]'::jsonb WHERE tenant_id=${m.tenantId}::uuid AND phase NOT IN ('COMPLETE','FAILED')`);
 await appendAudit(tx,{action:"integration.oauth_configured",actorUserId:m.userId,entityType:"integration_oauth",entityId:m.tenantId,changeSummary:{provider:"PARASUT"}});
 return {ok:true} as const;
 });
}
const sealer = (deps: OAuthDeps): Sealer => deps.sealer ?? integrationSealer();
const aad = (tenant: string,id: string) => ({ jobType:"integration.oauth",template:`PARASUT:${id}`,tenantId:tenant });
function checkBinding(params: ConnectionCallParams,b: OAuthBinding): void { if (params.tenantSlug !== b.slug || parseOAuthBinding(encodeOAuthBinding(b)) === null) throw invalid(); }
async function expire(tx: Parameters<Parameters<typeof runTenantCommand>[1]>[0],tenant: string): Promise<void> {
  await tx.execute(sql`UPDATE public.integration_oauth_attempts SET phase='FAILED',token_box=NULL,companies='[]'::jsonb WHERE tenant_id=${tenant}::uuid AND expires_at<=now() AND phase NOT IN ('COMPLETE','FAILED')`);
}
export async function beginParasutOAuth(params: ConnectionCallParams,deps: OAuthDeps = {}): Promise<{readonly ok:true;readonly binding:OAuthBinding;readonly authorizationUrl:string;readonly manual:boolean}|{readonly ok:false;readonly reason:string}> {
  if (params.recentAuth === undefined) throw new AppError("UNAUTHENTICATED",{detail:"RECENT_AUTH_REQUIRED"});
  // Authorization is checked even when server application credentials are not configured.
  return runTenantCommand({...params,permission:"settings.manage"},async(tx,m)=>{
    const demo=await tx.execute<{is_demo:boolean}>(sql`SELECT is_demo FROM public.tenants WHERE id=${m.tenantId}::uuid`);
    if(demo[0]?.is_demo) return {ok:false,reason:"DEMO"} as const;
    const cfg=await config(tx,m.tenantId,deps); if(cfg===null) return {ok:false,reason:"CONFIG"} as const;
    sealer(deps); // fail closed before sending the user to the provider
    await expire(tx,m.tenantId);
    await tx.execute(sql`UPDATE public.integration_oauth_attempts SET phase='FAILED',token_box=NULL,companies='[]'::jsonb WHERE tenant_id=${m.tenantId}::uuid AND user_id=${m.userId}::uuid AND phase NOT IN ('COMPLETE','FAILED')`);
    const binding:OAuthBinding={slug:params.tenantSlug,id:randomUUID(),state:randomBytes(32).toString("hex"),nonce:randomBytes(32).toString("hex")};
    await tx.execute(sql`INSERT INTO public.integration_oauth_attempts(tenant_id,id,user_id,membership_id,state_hash,nonce_hash,client_id,config_version) VALUES(${m.tenantId}::uuid,${binding.id}::uuid,${m.userId}::uuid,${m.membershipId}::uuid,${hash(binding.state)},${hash(binding.nonce)},${cfg.clientId},${configVersion(cfg)}::uuid)`);
    await appendAudit(tx,{action:"integration.oauth_started",actorUserId:m.userId,entityType:"integration_oauth",entityId:binding.id,changeSummary:{provider:"PARASUT"}});
    const url=new URL("https://api.parasut.com/oauth/authorize");
    url.search=new URLSearchParams({client_id:cfg.clientId,redirect_uri:cfg.redirectUri,response_type:"code",state:binding.state}).toString();
    return {ok:true,binding,authorizationUrl:url.href,manual:cfg.redirectUri!==(oauthApplicationOrigin()??"")+PARASUT_CALLBACK_PATH} as const;
  });
}
function companiesOf(raw:unknown):readonly Company[] {
  if(!Array.isArray(raw)||raw.length<1||raw.length>100) throw new ProviderError("BAD_RESPONSE");
  const seen=new Set<string>(); return raw.map((v:unknown)=>{
    if(v===null||typeof v!=="object") throw new ProviderError("BAD_RESPONSE");
    const r=v as Record<string,unknown>;const id=parseCompanyId(r.id);
    if(seen.has(id)||typeof r.name!=="string"||r.name.length<1||r.name.length>120||/\p{C}/u.test(r.name)) throw new ProviderError("BAD_RESPONSE");
    seen.add(id);return {id,name:r.name};
  });
}
async function failAttempt(params:ConnectionCallParams,b:OAuthBinding):Promise<void>{
  await runTenantCommand({...params,permission:"settings.manage"},async(tx,m)=>{
    await tx.execute(sql`UPDATE public.integration_oauth_attempts SET phase='FAILED',token_box=NULL,companies='[]'::jsonb WHERE tenant_id=${m.tenantId}::uuid AND id=${b.id}::uuid AND user_id=${m.userId}::uuid AND membership_id=${m.membershipId}::uuid AND nonce_hash=${hash(b.nonce)} AND phase NOT IN ('COMPLETE','FAILED')`);
    await appendAudit(tx,{action:"integration.oauth_failed",actorUserId:m.userId,entityType:"integration_oauth",entityId:b.id,changeSummary:{provider:"PARASUT"}});
  });
}
export async function completeParasutOAuth(params:ConnectionCallParams,input:{readonly binding:OAuthBinding;readonly code?:string;readonly denied?:boolean},deps:OAuthDeps={}):Promise<OAuthOutcome>{
  const b=input.binding;checkBinding(params,b);
  if(params.recentAuth===undefined) throw new AppError("UNAUTHENTICATED",{detail:"RECENT_AUTH_REQUIRED"});
  if(!input.denied&&(typeof input.code!=="string"||input.code.length<1||input.code.length>4096||/[\p{C}\s]/u.test(input.code)))throw invalid();
  const claim=await runTenantCommand({...params,permission:"settings.manage"},async(tx,m)=>{
    const cfg=await config(tx,m.tenantId,deps);if(cfg===null)throw invalid();
    await expire(tx,m.tenantId);
    const r=await tx.execute<{id:string}>(sql`UPDATE public.integration_oauth_attempts SET phase='EXCHANGING' WHERE tenant_id=${m.tenantId}::uuid AND id=${b.id}::uuid AND user_id=${m.userId}::uuid AND membership_id=${m.membershipId}::uuid AND state_hash=${hash(b.state)} AND nonce_hash=${hash(b.nonce)} AND client_id=${cfg.clientId} AND config_version=${configVersion(cfg)}::uuid AND expires_at>now() AND phase='PENDING' RETURNING id`);
    if(!r[0])throw invalid();return {tenant:m.tenantId,cfg};
  });
  const {tenant,cfg}=claim;
  if(input.denied){await failAttempt(params,b);return {ok:false,reason:"DENIED"};}
  try{
    const client=deps.client??new ParasutClient();
    const tokens=await client.authorizationCodeGrant({clientId:cfg.clientId,clientSecret:cfg.clientSecret,code:input.code!,redirectUri:cfg.redirectUri});
    const companies=companiesOf(await client.companies(tokens.accessToken));
    const box=sealer(deps).seal({accessToken:tokens.accessToken,refreshToken:tokens.refreshToken,accessExpiresAt:String(tokens.expiresAt)},aad(tenant,b.id));
    await runTenantCommand({...params,permission:"settings.manage"},async(tx,m)=>{
      const current=await config(tx,m.tenantId,deps);if(current===null||configVersion(current)!==configVersion(cfg))throw invalid();
      const r=await tx.execute<{id:string}>(sql`UPDATE public.integration_oauth_attempts SET phase='SELECT',token_box=${JSON.stringify(box)}::jsonb,companies=${JSON.stringify(companies)}::jsonb WHERE tenant_id=${m.tenantId}::uuid AND id=${b.id}::uuid AND user_id=${m.userId}::uuid AND membership_id=${m.membershipId}::uuid AND nonce_hash=${hash(b.nonce)} AND phase='EXCHANGING' AND expires_at>now() RETURNING id`);
      if(!r[0])throw invalid();
    });
    if(companies.length===1)return selectParasutOAuthCompany(params,{binding:b,companyId:companies[0]!.id},deps);
    return {ok:true,status:"SELECT",id:b.id,companies};
  }catch(e){
    if(e instanceof ProviderError){await failAttempt(params,b);return {ok:false,reason:e.code};}
    throw e;
  }
}
export async function getParasutOAuthSelection(params:ConnectionCallParams,b:OAuthBinding,deps:OAuthDeps={}):Promise<readonly Company[]|null>{
  checkBinding(params,b);
  return runTenantCommand({...params,permission:"settings.manage"},async(tx,m)=>{
    const cfg=await config(tx,m.tenantId,deps);if(cfg===null)return null;
    await expire(tx,m.tenantId);
    const r=await tx.execute<{companies:unknown}>(sql`SELECT companies FROM public.integration_oauth_attempts WHERE tenant_id=${m.tenantId}::uuid AND id=${b.id}::uuid AND user_id=${m.userId}::uuid AND membership_id=${m.membershipId}::uuid AND nonce_hash=${hash(b.nonce)} AND client_id=${cfg.clientId} AND config_version=${configVersion(cfg)}::uuid AND phase='SELECT' AND expires_at>now()`);
    return r[0]===undefined?null:companiesOf(r[0].companies);
  });
}
export async function selectParasutOAuthCompany(params:ConnectionCallParams,input:{readonly binding:OAuthBinding;readonly companyId:string},deps:OAuthDeps={}):Promise<OAuthOutcome>{
  const b=input.binding;checkBinding(params,b);const companyId=parseCompanyId(input.companyId);
  if(params.recentAuth===undefined)throw new AppError("UNAUTHENTICATED",{detail:"RECENT_AUTH_REQUIRED"});
  const selected=await runTenantCommand({...params,permission:"settings.manage"},async(tx,m)=>{
    const cfg=await config(tx,m.tenantId,deps);if(cfg===null)throw invalid();
    const r=await tx.execute<{token_box:unknown;companies:unknown}>(sql`SELECT token_box,companies FROM public.integration_oauth_attempts WHERE tenant_id=${m.tenantId}::uuid AND id=${b.id}::uuid AND user_id=${m.userId}::uuid AND membership_id=${m.membershipId}::uuid AND nonce_hash=${hash(b.nonce)} AND client_id=${cfg.clientId} AND config_version=${configVersion(cfg)}::uuid AND phase='SELECT' AND expires_at>now() FOR UPDATE`);
    const row=r[0];if(!row||!companiesOf(row.companies).some((c)=>c.id===companyId))throw invalid();
    const s=sealer(deps).open(row.token_box,aad(m.tenantId,b.id));
    if(typeof s.accessToken!=="string"||typeof s.refreshToken!=="string"||typeof s.accessExpiresAt!=="string"||Number(s.accessExpiresAt)<=Date.now())throw invalid();
    await tx.execute(sql`UPDATE public.integration_oauth_attempts SET phase='CONNECTING',token_box=NULL,companies='[]'::jsonb WHERE tenant_id=${m.tenantId}::uuid AND id=${b.id}::uuid`);
    return {cfg,tokens:{accessToken:s.accessToken,refreshToken:s.refreshToken,expiresAt:Number(s.accessExpiresAt)}};
  });
  const {cfg,tokens}=selected;
  const result=await connectParasutAuthorized(params,{companyId,clientId:cfg.clientId,clientSecret:cfg.clientSecret},()=>Promise.resolve(tokens as TokenSet),deps,async(tx,tenantId,userId,membershipId)=>{
    const current=await config(tx,tenantId,deps);if(current===null||configVersion(current)!==configVersion(cfg))throw invalid();
    const r=await tx.execute<{id:string}>(sql`UPDATE public.integration_oauth_attempts SET phase='COMPLETE' WHERE tenant_id=${tenantId}::uuid AND id=${b.id}::uuid AND user_id=${userId}::uuid AND membership_id=${membershipId}::uuid AND nonce_hash=${hash(b.nonce)} AND phase='CONNECTING' AND expires_at>now() RETURNING id`);
    if(!r[0])throw invalid();
  }, true);
  if(!result.ok){await failAttempt(params,b);return result;}
  return {ok:true,status:"CONNECTED",label:result.label};
}
