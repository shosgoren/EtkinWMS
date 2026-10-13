"use client";
import { useRef,useState,useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FormSection, FormSteps } from "../screen-shell.tsx";
import { Banner } from "@wms/ui";
import { Typeahead } from "../easy-setup/typeahead.tsx";
import { stockChoicesAction } from "../stock/documents/actions.ts";
import { control } from "../stock/documents/document-form.tsx";
import { errorKeyOf,submitWithKey,useKeyHolder,type ErrorInfo } from "../receipts/receipt-form.tsx";
import { createRecipeAction,previewProductionAction,produceAction } from "./actions.ts";
export type Choice={id:string;code:string;name:string;unitCode:string|null;trackingMode:string|null};
export function StockPicker({slug,label,kind,warehouseId,itemId,onChange}:{slug:string;label:string;kind:"item"|"warehouse"|"location"|"lot"|"serial";warehouseId?:string;itemId?:string;onChange:(choice:Choice|null)=>void}) {
 const [error,setError]=useState<ErrorInfo|null>(null);
 return <><Typeahead<Choice> label={label} listLabel={label} onQueryChange={()=>onChange(null)} onSelect={onChange} toSuggestion={c=>({key:c.id,primary:c.code,secondary:c.name})} search={async(q)=>{
  const result=await stockChoicesAction({slug,kind,q,...(warehouseId?{warehouseId}:{}),...(itemId?{itemId}:{})});
  if(!result.ok){setError(result.error);throw new Error("search failed");}setError(null);return result.data;
 }}/>{error&&<OperationError error={error}/>}</>;
}
export function OperationError({error}:{error:ErrorInfo}){const t=useTranslations("receiving.errors"),key=errorKeyOf(error,"create");return <Banner kind="warning"><p>{t(key)}</p><p>{t(`${key}Action`)}</p></Banner>;}
type Line={lineNo:number;itemId:string;itemCode:string;itemName:string;unitCode:string;trackingMode:string;quantity:string};
export type RecipeView={id:string;code:string;version:number;name:string;outputItemId:string;outputCode:string;outputName:string;unitCode:string;outputTrackingMode:string;outputQuantity:string;lines:readonly Line[]};
export function NewRecipeForm({slug}:{slug:string}){
 const t=useTranslations("production"),router=useRouter(),key=useKeyHolder(),flight=useRef(false);
 const [pending,start]=useTransition(),[error,setError]=useState<ErrorInfo|null>(null),[uncertain,setUncertain]=useState(false);
 const [code,setCode]=useState(""),[version,setVersion]=useState(1),[name,setName]=useState(""),[output,setOutput]=useState<Choice|null>(null),[quantity,setQuantity]=useState("1");
 const [lines,setLines]=useState<{key:string;item:Choice|null;quantity:string}[]>([{key:"first",item:null,quantity:""}]);
 function changed(){key.contentChanged();setError(null);}
 return <form className="workflow-form flex flex-col gap-4" onSubmit={e=>{e.preventDefault();if(flight.current||!output||lines.some(l=>!l.item))return;flight.current=true;start(async()=>{try{
  const result=await submitWithKey(key,clientKey=>createRecipeAction({slug,clientKey,code,version,name,outputItemId:output.id,outputQuantity:quantity,lines:lines.map(l=>({itemId:l.item!.id,quantity:l.quantity}))}));
  if(result.ok){router.push(`/t/${encodeURIComponent(slug)}/production?id=${result.data.recipeId}`);router.refresh();}else{setError(result.error);setUncertain(["NETWORK","INTERNAL"].includes(result.error.code));}
 }catch{setError({code:"NETWORK"});}finally{flight.current=false;}});}}>
  <p>{t("recipeHelp")}</p><FormSteps labels={[t("name"),t("output"),t("material")]}/><fieldset disabled={pending||uncertain} className="flex min-w-0 flex-col gap-4" onChange={changed}>
   <FormSection title={t("name")}><label>{t("code")}<input required maxLength={64} className={`${control} block w-full`} value={code} onChange={e=>setCode(e.target.value)}/></label>
   <label>{t("version")}<input required type="number" min="1" max="2147483647" className={`${control} block w-full`} value={version} onChange={e=>setVersion(Number(e.target.value))}/></label>
   <label>{t("name")}<input required maxLength={200} className={`${control} block w-full`} value={name} onChange={e=>setName(e.target.value)}/></label>
   </FormSection><FormSection title={t("output")}><StockPicker slug={slug} kind="item" label={t("output")} onChange={value=>{changed();setOutput(value);}}/>
   <label>{t("outputQuantity")} {output?.unitCode}<input required inputMode="decimal" maxLength={32} className={`${control} block w-full`} value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
   </FormSection><FormSection title={t("material")}>{lines.map((line,index)=><section key={line.key} className="flex min-w-0 flex-col gap-2 rounded-card border-2 border-border p-3">
    <StockPicker slug={slug} kind="item" label={`${t("material")} ${index+1}`} onChange={value=>{changed();setLines(old=>old.map(l=>l.key===line.key?{...l,item:value}:l));}}/>
    <label>{t("consumption")} {line.item?.unitCode}<input required inputMode="decimal" maxLength={32} className={`${control} block w-full`} value={line.quantity} onChange={e=>setLines(old=>old.map(l=>l.key===line.key?{...l,quantity:e.target.value}:l))}/></label>
    <button type="button" className={control} disabled={lines.length===1} onClick={()=>{changed();setLines(old=>old.filter(l=>l.key!==line.key));}}>{t("remove")}</button>
   </section>)}
   <button type="button" className={control} disabled={lines.length>=100} onClick={()=>{changed();setLines(old=>[...old,{key:crypto.randomUUID(),item:null,quantity:""}]);}}>{t("add")}</button>
  </FormSection></fieldset>{error&&<OperationError error={error}/>}{uncertain&&<p>{t("uncertain")}</p>}
  <button className={`workflow-primary ${control} bg-accent text-on-accent`} disabled={pending||!output||lines.some(l=>!l.item)}>{t(uncertain?"retry":"save")}</button>
 </form>;
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
  return <section className="flex min-w-0 flex-col gap-3 rounded-card border-2 border-border p-3"><h3 className="font-bold">{label}</h3>
   <StockPicker slug={slug} label={`${label}: ${t("warehouse")}`} kind="warehouse" onChange={v=>pick("warehouse",v)}/>
   {value.warehouse&&<StockPicker key={value.warehouse.id} slug={slug} warehouseId={value.warehouse.id} label={`${label}: ${t("location")}`} kind="location" onChange={v=>pick("location",v)}/>}
   {(tracking === "LOT"||tracking === "LOT_AND_SERIAL")&&<StockPicker slug={slug} itemId={itemId} label={`${label}: ${t("lot")}`} kind="lot" onChange={v=>pick("lot",v)}/>}
   {(tracking === "SERIAL"||tracking === "LOT_AND_SERIAL")&&<StockPicker slug={slug} itemId={itemId} label={`${label}: ${t("serial")}`} kind="serial" onChange={v=>pick("serial",v)}/>}
  </section>;
 }
 function valid(value:Source,tracking:string){return value.location&&(tracking!=="LOT"&&tracking!=="LOT_AND_SERIAL"||value.lot)&&(tracking!=="SERIAL"&&tracking!=="LOT_AND_SERIAL"||value.serial);}
 const ready=valid(target,recipe.outputTrackingMode)&&recipe.lines.every(l=>valid(sources[l.lineNo]??blank(),l.trackingMode));
 return <form className="workflow-form flex min-w-0 flex-col gap-4" onSubmit={e=>{e.preventDefault();if(flight.current||!ready)return;flight.current=true;start(async()=>{try{
  if(!preview){const result=await previewProductionAction({slug,recipeId:recipe.id,outputQuantity:quantity});if(result.ok){setPreview(result.data);setError(null);}else setError(result.error);return;}
  const result=await submitWithKey(key,clientKey=>produceAction({slug,clientKey,recipeId:recipe.id,outputQuantity:quantity,reason,targetLocationId:target.location!.id,
   ...(target.lot?{outputLotId:target.lot.id}:{}),...(target.serial?{outputSerialId:target.serial.id}:{}),
   sources:recipe.lines.map(l=>{const source=sources[l.lineNo]!;return {lineNo:l.lineNo,locationId:source.location!.id,...(source.lot?{lotId:source.lot.id}:{}),...(source.serial?{serialId:source.serial.id}:{})};})}));
  if(result.ok){router.push(`/t/${encodeURIComponent(slug)}/stock/documents?id=${result.data.documentId}`);router.refresh();}else{setError(result.error);setUncertain(["NETWORK","INTERNAL"].includes(result.error.code));}
 }catch{setError({code:"NETWORK"});}finally{flight.current=false;}});}}>
  <p>{t("postHelp")}</p><FormSteps labels={[t("outputQuantity"),t("material"),t("output")]}/><fieldset disabled={pending||preview!==null||uncertain} className="flex min-w-0 flex-col gap-4">
   <FormSection title={t("outputQuantity")}><label>{t("outputQuantity")} ({recipe.unitCode})<input required inputMode="decimal" maxLength={32} value={quantity} className={`${control} block w-full`} onChange={e=>{changed();setQuantity(e.target.value);}}/></label>
   </FormSection><FormSection title={t("material")}>{recipe.lines.map(line=><div key={line.lineNo}>{pickers(sources[line.lineNo]??blank(),v=>setSources(old=>({...old,[line.lineNo]:v})),line.itemId,line.trackingMode,line.itemName)}</div>)}
   </FormSection><FormSection title={t("output")}>{pickers(target,setTarget,recipe.outputItemId,recipe.outputTrackingMode,`${t("output")}: ${recipe.outputName}`)}
   <label>{t("reason")}<input required maxLength={500} value={reason} className={`${control} block w-full`} onChange={e=>{changed();setReason(e.target.value);}}/></label>
  </FormSection></fieldset>
  {preview&&<section aria-label={t("review")} className="rounded-card border-2 border-border p-4"><h2 className="font-bold">{t("review")}</h2>
   <ul>{preview.map(p=>{const line=recipe.lines.find(l=>l.lineNo===p.lineNo)!;return <li key={p.lineNo}>{line.itemName}: −{p.quantity} {line.unitCode} · {sources[p.lineNo]?.warehouse?.name} / {sources[p.lineNo]?.location?.code}</li>;})}</ul>
   <p>{recipe.outputName}: +{quantity} {recipe.unitCode} · {target.warehouse?.name} / {target.location?.code}</p><p>{reason}</p>
   {!uncertain&&<button type="button" className={control} disabled={pending} onClick={()=>setPreview(null)}>{t("edit")}</button>}
  </section>}{error&&<OperationError error={error}/>}{uncertain&&<p>{t("uncertain")}</p>}
  <button className={`workflow-primary ${control} bg-accent text-on-accent`} disabled={pending||!ready}>{t(uncertain?"retry":preview?"post":"review")}</button>
 </form>;
}
