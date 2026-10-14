"use client";
import { useCallback,useEffect,useRef,useState,useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FormSection, FormSteps } from "../screen-shell.tsx";
import { Banner, Boxes, CircleCheck, Package, ScanLine, Warehouse } from "@wms/ui";
import { Typeahead } from "../easy-setup/typeahead.tsx";
import { stockChoicesAction } from "../stock/documents/actions.ts";
import { control } from "../stock/documents/document-form.tsx";
import { errorKeyOf,submitWithKey,useKeyHolder,type ErrorInfo } from "../receipts/receipt-form.tsx";
import { createRecipeAction,previewProductionAction,produceAction,previewPackageProductionAction,preparePackageProductionAction,postPackageProductionAction,getPackageProductionBatchAction } from "./actions.ts";
import { PrimaryButton,PrimaryLink,SecondaryButton,ScanPanel,useScanner,useScanPrimary,FlowShell } from "../field/receive/receive-flow.tsx";
import { resolveCurrentPackageQrAction,getCurrentPackageAction,type CurrentPackageDto } from "../field/packages/actions.ts";
import type { ActionResult } from "../receipts/receipt-form.tsx";
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

type Successful<T> = T extends {readonly ok:true;readonly data:infer D}?D:never;
export type PackageBatchView=Successful<Awaited<ReturnType<typeof getPackageProductionBatchAction>>>;
type PackagePreviewView=Successful<Awaited<ReturnType<typeof previewPackageProductionAction>>>;
type OutputEntry={quantity:string;lotCode?:string;producedOn?:string;expiresOn?:string};
type PackageProductionPayload={slug:string;recipeId:string;recipeVersion:number;outputQuantity:string;targetLocationId:string;
 inputs:{packageId:string;predecessorVersion:number;currentBalanceVersion:string;baseQuantity:string}[];
 outputs:{kind:"KOLI"|"VARIL";packages:({mode:"equal";count:number}&OutputEntry)|{mode:"explicit";packages:OutputEntry[]}}};
const packageControl="min-h-12 w-full min-w-0 rounded-control border-2 border-border-strong bg-surface px-3 text-base text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus";
const packageCard="min-w-0 rounded-card border-2 border-border bg-surface p-4";
function micro(raw:string):bigint|null {const s=raw.replace(",",".");if(!/^\d+(?:\.\d{1,6})?$/.test(s)||s.length>32)return null;const [w="0",f=""]=s.split(".");return BigInt(w)*1_000_000n+BigInt(f.padEnd(6,"0"));}
function decimal(value:bigint):string {const w=value/1_000_000n,f=(value%1_000_000n).toString().padStart(6,"0").replace(/0+$/,"");return `${w}${f?`.${f}`:""}`;}
const shown=(raw:string)=>raw.replace(/\.0+$/,"").replace(".",",");
const canonical=(raw:string)=>raw.replace(",",".");
function equalAmount(raw:string,count:string):string {const q=micro(raw),n=/^[1-9]\d{0,2}$/.test(count)?Number(count):0;return q!==null&&n>0&&n<=200&&q%BigInt(n)===0n?decimal(q/BigInt(n)):"";}

