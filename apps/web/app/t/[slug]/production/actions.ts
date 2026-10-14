"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { createProductionRecipe,getProductionRecipe,produceFromRecipe,scaleRecipeQuantity,previewPackageProduction,preparePackageProduction,postPackageProduction,getPackageProductionBatch } from "@wms/domain/operations";
import { createProductionGuard,limitVerifiedTenant,type ActionContext } from "../../../../lib/action-guard.ts";
import { AppError } from "@wms/shared/errors";
import { assertPackageReceivingEnabled } from "../../../../lib/package-receiving-config.ts";
const guard=createProductionGuard(()=>headers()),uuid=z.string().uuid(),slug=z.string().min(1).max(63),quantity=z.string().min(1).max(32);
const create=z.object({slug,clientKey:uuid,code:z.string().min(1).max(64),version:z.number().int().min(1).max(2147483647),name:z.string().min(1).max(200),outputItemId:uuid,outputQuantity:quantity,lines:z.array(z.object({itemId:uuid,quantity}).strict()).min(1).max(100)}).strict();
const production=z.object({slug,clientKey:uuid,recipeId:uuid,outputQuantity:quantity,targetLocationId:uuid,outputLotId:uuid.optional(),outputSerialId:uuid.optional(),reason:z.string().min(1).max(500),sources:z.array(z.object({lineNo:z.number().int().min(1).max(100),locationId:uuid,lotId:uuid.optional(),serialId:uuid.optional()}).strict()).min(1).max(100)}).strict();
const preview=z.object({slug,recipeId:uuid,outputQuantity:quantity}).strict();
function context(slug:string,ctx:ActionContext){if(!ctx.principal)throw new Error("principal required");return {db:getAppDb(),principal:ctx.principal,tenantSlug:slug};}
export async function createRecipeAction(raw:unknown){return guard({schema:create},async(input,ctx)=>{const params=context(input.slug,ctx);await limitVerifiedTenant({...params,permission:"settings.manage"},ctx);return createProductionRecipe({...params,clientKey:input.clientKey},{...input,requestId:ctx.requestId});})(raw);}
export async function produceAction(raw:unknown){return guard({schema:production},async(input,ctx)=>{const params=context(input.slug,ctx);await limitVerifiedTenant({...params,permission:"stock.post"},ctx);return produceFromRecipe({...params,clientKey:input.clientKey},{...input,requestId:ctx.requestId});})(raw);}
/** Server preview uses exactly the same decimal arithmetic as posting. */
export async function previewProductionAction(raw:unknown){return guard({schema:preview},async(input,ctx)=>{const recipe=await getProductionRecipe(context(input.slug,ctx),input.recipeId);return recipe.lines.map(line=>({lineNo:line.lineNo,quantity:scaleRecipeQuantity(line.quantity,recipe.outputQuantity,input.outputQuantity)}));})(raw);}

// These strict payloads carry observed input versions and operator quantities only.
const version=z.number().int().min(1).max(2147483647);
const outputRow=z.object({quantity,lotCode:z.string().min(1).max(256).optional(),producedOn:z.string().max(10).optional(),expiresOn:z.string().max(10).optional()}).strict();
const outputPackages=z.union([
 z.object({mode:z.literal("explicit"),packages:z.array(outputRow).min(1).max(200)}).strict(),
 outputRow.extend({mode:z.literal("equal"),count:z.number().int().min(1).max(200)}).strict(),
]);
const packagePayload=z.object({slug,recipeId:uuid,recipeVersion:version,outputQuantity:quantity,targetLocationId:uuid,
 inputs:z.array(z.object({packageId:uuid,predecessorVersion:z.number().int().min(0).max(2147483646),currentBalanceVersion:z.string().regex(/^(0|[1-9][0-9]{0,18})$/),baseQuantity:quantity}).strict()).min(1).max(200),
 outputs:z.object({kind:z.enum(["KOLI","VARIL"]),packages:outputPackages}).strict(),
}).strict();
const packagePrepare=packagePayload.extend({clientKey:uuid}).strict();
const packagePost=z.object({slug,clientKey:uuid,documentId:uuid,expectedVersion:version}).strict();
const packageBatch=z.object({slug,documentId:uuid}).strict();
async function packageContext(slug:string,ctx:ActionContext,permission:"stock.view"|"stock.post"){
 assertPackageReceivingEnabled();
 if(!ctx.principal?.mfaVerified)throw new AppError("FORBIDDEN",{detail:"MFA_REQUIRED"});
 const params=context(slug,ctx);await limitVerifiedTenant({...params,permission},ctx);return params;
}
export async function previewPackageProductionAction(raw:unknown){return guard({schema:packagePayload},async(input,ctx)=>{
 const params=await packageContext(input.slug,ctx,"stock.post");const payload={recipeId:input.recipeId,recipeVersion:input.recipeVersion,outputQuantity:input.outputQuantity,targetLocationId:input.targetLocationId,inputs:input.inputs,outputs:input.outputs};
 return previewPackageProduction(params,{...payload,requestId:ctx.requestId});
})(raw);}
export async function preparePackageProductionAction(raw:unknown){return guard({schema:packagePrepare},async(input,ctx)=>{
 const params=await packageContext(input.slug,ctx,"stock.post");const payload={recipeId:input.recipeId,recipeVersion:input.recipeVersion,outputQuantity:input.outputQuantity,targetLocationId:input.targetLocationId,inputs:input.inputs,outputs:input.outputs};
 return preparePackageProduction({...params,clientKey:input.clientKey},{...payload,requestId:ctx.requestId});
})(raw);}
export async function postPackageProductionAction(raw:unknown){return guard({schema:packagePost},async(input,ctx)=>{
 const params=await packageContext(input.slug,ctx,"stock.post");return postPackageProduction({...params,clientKey:input.clientKey},{documentId:input.documentId,expectedVersion:input.expectedVersion,requestId:ctx.requestId});
})(raw);}
export async function getPackageProductionBatchAction(raw:unknown){return guard({schema:packageBatch},async(input,ctx)=>{
 const params=await packageContext(input.slug,ctx,"stock.view");return getPackageProductionBatch(params,{documentId:input.documentId});
})(raw);}
