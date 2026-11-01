"use client";
import{useEffect,useRef,useState}from"react";
import{useRouter}from"next/navigation";
import{useTranslations}from"next-intl";
import type{LabelWorkspace,LabelPreference}from"@wms/shared/labels";
import{LICON}from"../../../design/kalip-icons.ts";
import{KalipEkran,useKalipToast}from"../kalip/ekran.tsx";
import{KalipFormEkran}from"../kalip/form-ekran.tsx";
import{KalipAlan,KalipAlanSira,KalipAnahtar,KalipGrup}from"../kalip/form.tsx";
import{KalipAyarKart}from"../kalip/ayar.tsx";
import{KalipSecim}from"../kalip/secim.tsx";
import{KalipBildirim,KalipDugme}from"../kalip/belge.tsx";
import{KalipKart,KalipKartListe}from"../kalip/liste.tsx";
import{labelPreferenceAction,labelPrinterSaveAction}from"./actions.ts";
export function LabelPrinterChoice({slug,data,device,templateId}:{slug:string;data:LabelWorkspace;device:string|null;templateId:string|null}){
 const t=useTranslations('labelEditor'),{say}=useKalipToast('form'),[personal,setPersonal]=useState(true),[prefs,setPrefs]=useState<readonly LabelPreference[]>(data.preferences),[busy,setBusy]=useState(false),guard=useRef(false);
 useEffect(()=>setPrefs(data.preferences),[data.preferences]);
 const old=prefs.find(p=>p.templateId===templateId&&p.personal===personal),selected=old?.printerId??'';
 return<><KalipSecim label={t(templateId?'templatePrinter':'generalPrinter')} value={personal?'DEVICE':'COMPANY'} color="3B6A9E" disabled={busy||!data.rights.printers} options={[{id:'DEVICE',label:t('thisDevice'),d:LICON.printer,color:'3B6A9E'},{id:'COMPANY',label:t('company'),d:LICON.workspace,color:'3B6A9E'}]} onPick={v=>setPersonal(v==='DEVICE')}/>
 <KalipSecim label={t('printer')} value={selected} color="3B6A9E" disabled={busy||!data.rights.printers||(personal&&device===null)} options={[{id:'',label:t(templateId?'inherit':'systemPrinter'),d:LICON.printer,color:'3B6A9E'},...data.printers.map(p=>({id:p.id,label:p.name,sub:p.active?`${p.dpi} DPI`:t('printerClosed'),disabled:!p.active,d:LICON.printer,color:'3B6A9E'}))]} onPick={async v=>{
  if(guard.current)return;guard.current=true;setBusy(true);try{const r=await labelPreferenceAction({slug,templateId,deviceId:personal?device:null,printerId:v||null,expectedVersion:old?.version??0});if(!r.ok){say('warn',t(r.error.detail==='MFA_REQUIRED'?'mfa':r.error.code==='VERSION_CONFLICT'?'conflict':'failed'));return;}setPrefs(p=>[...p.filter(x=>!(x.templateId===templateId&&x.personal===personal)),{id:r.data.id,templateId,personal,printerId:v||null,version:r.data.version}]);say('ok',t('printerSaved'));}catch{say('err',t('failed'));}finally{guard.current=false;setBusy(false);}
 }}/><KalipBildirim tur="bilgi" sub={t('printerHint')}/></>;
}
export function LabelPrinters({slug,dark,data,device,editId}:{slug:string;dark:boolean;data:LabelWorkspace;device:string|null;editId:string|undefined}){
 const t=useTranslations('labelEditor'),base=`/t/${encodeURIComponent(slug)}/label-designs`;
 if(editId!==undefined)return<PrinterEdit key={editId} slug={slug} dark={dark} data={data} id={editId}/>;
 return<KalipEkran testId="label-printers" kind="form" dark={dark} title={t('printers')} icon={{d:LICON.printer,color:'3B6A9E'}} bar={{back:{href:base},main:{label:t('newPrinter'),d:LICON.plus,href:base+'?printer=new',locked:!data.rights.printers,disabledReason:t('locked')}}}>
  <KalipAyarKart title={t('generalPrinter')} d={LICON.printer} ton="mavi"><LabelPrinterChoice slug={slug} data={data} device={device} templateId={null}/></KalipAyarKart>
  <KalipKartListe label={t('printers')}>{data.printers.map(p=><KalipKart key={p.id} name={p.name} code={`${p.dpi} DPI`} d={LICON.printer} color="3B6A9E" aria={p.name} href={base+'?printer='+p.id} badge={{value:t(p.active?'active':'printerClosed'),sub:t('systemPrinter')}}/>)}</KalipKartListe>
 </KalipEkran>;
}
function PrinterEdit({slug,dark,data,id}:{slug:string;dark:boolean;data:LabelWorkspace;id:string}){
 const t=useTranslations('labelEditor'),router=useRouter(),base=`/t/${encodeURIComponent(slug)}/label-designs?tab=printers`,old=data.printers.find(p=>p.id===id);
 const initial={name:old?.name??'',dpi:old?.dpi??203,offsetX:String((old?.offsetX??0)/1000),offsetY:String((old?.offsetY??0)/1000),active:old?.active??true};
 const[value,setValue]=useState(initial),[version,setVersion]=useState(old?.version??0);
 if(id!=='new'&&!old)return<KalipEkran kind="form" dark={dark} title={t('printers')} icon={{d:LICON.printer,color:'3B6A9E'}} bar={{back:{href:base},main:null}}><KalipBildirim tur="hata" title={t('failed')}/><KalipDugme onClick={()=>router.push(base)}>{t('back')}</KalipDugme></KalipEkran>;
 const offset=(s:string)=>{if(!/^-?\d{1,2}(?:[.,]\d{1,3})?$/.test(s))return NaN;return Math.round(Number(s.replace(',','.'))*1000);};
 return<KalipFormEkran dark={dark} title={old?.name??t('newPrinter')} icon={{d:LICON.printer,color:'3B6A9E'}} values={value} initial={initial} canEdit={data.rights.printers} rules={[{name:'name',label:t('name'),required:true}]} onBack={()=>router.push(base)} onDone={()=>router.push(base)} onSave={async()=>{
  const x=offset(value.offsetX),y=offset(value.offsetY);if(!Number.isInteger(x)||!Number.isInteger(y)||Math.abs(x)>10000||Math.abs(y)>10000)return{ok:false,mesaj:t('calibrationError')};
  const r=await labelPrinterSaveAction({slug,...(old?{id:old.id}:{}),expectedVersion:version,name:value.name,dpi:value.dpi,offsetX:x,offsetY:y,active:value.active});if(!r.ok)return{ok:false,mesaj:t(r.error.detail==='MFA_REQUIRED'?'mfa':r.error.code==='VERSION_CONFLICT'?'conflict':'failed')};setVersion(r.data.version);return{ok:true};
 }}>
 <KalipGrup title={t('printer')} d={LICON.printer} color="3B6A9E"><KalipAlan name="name" label={t('name')} value={value.name} maxLength={80} onChange={e=>setValue(v=>({...v,name:e.target.value}))}/><KalipSecim label="DPI" value={String(value.dpi)} color="3B6A9E" options={['203','300','600'].map(id=>({id,label:id+' DPI',d:LICON.printer,color:'3B6A9E'}))} onPick={id=>setValue(v=>({...v,dpi:Number(id) as 203|300|600}))}/><KalipAnahtar title={t('active')} d={LICON.check} color="2F7D5B" on={value.active} aria={t('active')} onToggle={()=>setValue(v=>({...v,active:!v.active}))}/></KalipGrup>
 <KalipGrup title={t('calibration')} d={LICON.grid} color="3B6A9E"><KalipAlanSira><KalipAlan label="X · mm" inputMode="decimal" value={value.offsetX} onChange={e=>setValue(v=>({...v,offsetX:e.target.value}))}/><KalipAlan label="Y · mm" inputMode="decimal" value={value.offsetY} onChange={e=>setValue(v=>({...v,offsetY:e.target.value}))}/></KalipAlanSira><KalipBildirim tur="bilgi" sub={t('printerHint')}/></KalipGrup>
 </KalipFormEkran>;
}
