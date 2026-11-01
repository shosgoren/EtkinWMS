"use client";
import{useCallback,useEffect,useRef,useState}from'react';
import{flushSync}from'react-dom';
import{useTranslations}from'next-intl';
import type{LabelPrintPreview,LabelPrepared,LabelSourceRequest}from'@wms/shared/labels';
import{LICON}from'../../../design/kalip-icons.ts';
import{KalipEkran,KalipBaslik,useKalipToast}from'../kalip/ekran.tsx';
import{KalipAlan}from'../kalip/form.tsx';
import{KalipSecim}from'../kalip/secim.tsx';
import{KalipCipler,KalipDaha}from'../kalip/liste.tsx';
import{KalipUyari}from'../kalip/uyari.tsx';
import{KalipEtiketOnizleme,KalipEtiketBaski}from'../kalip/etiket-baski.tsx';
import{labelPaperLayout,labelPaperPages,type LabelPaper}from'../labels/physical-print.ts';
import{labelDeviceId}from'../label-designs/label-client.ts';
import{customLabelPreviewAction,customLabelPrepareAction}from'./actions.ts';
interface Choice{readonly id:string;readonly name:string;readonly versionId:string;readonly isDefault:boolean;readonly assignedVersionId:string|null}
interface Props{readonly slug:string;readonly dark:boolean;readonly locale:'tr'|'en';readonly source:LabelSourceRequest;readonly choices:readonly Choice[];readonly initial:LabelPrintPreview;readonly initialTemplateId?:string;readonly historicalJob?:string}
export function CustomLabelPrintView({slug,dark,locale,source,choices,initial,initialTemplateId,historicalJob}:Props){
 const t=useTranslations('labelPrint'),{say}=useKalipToast('form'),home=`/t/${encodeURIComponent(slug)}`;
 const[preview,setPreview]=useState(initial),[templateId,setTemplateId]=useState(initialTemplateId??''),[mode,setMode]=useState<LabelPaper>('a4'),[copies,setCopies]=useState(1),[index,setIndex]=useState(0),[busy,setBusy]=useState(false),[deviceId,setDeviceId]=useState<string|null>(null),[prepared,setPrepared]=useState<LabelPrepared|null>(null),[reason,setReason]=useState('damaged'),[failure,setFailure]=useState<string|null>(null),[opened,setOpened]=useState(false);
 const alive=useRef(true),pendingPreview=useRef(false);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const guard=useRef(false),request=useRef(0),intent=useRef<{key:string;jobId:string}|null>(null);
 let paperOk=true;try{labelPaperLayout(preview.width,preview.height,mode);}catch{paperOk=false;}
 const valid=paperOk&&Number.isInteger(copies)&&copies>0&&copies<=100&&preview.pages.length*copies<=500;
 const error=useCallback((code:string)=>say('warn',t(code==='UNAUTHENTICATED'?'login':code==='VERSION_CONFLICT'?'changed':code==='FORBIDDEN'?'locked':'failed')),[say,t]);
 const refresh=useCallback(async(selected:string,device:string|null)=>{
  const seq=++request.current;pendingPreview.current=true;setBusy(true);setFailure(null);try{const r=await customLabelPreviewAction({slug,source,locale,...(selected?{templateId:selected}:{}),...(device?{deviceId:device}:{})});if(seq!==request.current)return;if(!r.ok){setFailure(t('failed'));error(r.error.code);return;}if(!r.data.ready){const message=t(`errors.${r.data.reason}`);setFailure(message);say('warn',message);return;}setPreview(r.data.result);setIndex(0);setPrepared(null);setOpened(false);}catch{if(seq===request.current){setFailure(t('failed'));say('err',t('failed'));}}finally{if(seq===request.current){pendingPreview.current=false;setBusy(false);}}
 },[slug,source,locale,error,say,t]);
 useEffect(()=>{const id=labelDeviceId();setDeviceId(id);if(!historicalJob)void refresh(initialTemplateId??'',id);return()=>{request.current++;};},[slug,historicalJob,initialTemplateId,refresh]); // current device preference is server-owned; no browser printer IDs.
 const print=async()=>{
  if(guard.current||pendingPreview.current){say('warn',t('preparing'));return;}if(!valid||failure){say('warn',failure??t(paperOk?'copiesError':'paperError'));return;}guard.current=true;setBusy(true);const seq=++request.current,printMode=mode;
  const body={slug,source,locale,copies,...(!historicalJob&&templateId?{templateId}:{}),...(deviceId?{deviceId}:{}),...(historicalJob?{reprintOf:historicalJob,reason:t(`reasons.${reason}`)}:{})};const key=JSON.stringify(body);if(intent.current?.key!==key)intent.current={key,jobId:crypto.randomUUID()};
  try{const r=await customLabelPrepareAction({...body,jobId:intent.current.jobId});if(!alive.current||seq!==request.current)return;if(!r.ok){error(r.error.code);return;}if(!r.data.ready){say('warn',t(`errors.${r.data.reason}`));return;}
   const result=r.data.result;try{labelPaperPages(result.pages,result.copies,result.width,result.height,printMode);}catch{setPrepared(null);setPreview(result);setOpened(false);say('warn',t('paperError'));return;}flushSync(()=>{setPrepared(result);setPreview(result);setOpened(true);});
   await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));if(!alive.current||seq!==request.current||!document.querySelector(`[data-label-job="${result.jobId}"]`))return;window.print();
  }catch{say('err',t('failed'));}finally{guard.current=false;setBusy(false);}
 };
 const nextSource=preview.next&&source.kind!=='PRODUCT'?{...source,after:preview.next}:null;
 return<KalipEkran kind="liste" dark={dark} title={t('title')} icon={{d:LICON.printer,color:'3B6A9E'}} testId="custom-labels" bar={{back:{href:source.kind==='PRODUCT'?home+'/items':source.kind==='LOCATION'?home+'/warehouses/'+encodeURIComponent(source.warehouseId):source.kind==='PRODUCTION'?home+'/production':source.kind==='SHIPMENT'?home+'/shipping':home+'/receipts'},main:{label:t(historicalJob?'reprint':'print'),d:LICON.printer,onClick:()=>void print(),busy,disabled:busy||!valid||failure!==null,disabledReason:failure??t(paperOk?'copiesError':'paperError'),testId:'custom-label-print'}}}>
  <section className="label-controls"><KalipBaslik title={preview.name} hint={t('summary',{count:preview.pages.length,width:preview.width,height:preview.height})}/>
  {!historicalJob&&<KalipSecim label={t('template')} value={templateId} disabled={busy} color="3B6A9E" options={[...(choices.some(c=>c.isDefault)?[{id:'',label:t('default'),d:LICON.check,color:'2F7D5B'}]:[]),...choices.map(c=>({id:c.id,label:c.name,d:LICON.printer,color:'3B6A9E'}))]} onPick={id=>{setTemplateId(id);void refresh(id,deviceId);}}/>}
  <KalipCipler label={t('paper')} chips={[{id:'a4',label:'A4',d:LICON.printer,color:'3B6A9E',on:mode==='a4',onClick:()=>{if(guard.current||pendingPreview.current){say('warn',t('preparing'));return;}setPrepared(null);setOpened(false);setMode('a4');}},{id:'roll',label:t('roll'),d:LICON.tag,color:'0E7C7B',on:mode==='roll',onClick:()=>{if(guard.current||pendingPreview.current){say('warn',t('preparing'));return;}setPrepared(null);setOpened(false);setMode('roll');}}]}/>
  <KalipAlan label={t('copies')} type="number" min={1} max={Math.min(100,Math.floor(500/preview.pages.length))} inputMode="numeric" value={copies} disabled={busy} onChange={e=>{setPrepared(null);setOpened(false);setCopies(Number(e.target.value));}}/>
  {historicalJob&&<KalipSecim label={t('reason')} value={reason} disabled={busy} color="3B6A9E" options={['damaged','extra'].map(id=>({id,label:t(`reasons.${id}`),d:LICON.tag,color:'3B6A9E'}))} onPick={setReason}/>}
  <p className="khint">{preview.printer.kind==='dialog'&&preview.printer.name?`${preview.printer.name} · `:''}{t('dialogHint')}</p>
  {(!valid||failure)&&<KalipUyari tone="uyari"><p>{failure??t(paperOk?'copiesError':'paperError')}</p></KalipUyari>}
  {opened&&<KalipUyari tone="bilgi"><p>{t('dialogOpened')}</p></KalipUyari>}
  {preview.pages.length>1&&<KalipCipler label={t('preview')} chips={[{id:'previous',label:t('previous'),d:LICON.transfer,color:'3B6A9E',on:false,onClick:()=>setIndex(i=>(i+preview.pages.length-1)%preview.pages.length)},{id:'current',label:`${index+1} / ${preview.pages.length}`,d:LICON.tag,color:'3B6A9E',on:true},{id:'next',label:t('next'),d:LICON.arrow,color:'3B6A9E',on:false,onClick:()=>setIndex(i=>(i+1)%preview.pages.length)}]}/>}
  {nextSource&&<KalipDaha href={home+'/custom-labels?'+new URLSearchParams({source:JSON.stringify(nextSource)})}>{t('nextBatch')}</KalipDaha>}
  {prepared&&<KalipDaha href={home+'/custom-labels?'+new URLSearchParams({job:prepared.jobId})}>{t('savedJob')}</KalipDaha>}</section>
  <KalipEtiketOnizleme svg={preview.pages[index]??preview.pages[0]!} width={preview.width} height={preview.height} label={t('preview')}/>
  {prepared&&paperOk&&<KalipEtiketBaski jobId={prepared.jobId} pages={prepared.pages} copies={prepared.copies} width={prepared.width} height={prepared.height} mode={mode}/>}
 </KalipEkran>;
}
