"use server";
import{headers}from'next/headers';
import{z}from'zod';
import{getAppDb}from'@wms/db';
import{AppError}from'@wms/shared/errors';
import{LabelDesignError}from'@wms/shared/labels';
import{previewCustomLabels,prepareCustomLabels,LabelPrintError}from'@wms/domain/labels/print';
import{createProductionGuard,limitVerifiedTenant,type ActionContext}from'../../../../lib/action-guard.ts';
import{packageReceivingEnabled}from'../../../../lib/package-receiving-config.ts';
const guard=createProductionGuard(()=>headers()),id=z.string().uuid(),base=z.object({slug:z.string().min(1).max(63),source:z.unknown(),templateId:id.optional(),deviceId:id.optional(),locale:z.enum(['tr','en'])}).strict();
const prepare=base.extend({jobId:id,copies:z.number().int().min(1).max(100),reprintOf:id.optional(),reason:z.string().trim().min(1).max(120).optional()}).strict();
async function context(slug:string,ctx:ActionContext){if(!ctx.principal)throw new AppError('UNAUTHENTICATED');const p={db:getAppDb(),principal:ctx.principal,tenantSlug:slug,requestId:ctx.requestId};await limitVerifiedTenant({...p,permission:'labels.print'},ctx);return p;}
async function known<T>(fn:()=>Promise<T>){try{return{ready:true as const,result:await fn()};}catch(e){if(e instanceof LabelPrintError)return{ready:false as const,reason:e.reason};if(e instanceof LabelDesignError)return{ready:false as const,reason:'DESIGN_INVALID' as const};throw e;}}
export async function customLabelPreviewAction(raw:unknown){return guard({schema:base},async(input,ctx)=>{const{slug,...body}=input;const p=await context(slug,ctx);return known(()=>previewCustomLabels(p,body,packageReceivingEnabled()));})(raw);}
export async function customLabelPrepareAction(raw:unknown){return guard({schema:prepare},async(input,ctx)=>{const{slug,...body}=input;const p=await context(slug,ctx);return known(()=>prepareCustomLabels(p,body,packageReceivingEnabled()));})(raw);}
