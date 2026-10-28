"use client";
// Reçete ve üretim emri formları. Anahtarlı gönderim (`useKeyHolder` / `submitWithKey`): ağ hatasında aynı anahtarla yeniden deneme; kurallar sunucuda.
// T-1119 (B-123): iç parçalar kalıp görünümünde — seçiciler `KalipSecimAra` (sunucuda arar; eski Typeahead yerine), alanlar `KalipAlan`, satırlar
// `KalipSatirKart`, uyarılar `KalipBildirim`, düğmeler `KalipDugme`. Ayrıntı ekranında (üretim emri) `KalipFormKap` form görünümünü kurar.
// React durumundaki seçim/satırlar çıkış korumasına `data-dirty` ile bildirilir (FormEkran).
import { useRef,useState,useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LICON } from "../../../design/kalip-icons.ts";
import { KalipAlan,KalipGrup } from "../kalip/form.tsx";
import { KalipSecimAra } from "../kalip/secim.tsx";
import { KalipBildirim,KalipDugme,KalipFormKap,KalipSatirKart } from "../kalip/belge.tsx";
import { useSonucSesi } from "../kalip/sonuc-sesi.ts";
import { stockChoicesAction } from "../stock/documents/actions.ts";
import { errorKeyOf,submitWithKey,useKeyHolder,type ErrorInfo } from "../receipts/receipt-form.tsx";
import { createRecipeAction,previewProductionAction,produceAction } from "./actions.ts";
export type Choice={id:string;code:string;name:string;unitCode:string|null;trackingMode:string|null};
type PickKind="item"|"warehouse"|"location"|"lot"|"serial";
/** T-1119: seçici türüne göre kalıp simgesi ve rengi (STANDART §7 eşlemesi). */
export const PICK_ICON:Readonly<Record<PickKind,{readonly d:string;readonly color:string}>>={item:{d:LICON.box,color:"2F5DA8"},warehouse:{d:LICON.depo,color:"30475A"},location:{d:LICON.raf,color:"4E6476"},lot:{d:LICON.tag,color:"2F5DA8"},serial:{d:LICON.tag,color:"6C4BD8"}};
export const choiceOption=(kind:PickKind)=>(c:Choice)=>({id:c.id,label:c.code,sub:c.name,d:PICK_ICON[kind].d,color:PICK_ICON[kind].color});
export function StockPicker({slug,label,kind,value,warehouseId,itemId,onChange}:{slug:string;label:string;kind:PickKind;value:Choice|null;warehouseId?:string;itemId?:string;onChange:(choice:Choice|null)=>void}) {
 const [error,setError]=useState<ErrorInfo|null>(null);
 return <><KalipSecimAra<Choice> label={label} value={value} icon={PICK_ICON[kind]} toOption={choiceOption(kind)} onPick={onChange} search={async(q)=>{
  const result=await stockChoicesAction({slug,kind,q,...(warehouseId?{warehouseId}:{}),...(itemId?{itemId}:{})});
  if(!result.ok){setError(result.error);throw new Error("search failed");}setError(null);return result.data;
 }}/>{error&&<OperationError error={error}/>}</>;
}
/** Sunucu reddi: kalıp hata bandı + hata sesi (ALTIN-KURAL 3). Sevk ve sayım formları da kullanır. */
export function OperationError({error}:{error:ErrorInfo}){const t=useTranslations("receiving.errors"),key=errorKeyOf(error,"create");useSonucSesi({hata:error});return <KalipBildirim tur="hata" title={t(key)}><p>{t(`${key}Action`)}</p></KalipBildirim>;}
type Line={lineNo:number;itemId:string;itemCode:string;itemName:string;unitCode:string;trackingMode:string;quantity:string};
export type RecipeView={id:string;code:string;version:number;name:string;outputItemId:string;outputCode:string;outputName:string;unitCode:string;outputTrackingMode:string;outputQuantity:string;lines:readonly Line[]};
export function NewRecipeForm({slug}:{slug:string}){
 const t=useTranslations("production"),router=useRouter(),key=useKeyHolder(),flight=useRef(false);
 const [pending,start]=useTransition(),[error,setError]=useState<ErrorInfo|null>(null),[uncertain,setUncertain]=useState(false);
 const [code,setCode]=useState(""),[version,setVersion]=useState(1),[name,setName]=useState(""),[output,setOutput]=useState<Choice|null>(null),[quantity,setQuantity]=useState("1");
 const [lines,setLines]=useState<{key:string;item:Choice|null;quantity:string}[]>([{key:"first",item:null,quantity:""}]);
 function changed(){key.contentChanged();setError(null);}
 const dirty=output!==null||lines.length>1||lines.some(l=>l.item!==null);
 return <KalipFormKap><form className="workflow-form kform-ic" data-dirty={dirty?"true":"false"} onSubmit={e=>{e.preventDefault();if(flight.current||!output||lines.some(l=>!l.item))return;flight.current=true;start(async()=>{try{
  const result=await submitWithKey(key,clientKey=>createRecipeAction({slug,clientKey,code,version,name,outputItemId:output.id,outputQuantity:quantity,lines:lines.map(l=>({itemId:l.item!.id,quantity:l.quantity}))}));
  if(result.ok){router.push(`/t/${encodeURIComponent(slug)}/production?id=${result.data.recipeId}`);router.refresh();}else{setError(result.error);setUncertain(["NETWORK","INTERNAL"].includes(result.error.code));}
 }catch{setError({code:"NETWORK"});}finally{flight.current=false;}});}}>
  <small className="khint">{t("recipeHelp")}</small><fieldset disabled={pending||uncertain} className="kform-alan" onChange={changed}>
   <KalipGrup title={`1. ${t("name")}`} d={LICON.pencil} color="30475A"><KalipAlan label={t("code")} name="code" required maxLength={64} value={code} onChange={e=>setCode(e.target.value)}/>
   <KalipAlan label={t("version")} name="version" required type="number" min="1" max="2147483647" value={version} onChange={e=>setVersion(Number(e.target.value))}/>
   <KalipAlan label={t("name")} name="name" required maxLength={200} value={name} onChange={e=>setName(e.target.value)}/>
   </KalipGrup><KalipGrup title={`2. ${t("output")}`} sub={output ? `${output.code} — ${output.name}` : undefined} d={LICON.uret} color="2F5DA8"><StockPicker slug={slug} kind="item" label={t("output")} value={output} onChange={value=>{changed();setOutput(value);}}/>
   <KalipAlan label={output?.unitCode ? `${t("outputQuantity")} · ${output.unitCode}` : t("outputQuantity")} name="outputQuantity" required inputMode="decimal" maxLength={32} value={quantity} onChange={e=>setQuantity(e.target.value)}/>
   </KalipGrup><KalipGrup title={`3. ${t("material")}`} sub={String(lines.length)} d={LICON.box} color="0E7C7B">{lines.map((line,index)=><KalipSatirKart key={line.key} title={`${t("material")} ${index+1}`} remove={{label:`${t("remove")}: ${t("material")} ${index+1}`,disabled:lines.length===1,onClick:()=>{changed();setLines(old=>old.filter(l=>l.key!==line.key));}}}>
    <StockPicker slug={slug} kind="item" label={`${t("material")} ${index+1}`} value={line.item} onChange={value=>{changed();setLines(old=>old.map(l=>l.key===line.key?{...l,item:value}:l));}}/>
    <KalipAlan label={line.item?.unitCode ? `${t("consumption")} · ${line.item.unitCode}` : t("consumption")} name={`consumption-${index}`} required inputMode="decimal" maxLength={32} value={line.quantity} onChange={e=>setLines(old=>old.map(l=>l.key===line.key?{...l,quantity:e.target.value}:l))}/>
   </KalipSatirKart>)}
   <KalipDugme d={LICON.plus} disabled={lines.length>=100} onClick={()=>{changed();setLines(old=>[...old,{key:crypto.randomUUID(),item:null,quantity:""}]);}}>{t("add")}</KalipDugme>
  </KalipGrup></fieldset>{error&&<OperationError error={error}/>}{uncertain&&<KalipBildirim tur="uyari" title={t("uncertain")}/>}
  <KalipDugme tur="ana" type="submit" className="workflow-primary" d={LICON.check} busy={pending} disabled={pending||!output||lines.some(l=>!l.item)}>{t(uncertain?"retry":"save")}</KalipDugme>
 </form></KalipFormKap>;
}
type Source={warehouse:Choice|null;location:Choice|null;lot:Choice|null;serial:Choice|null};
const blank=():Source=>({warehouse:null,location:null,lot:null,serial:null});
export function ProductionForm({slug,recipe}:{slug:string;recipe:RecipeView}){
 const t=useTranslations("production"),router=useRouter(),key=useKeyHolder(),flight=useRef(false);
 const [pending,start]=useTransition(),[error,setError]=useState<ErrorInfo|null>(null),[uncertain,setUncertain]=useState(false);
 const [sources,setSources]=useState<Record<number,Source>>({}),[target,setTarget]=useState<Source>(blank),[quantity,setQuantity]=useState(recipe.outputQuantity),[reason,setReason]=useState("");
 const [preview,setPreview]=useState<readonly {lineNo:number;quantity:string}[]|null>(null);
 function changed(){key.contentChanged();setPreview(null);setError(null);}
 function pickers(value:Source,update:(s:Source)=>void,itemId:string,tracking:string,label:string){
  const pick=(kind:keyof Source,choice:Choice|null)=>{changed();update({...value,[kind]:choice,...(kind === "warehouse"?{location:null}:{})});};
  return <KalipSatirKart title={label}>
   <StockPicker slug={slug} label={`${label}: ${t("warehouse")}`} kind="warehouse" value={value.warehouse} onChange={v=>pick("warehouse",v)}/>
   {value.warehouse&&<StockPicker slug={slug} warehouseId={value.warehouse.id} label={`${label}: ${t("location")}`} kind="location" value={value.location} onChange={v=>pick("location",v)}/>}
   {(tracking === "LOT"||tracking === "LOT_AND_SERIAL")&&<StockPicker slug={slug} itemId={itemId} label={`${label}: ${t("lot")}`} kind="lot" value={value.lot} onChange={v=>pick("lot",v)}/>}
   {(tracking === "SERIAL"||tracking === "LOT_AND_SERIAL")&&<StockPicker slug={slug} itemId={itemId} label={`${label}: ${t("serial")}`} kind="serial" value={value.serial} onChange={v=>pick("serial",v)}/>}
  </KalipSatirKart>;
 }
 function valid(value:Source,tracking:string){return value.location&&(tracking!=="LOT"&&tracking!=="LOT_AND_SERIAL"||value.lot)&&(tracking!=="SERIAL"&&tracking!=="LOT_AND_SERIAL"||value.serial);}
 const ready=valid(target,recipe.outputTrackingMode)&&recipe.lines.every(l=>valid(sources[l.lineNo]??blank(),l.trackingMode));
 const dirty=Object.keys(sources).length>0||target.warehouse!==null;
 return <KalipFormKap><form className="workflow-form kform-ic" data-dirty={dirty?"true":"false"} onSubmit={e=>{e.preventDefault();if(flight.current||!ready)return;flight.current=true;start(async()=>{try{
  if(!preview){const result=await previewProductionAction({slug,recipeId:recipe.id,outputQuantity:quantity});if(result.ok){setPreview(result.data);setError(null);}else setError(result.error);return;}
  const result=await submitWithKey(key,clientKey=>produceAction({slug,clientKey,recipeId:recipe.id,outputQuantity:quantity,reason,targetLocationId:target.location!.id,
   ...(target.lot?{outputLotId:target.lot.id}:{}),...(target.serial?{outputSerialId:target.serial.id}:{}),
   sources:recipe.lines.map(l=>{const source=sources[l.lineNo]!;return {lineNo:l.lineNo,locationId:source.location!.id,...(source.lot?{lotId:source.lot.id}:{}),...(source.serial?{serialId:source.serial.id}:{})};})}));
  if(result.ok){router.push(`/t/${encodeURIComponent(slug)}/stock/documents?id=${result.data.documentId}`);router.refresh();}else{setError(result.error);setUncertain(["NETWORK","INTERNAL"].includes(result.error.code));}
 }catch{setError({code:"NETWORK"});}finally{flight.current=false;}});}}>
  <small className="khint">{t("postHelp")}</small><fieldset disabled={pending||preview!==null||uncertain} className="kform-alan">
   <KalipGrup title={`1. ${t("k.groupQty")}`} d={LICON.uret} color="30475A"><KalipAlan label={`${t("outputQuantity")} (${recipe.unitCode})`} name="outputQuantity" required inputMode="decimal" maxLength={32} value={quantity} onChange={e=>{changed();setQuantity(e.target.value);}}/>
   </KalipGrup><KalipGrup title={`2. ${t("material")}`} sub={String(recipe.lines.length)} d={LICON.box} color="0E7C7B">{recipe.lines.map(line=><div key={line.lineNo} className="kgovde">{pickers(sources[line.lineNo]??blank(),v=>setSources(old=>({...old,[line.lineNo]:v})),line.itemId,line.trackingMode,line.itemName)}</div>)}
   </KalipGrup><KalipGrup title={`3. ${t("output")}`} sub={recipe.outputName} d={LICON.depo} color="2F5DA8">{pickers(target,setTarget,recipe.outputItemId,recipe.outputTrackingMode,`${t("output")}: ${recipe.outputName}`)}
   <KalipAlan label={t("reason")} name="reason" required maxLength={500} value={reason} onChange={e=>{changed();setReason(e.target.value);}}/>
  </KalipGrup></fieldset>
  {preview&&<KalipGrup title={t("review")} d={LICON.check} color="2F7D5B"><ul className="kozet">{preview.map(p=>{const line=recipe.lines.find(l=>l.lineNo===p.lineNo)!;return <li key={p.lineNo}>{line.itemName}: −{p.quantity} {line.unitCode} · {sources[p.lineNo]?.warehouse?.name} / {sources[p.lineNo]?.location?.code}</li>;})}
   <li>{recipe.outputName}: +{quantity} {recipe.unitCode} · {target.warehouse?.name} / {target.location?.code}</li><li>{reason}</li></ul>
   {!uncertain&&<KalipDugme d={LICON.pencil} disabled={pending} onClick={()=>setPreview(null)}>{t("edit")}</KalipDugme>}
  </KalipGrup>}{error&&<OperationError error={error}/>}{uncertain&&<KalipBildirim tur="uyari" title={t("uncertain")}/>}
  <KalipDugme tur="ana" type="submit" className="workflow-primary" d={preview?LICON.uret:LICON.check} busy={pending} disabled={pending||!ready}>{t(uncertain?"retry":preview?"post":"review")}</KalipDugme>
 </form></KalipFormKap>;
}
