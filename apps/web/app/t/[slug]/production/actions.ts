"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { createProductionRecipe,getProductionRecipe,produceFromRecipe,scaleRecipeQuantity } from "@wms/domain/operations";
import { createProductionGuard,limitVerifiedTenant,type ActionContext } from "../../../../lib/action-guard.ts";
const guard=createProductionGuard(()=>headers()),uuid=z.string().uuid(),slug=z.string().min(1).max(63),quantity=z.string().min(1).max(32);
const create=z.object({slug,clientKey:uuid,code:z.string().min(1).max(64),version:z.number().int().min(1).max(2147483647),name:z.string().min(1).max(200),outputItemId:uuid,outputQuantity:quantity,lines:z.array(z.object({itemId:uuid,quantity}).strict()).min(1).max(100)}).strict();
const production=z.object({slug,clientKey:uuid,recipeId:uuid,outputQuantity:quantity,targetLocationId:uuid,outputLotId:uuid.optional(),outputSerialId:uuid.optional(),reason:z.string().min(1).max(500),sources:z.array(z.object({lineNo:z.number().int().min(1).max(100),locationId:uuid,lotId:uuid.optional(),serialId:uuid.optional()}).strict()).min(1).max(100)}).strict();
const preview=z.object({slug,recipeId:uuid,outputQuantity:quantity}).strict();
function context(slug:string,ctx:ActionContext){if(!ctx.principal)throw new Error("principal required");return {db:getAppDb(),principal:ctx.principal,tenantSlug:slug};}
export async function createRecipeAction(raw:unknown){return guard({schema:create},async(input,ctx)=>{const params=context(input.slug,ctx);await limitVerifiedTenant({...params,permission:"settings.manage"},ctx);return createProductionRecipe({...params,clientKey:input.clientKey},{...input,requestId:ctx.requestId});})(raw);}
export async function produceAction(raw:unknown){return guard({schema:production},async(input,ctx)=>{const params=context(input.slug,ctx);await limitVerifiedTenant({...params,permission:"stock.post"},ctx);return produceFromRecipe({...params,clientKey:input.clientKey},{...input,requestId:ctx.requestId});})(raw);}
/** Server preview uses exactly the same decimal arithmetic as posting. */
export async function previewProductionAction(raw:unknown){return guard({schema:preview},async(input,ctx)=>{const recipe=await getProductionRecipe(context(input.slug,ctx),input.recipeId);return recipe.lines.map(line=>({lineNo:line.lineNo,quantity:scaleRecipeQuantity(line.quantity,recipe.outputQuantity,input.outputQuantity)}));})(raw);}
