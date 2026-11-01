import type{Metadata}from"next";
import{cookies,headers}from"next/headers";
import{notFound,redirect}from"next/navigation";
import{getTranslations}from"next-intl/server";
import{getAppDb}from"@wms/db";
import{AppError}from"@wms/shared/errors";
import{LABEL_CONTEXTS,type LabelContext}from"@wms/shared/labels";
import{getLabelWorkspace,getLabelTemplate,readLabelLogo,getLabelGuideSeen}from"@wms/domain/labels/store";
import{LICON}from"../../../design/kalip-icons.ts";
import{temaKoyu}from"../../../design/theme.ts";
import{KalipKilitliEkran}from"../kalip/liste.tsx";
import{LabelWorkspaceView}from"./workspace-view.tsx";
export const dynamic='force-dynamic';
export async function generateMetadata():Promise<Metadata>{const t=await getTranslations('labelEditor');return{title:t('title')};}
export default async function LabelDesignsPage({params,searchParams}:{params:Promise<{slug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const{slug}=await params,query=await searchParams,t=await getTranslations('labelEditor'),home=`/t/${encodeURIComponent(slug)}`,base=home+'/label-designs';
 const{getAuthService}=await import('../../../../lib/auth-service.ts');const principal=await getAuthService().getPrincipal(await headers());if(!principal)redirect(`/login?next=${encodeURIComponent(base)}`);
 const dark=temaKoyu(await cookies()),one=(k:string)=>typeof query[k]==='string'?query[k] as string:undefined,context=one('context')??one('new');
 if(context!==undefined&&!(LABEL_CONTEXTS as readonly string[]).includes(context))notFound();
 const p={db:getAppDb(),principal,tenantSlug:slug};try{
  const data=await getLabelWorkspace(p,{...(context?{context:context as LabelContext}:{}),archived:one('archived')==='1',...(one('q')?{q:one('q')!}:{}),...(one('after')?{after:one('after')!}:{})});
  const guideSeen=await getLabelGuideSeen(p);
  const detail=one('id')?await getLabelTemplate(p,one('id')!):null;
  const logos=detail?[...new Set(detail.draft.elements.flatMap(e=>e.kind==='logo'?[e.assetId]:[]))]:[];
  const assets=Object.fromEntries(await Promise.all(logos.map(async id=>[id,`data:image/png;base64,${(await readLabelLogo(p,id)).toString('base64')}`])));
  return<main className="flex w-full min-w-0 flex-col"><LabelWorkspaceView key={detail?.id??one('new')??one('printer')??one('tab')??'list:'+JSON.stringify([context,one('archived'),one('q'),one('after')])} slug={slug} dark={dark} guideSeen={guideSeen} initial={data} detail={detail} assets={assets} newContext={one('new') as LabelContext|undefined} context={context as LabelContext|undefined} archived={one('archived')==='1'} query={one('q')??''} after={one('after')} printers={one('tab')==='printers'} printerId={one('printer')}/></main>;
 }catch(e){if(e instanceof AppError){if(e.code==='NOT_FOUND'||e.code==='VALIDATION_FAILED')notFound();if(e.code==='UNAUTHENTICATED')redirect(`/login?next=${encodeURIComponent(base)}`);if(e.code==='FORBIDDEN'&&e.detail==='MFA_REQUIRED')redirect(`/mfa?next=${encodeURIComponent(base)}`);if(e.code==='FORBIDDEN')return<KalipKilitliEkran title={t('title')} icon={{d:LICON.printer,color:'3B6A9E'}} text={t('locked')} hint={t('askOwner')} dark={dark} home={home}/>;}throw e;}
}
