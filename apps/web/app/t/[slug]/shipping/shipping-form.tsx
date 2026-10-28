"use client";
// Sevk siparişi formları: yeni sipariş, sipariş komutları (stok ayır / toplama görevi / iptal), raftan toplama ve sevk çıkışı. Anahtarlı gönderim
// (`useKeyHolder` / `submitWithKey`): belirsiz sonuçta aynı anahtar ve aynı içerikle "Yeniden dene"; kurallar sunucuda.
// T-1119 (B-123): iç parçalar kalıp görünümünde — `KalipSecimAra` (ürün), `KalipAlan`, `KalipSatirKart`, `KalipBildirim`, `KalipDugme`; ayrıntı
// ekranında (`.dzd`) `KalipFormKap` form görünümünü kurar. Okutma alanları ortak `ScanField` (kalıp görünümü) + kamera.
import { useRef,useState,useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { KalipAdimlar } from "../kalip/adimlar.tsx";
import { LICON } from "../../../design/kalip-icons.ts";
import { KalipAlan,KalipGrup } from "../kalip/form.tsx";
import { KalipBildirim,KalipDugme,KalipFormKap,KalipSatirKart } from "../kalip/belge.tsx";
import { Ico } from "../kalip/ico.tsx";
import { CameraOverlay } from "../field/receive/receive-flow.tsx";
import { ScanField } from "@wms/ui";
import { StockPicker,OperationError,type Choice } from "../production/production-form.tsx";
import { submitWithKey,useKeyHolder,type ErrorInfo } from "../receipts/receipt-form.tsx";
import { createShippingOrderAction,shippingOrderAction,confirmShippingPickAction,postShipmentAction,previewShippingPickAction } from "./actions.ts";
export function NewOrderForm({slug}:{slug:string}){
 const t=useTranslations("shipping"),router=useRouter(),key=useKeyHolder(),flight=useRef(false);
 const [pending,start]=useTransition(),[error,setError]=useState<ErrorInfo|null>(null),[uncertain,setUncertain]=useState(false),[customer,setCustomer]=useState("");
 const [lines,setLines]=useState<{key:string;item:Choice|null;quantity:string}[]>([{key:"first",item:null,quantity:""}]);
 const unsupported=lines.some(l=>l.item&&l.item.trackingMode!=="NONE");
 function changed(){key.contentChanged();setError(null);}
 const dirty=lines.length>1||lines.some(l=>l.item!==null);
 return <form className="workflow-form kform-ic" data-dirty={dirty?"true":"false"} onSubmit={e=>{e.preventDefault();if(flight.current||unsupported||lines.some(l=>!l.item))return;flight.current=true;start(async()=>{try{
  const result=await submitWithKey(key,clientKey=>createShippingOrderAction({slug,clientKey,customerRef:customer,lines:lines.map(l=>({itemId:l.item!.id,quantity:l.quantity}))}));
  if(result.ok){router.push(`/t/${encodeURIComponent(slug)}/shipping?id=${result.data.documentId}`);router.refresh();}else{setError(result.error);setUncertain(["NETWORK","INTERNAL"].includes(result.error.code));}
 }finally{flight.current=false;}});}}>
  <small className="khint">{t("newHelp")}</small><fieldset disabled={pending||uncertain} className="kform-alan" onChange={changed}>
   <KalipGrup title={`1. ${t("k.groupCustomer")}`} d={LICON.people} color="2F5DA8"><KalipAlan label={t("customer")} name="customer" required maxLength={100} value={customer} onChange={e=>setCustomer(e.target.value)}/>
   </KalipGrup><KalipGrup title={`2. ${t("k.groupItems")}`} sub={String(lines.length)} d={LICON.box} color="B85A14">{lines.map((line,i)=><KalipSatirKart key={line.key} title={`${t("item")} ${i+1}`} remove={{label:`${t("remove")}: ${t("item")} ${i+1}`,disabled:lines.length===1,onClick:()=>{changed();setLines(old=>old.filter(l=>l.key!==line.key));}}}>
    <StockPicker slug={slug} kind="item" label={`${t("item")} ${i+1}`} value={line.item} onChange={item=>{changed();setLines(old=>old.map(l=>l.key===line.key?{...l,item}:l));}}/>
    <KalipAlan label={line.item?.unitCode ? `${t("quantity")} · ${line.item.unitCode}` : t("quantity")} name={`quantity-${i}`} required inputMode="decimal" maxLength={32} value={line.quantity} onChange={e=>setLines(old=>old.map(l=>l.key===line.key?{...l,quantity:e.target.value}:l))}/>
   </KalipSatirKart>)}<KalipDugme d={LICON.plus} disabled={lines.length>=200} onClick={()=>{changed();setLines(old=>[...old,{key:crypto.randomUUID(),item:null,quantity:""}]);}}>{t("add")}</KalipDugme>
  </KalipGrup></fieldset>
  <KalipGrup title={`3. ${t("review")}`} d={LICON.check} color="2F7D5B"><ul className="kozet">{customer===""?null:<li>{customer}</li>}{lines.map(l=><li key={l.key}>{l.item?.name}: {l.quantity} {l.item?.unitCode}</li>)}</ul></KalipGrup>
  {unsupported&&<KalipBildirim tur="uyari" title={t("untracked")}/>}{error&&<OperationError error={error}/>}{uncertain&&<KalipBildirim tur="uyari" title={t("uncertain")}/>}
  <KalipDugme tur="ana" type="submit" className="workflow-primary" d={LICON.check} busy={pending} disabled={pending||unsupported||lines.some(l=>!l.item)}>{t(uncertain?"retry":"create")}</KalipDugme>
 </form>;
}
type OrderCommandProps={slug:string;orderId:string}&({operation:"cancel";expectedVersion:number}|{operation:"reserve"|"assign";expectedVersion?:never});
const COMMAND_ICON={reserve:LICON.lock,assign:LICON.raf,cancel:LICON.trash} as const;
export function OrderCommand(props:OrderCommandProps){
 const {slug,orderId,operation}=props;
 // Preserve the version the user saw for this command, including uncertain retries.
 const [expectedVersion]=useState(props.expectedVersion);
 const [confirmCancel,setConfirmCancel]=useState(false);
 const t=useTranslations("shipping"),router=useRouter(),key=useKeyHolder(),flight=useRef(false),[pending,start]=useTransition(),[error,setError]=useState<ErrorInfo|null>(null),[done,setDone]=useState(false);
 return <div className="kgovde">{error&&<OperationError error={error}/>}{done&&<KalipBildirim tur="tamam" title={t("updated")}/>}
  <KalipDugme tur={operation==="cancel"?"tehlike":"ana"} d={COMMAND_ICON[operation]} busy={pending} disabled={pending} onClick={()=>{if(operation==="cancel"&&!confirmCancel){setConfirmCancel(true);return;}if(flight.current)return;flight.current=true;start(async()=>{try{
   const result=await submitWithKey(key,clientKey=>shippingOrderAction({slug,clientKey,orderId,operation,...(operation==="cancel"?{expectedVersion}:{})}));if(result.ok){setError(null);setDone(true);router.refresh();}else setError(result.error);
  }finally{flight.current=false;}});}}>{t(operation==="cancel"&&confirmCancel?"confirmCancel":operation)}</KalipDugme>{confirmCancel&&<KalipBildirim tur="uyari" title={t("cancelHelp")}/>}</div>;
}
export function PickForm({slug,task}:{slug:string;task:{id:string;itemName:string;unitCode:string;warehouseName:string;sourceCode:string;targetCode:string|null;quantity:string}}){
 const t=useTranslations("shipping"),router=useRouter(),key=useKeyHolder(),flight=useRef(false),[pending,start]=useTransition(),[error,setError]=useState<ErrorInfo|null>(null),[uncertain,setUncertain]=useState(false);
 const [location,setLocation]=useState(""),[barcode,setBarcode]=useState(""),[quantity,setQuantity]=useState("");
 const [cameraTarget,setCameraTarget]=useState<"location"|"barcode"|null>(null);
 const [preview,setPreview]=useState<{baseQuantity:string;unitCode:string}|null>(null);
 function change(){key.contentChanged();setPreview(null);setError(null);}
 return <KalipFormKap><form className="workflow-form ksatk" onSubmit={e=>{e.preventDefault();if(flight.current)return;flight.current=true;start(async()=>{try{
  if(!preview){const result=await previewShippingPickAction({slug,taskId:task.id,barcode,quantity});if(result.ok)setPreview(result.data);else setError(result.error);return;}
  const result=await submitWithKey(key,clientKey=>confirmShippingPickAction({slug,clientKey,taskId:task.id,foundQuantity:quantity,scannedLocationCode:location,scannedItemBarcode:barcode}));
  if(result.ok){router.refresh();}else{setError(result.error);setUncertain(["NETWORK","INTERNAL"].includes(result.error.code));}
 }catch{setError({code:"NETWORK"});}finally{flight.current=false;}});}}>
  <div className="ksatk-h"><h3>{task.itemName} — {task.quantity} {task.unitCode}</h3></div><small className="khint">{task.warehouseName}: {task.sourceCode} → {task.targetCode}</small>
  <small className="khint">{t("pickHelp")}</small><KalipAdimlar labels={[t("locationScan"),t("barcode"),t("review")]}/><fieldset disabled={pending||preview!==null||uncertain} className="kform-alan">
   <button type="button" className="btn n" onClick={()=>setCameraTarget("location")}><Ico d={LICON.cam} size={20}/>{t("cameraLocation")}</button>
   <ScanField variant="kalip" label={t("locationScan")} value={location} manualLabel={t("manual")} confirmLabel={t("use")} cancelLabel={t("back")} onManualSubmit={v=>{change();setLocation(v);}}/>
   <button type="button" className="btn n" onClick={()=>setCameraTarget("barcode")}><Ico d={LICON.cam} size={20}/>{t("cameraBarcode")}</button>
   <ScanField variant="kalip" label={t("barcode")} value={barcode} manualLabel={t("manual")} confirmLabel={t("use")} cancelLabel={t("back")} onManualSubmit={v=>{change();setBarcode(v);}}/>
   <KalipAlan label={t("barcodeQuantity")} required inputMode="decimal" maxLength={32} value={quantity} onChange={e=>{change();setQuantity(e.target.value);}}/>
  </fieldset>
  {cameraTarget&&<CameraOverlay onClose={()=>setCameraTarget(null)} onManual={()=>setCameraTarget(null)} onCode={code=>{if(flight.current||uncertain||preview)return false;change();if(cameraTarget==="location")setLocation(code);else setBarcode(code);setCameraTarget(null);return true;}}/>}
  {preview&&<KalipGrup title={t("review")} d={LICON.check} color="2F7D5B"><ul className="kozet"><li>{task.itemName}: {preview.baseQuantity} {preview.unitCode}</li><li>{task.sourceCode} → {task.targetCode}</li></ul>{!uncertain&&<KalipDugme d={LICON.pencil} disabled={pending} onClick={()=>{if(!flight.current)setPreview(null);}}>{t("edit")}</KalipDugme>}</KalipGrup>}
  {error&&<OperationError error={error}/>}{uncertain&&<KalipBildirim tur="uyari" title={t("uncertain")}/>}
  <KalipDugme tur="ana" type="submit" className="workflow-primary" d={preview?LICON.check:LICON.search} busy={pending} disabled={pending||!location||!barcode||!quantity}>{t(uncertain?"retry":preview?"pick":"review")}</KalipDugme>
 </form></KalipFormKap>;
}
export function ShipForm({slug,orderId,row}:{slug:string;orderId:string;row:{lineId:string;warehouseId:string;warehouseName:string;itemName:string;unitCode:string;quantity:string}}){
 const t=useTranslations("shipping"),router=useRouter(),key=useKeyHolder(),flight=useRef(false),[pending,start]=useTransition(),[error,setError]=useState<ErrorInfo|null>(null),[uncertain,setUncertain]=useState(false),[review,setReview]=useState(false),[quantity,setQuantity]=useState(row.quantity);
 return <KalipFormKap><form className="workflow-form ksatk" onSubmit={e=>{e.preventDefault();if(!review){setReview(true);return;}if(flight.current)return;flight.current=true;start(async()=>{try{
  const result=await submitWithKey(key,clientKey=>postShipmentAction({slug,clientKey,orderId,warehouseId:row.warehouseId,lineId:row.lineId,quantity}));
  if(result.ok){router.refresh();}else{setError(result.error);setUncertain(["NETWORK","INTERNAL"].includes(result.error.code));}
 }finally{flight.current=false;}});}}>
  <div className="ksatk-h"><h3>{row.itemName} · {row.warehouseName}</h3></div><small className="khint">{t("ready")}: {row.quantity} {row.unitCode}</small>
  <KalipAlan label={`${t("shipQuantity")} (${row.unitCode})`} required inputMode="decimal" maxLength={32} disabled={pending||review||uncertain} value={quantity} onChange={e=>{key.contentChanged();setQuantity(e.target.value);setError(null);}}/>
  {review&&<KalipGrup title={t("review")} d={LICON.check} color="2F7D5B"><ul className="kozet"><li>{row.itemName} · {row.warehouseName}: −{quantity} {row.unitCode}</li></ul>{!uncertain&&<KalipDugme d={LICON.pencil} disabled={pending} onClick={()=>{if(!flight.current)setReview(false);}}>{t("edit")}</KalipDugme>}</KalipGrup>}
  {error&&<OperationError error={error}/>}{uncertain&&<KalipBildirim tur="uyari" title={t("uncertain")}/>}
  <KalipDugme tur="ana" type="submit" className="workflow-primary" d={review?LICON.moveOut:LICON.search} busy={pending} disabled={pending}>{t(uncertain?"retry":review?"ship":"review")}</KalipDugme>
 </form></KalipFormKap>;
}
