import{cookies,headers}from'next/headers';
import{notFound,redirect}from'next/navigation';
import{getLocale,getTranslations}from'next-intl/server';
import{getAppDb}from'@wms/db';
import{AppError}from'@wms/shared/errors';
import{previewCustomLabels,getLabelPrintChoices,readPreparedLabels,LabelPrintError,parseLabelSourceRequest}from'@wms/domain/labels/print';
import{getAuthService}from'../../../../lib/auth-service.ts';
import{packageReceivingEnabled}from'../../../../lib/package-receiving-config.ts';
import{temaKoyu}from'../../../design/theme.ts';
import{LICON}from'../../../design/kalip-icons.ts';
import{KalipKilitliEkran}from'../kalip/liste.tsx';
import{LabelNotice,LabelShell}from'../labels/label-preview.tsx';
import{CustomLabelPrintView}from'./print-view.tsx';
export const dynamic='force-dynamic';
export default async function CustomLabelsPage({params,searchParams}:{params:Promise<{slug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const{slug}=await params,q=await searchParams,home=`/t/${encodeURIComponent(slug)}`,url=home+'/custom-labels',t=await getTranslations('labelPrint'),dark=temaKoyu(await cookies()),locale=await getLocale()==='en'?'en':'tr';
 const principal=await getAuthService().getPrincipal(await headers());if(!principal)redirect(`/login?next=${encodeURIComponent(url)}`);const p={db:getAppDb(),principal,tenantSlug:slug};
 const shell=(text:string)=><LabelShell dark={dark} back={home} title={t('title')}><LabelNotice title={text} action={{label:t('back'),href:home}}/></LabelShell>;
 try{
  if(typeof q.job==='string'){
   const saved=await readPreparedLabels(p,q.job,packageReceivingEnabled()),choices=await getLabelPrintChoices(p,saved.context);
   return<CustomLabelPrintView slug={slug} dark={dark} locale={locale} source={saved.source} choices={choices} initial={saved} historicalJob={saved.jobId}/>;
  }
  if(typeof q.source!=='string'||q.source.length>8000)notFound();let raw:unknown;try{raw=JSON.parse(q.source);}catch{notFound();}const source=parseLabelSourceRequest(raw),context=source.kind==='PRODUCTION'?'RECEIPT':source.kind,choices=await getLabelPrintChoices(p,context);
  if(choices.length===0)return shell(t('noTemplate'));
  const templateId=choices.some(c=>c.isDefault)?undefined:choices[0]!.id;
  const initial=await previewCustomLabels(p,{source,locale,...(templateId?{templateId}:{})},packageReceivingEnabled());
  return<CustomLabelPrintView slug={slug} dark={dark} locale={locale} source={source} choices={choices} initial={initial} initialTemplateId={templateId}/>;
 }catch(e){if(e instanceof LabelPrintError)return shell(t(`errors.${e.reason}`));if(e instanceof AppError){if(e.code==='NOT_FOUND')notFound();if(e.code==='VALIDATION_FAILED')return shell(t('errors.DESIGN_INVALID'));if(e.code==='UNAUTHENTICATED')redirect(`/login?next=${encodeURIComponent(url)}`);if(e.code==='FORBIDDEN'&&e.detail==='MFA_REQUIRED')redirect(`/mfa?next=${encodeURIComponent(url)}`);if(e.code==='FORBIDDEN')return<KalipKilitliEkran title={t('title')} icon={{d:LICON.printer,color:'3B6A9E'}} text={t('locked')} hint={t('askOwner')} dark={dark} home={home}/>;}throw e;}
}