// Prepare and post are separate durable commands. A successful post is never sent again after a failed read.
export function createPackageProductionSubmission(initial:PackageBatchView|null){
 let doc=initial?.documentId??null,batch=initial,prepareKey:string|null=null,postKey:string|null=null;
 let payload:PackageProductionPayload|null=null,pending=false,unknownPrepare=false,posted=initial?.documentStatus==="POSTED";
 const unwrap=<T,>(r:ActionResult<T>):T=>{if(!r.ok)throw r.error;return r.data;};
 return {get frozen(){return payload!==null||doc!==null;},get documentId(){return doc;},get posted(){return posted;},
  async run(input:PackageProductionPayload|null,slug:string,prepared:(id:string)=>void):Promise<PackageBatchView>{
   if(pending)throw {code:"BUSY"};pending=true;
   try{
    if(doc===null){
     if(payload===null){if(input===null)throw {code:"VALIDATION_FAILED"};payload=structuredClone(input);}
     prepareKey??=crypto.randomUUID();let r;
     try{r=await preparePackageProductionAction({...payload,clientKey:prepareKey});}catch(e){unknownPrepare=true;throw e;}
     if(!r.ok){if(!unknownPrepare&&(r.error.code==="VALIDATION_FAILED"||r.error.code==="FORBIDDEN")){payload=null;prepareKey=null;}else unknownPrepare=true;throw r.error;}
     if(!r.data.documentId||r.data.status!=="APPROVED")throw {code:"INTERNAL"};doc=r.data.documentId;prepared(doc);
    }
    batch??=unwrap(await getPackageProductionBatchAction({slug,documentId:doc}));
    if(batch.documentStatus==="POSTED"){posted=true;return batch;}
    if(!posted){
     postKey??=crypto.randomUUID();const committed=unwrap(await postPackageProductionAction({slug,documentId:doc,expectedVersion:batch.documentVersion,clientKey:postKey}));
     if(committed.status!=="POSTED"||committed.documentId!==doc)throw {code:"INTERNAL"};posted=true;batch=null;
    }
    batch=unwrap(await getPackageProductionBatchAction({slug,documentId:doc}));
    if(batch.documentStatus!=="POSTED")throw {code:"INTERNAL"};return batch;
   }finally{pending=false;}
  }};
}

