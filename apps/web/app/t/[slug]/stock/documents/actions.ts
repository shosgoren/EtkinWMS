"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { transferBetweenWarehouses } from "@wms/domain/operations";
import { getItem } from "@wms/domain/catalog";
import { approveDocument, cancelDocument, createStockDocument, postDocument, searchStockChoices } from "@wms/domain/stock";
import { createProductionGuard, limitVerifiedTenant, type ActionContext } from "../../../../../lib/action-guard.ts";
const guard=createProductionGuard(()=>headers());
const slug=z.string().min(1).max(63), uuid=z.string().uuid();
const create=z.object({slug,clientKey:uuid,kind:z.enum(["STOCK_IN","STOCK_OUT"]),warehouseId:uuid,itemId:uuid,locationId:uuid,
  quantity:z.string().min(1).max(32),lotId:uuid.optional(),serialId:uuid.optional(),reason:z.string().min(1).max(500)}).strict();
const transition=z.object({slug,clientKey:uuid,documentId:uuid,expectedVersion:z.number().int().positive(),operation:z.enum(["approve","post","cancel"])}).strict();
const search=z.object({slug,kind:z.enum(["warehouse","item","location","lot","serial"]),q:z.string().max(128),warehouseId:uuid.optional(),itemId:uuid.optional()}).strict();
function context(slug: string,ctx: ActionContext) {
  if(!ctx.principal) throw new Error("principal required");
  return {db:getAppDb(),principal:ctx.principal,tenantSlug:slug};
}
export async function stockChoicesAction(raw: unknown) {
  return guard({schema:search},async(input,ctx)=>searchStockChoices(context(input.slug,ctx),input))(raw);
}
export async function createManualStockAction(raw: unknown) {
  return guard({schema:create},async(input,ctx)=>{
    const params=context(input.slug,ctx);
    await limitVerifiedTenant({...params,permission:"document.create"},ctx);
    const item=await getItem(params,{itemId:input.itemId});
    return createStockDocument({...params,clientKey:input.clientKey},{kind:input.kind,warehouseId:input.warehouseId,reason:input.reason,requestId:ctx.requestId,
      lines:[{itemId:item.id,unitId:item.baseUnitId,quantity:input.quantity,baseQuantity:input.quantity,conversionFactor:"1",
        ...(input.kind === "STOCK_IN" ? {targetLocationId:input.locationId}:{sourceLocationId:input.locationId}),
        ...(input.lotId ? {lotId:input.lotId}:{}),...(input.serialId ? {serialId:input.serialId}:{})}]});
  })(raw);
}
export async function transitionManualStockAction(raw: unknown) {
  return guard({schema:transition},async(input,ctx)=>{
    const params=context(input.slug,ctx);
    const permission=input.operation === "approve" ? "document.approve" : input.operation === "post" ? "stock.post" : "document.create";
    await limitVerifiedTenant({...params,permission},ctx);
    const command=input.operation === "approve" ? approveDocument : input.operation === "post" ? postDocument : cancelDocument;
    return command({...params,clientKey:input.clientKey},{documentId:input.documentId,expectedVersion:input.expectedVersion,requestId:ctx.requestId});
  })(raw);
}

const transfer=z.object({slug,clientKey:uuid,sourceLocationId:uuid,targetLocationId:uuid,itemId:uuid,quantity:z.string().min(1).max(32),lotId:uuid.optional(),serialId:uuid.optional(),reason:z.string().min(1).max(500)}).strict();
export async function transferStockAction(raw:unknown) {
 return guard({schema:transfer},async(input,ctx)=>{
  const params=context(input.slug,ctx);await limitVerifiedTenant({...params,permission:"stock.post"},ctx);
  return transferBetweenWarehouses({...params,clientKey:input.clientKey},{...input,requestId:ctx.requestId});
 })(raw);
}
