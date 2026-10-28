"use client";
// Elle stok girişi / çıkışı / transfer formu ve belge durum komutları (onayla / stoka işle / iptal). Anahtarlı gönderim; kurallar sunucuda.
// T-1119 (B-123): seçiciler `KalipSecimAra` (eski Typeahead yerine), hata `OperationError` (kalıp bandı + ses), düğmeler `KalipDugme`; eski
// Tailwind `control` sınıfı kaldırıldı. Rehber hedefleri (`data-guide`) ve `form.workflow-form` sözleşmesi aynı.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LICON } from "../../../../design/kalip-icons.ts";
import { KalipAlan, KalipGrup } from "../../kalip/form.tsx";
import { KalipSecimAra } from "../../kalip/secim.tsx";
import { KalipBildirim, KalipDugme } from "../../kalip/belge.tsx";
import { OperationError, PICK_ICON, choiceOption } from "../../production/production-form.tsx";
import { submitWithKey, useKeyHolder, type ErrorInfo } from "../../receipts/receipt-form.tsx";
import { createManualStockAction, stockChoicesAction, transitionManualStockAction, transferStockAction } from "./actions.ts";
type Choice={ id:string;code:string;name:string;unitCode:string|null;trackingMode:string|null };
type Kind="warehouse"|"item"|"location"|"lot"|"serial"|"targetWarehouse"|"targetLocation";
const baseKind=(kind:Kind):"warehouse"|"item"|"location"|"lot"|"serial"=>kind === "targetWarehouse"?"warehouse":kind === "targetLocation"?"location":kind;
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
    return <KalipSecimAra<Choice> label={t(kind)} value={selected[kind] ?? null} icon={PICK_ICON[baseKind(kind)]} toOption={choiceOption(baseKind(kind))}
      search={async(q)=>{
        const result=await stockChoicesAction({slug,kind:baseKind(kind),q,...(kind === "targetLocation" && selected.targetWarehouse?{warehouseId:selected.targetWarehouse.id}:warehouse?{warehouseId:warehouse.id}:{}),...(item?{itemId:item.id}:{})});
        if(!result.ok){setError(result.error);throw new Error("search failed");} return result.data;
      }} onPick={value=>choose(kind,value)} />;
  }
  // T-1119: seçimler React durumunda — çıkış korumasına `data-dirty` ile bildirilir.
  const dirty=Object.keys(selected).length>0;
  // T-1124: işlem rehberinin "bitti" işaretleri (adım ancak iş gerçekten yapılınca ilerler; yalnız yazmak seçim sayılmaz).
  const guideDone=[warehouse && selected.location ? "source" : "",kind === "TRANSFER" && selected.targetLocation && selected.targetWarehouse?.id !== warehouse?.id ? "target" : "",
    item && (!lotRequired || selected.lot) && (!serialRequired || selected.serial) ? "item" : "",/^[0-9]+([.][0-9]{1,6})?$/.test(quantity) && Number(quantity) > 0 && reason.trim() !== "" ? "quantity" : ""].filter(Boolean).join(" ");
  return <form className="workflow-form kform-ic" data-dirty={dirty?"true":"false"} data-guide-done={guideDone} onSubmit={event=>{
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
    <small className="khint">{t(kind === "TRANSFER"?"transferHelp":"draftHelp")}</small>
    <fieldset disabled={pending || uncertain} className="kform-alan">
      <KalipGrup title={`1. ${screen("source")}`} sub={warehouse ? `${warehouse.name}${selected.location ? ` / ${selected.location.code}` : ""}` : undefined} d={LICON.depo} color="30475A"><div data-guide="source" className="kgovde">{picker("warehouse")}{warehouse && picker("location")}</div></KalipGrup>
      {kind === "TRANSFER" && <KalipGrup title={`2. ${screen("target")}`} sub={selected.targetWarehouse ? `${selected.targetWarehouse.name}${selected.targetLocation ? ` / ${selected.targetLocation.code}` : ""}` : undefined} d={LICON.transfer} color="0E7C7B"><div data-guide="target" className="kgovde">{picker("targetWarehouse")}{selected.targetWarehouse && picker("targetLocation")}</div></KalipGrup>}
      <KalipGrup title={`${kind === "TRANSFER" ? 3 : 2}. ${screen("itemsStep")}`} sub={item ? `${item.code} — ${item.name}` : undefined} d={LICON.box} color="2F5DA8"><div data-guide="item" className="kgovde">{picker("item")}
      {lotRequired && picker("lot")}{serialRequired && picker("serial")}
      {/* T-1037: ortak kalıp alanı (.fld) — eski düz kutu (control) yerine; ad/kurallar aynı. */}
      <KalipAlan label={item?.unitCode ? `${t("quantity")} · ${item.unitCode}` : t("quantity")} data-guide="quantity" name="quantity" required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,6})?" maxLength={32} value={quantity} onChange={e=>{key.contentChanged();setQuantity(e.target.value);}} />
      <KalipAlan label={t("reason")} data-guide="reason" name="reason" required maxLength={500} value={reason} onChange={e=>{key.contentChanged();setReason(e.target.value);}} />
      </div></KalipGrup>
    </fieldset>
    {item && warehouse && selected.location && <div data-guide="summary" className="kgovde"><KalipGrup title={t("summary")} d={LICON.check} color="2F7D5B"><ul className="kozet">
      <li>{warehouse.name} / {selected.location.code}</li><li>{item.code} — {item.name}</li>
      <li>{kind === "STOCK_IN" ? "+" : "−"}{quantity || "0"} {item.unitCode}</li>
      {kind === "TRANSFER" && <li>→ {selected.targetWarehouse?.name} / {selected.targetLocation?.code}: +{quantity || "0"} {item.unitCode}</li>}
      {selected.lot && <li>{t("lot")}: {selected.lot.code}</li>}{selected.serial && <li>{t("serial")}: {selected.serial.code}</li>}
    </ul></KalipGrup></div>}
    {error && <OperationError error={error} />}
    {uncertain && <KalipBildirim tur="uyari" title={t("uncertain")} />}
    <KalipDugme tur="ana" data-guide="submit" type="submit" className="workflow-primary" d={LICON.check} busy={pending} disabled={pending || !warehouse || !item || !selected.location || (kind === "TRANSFER" && (!selected.targetLocation || selected.targetWarehouse?.id === warehouse?.id)) || (lotRequired && !selected.lot) || (serialRequired && !selected.serial)}>{pending?t("busy"):uncertain?t("retry"):t(kind === "TRANSFER"?"transferPost":"create")}</KalipDugme>
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
  return <div className="kgovde">
    {error && <OperationError error={error} />}
    {document.processing && <KalipBildirim tur="bilgi" title={t("processing")} />}
    {uncertain ? <><KalipBildirim tur="uyari" title={t("uncertain")} /><KalipDugme tur="ana" d={LICON.arrow} busy={pending} disabled={pending} onClick={()=>run(uncertain)}>{t("retry")}</KalipDugme></> : <div className="kdugler">
      {document.status === "DRAFT" && permissions.approve && <KalipDugme tur="ana" d={LICON.check} busy={pending} disabled={pending} onClick={()=>run("approve")}>{t("approve")}</KalipDugme>}
      {document.status === "APPROVED" && permissions.post && <KalipDugme tur="ana" d={LICON.box} busy={pending} disabled={pending || document.processing} onClick={()=>run("post")}>{t("post")}</KalipDugme>}
      {["DRAFT","APPROVED"].includes(document.status) && permissions.create && <KalipDugme tur="tehlike" d={LICON.close} disabled={pending || document.processing} onClick={()=>run("cancel")}>{t("cancel")}</KalipDugme>}
    </div>}
    <KalipDugme d={LICON.clock} disabled={pending} onClick={()=>router.refresh()}>{t("refresh")}</KalipDugme>
  </div>;
}
