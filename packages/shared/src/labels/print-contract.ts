// Browser-safe wire types only. Source facts, permission checks and rendering are server-owned.
import type{LabelContext}from'./model.ts';
import type{PrinterResolution}from'./printers.ts';
type LabelPage={readonly after?:string;readonly ids?:readonly string[]};
export type LabelSourceRequest=
 |{readonly kind:'PRODUCT';readonly ids:readonly string[]}
 |({readonly kind:'LOCATION';readonly warehouseId:string;readonly locationId?:string;readonly subtree?:boolean}&LabelPage)
 |({readonly kind:'RECEIPT'|'PRODUCTION'|'SHIPMENT';readonly documentId:string}&LabelPage);
export interface LabelPrintPreview{readonly templateId:string;readonly versionId:string;readonly name:string;readonly context:LabelContext;readonly width:number;readonly height:number;readonly pages:readonly string[];readonly next:string|null;readonly printer:PrinterResolution}
export interface LabelPrepared extends LabelPrintPreview{readonly jobId:string;readonly copies:number;readonly replayed:boolean;readonly reprintOf:string|null;readonly source:LabelSourceRequest}
