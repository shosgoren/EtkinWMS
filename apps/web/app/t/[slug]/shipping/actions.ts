"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { getItem } from "@wms/domain/catalog";
import { createSalesOrder,reserveOrder,createPickAssignment,confirmPick,shipOrder,cancelSalesOrder,previewShippingPick } from "@wms/domain/operations";
import { createProductionGuard,limitVerifiedTenant,type ActionContext } from "../../../../lib/action-guard.ts";
const guard=createProductionGuard(()=>headers()),uuid=z.string().uuid(),slug=z.string().min(1).max(63),quantity=z.string().min(1).max(32);
const create=z.object({slug,clientKey:uuid,customerRef:z.string().min(1).max(100),lines:z.array(z.object({itemId:uuid,quantity}).strict()).min(1).max(200)}).strict();
const order=z.discriminatedUnion("operation",[
 z.object({slug,clientKey:uuid,orderId:uuid,operation:z.literal("cancel"),expectedVersion:z.number().int().positive().max(2147483647)}).strict(),
 z.object({slug,clientKey:uuid,orderId:uuid,operation:z.literal("reserve")}).strict(),
 z.object({slug,clientKey:uuid,orderId:uuid,operation:z.literal("assign")}).strict(),
]);
const pick=z.object({slug,clientKey:uuid,taskId:uuid,foundQuantity:quantity,scannedLocationCode:z.string().min(1).max(256),scannedItemBarcode:z.string().min(1).max(256)}).strict();
const ship=z.object({slug,clientKey:uuid,orderId:uuid,warehouseId:uuid,lineId:uuid,quantity}).strict();
const preview=z.object({slug,taskId:uuid,barcode:z.string().min(1).max(256),quantity}).strict();
function context(slug:string,ctx:ActionContext){if(!ctx.principal)throw new Error("principal required");return {db:getAppDb(),principal:ctx.principal,tenantSlug:slug};}
export async function createShippingOrderAction(raw:unknown){return guard({schema:create},async(input,ctx)=>{
 const params=context(input.slug,ctx);await limitVerifiedTenant({...params,permission:"document.create"},ctx);
 const lines=[];for(const line of input.lines){const item=await getItem(params,{itemId:line.itemId});if(item.trackingMode!=="NONE")throw new AppError("VALIDATION_FAILED");lines.push({...line,unitId:item.baseUnitId});}
 return createSalesOrder({...params,clientKey:input.clientKey},{customerRef:input.customerRef,lines,requestId:ctx.requestId});
})(raw);}
export async function shippingOrderAction(raw:unknown){return guard({schema:order},async(input,ctx)=>{
 const params=context(input.slug,ctx);await limitVerifiedTenant({...params,permission:"document.approve"},ctx);
 if(input.operation==="assign")return createPickAssignment({...params,clientKey:input.clientKey},{orderIds:[input.orderId],requestId:ctx.requestId});
 if(input.operation==="reserve")return reserveOrder({...params,clientKey:input.clientKey},{orderId:input.orderId,requestId:ctx.requestId});
 return cancelSalesOrder({...params,clientKey:input.clientKey},{orderId:input.orderId,expectedVersion:input.expectedVersion,reason:"User cancelled from shipping",requestId:ctx.requestId});
})(raw);}
export async function confirmShippingPickAction(raw:unknown){return guard({schema:pick},async(input,ctx)=>{const params=context(input.slug,ctx);await limitVerifiedTenant({...params,permission:"stock.post"},ctx);return confirmPick({...params,clientKey:input.clientKey},{...input,requestId:ctx.requestId});})(raw);}
export async function postShipmentAction(raw:unknown){return guard({schema:ship},async(input,ctx)=>{const params=context(input.slug,ctx);await limitVerifiedTenant({...params,permission:"stock.post"},ctx);return shipOrder({...params,clientKey:input.clientKey},{orderId:input.orderId,warehouseId:input.warehouseId,lines:[{orderLineId:input.lineId,quantity:input.quantity}],requestId:ctx.requestId});})(raw);}
export async function previewShippingPickAction(raw:unknown){return guard({schema:preview},async(input,ctx)=>previewShippingPick(context(input.slug,ctx),input))(raw);}