export function PackageProductionForm({slug,recipe,initial,initialTarget}:{slug:string;recipe:RecipeView;initial:PackageBatchView|null;initialTarget?:{warehouse:Choice;location:Choice}|null}){
 const t=useTranslations("packageProduction"),[ready,setReady]=useState(false);
 useEffect(()=>setReady(true),[]);
 const flowRoot=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const keepFocusedField=()=>{const field=document.activeElement;if(field instanceof HTMLElement&&/^(INPUT|SELECT|TEXTAREA)$/.test(field.tagName)&&flowRoot.current?.contains(field))field.scrollIntoView({block:"center"});};
  window.addEventListener("resize",keepFocusedField);window.visualViewport?.addEventListener("resize",keepFocusedField);
  return()=>{window.removeEventListener("resize",keepFocusedField);window.visualViewport?.removeEventListener("resize",keepFocusedField);};
 },[]);
 const controller=useRef<ReturnType<typeof createPackageProductionSubmission>|null>(null);controller.current??=createPackageProductionSubmission(initial);
 const [stage,setStage]=useState(initial?.documentStatus==="POSTED"?5:initial?4:1),[busy,setBusy]=useState(false),[error,setError]=useState<ErrorInfo|null>(null),[localError,setLocalError]=useState<string|null>(null);
 const [qty,setQty]=useState(initial?.outputQuantity??recipe.outputQuantity),[needs,setNeeds]=useState<readonly{lineNo:number;quantity:string}[]>([]);
 const [inputs,setInputs]=useState<{value:CurrentPackageDto;consume:string}[]>([]);
 const [targetWarehouse,setTargetWarehouse]=useState<Choice|null>(initialTarget?.warehouse??null),[targetLocation,setTargetLocation]=useState<Choice|null>(initialTarget?.location??null),[changeTarget,setChangeTarget]=useState(false);
 const [count,setCount]=useState("1"),[each,setEach]=useState(recipe.outputQuantity),[different,setDifferent]=useState(false),[rows,setRows]=useState<OutputEntry[]>([{quantity:recipe.outputQuantity}]);
 const [kind,setKind]=useState<"KOLI"|"VARIL">("KOLI"),[lot,setLot]=useState(""),[produced,setProduced]=useState(""),[expiry,setExpiry]=useState("");
 const [preview,setPreview]=useState<PackagePreviewView|null>(null),[batch,setBatch]=useState(initial),[last,setLast]=useState("");
 const flight=useRef(false),blocked=useCallback(()=>flight.current||controller.current?.frozen===true,[]);
 const locked=controller.current.frozen,base=`/t/${encodeURIComponent(slug)}/production`;
 const report=(e:unknown)=>setError(typeof e==="object"&&e!==null&&"code" in e?e as ErrorInfo:{code:"NETWORK"});
 const metadata=(q:string,l=lot,p=produced,x=expiry):OutputEntry=>({quantity:canonical(q),...(l.trim()?{lotCode:l.trim()}:{}),...(p?{producedOn:p}:{}),...(x?{expiresOn:x}:{})});
 const outputRows=different?rows.map(r=>metadata(r.quantity,r.lotCode??lot,r.producedOn??produced,r.expiresOn??expiry)):Array.from({length:/^[1-9]\d{0,2}$/.test(count)&&Number(count)<=200?Number(count):0},()=>metadata(each));
 const total=outputRows.reduce<bigint|null>((a,r)=>{const q=micro(r.quantity);return a===null||q===null?null:a+q;},0n);
 const outputReady=total!==null&&total===micro(qty)&&outputRows.length>0&&outputRows.every(r=>(micro(r.quantity)??0n)>0n&&(recipe.outputTrackingMode!=="LOT"||!!r.lotCode));
 const neededForItem=(itemId:string)=>{const n=recipe.lines.find(l=>l.itemId===itemId)?.lineNo;return needs.find(r=>r.lineNo===n)?.quantity??null;};
 const allocated=(itemId:string)=>inputs.filter(i=>i.value.itemId===itemId).reduce<bigint|null>((a,i)=>{const q=micro(i.consume);return a===null||q===null?null:a+q;},0n);
 const allInputs=inputs.length>0&&inputs.every(i=>i.value.currentStockStatus==="AVAILABLE"&&i.value.currentBalanceVersion!==null&&(micro(i.consume)??0n)>0n&&(micro(i.consume)??0n)<=(micro(i.value.remainingBaseQuantity)??0n))&&recipe.lines.every(l=>{const need=neededForItem(l.itemId),q=need===null?null:micro(need);return q!==null&&allocated(l.itemId)===q;});
 const payload=():PackageProductionPayload|null=>targetLocation&&inputs.every(i=>i.value.currentBalanceVersion!==null)?{slug,recipeId:recipe.id,recipeVersion:recipe.version,outputQuantity:canonical(qty),targetLocationId:targetLocation.id,
  inputs:inputs.map(i=>({packageId:i.value.id,predecessorVersion:i.value.predecessorVersion,currentBalanceVersion:i.value.currentBalanceVersion!,baseQuantity:canonical(i.consume)})),
  outputs:{kind,packages:different?{mode:"explicit",packages:outputRows}:{mode:"equal",count:Number(count),...metadata(each)}}}:null;

 const scan=async(code:string)=>{
  if(!ready||flight.current||locked||stage!==2)return;flight.current=true;setBusy(true);setError(null);setLocalError(null);setLast(code);
  try{
   const r=await resolveCurrentPackageQrAction({slug,qr:code});if(!r.ok)throw r.error;const value=r.data;
   if(inputs.some(i=>i.value.id===value.id)){setLocalError(t("duplicate"));return;}
   if(!recipe.lines.some(l=>l.itemId===value.itemId)){setLocalError(t("wrongItem"));return;}
   if(value.currentStockStatus!=="AVAILABLE"||value.currentBalanceVersion===null||(micro(value.remainingBaseQuantity)??0n)<=0n){setLocalError(t("notAvailable"));return;}
   if(inputs[0]&&inputs[0].value.warehouseId!==value.warehouseId){setLocalError(t("sameWarehouse"));return;}
   const need=neededForItem(value.itemId),used=allocated(value.itemId),remaining=micro(value.remainingBaseQuantity);
   const outstanding=need!==null&&used!==null?(micro(need)??0n)-used:0n;
   if(outstanding<=0n){setLocalError(t("enough"));return;}
   const consume=decimal(remaining!==null&&remaining<outstanding?remaining:outstanding);
   setInputs(old=>[...old,{value,consume}]);
   if(!targetWarehouse){setTargetWarehouse({id:value.warehouseId,code:value.warehouseCode,name:value.warehouseName,unitCode:null,trackingMode:null});
    if(value.currentLocation?.kind==="STORAGE")setTargetLocation({id:value.currentLocation.id,code:value.currentLocation.code,name:value.currentLocation.name,unitCode:null,trackingMode:null});}
  }catch(e){report(e);}finally{flight.current=false;setBusy(false);}
 };
 const {service,camera}=useScanner(v=>void scan(v),ready&&stage===2&&!busy&&!locked,blocked);
 const scanner=useScanPrimary(camera,{busy,name:inputs.find(i=>i.value.qr===last)?.value.itemName,code:last,alerting:error!==null||localError!==null});
 const next=async()=>{
  if(!ready||flight.current||locked)return;flight.current=true;setBusy(true);setError(null);setLocalError(null);
  try{
   if(stage===1){const r=await previewProductionAction({slug,recipeId:recipe.id,outputQuantity:canonical(qty)});if(!r.ok)throw r.error;setNeeds(r.data);setInputs([]);setStage(2);}
   else if(stage===2)setStage(3);
   else if(stage===3){const input=payload();if(!input)return;const r=await previewPackageProductionAction(input);if(!r.ok)throw r.error;setPreview(r.data);setStage(4);}
  }catch(e){report(e);}finally{flight.current=false;setBusy(false);}
 };
 const refreshInputs=async()=>{
  if(flight.current||locked)return;flight.current=true;setBusy(true);setError(null);
  try{const fresh=[];for(const i of inputs){const r=await getCurrentPackageAction({slug,packageId:i.value.id});if(!r.ok)throw r.error;fresh.push({value:r.data,consume:i.consume});}setInputs(fresh);setPreview(null);setStage(2);}
  catch(e){report(e);}finally{flight.current=false;setBusy(false);}
 };
 const complete=async()=>{
  if(!ready||flight.current)return;flight.current=true;setBusy(true);setError(null);setLocalError(null);
  try{
   const value=await controller.current!.run(payload(),slug,id=>{const u=new URL(globalThis.location.href);u.searchParams.set("document",id);u.searchParams.set("id",recipe.id);globalThis.history.replaceState(null,"",u);});
   setBatch(value);setStage(5);
  }catch(e){report(e);}finally{flight.current=false;setBusy(false);}
 };
 const numberOfPackages=/^[1-9]\d{0,2}$/.test(count)&&Number(count)<=200?Number(count):0;
 const labels=batch?.documentStatus==="POSTED"?`/t/${encodeURIComponent(slug)}/receipts/packages/labels?${new URLSearchParams({document:batch.documentId})}`:null;
 const footer=stage===5&&labels?<PrimaryLink href={labels}><Package className="mr-2 size-6" aria-hidden="true"/>{t("labels")}</PrimaryLink>
  :stage===4?<PrimaryButton disabled={!ready||busy} loading={busy} onClick={()=>void complete()}><CircleCheck className="mr-2 size-6" aria-hidden="true"/>{t(controller.current.posted?"reload":locked?"retry":"complete")}</PrimaryButton>
  :stage===2&&!allInputs?<PrimaryButton disabled={!ready||busy||locked} loading={busy} onClick={scanner.press}><ScanLine className="mr-2 size-6" aria-hidden="true"/>{t("scan")}</PrimaryButton>
  :<PrimaryButton disabled={!ready||busy||locked||(stage===1&&(micro(qty)??0n)<=0n)||(stage===3&&(!targetLocation||!outputReady))} loading={busy} onClick={()=>void next()}>{t(stage===1?"toInputs":stage===2?"toOutputs":"review")}</PrimaryButton>;
 return <FlowShell hue="teal" icon={<Boxes className="size-6" aria-hidden="true"/>} title={t(stage===5?"done":"title")} step={stage} total={5}
  {...(locked?{}:stage>1?{onBack:()=>{if(!flight.current){setPreview(null);setError(null);setLocalError(null);setStage(stage-1);}}}:{backHref:base})} footer={footer} scanProxy={stage===2}>
  <div ref={flowRoot} data-testid="package-production-flow" className="grid min-w-0 gap-3 min-[1200px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" onFocusCapture={event=>{const target=event.target;if(target instanceof HTMLElement&&/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName))target.scrollIntoView({block:"center"});}}>
   <section className={`${packageCard} flex flex-col gap-3`}>
    <div className="flex items-center gap-2"><Boxes className="size-8 shrink-0 text-cat-purple-ink" aria-hidden="true"/><h2 className="break-words text-xl font-extrabold">{recipe.outputName}</h2></div>
    <p className="text-sm font-bold text-ink-muted">{recipe.code} · v{recipe.version}</p>
    <FormSteps labels={[t("amount"),t("inputs"),t("outputs"),t("review"),t("labels")]}/>
    {needs.length>0&&<ul className="flex flex-col gap-2">{recipe.lines.map(l=><li key={l.lineNo} className="flex min-w-0 items-center justify-between gap-2 rounded-control bg-cat-purple-bg p-3 text-cat-purple-ink"><span className="break-words font-bold">{l.itemName}</span><span className="shrink-0 font-bold">{shown(needs.find(r=>r.lineNo===l.lineNo)?.quantity??"—")} {l.unitCode}</span></li>)}</ul>}
    {controller.current.posted&&stage!==5&&<p role="status" className="flex items-center gap-2 rounded-control bg-cat-green-bg p-3 font-bold text-cat-green-ink"><CircleCheck className="size-6 shrink-0" aria-hidden="true"/>{t("saved")}</p>}
   </section>
   <section className="flex min-w-0 flex-col gap-3">
    {error&&<OperationError error={error}/>} {localError&&<Banner kind="warning">{localError}</Banner>}
    {stage===1&&<fieldset disabled={!ready||busy||locked} className={`${packageCard} flex min-w-0 flex-col gap-3`}><label className="font-bold">{t("amount")} ({recipe.unitCode})<input maxLength={32} inputMode="decimal" value={qty} className={packageControl} onChange={e=>{setQty(e.target.value);setEach(equalAmount(e.target.value,count));setRows(old=>old.length===1?[{...old[0],quantity:e.target.value}]:old);}}/></label></fieldset>}
    {stage===2&&<><fieldset disabled={!ready||busy||locked} className="min-w-0"><ScanPanel service={ready&&!busy&&!locked?service:null} prompt={t("scan")} last={last} ready={ready&&scanner.ready&&!busy} hue="teal"/></fieldset>
     {inputs.map((i,n)=><fieldset key={i.value.id} disabled={!ready||busy||locked} className={`${packageCard} flex min-w-0 flex-col gap-2`} data-testid="production-input">
      <h3 className="break-words font-extrabold">{i.value.itemName} · {n+1}</h3><p className="text-sm font-bold">{i.value.warehouseName} · {i.value.currentLocation?.code}</p>
      <p>{t("remaining")}: <strong>{shown(i.value.remainingBaseQuantity)} {i.value.baseUnitCode}</strong></p>
      <label className="font-bold">{t("consume")} ({i.value.baseUnitCode})<input maxLength={32} inputMode="decimal" className={packageControl} value={i.consume} onChange={e=>setInputs(old=>old.map(x=>x.value.id===i.value.id?{...x,consume:e.target.value}:x))}/></label>
      <SecondaryButton disabled={!ready||busy||locked} onClick={()=>setInputs(old=>old.filter(x=>x.value.id!==i.value.id))}>{t("remove")}</SecondaryButton>
     </fieldset>)} {error&&inputs.length>0&&!locked&&<SecondaryButton disabled={!ready||busy} onClick={()=>void refreshInputs()}>{t("refreshInputs")}</SecondaryButton>}
    </>}
    {stage===3&&<fieldset disabled={!ready||busy||locked} className={`${packageCard} flex min-w-0 flex-col gap-3`}>
     <h2 className="font-extrabold">{t("outputs")}</h2>
     <p className="flex items-center gap-2 break-words font-bold"><Warehouse className="size-6 shrink-0" aria-hidden="true"/>{targetWarehouse?.name} · {targetLocation?.code}</p>
     <SecondaryButton disabled={!ready||busy||locked} onClick={()=>setChangeTarget(v=>!v)}>{t("changeLocation")}</SecondaryButton>
     {(changeTarget||!targetLocation)&&<><StockPicker slug={slug} kind="warehouse" label={t("warehouse")} onChange={v=>{setTargetWarehouse(v);setTargetLocation(null);}}/>
      {targetWarehouse&&<StockPicker key={targetWarehouse.id} slug={slug} kind="location" warehouseId={targetWarehouse.id} label={t("location")} onChange={setTargetLocation}/>}</>}
     <label className="font-bold">{t("kind")}<select value={kind} className={packageControl} onChange={e=>setKind(e.target.value as "KOLI"|"VARIL")}><option value="KOLI">{t("box")}</option><option value="VARIL">{t("barrel")}</option></select></label>
     <label className="font-bold">{t("count")}<input inputMode="numeric" maxLength={3} value={count} className={packageControl} onChange={e=>{setCount(e.target.value);setEach(equalAmount(qty,e.target.value));if(/^[1-9]\d{0,2}$/.test(e.target.value)&&Number(e.target.value)<=200)setRows(old=>Array.from({length:Number(e.target.value)},(_,n)=>old[n]??{quantity:equalAmount(qty,e.target.value)}));}}/></label>
     <SecondaryButton disabled={!ready||busy||locked||numberOfPackages<1} pressed={different} onClick={()=>{if(!different)setRows(Array.from({length:numberOfPackages},()=>metadata(each)));setDifferent(v=>!v);}}>{t("different")}</SecondaryButton>
     {!different&&<label className="font-bold">{t("each")} ({recipe.unitCode})<input maxLength={32} inputMode="decimal" className={packageControl} value={each} onChange={e=>setEach(e.target.value)}/></label>}
     {recipe.outputTrackingMode==="LOT"&&<label className="font-bold">{t("lot")}<input maxLength={256} className={packageControl} value={lot} onChange={e=>setLot(e.target.value)}/></label>}
     <label className="font-bold">{t("produced")}<input type="date" className={packageControl} value={produced} onChange={e=>setProduced(e.target.value)}/></label>
     <label className="font-bold">{t("expiry")}<input type="date" className={packageControl} value={expiry} onChange={e=>setExpiry(e.target.value)}/></label>
     {different&&rows.map((r,n)=><div key={n} className="flex min-w-0 flex-col gap-2 rounded-control border-2 border-border p-3"><h3 className="font-extrabold">{n+1} · {t("package")}</h3>
      <label className="font-bold">{n+1} {t("each")} ({recipe.unitCode})<input maxLength={32} inputMode="decimal" className={packageControl} value={r.quantity} onChange={e=>setRows(old=>old.map((x,k)=>k===n?{...x,quantity:e.target.value}:x))}/></label>
      {recipe.outputTrackingMode==="LOT"&&<label className="font-bold">{n+1} {t("lot")}<input maxLength={256} className={packageControl} value={r.lotCode??lot} onChange={e=>setRows(old=>old.map((x,k)=>k===n?{...x,lotCode:e.target.value}:x))}/></label>}
      <label className="font-bold">{n+1} {t("produced")}<input type="date" className={packageControl} value={r.producedOn??produced} onChange={e=>setRows(old=>old.map((x,k)=>k===n?{...x,producedOn:e.target.value}:x))}/></label>
      <label className="font-bold">{n+1} {t("expiry")}<input type="date" className={packageControl} value={r.expiresOn??expiry} onChange={e=>setRows(old=>old.map((x,k)=>k===n?{...x,expiresOn:e.target.value}:x))}/></label>
     </div>)}
     <p data-testid="production-output-total" className={`rounded-control p-3 font-bold ${outputReady?"bg-cat-teal-bg text-cat-teal-ink":"bg-warning-bg text-warning-ink"}`}>{numberOfPackages} {t("package")} · {total===null?"—":shown(decimal(total))} / {shown(qty)} {recipe.unitCode}</p>
    </fieldset>}
    {stage===4&&<section className={`${packageCard} flex flex-col gap-3`} data-testid="production-review">
     <h2 className="font-extrabold">{t("review")}</h2>
     {preview?.inputs.map(i=>{const input=inputs.find(x=>x.value.id===i.packageId);const remain=micro(i.remainingBaseQuantity),use=micro(i.consumeBaseQuantity);return <p key={i.packageId} className="break-words font-bold">{input?.value.itemName} · −{shown(i.consumeBaseQuantity)} {input?.value.baseUnitCode} · {t("remaining")}: {remain!==null&&use!==null?shown(decimal(remain-use)):"—"}</p>;})}
     <p className="text-2xl font-extrabold">+{shown(preview?.outputQuantity??batch?.outputQuantity??qty)} {recipe.unitCode}</p>
     {targetWarehouse&&targetLocation&&<p className="break-words font-bold">{targetWarehouse.name} · {targetLocation.code}</p>}
     <p>{preview?.outputs.length??batch?.packages.length??0} {t("package")}</p>
     {!locked&&<SecondaryButton disabled={!ready||busy} onClick={()=>{setPreview(null);setStage(3);}}>{t("edit")}</SecondaryButton>}
    </section>}
    {stage===5&&batch?.documentStatus==="POSTED"&&<section className={`${packageCard} flex flex-col gap-3`} data-testid="production-posted"><CircleCheck className="size-12 text-cat-green-ink" aria-hidden="true"/><h2 className="text-xl font-extrabold text-cat-green-ink">{t("done")}</h2><p>{batch.packages.length} {t("package")} · {shown(batch.outputQuantity)} {recipe.unitCode}</p>
     {batch.packages.map(p=><a key={p.id} className={`${packageControl} flex items-center font-bold`} href={`/t/${encodeURIComponent(slug)}/field/packages?${new URLSearchParams({package:p.id})}`}>{p.packageNo} · {p.itemName} · {shown(p.quantity)} {p.unitCode}</a>)}
    </section>}
   </section>
  </div>{scanner.overlay}
  <style jsx global>{`
   .screen-shell:has([data-testid="package-production-flow"]) [data-testid="screen-home"], .screen-shell:has([data-testid="package-production-flow"]) [data-testid="screen-back"] { min-height:56px; }
   [data-testid="flow-step"]:has([data-testid="package-production-flow"]) > header > button, [data-testid="flow-step"]:has([data-testid="package-production-flow"]) > header > a { min-height:56px; min-width:56px; }
   [data-testid="flow-step"]:has([data-testid="package-production-flow"]) > [role="group"] { bottom: var(--screen-nav-height, 74px); }
   @media (min-width:1200px) { [data-testid="flow-step"]:has([data-testid="package-production-flow"]) > [role="group"] { bottom:0; } }
  `}</style>
 </FlowShell>;
}
