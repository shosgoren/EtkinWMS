// Browser-safe label contract; no database, storage or network imports.
export * from "./model.ts";
export * from "./printers.ts";

import type { LabelContext, LabelDesign } from "./model.ts";
import type { LabelPrinter } from "./printers.ts";
export interface LabelRights { readonly view:boolean; readonly design:boolean; readonly publish:boolean; readonly print:boolean; readonly printers:boolean }
export interface LabelTemplateSummary { readonly id:string; readonly name:string; readonly context:LabelContext; readonly version:number; readonly publishedVersionId:string|null; readonly archived:boolean }
export interface LabelTemplateDetail extends LabelTemplateSummary { readonly draft:LabelDesign; readonly published:LabelDesign|null; readonly revisions:readonly {readonly id:string;readonly revision:number}[] }
export interface LabelPrinterProfile extends LabelPrinter { readonly dpi:203|300|600; readonly offsetX:number; readonly offsetY:number; readonly version:number }
export interface LabelPreference { readonly id:string; readonly templateId:string|null; readonly personal:boolean; readonly printerId:string|null; readonly version:number }
export interface LabelWorkspace { readonly templates:readonly LabelTemplateSummary[]; readonly next:string|null; readonly defaults:readonly {readonly context:LabelContext;readonly templateId:string;readonly versionId:string;readonly version:number}[]; readonly printers:readonly LabelPrinterProfile[]; readonly preferences:readonly LabelPreference[]; readonly assets:readonly {readonly id:string;readonly width:number;readonly height:number}[]; readonly rights:LabelRights }

export * from "./code128.ts";
export * from "./render.ts";

export * from "./ready.ts";
