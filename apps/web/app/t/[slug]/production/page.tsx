import { headers } from "next/headers";
import { notFound,redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getProductionRecipe,listProductionRecipes,getPackageProductionBatch } from "@wms/domain/operations";
import { getWarehouse,getLocationTree,type LocationTreeCursor } from "@wms/domain/warehouse";
import { AppError } from "@wms/shared/errors";
import { Banner } from "@wms/ui";
import { NewRecipeForm,ProductionForm,PackageProductionForm,type Choice } from "./production-form.tsx";
import { packageReceivingEnabled } from "../../../../lib/package-receiving-config.ts";
export const dynamic="force-dynamic";
const control="inline-flex min-h-12 items-center rounded-lg border-2 border-border-strong bg-surface px-4 py-2 font-bold focus-visible:outline-3 focus-visible:outline-focus";
const first=(v:string|string[]|undefined)=>Array.isArray(v)?v[0]:v;
export default async function ProductionPage({params,searchParams}:{params:Promise<{slug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {slug}=await params,sp=await searchParams,t=await getTranslations("production"),path=`/t/${encodeURIComponent(slug)}/production`;
 const id=first(sp.id),q=first(sp.q)??"",after=first(sp.after),packagesEnabled=packageReceivingEnabled(),documentId=packageReceivingEnabled()?first(sp.document):undefined;
 const returnTo=`${path}${id||documentId?`?${new URLSearchParams({...id?{id}:{},...documentId?{document:documentId}:{}})}`:""}`;
 const {getAuthService}=await import("../../../../lib/auth-service.ts");const principal=await getAuthService().getPrincipal(await headers());
 if(!principal)redirect(`/login?next=${encodeURIComponent(returnTo)}`);
 let data:Awaited<ReturnType<typeof listProductionRecipes>>,recipe:Awaited<ReturnType<typeof getProductionRecipe>>|null;
 let batch:Awaited<ReturnType<typeof getPackageProductionBatch>>|null=null,initialTarget:{warehouse:Choice;location:Choice}|null=null;
 try{const context={db:getAppDb(),principal,tenantSlug:slug};data=await listProductionRecipes(context,{q,...(after?{after}:{})});
  // This GET reads the actual authorized batch; POST Origin actions are never used for SSR resume.
  if(documentId)batch=await getPackageProductionBatch(context,{documentId});const recipeId=batch?.recipeId??id;recipe=recipeId?await getProductionRecipe(context,recipeId):null;
  if(batch){const warehouse=await getWarehouse(context,{warehouseId:batch.warehouseId});let cursor:LocationTreeCursor|undefined;
   do{const locations=await getLocationTree(context,{warehouseId:batch.warehouseId,includeArchived:true,limit:200,...cursor?{after:cursor}:{}});const location=locations.items.find(l=>l.id===batch!.targetLocationId);
    if(location){initialTarget={warehouse:{id:warehouse.id,code:warehouse.code,name:warehouse.name,unitCode:null,trackingMode:null},location:{id:location.id,code:location.code,name:location.name,unitCode:null,trackingMode:null}};break;}cursor=locations.next??undefined;
   }while(cursor);
  }
 }
 catch(e){if(e instanceof AppError){if(e.code==="NOT_FOUND"||e.code==="VALIDATION_FAILED")notFound();if(e.code==="FORBIDDEN"&&e.detail==="MFA_REQUIRED")redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);if(e.code==="UNAUTHENTICATED")redirect(`/login?next=${encodeURIComponent(returnTo)}`);if(e.code==="FORBIDDEN")return <main className="p-4"><Banner kind="warning">{t("locked")}</Banner></main>;}throw e;}
 if(packagesEnabled&&recipe&&(data.canPost||batch?.documentStatus==="POSTED"))return <div><PackageProductionForm slug={slug} recipe={recipe} initial={batch} initialTarget={initialTarget}/></div>;
 return <main className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4 px-4 py-6 text-ink">
  <nav className="flex flex-wrap gap-2"><a className={control} href={`/t/${encodeURIComponent(slug)}/stock`}>{t("stock")}</a><a className={control} href={path}>{t("title")}</a></nav>
  <h1 className="text-2xl font-extrabold">{t("title")}</h1>
  {recipe?<><h2 className="text-xl font-bold">{recipe.code} / {recipe.version} — {recipe.name}</h2><p>{recipe.outputName}: {recipe.outputQuantity} {recipe.unitCode}</p>
   <ul>{recipe.lines.map(line=><li key={line.lineNo}>{line.itemName}: {line.quantity} {line.unitCode}</li>)}</ul>
   {data.canPost?<ProductionForm slug={slug} recipe={recipe}/>:<Banner kind="warning">{t("locked")}</Banner>}
  </>:first(sp.new)==="1"?data.canCreate?<NewRecipeForm slug={slug}/>:<Banner kind="warning">{t("locked")}</Banner>:<>
   {data.canCreate&&<a className={control} href={`${path}?new=1`}>{t("new")}</a>}
   <form action={path} className="flex flex-wrap gap-2"><label className="flex-1">{t("search")}<input name="q" maxLength={128} defaultValue={q} className={`${control} block w-full`}/></label><button className={control}>{t("find")}</button></form>
   {data.items.length===0&&<p>{t("empty")}</p>}
   <ul className="flex flex-col gap-3">{data.items.map(row=><li key={row.id}><a className={`${control} flex-col items-start`} href={`${path}?id=${row.id}`}><span>{row.code} / {row.version} — {row.name}</span><span>{row.outputName}: {row.outputQuantity} {row.unitCode}</span></a></li>)}</ul>
   {data.next&&<a className={control} href={`${path}?${new URLSearchParams({q,after:data.next})}`}>{t("next")}</a>}
  </>}
 </main>;
}
