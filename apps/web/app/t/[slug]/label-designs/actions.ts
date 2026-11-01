"use server";
// Thin tenant/action boundary. The browser never supplies an actor, tenant UUID, audit record, printer endpoint or print snapshot.
import{headers}from"next/headers";
import{z}from"zod";
import{getAppDb}from"@wms/db";
import{AppError}from"@wms/shared/errors";
import{LABEL_CONTEXTS}from"@wms/shared/labels";
import type{Permission}from"@wms/domain/identity/permissions";
import{getLabelWorkspace,getLabelTemplate,saveLabelTemplate,publishLabelTemplate,assignLabelDefault,archiveLabelTemplate,restoreLabelDraft,uploadLabelLogo,readLabelLogo,saveLabelPrinter,setLabelPrinterPreference,exportLabelDesigns}from"@wms/domain/labels/store";
import{ensureRecentAuth}from"../../../../lib/auth-service.ts";
import{createProductionGuard,limitVerifiedTenant,type ActionContext}from"../../../../lib/action-guard.ts";
const guard=createProductionGuard(()=>headers()),slug=z.string().min(1).max(63),id=z.string().uuid(),version=z.number().int().min(0).max(2147483646);
const workspace=z.object({slug,context:z.enum(LABEL_CONTEXTS).optional(),archived:z.boolean().optional(),after:id.optional(),deviceId:id.optional(),q:z.string().max(80).optional()}).strict();
const identity=z.object({slug,id}).strict();
const save=z.object({slug,id:id.optional(),expectedVersion:version,name:z.string().trim().min(1).max(80),design:z.unknown()}).strict();
const publish=z.object({slug,id,expectedVersion:version.min(1),expectedDefaultVersion:version.optional()}).strict();
const assign=z.object({slug,id,expectedDefaultVersion:version}).strict();
const archive=z.object({slug,id,expectedVersion:version.min(1),archived:z.boolean()}).strict();
const restore=z.object({slug,id,expectedVersion:version.min(1),versionId:id}).strict();
const logo=z.object({slug,png:z.string().min(80).max(174764).regex(/^[A-Za-z0-9+/]+={0,2}$/)}).strict();
const printer=z.object({slug,id:id.optional(),expectedVersion:version,name:z.string().trim().min(1).max(80),dpi:z.union([z.literal(203),z.literal(300),z.literal(600)]),offsetX:z.number().int().min(-10000).max(10000),offsetY:z.number().int().min(-10000).max(10000),active:z.boolean()}).strict();
const preference=z.object({slug,templateId:id.nullable(),deviceId:id.nullable(),printerId:id.nullable(),expectedVersion:version}).strict();
async function context(tenantSlug:string,ctx:ActionContext,permission:Permission){
 if(ctx.principal===null)throw new AppError("UNAUTHENTICATED");
 await limitVerifiedTenant({db:getAppDb(),principal:ctx.principal,tenantSlug,permission},ctx);
 const h=await headers();return{db:getAppDb(),principal:ctx.principal,tenantSlug,requestId:ctx.requestId,recentAuth:()=>ensureRecentAuth(h)};
}
export async function labelWorkspaceAction(raw:unknown){return guard({schema:workspace},async(input,ctx)=>{const{slug,...query}=input;return getLabelWorkspace(await context(slug,ctx,"labels.view"),query);})(raw);}
export async function labelTemplateAction(raw:unknown){return guard({schema:identity},async(input,ctx)=>getLabelTemplate(await context(input.slug,ctx,"labels.view"),input.id))(raw);}
export async function labelSaveAction(raw:unknown){return guard({schema:save},async(input,ctx)=>{const{slug,...body}=input;return saveLabelTemplate(await context(slug,ctx,"labels.design"),body);})(raw);}
export async function labelPublishAction(raw:unknown){return guard({schema:publish},async(input,ctx)=>{const{slug,...body}=input;return publishLabelTemplate(await context(slug,ctx,"labels.publish"),body);})(raw);}
export async function labelAssignAction(raw:unknown){return guard({schema:assign},async(input,ctx)=>{const{slug,...body}=input;return assignLabelDefault(await context(slug,ctx,"labels.publish"),body);})(raw);}
export async function labelArchiveAction(raw:unknown){return guard({schema:archive},async(input,ctx)=>{const{slug,...body}=input;return archiveLabelTemplate(await context(slug,ctx,"labels.publish"),body);})(raw);}
export async function labelRestoreAction(raw:unknown){return guard({schema:restore},async(input,ctx)=>{const{slug,...body}=input;return restoreLabelDraft(await context(slug,ctx,"labels.design"),body);})(raw);}
export async function labelLogoUploadAction(raw:unknown){return guard({schema:logo},async(input,ctx)=>{
 await context(input.slug,ctx,"labels.view");
 const p=await context(input.slug,ctx,"labels.design"),bytes=Buffer.from(input.png,"base64");if(bytes.length>128*1024)throw new AppError("VALIDATION_FAILED");
 const result=await uploadLabelLogo(p,bytes);return{...result,uri:`data:image/png;base64,${(await readLabelLogo(p,result.id)).toString("base64")}`};
})(raw);}
export async function labelLogoReadAction(raw:unknown){return guard({schema:identity},async(input,ctx)=>({uri:`data:image/png;base64,${(await readLabelLogo(await context(input.slug,ctx,"labels.view"),input.id)).toString("base64")}`}))(raw);}
export async function labelPrinterSaveAction(raw:unknown){return guard({schema:printer},async(input,ctx)=>{const{slug,...body}=input;return saveLabelPrinter(await context(slug,ctx,"labels.printers"),body);})(raw);}
export async function labelPreferenceAction(raw:unknown){return guard({schema:preference},async(input,ctx)=>{const{slug,...body}=input;return setLabelPrinterPreference(await context(slug,ctx,"labels.printers"),body);})(raw);}
export async function labelExportAction(raw:unknown){return guard({schema:z.object({slug,kind:z.enum(["TEMPLATES","VERSIONS","ASSETS"]),after:id.optional()}).strict()},async(input,ctx)=>{const{slug,...body}=input;return exportLabelDesigns(await context(slug,ctx,"labels.view"),body);})(raw);}
