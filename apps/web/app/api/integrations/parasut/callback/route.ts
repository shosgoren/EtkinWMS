// Provider GET has no same-origin header; state + HttpOnly browser nonce bind the authorized session.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAppDb } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { completeParasutOAuth, matchesOAuthState, oauthApplicationOrigin, oauthCookieName, parseOAuthBinding } from "@wms/domain/integrations";
import { createProductionRouteGuard, limitVerifiedTenant } from "../../../../../lib/action-guard.ts";
import { getSenderQueue } from "../../../../../lib/queue.ts";
import { ensureRecentAuth } from "../../../../../lib/auth-service.ts";

export const dynamic = "force-dynamic";
const guard=createProductionRouteGuard();
export async function GET(request:Request):Promise<Response>{
  const response=await guard({requireAuth:false},async(req,ctx)=>{
    const origin=oauthApplicationOrigin();if(origin===null)throw new AppError("INTERNAL");
    const jar=await cookies();const name=oauthCookieName(origin);const binding=parseOAuthBinding(jar.get(name)?.value);
    const q=new URL(req.url).searchParams;
    const state=q.get("state");const code=q.get("code");const error=q.get("error");
    if(binding===null||state===null||!matchesOAuthState(binding,state)||q.getAll("state").length!==1||q.getAll("code").length>1||q.getAll("error").length>1||((code===null)===(error===null))||(code!==null&&(code.length<1||code.length>4096||/[\p{C}\s]/u.test(code)))||(error!==null&&error.length>200)){
      return NextResponse.json({error:{code:"INVALID_OAUTH_CALLBACK"}},{status:400});
    }
    const target=`/t/${encodeURIComponent(binding.slug)}/integrations`;
    const end=(location:string,clear=true)=>{
      const r=NextResponse.redirect(new URL(location,origin),303);
      if(clear)r.cookies.set(name,"",{httpOnly:true,secure:origin.startsWith("https:"),sameSite:"lax",path:"/",maxAge:0});
      return r;
    };
    if(ctx.principal===null)return end(`/login?next=${encodeURIComponent(target+"?oauth_result=retry")}`);
    try{
      const access={db:getAppDb(),principal:ctx.principal,tenantSlug:binding.slug};
      await limitVerifiedTenant({...access,permission:"settings.manage"},ctx);
      const result=await completeParasutOAuth({...access,recentAuth:()=>ensureRecentAuth(req.headers)},{binding,...(error===null?{code:code!}:{denied:true})},{queue:await getSenderQueue()});
      if(result.ok&&result.status==="SELECT")return end(`${target}?oauth_select=${encodeURIComponent(result.id)}`,false);
      return end(`${target}?oauth_result=${result.ok?"connected":"failed"}`);
    }catch(e){
      if(!(e instanceof AppError))throw e;
      if(e.code==="UNAUTHENTICATED")return end(`/login?next=${encodeURIComponent(target+"?oauth_result=retry")}`);
      return end(`${target}?oauth_result=failed`);
    }
  })(request);
  response.headers.set("cache-control","no-store");
  response.headers.set("referrer-policy","no-referrer");
  response.headers.set("x-content-type-options","nosniff");
  return response;
}
