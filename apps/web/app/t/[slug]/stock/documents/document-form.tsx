"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LICON } from "../../../../design/kalip-icons.ts";
import { KalipGrup } from "../../kalip/form.tsx";
import { Banner } from "@wms/ui";
import { Typeahead } from "../../easy-setup/typeahead.tsx";
import { errorKeyOf, submitWithKey, useKeyHolder, type ErrorInfo } from "../../receipts/receipt-form.tsx";
import { createManualStockAction, stockChoicesAction, transitionManualStockAction, transferStockAction } from "./actions.ts";
export const control="min-h-12 rounded-lg border-2 border-border-strong bg-surface px-4 py-2 font-bold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50";
type Choice={ id:string;code:string;name:string;unitCode:string|null;trackingMode:string|null };
type Kind="warehouse"|"item"|"location"|"lot"|"serial"|"targetWarehouse"|"targetLocation";
function Failure({error}:{error:ErrorInfo}) {
  const t=useTranslations("receiving.errors");
  const key=errorKeyOf(error,"create");
  return <Banner kind="warning"><p>{t(key)}</p><p>{t(`${key}Action`)}</p></Banner>;
}
export function DocumentForm({slug,kind}:{slug:string;kind:"STOCK_IN"|"STOCK_OUT"|"TRANSFER"}) {
  const t=useTranslations("stockDocuments"),screen=useTranslations("shell.screen"),router=useRouter(),key=useKeyHolder();
  const [selected,setSelected]=useState<Partial<Record<Kind,Choice>>>({});
  const [quantity,setQuantity]=useState(""),[reason,setReason]=useState("");
  const [error,setError]=useState<ErrorInfo|null>(null),[pending,start]=useTransition();
  const inFlight=useRef(false);
  const [uncertain,setUncertain]=useState(false);
  const item=selected.item,warehouse=selected.warehouse;
  const lotRequired=item?.trackingMode === "LOT" || item?.trackingMode === "LOT_AND_SERIAL";
  const serialRequired=item?.trackingMode === "SERIAL" || item?.trackingMode === "LOT_AND_SERIAL";
  function choose(kind:Kind,value:Choice) {
    key.contentChanged(); setError(null);
    setSelected(old=>({...old,[kind]:value,...(kind === "warehouse" ? {location:undefined}:{}),...(kind === "item" ? {lot:undefined,serial:undefined}:{}),...(kind === "targetWarehouse" ? {targetLocation:undefined}:{})}));
  }
  function picker(kind:Kind) {
    return <Typeahead<Choice> key={`${kind}:${kind === "targetLocation" ? selected.targetWarehouse?.id ?? "" : kind === "location" ? warehouse?.id ?? "" : kind === "lot" || kind === "serial" ? item?.id ?? "" : ""}`} label={t(kind)} listLabel={t(kind)}
      defaultValue={selected[kind]?.code ?? ""} onQueryChange={()=>{
        key.contentChanged();setSelected(old=>{const next={...old};delete next[kind];
          if(kind === "warehouse")delete next.location;
          if(kind === "targetWarehouse")delete next.targetLocation;
          if(kind === "item"){delete next.lot;delete next.serial;}return next;});
      }} search={async(q)=>{
        const result=await stockChoicesAction({slug,kind:kind === "targetWarehouse"?"warehouse":kind === "targetLocation"?"location":kind,q,...(kind === "targetLocation" && selected.targetWarehouse?{warehouseId:selected.targetWarehouse.id}:warehouse?{warehouseId:warehouse.id}:{}),...(item?{itemId:item.id}:{})});
        if(!result.ok){setError(result.error);throw new Error("search failed");} return result.data;
      }} toSuggestion={c=>({key:c.id,primary:c.code,secondary:c.name})} onSelect={value=>choose(kind,value)} />;
  }
  return <form className="workflow-form flex min-w-0 flex-col gap-4" onSubmit={event=>{
    event.preventDefault(); if(inFlight.current || !warehouse || !item || !selected.location) return;
    inFlight.current=true;
    const payload={slug,kind,warehouseId:warehouse.id,itemId:item.id,locationId:selected.location.id,quantity,reason,
      ...(selected.lot?{lotId:selected.lot.id}:{}),...(selected.serial?{serialId:selected.serial.id}:{})};
    start(async()=>{try{
      const result=await submitWithKey(key,clientKey=>kind === "TRANSFER" ? transferStockAction({slug,clientKey,itemId:item.id,quantity,reason,sourceLocationId:payload.locationId,targetLocationId:selected.targetLocation?.id,...(selected.lot?{lotId:selected.lot.id}:{}),...(selected.serial?{serialId:selected.serial.id}:{})}) : createManualStockAction({...payload,clientKey}));
      if(result.ok){router.push(`/t/${encodeURIComponent(slug)}/stock/documents?id=${result.data.documentId}`);router.refresh();}
      else{setError(result.error);setUncertain(["NETWORK","INTERNAL"].includes(result.error.code));}
    }finally{inFlight.current=false;}});
  }}>
    <p className="text-ink-muted">{t(kind === "TRANSFER"?"transferHelp":"draftHelp")}</p>
    <fieldset disabled={pending || uncertain} className="flex min-w-0 flex-col gap-4">
      <KalipGrup title={`1. ${screen("source")}`} sub={warehouse ? `${warehouse.name}${selected.location ? ` / ${selected.location.code}` : ""}` : undefined} d={LICON.depo} color="30475A"><div className="flex min-w-0 flex-col gap-3 p-3">{picker("warehouse")}{warehouse && picker("location")}</div></KalipGrup>
      {kind === "TRANSFER" && <KalipGrup title={`2. ${screen("target")}`} sub={selected.targetWarehouse ? `${selected.targetWarehouse.name}${selected.targetLocation ? ` / ${selected.targetLocation.code}` : ""}` : undefined} d={LICON.transfer} color="0E7C7B"><div className="flex min-w-0 flex-col gap-3 p-3">{picker("targetWarehouse")}{selected.targetWarehouse && picker("targetLocation")}</div></KalipGrup>}
      <KalipGrup title={`${kind === "TRANSFER" ? 3 : 2}. ${screen("itemsStep")}`} sub={item ? `${item.code} — ${item.name}` : undefined} d={LICON.box} color="2F5DA8"><div className="flex min-w-0 flex-col gap-3 p-3">{picker("item")}
      {lotRequired && picker("lot")}{serialRequired && picker("serial")}
      <label className="flex flex-col gap-1 font-bold">{t("quantity")} {item?.unitCode}
        <input required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,6})?" maxLength={32} className={control} value={quantity} onChange={e=>{key.contentChanged();setQuantity(e.target.value);}} />
      </label>
      <label className="flex flex-col gap-1 font-bold">{t("reason")}<input required maxLength={500} className={control} value={reason} onChange={e=>{key.contentChanged();setReason(e.target.value);}} /></label>
      </div></KalipGrup>
    </fieldset>
    {item && warehouse && selected.location && <section className="rounded-card border-2 border-border bg-surface p-4" aria-label={t("summary")}>
      <h2 className="font-bold">{t("summary")}</h2><p>{warehouse.name} / {selected.location.code}</p><p>{item.code} — {item.name}</p>
      <p>{kind === "STOCK_IN" ? "+" : "−"}{quantity || "0"} {item.unitCode}</p>
      {kind === "TRANSFER" && <p>→ {selected.targetWarehouse?.name} / {selected.targetLocation?.code}: +{quantity || "0"} {item.unitCode}</p>}
      {selected.lot && <p>{t("lot")}: {selected.lot.code}</p>}{selected.serial && <p>{t("serial")}: {selected.serial.code}</p>}
    </section>}
    {error && <Failure error={error} />}
    {uncertain && <p role="status">{t("uncertain")}</p>}
    <button type="submit" className={`workflow-primary ${control} bg-accent text-on-accent`} disabled={pending || !warehouse || !item || !selected.location || (kind === "TRANSFER" && (!selected.targetLocation || selected.targetWarehouse?.id === warehouse?.id)) || (lotRequired && !selected.lot) || (serialRequired && !selected.serial)}>{pending?t("busy"):uncertain?t("retry"):t(kind === "TRANSFER"?"transferPost":"create")}</button>
  </form>;
}
export function DocumentControls({slug,document,permissions}:{slug:string;document:{id:string;version:number;status:string;processing:boolean};permissions:{create:boolean;approve:boolean;post:boolean}}) {
  const t=useTranslations("stockDocuments"),router=useRouter();
  const approveKey=useKeyHolder(),postKey=useKeyHolder(),cancelKey=useKeyHolder();
  const [pending,start]=useTransition(),[error,setError]=useState<ErrorInfo|null>(null);
  const [uncertain,setUncertain]=useState<"approve"|"post"|"cancel"|null>(null),flight=useRef(false);
  function run(operation:"approve"|"post"|"cancel") {
    if(flight.current) return; flight.current=true;
    start(async()=>{try{
      const result=await submitWithKey(operation === "approve" ? approveKey : operation === "post" ? postKey : cancelKey,clientKey=>transitionManualStockAction({slug,documentId:document.id,expectedVersion:document.version,operation,clientKey}));
      if(result.ok){setError(null);setUncertain(null);router.refresh();}
      else {setError(result.error);setUncertain(["NETWORK","INTERNAL"].includes(result.error.code)?operation:null);}
    }finally{flight.current=false;}});
  }
  return <div className="flex flex-col gap-3">
    {error && <Failure error={error} />}
    {document.processing && <p role="status">{t("processing")}</p>}
    {uncertain ? <><p>{t("uncertain")}</p><button className={control} disabled={pending} onClick={()=>run(uncertain)}>{t("retry")}</button></> : <div className="flex flex-wrap gap-2">
      {document.status === "DRAFT" && permissions.approve && <button className={control} disabled={pending} onClick={()=>run("approve")}>{t("approve")}</button>}
      {document.status === "APPROVED" && permissions.post && <button className={`${control} bg-accent text-on-accent`} disabled={pending || document.processing} onClick={()=>run("post")}>{t("post")}</button>}
      {["DRAFT","APPROVED"].includes(document.status) && permissions.create && <button className={control} disabled={pending || document.processing} onClick={()=>run("cancel")}>{t("cancel")}</button>}
    </div>}
    <button className={control} disabled={pending} onClick={()=>router.refresh()}>{t("refresh")}</button>
  </div>;
}
