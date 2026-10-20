"use client";
import { useRef,useState,useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FormSteps } from "../screen-shell.tsx";
import { LICON } from "../../../design/kalip-icons.ts";
import { KalipGrup } from "../kalip/form.tsx";
import { CameraOverlay } from "../field/receive/receive-flow.tsx";
import { Banner,ScanField } from "@wms/ui";
import { StockPicker,OperationError,type Choice } from "../production/production-form.tsx";
import { control } from "../stock/documents/document-form.tsx";
import { submitWithKey,useKeyHolder,type ErrorInfo } from "../receipts/receipt-form.tsx";
import { createShippingOrderAction,shippingOrderAction,confirmShippingPickAction,postShipmentAction,previewShippingPickAction } from "./actions.ts";
export function NewOrderForm({slug}:{slug:string}){
 const t=useTranslations("shipping"),router=useRouter(),key=useKeyHolder(),flight=useRef(false);
 const [pending,start]=useTransition(),[error,setError]=useState<ErrorInfo|null>(null),[uncertain,setUncertain]=useState(false),[customer,setCustomer]=useState("");
 const [lines,setLines]=useState<{key:string;item:Choice|null;quantity:string}[]>([{key:"first",item:null,quantity:""}]);
 const unsupported=lines.some(l=>l.item&&l.item.trackingMode!=="NONE");
 function changed(){key.contentChanged();setError(null);}
 return <form className="workflow-form flex flex-col gap-4" onSubmit={e=>{e.preventDefault();if(flight.current||unsupported||lines.some(l=>!l.item))return;flight.current=true;start(async()=>{try{
  const result=await submitWithKey(key,clientKey=>createShippingOrderAction({slug,clientKey,customerRef:customer,lines:lines.map(l=>({itemId:l.item!.id,quantity:l.quantity}))}));
  if(result.ok){router.push(`/t/${encodeURIComponent(slug)}/shipping?id=${result.data.documentId}`);router.refresh();}else{setError(result.error);setUncertain(["NETWORK","INTERNAL"].includes(result.error.code));}
 }finally{flight.current=false;}});}}>
  <p className="text-ink-muted">{t("newHelp")}</p><fieldset disabled={pending||uncertain} className="flex min-w-0 flex-col gap-4" onChange={changed}>
   <KalipGrup title={`1. ${t("customer")}`} d={LICON.people} color="2F5DA8"><div className="flex min-w-0 flex-col gap-3 p-3"><label>{t("customer")}<input required maxLength={100} value={customer} className={`${control} block w-full`} onChange={e=>setCustomer(e.target.value)}/></label>
   </div></KalipGrup><KalipGrup title={`2. ${t("item")}`} sub={String(lines.length)} d={LICON.box} color="B85A14"><div className="flex min-w-0 flex-col gap-3 p-3">{lines.map((line,i)=><section key={line.key} className="flex min-w-0 flex-col gap-2 rounded-card border-2 border-border p-3">
    <StockPicker slug={slug} kind="item" label={`${t("item")} ${i+1}`} onChange={item=>{changed();setLines(old=>old.map(l=>l.key===line.key?{...l,item}:l));}}/>
    <label>{t("quantity")} {line.item?.unitCode}<input required inputMode="decimal" maxLength={32} value={line.quantity} className={`${control} block w-full`} onChange={e=>setLines(old=>old.map(l=>l.key===line.key?{...l,quantity:e.target.value}:l))}/></label>
    <button type="button" className={control} disabled={lines.length===1} onClick={()=>{changed();setLines(old=>old.filter(l=>l.key!==line.key));}}>{t("remove")}</button>
   </section>)}<button type="button" className={control} disabled={lines.length>=200} onClick={()=>{changed();setLines(old=>[...old,{key:crypto.randomUUID(),item:null,quantity:""}]);}}>{t("add")}</button>
  </div></KalipGrup></fieldset>
  <section className="workflow-section rounded-card border-2 border-border p-3" aria-label={t("review")}><h2 className="font-bold">3. {t("review")}</h2><p>{customer}</p><ul>{lines.map(l=><li key={l.key}>{l.item?.name}: {l.quantity} {l.item?.unitCode}</li>)}</ul></section>
  {unsupported&&<Banner kind="warning">{t("untracked")}</Banner>}{error&&<OperationError error={error}/>}{uncertain&&<p>{t("uncertain")}</p>}
  <button className={`workflow-primary ${control} bg-accent text-on-accent`} disabled={pending||unsupported||lines.some(l=>!l.item)}>{t(uncertain?"retry":"create")}</button>
 </form>;
}
type OrderCommandProps={slug:string;orderId:string}&({operation:"cancel";expectedVersion:number}|{operation:"reserve"|"assign";expectedVersion?:never});
export function OrderCommand(props:OrderCommandProps){
 const {slug,orderId,operation}=props;
 // Preserve the version the user saw for this command, including uncertain retries.
 const [expectedVersion]=useState(props.expectedVersion);
 const [confirmCancel,setConfirmCancel]=useState(false);
 const t=useTranslations("shipping"),router=useRouter(),key=useKeyHolder(),flight=useRef(false),[pending,start]=useTransition(),[error,setError]=useState<ErrorInfo|null>(null),[done,setDone]=useState(false);
 return <div className="flex flex-col gap-2">{error&&<OperationError error={error}/>}{done&&<p role="status">{t("updated")}</p>}
  <button className={control} disabled={pending} onClick={()=>{if(operation==="cancel"&&!confirmCancel){setConfirmCancel(true);return;}if(flight.current)return;flight.current=true;start(async()=>{try{
   const result=await submitWithKey(key,clientKey=>shippingOrderAction({slug,clientKey,orderId,operation,...(operation==="cancel"?{expectedVersion}:{})}));if(result.ok){setError(null);setDone(true);router.refresh();}else setError(result.error);
  }finally{flight.current=false;}});}}>{t(operation==="cancel"&&confirmCancel?"confirmCancel":operation)}</button>{confirmCancel&&<p>{t("cancelHelp")}</p>}</div>;
}
export function PickForm({slug,task}:{slug:string;task:{id:string;itemName:string;unitCode:string;warehouseName:string;sourceCode:string;targetCode:string|null;quantity:string}}){
 const t=useTranslations("shipping"),router=useRouter(),key=useKeyHolder(),flight=useRef(false),[pending,start]=useTransition(),[error,setError]=useState<ErrorInfo|null>(null),[uncertain,setUncertain]=useState(false);
 const [location,setLocation]=useState(""),[barcode,setBarcode]=useState(""),[quantity,setQuantity]=useState("");
 const [cameraTarget,setCameraTarget]=useState<"location"|"barcode"|null>(null);
 const [preview,setPreview]=useState<{baseQuantity:string;unitCode:string}|null>(null);
 function change(){key.contentChanged();setPreview(null);setError(null);}
 return <form className="workflow-form flex min-w-0 flex-col gap-3 rounded-card border-2 border-border p-4" onSubmit={e=>{e.preventDefault();if(flight.current)return;flight.current=true;start(async()=>{try{
  if(!preview){const result=await previewShippingPickAction({slug,taskId:task.id,barcode,quantity});if(result.ok)setPreview(result.data);else setError(result.error);return;}
  const result=await submitWithKey(key,clientKey=>confirmShippingPickAction({slug,clientKey,taskId:task.id,foundQuantity:quantity,scannedLocationCode:location,scannedItemBarcode:barcode}));
  if(result.ok){router.refresh();}else{setError(result.error);setUncertain(["NETWORK","INTERNAL"].includes(result.error.code));}
 }catch{setError({code:"NETWORK"});}finally{flight.current=false;}});}}>
  <h3 className="font-bold">{task.itemName} — {task.quantity} {task.unitCode}</h3><p>{task.warehouseName}: {task.sourceCode} → {task.targetCode}</p>
  <p>{t("pickHelp")}</p><FormSteps labels={[t("locationScan"),t("barcode"),t("review")]}/><fieldset disabled={pending||preview!==null||uncertain} className="flex flex-col gap-3">
   <button type="button" className={control} onClick={()=>setCameraTarget("location")}>{t("cameraLocation")}</button>
   <ScanField label={t("locationScan")} value={location} manualLabel={t("manual")} confirmLabel={t("use")} cancelLabel={t("back")} onManualSubmit={v=>{change();setLocation(v);}}/>
   <button type="button" className={control} onClick={()=>setCameraTarget("barcode")}>{t("cameraBarcode")}</button>
   <ScanField label={t("barcode")} value={barcode} manualLabel={t("manual")} confirmLabel={t("use")} cancelLabel={t("back")} onManualSubmit={v=>{change();setBarcode(v);}}/>
   <label>{t("barcodeQuantity")}<input required inputMode="decimal" maxLength={32} value={quantity} className={`${control} block w-full`} onChange={e=>{change();setQuantity(e.target.value);}}/></label>
  </fieldset>
  {cameraTarget&&<CameraOverlay onClose={()=>setCameraTarget(null)} onManual={()=>setCameraTarget(null)} onCode={code=>{if(flight.current||uncertain||preview)return false;change();if(cameraTarget==="location")setLocation(code);else setBarcode(code);setCameraTarget(null);return true;}}/>}
  {preview&&<section aria-label={t("review")}><h4 className="font-bold">{t("review")}</h4><p>{task.itemName}: {preview.baseQuantity} {preview.unitCode}</p><p>{task.sourceCode} → {task.targetCode}</p>{!uncertain&&<button type="button" className={control} disabled={pending} onClick={()=>{if(!flight.current)setPreview(null);}}>{t("edit")}</button>}</section>}
  {error&&<OperationError error={error}/>}{uncertain&&<p>{t("uncertain")}</p>}
  <button className={`workflow-primary ${control} bg-accent text-on-accent`} disabled={pending||!location||!barcode||!quantity}>{t(uncertain?"retry":preview?"pick":"review")}</button>
 </form>;
}
export function ShipForm({slug,orderId,row}:{slug:string;orderId:string;row:{lineId:string;warehouseId:string;warehouseName:string;itemName:string;unitCode:string;quantity:string}}){
 const t=useTranslations("shipping"),router=useRouter(),key=useKeyHolder(),flight=useRef(false),[pending,start]=useTransition(),[error,setError]=useState<ErrorInfo|null>(null),[uncertain,setUncertain]=useState(false),[review,setReview]=useState(false),[quantity,setQuantity]=useState(row.quantity);
 return <form className="workflow-form flex min-w-0 flex-col gap-3 rounded-card border-2 border-border p-4" onSubmit={e=>{e.preventDefault();if(!review){setReview(true);return;}if(flight.current)return;flight.current=true;start(async()=>{try{
  const result=await submitWithKey(key,clientKey=>postShipmentAction({slug,clientKey,orderId,warehouseId:row.warehouseId,lineId:row.lineId,quantity}));
  if(result.ok){router.refresh();}else{setError(result.error);setUncertain(["NETWORK","INTERNAL"].includes(result.error.code));}
 }finally{flight.current=false;}});}}>
  <h3 className="font-bold">{row.itemName} · {row.warehouseName}</h3><p>{t("ready")}: {row.quantity} {row.unitCode}</p>
  <label>{t("shipQuantity")} ({row.unitCode})<input required inputMode="decimal" maxLength={32} disabled={pending||review||uncertain} value={quantity} className={`${control} block w-full`} onChange={e=>{key.contentChanged();setQuantity(e.target.value);setError(null);}}/></label>
  {review&&<section aria-label={t("review")}><h4 className="font-bold">{t("review")}</h4><p>{row.itemName} · {row.warehouseName}: −{quantity} {row.unitCode}</p>{!uncertain&&<button type="button" className={control} disabled={pending} onClick={()=>{if(!flight.current)setReview(false);}}>{t("edit")}</button>}</section>}
  {error&&<OperationError error={error}/>}{uncertain&&<p>{t("uncertain")}</p>}
  <button className={`workflow-primary ${control} bg-accent text-on-accent`} disabled={pending}>{t(uncertain?"retry":review?"ship":"review")}</button>
 </form>;
}
