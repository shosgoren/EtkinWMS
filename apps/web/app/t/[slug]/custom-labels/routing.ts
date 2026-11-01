// Server route selection only. Missing designer/print permission preserves the existing stock.view label route.
import{AppError}from'@wms/shared/errors';
import type{LabelSourceRequest}from'@wms/shared/labels';
import{getLabelPrintChoices}from'@wms/domain/labels/print';
export async function customLabelHref(p:Parameters<typeof getLabelPrintChoices>[0],source:LabelSourceRequest,options:{readonly copies?:number;readonly batchNext?:string}={}){
 const context=source.kind==='PRODUCTION'?'RECEIPT':source.kind;try{
  if(!(await getLabelPrintChoices(p,context)).some(c=>c.isDefault))return null;
  return `/t/${encodeURIComponent(p.tenantSlug)}/custom-labels?`+new URLSearchParams({source:JSON.stringify(source),...(options.copies===undefined?{}:{copies:String(options.copies)}),...(options.batchNext?{batchNext:options.batchNext}:{})});
 }catch(e){if(e instanceof AppError&&e.code==='FORBIDDEN')return null;throw e;}
}
