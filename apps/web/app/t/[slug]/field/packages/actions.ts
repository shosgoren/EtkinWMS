"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { approvePackageQuality, putawayPackage, transferPackage, getCurrentPackage, resolveCurrentPackageQr } from "@wms/domain/operations";
import { findLocationByCode, getLocationTree, getWarehouse, listWarehouses } from "@wms/domain/warehouse";
import type { Permission } from "@wms/domain/identity/permissions";
import { AppError } from "@wms/shared/errors";
import { createProductionGuard, limitVerifiedTenant, type ActionContext, type ActionResult } from "../../../../../lib/action-guard.ts";
import { assertPackageReceivingEnabled } from "../../../../../lib/package-receiving-config.ts";
export interface CurrentPackageDto {
  readonly id: string; readonly qr: string; readonly kind: string; readonly packageNo: number;
  readonly itemId: string; readonly itemCode: string; readonly itemName: string;
  readonly baseUnitId: string; readonly baseUnitCode: string; readonly baseUnitName: string;
  readonly originKind: "RECEIPT" | "PRODUCTION";
  readonly baseQuantity: string; readonly remainingBaseQuantity: string;
  readonly originBaseQuantity: string; readonly currentBaseQuantity: string;
  readonly lotId: string | null; readonly lotCode: string | null; readonly producedOn: string | null; readonly expiresOn: string | null;
  readonly warehouseId: string; readonly warehouseCode: string; readonly warehouseName: string;
  readonly currentLocation: { readonly id: string; readonly code: string; readonly name: string; readonly kind: string } | null;
  readonly currentStockStatus: string | null; readonly predecessorVersion: number; readonly currentBalanceVersion: string | null;
  readonly canTransfer: boolean;
  readonly allowedActions: readonly ("QC_RELEASE" | "PUTAWAY")[];
  readonly blockedReason: null | "DRAFT" | "NO_PERMISSION" | "UNSUPPORTED_STATE";
}
export interface PackageMovementCommandDto { readonly documentId: string; readonly status: "POSTED"; readonly replayed: boolean }
export interface PackageDestinationDto { readonly id: string; readonly code: string; readonly name: string }
export interface PackageDestinationCursor { readonly depth: number; readonly code: string; readonly id: string }
const guard = createProductionGuard(() => headers());
const slug = z.string().min(1).max(63), uuid = z.string().uuid();
const currentSchema = z.object({ slug, packageId: uuid }).strict();
const qrSchema = z.object({ slug, qr: z.string().min(1).max(256) }).strict();
const version = z.string().regex(/^(0|[1-9]\d{0,18})$/);
const movement = { slug, clientKey: uuid, packageId: uuid, predecessorVersion: z.number().int().min(0).max(2147483646), currentBalanceVersion: version };
const releaseSchema = z.object(movement).strict();
const putawaySchema = z.object({ ...movement, targetLocationId: uuid }).strict();
const destinationSchema = z.object({ slug, packageId: uuid, code: z.string().min(1).max(128) }).strict();
const transferWarehouseSchema = z.object({ slug, packageId: uuid, afterCode: z.string().min(1).max(64).optional() }).strict();
const transferDestinationSchema = z.object({ slug, packageId: uuid, warehouseId: uuid, code: z.string().min(1).max(128) }).strict();
const transferLocationsSchema = z.object({ slug, packageId: uuid, warehouseId: uuid, after: z.object({ depth: z.number().int().min(0).max(100), code: z.string().max(64), id: uuid }).strict().optional() }).strict();
const destinationsSchema = z.object({ slug, packageId: uuid, after: z.object({ depth: z.number().int().min(0).max(100), code: z.string().max(64), id: uuid }).strict().optional() }).strict();
async function context(tenantSlug: string, permission: Permission, ctx: ActionContext) {
  assertPackageReceivingEnabled(); const params = { db: getAppDb(), principal: ctx.principal, tenantSlug };
  await limitVerifiedTenant({ ...params, permission }, ctx); return params;
}
export async function getCurrentPackageAction(raw: unknown): Promise<ActionResult<CurrentPackageDto>> {
  return guard({ schema: currentSchema }, async (i, ctx) => getCurrentPackage(await context(i.slug, "stock.view", ctx), { packageId: i.packageId }))(raw);
}
export async function resolveCurrentPackageQrAction(raw: unknown): Promise<ActionResult<CurrentPackageDto>> {
  return guard({ schema: qrSchema }, async (i, ctx) => resolveCurrentPackageQr(await context(i.slug, "stock.view", ctx), { qr: i.qr }))(raw);
}
export async function qualityReleasePackageAction(raw: unknown): Promise<ActionResult<PackageMovementCommandDto>> {
  return guard({ schema: releaseSchema }, async (i, ctx): Promise<PackageMovementCommandDto> => {
    const r = await approvePackageQuality({ ...await context(i.slug, "document.approve", ctx), clientKey: i.clientKey }, { packageId: i.packageId, predecessorVersion: i.predecessorVersion, currentBalanceVersion: i.currentBalanceVersion, requestId: ctx.requestId });
    if (r.documentId === undefined || r.status !== "POSTED") throw new AppError("INTERNAL");
    return { documentId: r.documentId, status: r.status, replayed: r.replayed };
  })(raw);
}
export async function putawayPackageAction(raw: unknown): Promise<ActionResult<PackageMovementCommandDto>> {
  return guard({ schema: putawaySchema }, async (i, ctx): Promise<PackageMovementCommandDto> => {
    const r = await putawayPackage({ ...await context(i.slug, "stock.post", ctx), clientKey: i.clientKey }, { packageId: i.packageId, predecessorVersion: i.predecessorVersion, currentBalanceVersion: i.currentBalanceVersion, targetLocationId: i.targetLocationId, requestId: ctx.requestId });
    if (r.documentId === undefined || r.status !== "POSTED") throw new AppError("INTERNAL");
    return { documentId: r.documentId, status: r.status, replayed: r.replayed };
  })(raw);
}
export async function packageStorageLocationsAction(raw: unknown): Promise<ActionResult<{ readonly items: readonly PackageDestinationDto[]; readonly next: PackageDestinationCursor | null }>> {
  return guard({ schema: destinationsSchema }, async (i, ctx) => {
    const params = await context(i.slug, "stock.view", ctx), current = await getCurrentPackage(params, { packageId: i.packageId });
    const page = await getLocationTree(params, { warehouseId: current.warehouseId, ...(i.after === undefined ? {} : { after: i.after }), limit: 200 });
    return { items: page.items.filter(l => l.status === "ACTIVE" && l.kind === "STORAGE" && l.id !== current.currentLocation?.id).map(l => ({ id: l.id, code: l.code, name: l.name })), next: page.next };
  })(raw);
}
export async function resolvePackageDestinationAction(raw: unknown): Promise<ActionResult<PackageDestinationDto>> {
  return guard({ schema: destinationSchema }, async (i, ctx) => {
    const params = await context(i.slug, "stock.view", ctx), current = await getCurrentPackage(params, { packageId: i.packageId });
    const l = await findLocationByCode(params, { warehouseId: current.warehouseId, code: i.code });
    if (l === null || l.status !== "ACTIVE" || l.kind !== "STORAGE" || l.id === current.currentLocation?.id) throw new AppError("NOT_FOUND");
    return { id: l.id, code: l.code, name: l.name };
  })(raw);
}

// T-948: returns the committed terminal document without a subsequent read.
export async function transferPackageAction(raw: unknown): Promise<ActionResult<PackageMovementCommandDto>> {
  return guard({ schema: putawaySchema }, async (i, ctx): Promise<PackageMovementCommandDto> => {
    const r = await transferPackage({ ...await context(i.slug, "stock.post", ctx), clientKey: i.clientKey }, { packageId: i.packageId, predecessorVersion: i.predecessorVersion, currentBalanceVersion: i.currentBalanceVersion, targetLocationId: i.targetLocationId, requestId: ctx.requestId });
    if (r.documentId === undefined || r.status !== "POSTED") throw new AppError("INTERNAL");
    return { documentId: r.documentId, status: r.status, replayed: r.replayed };
  })(raw);
}
async function transferCurrent(params: Awaited<ReturnType<typeof context>>, packageId: string) {
  const current = await getCurrentPackage(params, { packageId });
  if (current.canTransfer !== true) throw new AppError("VALIDATION_FAILED");
  return current;
}
async function transferWarehouse(params: Awaited<ReturnType<typeof context>>, current: CurrentPackageDto, warehouseId: string) {
  if (warehouseId === current.warehouseId) throw new AppError("VALIDATION_FAILED");
  const warehouse = await getWarehouse(params, { warehouseId });
  if (warehouse.status !== "ACTIVE") throw new AppError("NOT_FOUND");
  return warehouse;
}
export async function packageTransferWarehousesAction(raw: unknown): Promise<ActionResult<{ readonly items: readonly PackageDestinationDto[]; readonly nextAfterCode: string | null }>> {
  return guard({ schema: transferWarehouseSchema }, async (i, ctx) => {
    const params = await context(i.slug, "stock.post", ctx), current = await transferCurrent(params, i.packageId);
    const page = await listWarehouses(params, { ...(i.afterCode === undefined ? {} : { afterCode: i.afterCode }), limit: 100 });
    return { items: page.items.filter(w => w.status === "ACTIVE" && w.id !== current.warehouseId).map(w => ({ id: w.id, code: w.code, name: w.name })), nextAfterCode: page.nextAfterCode };
  })(raw);
}
export async function packageTransferLocationsAction(raw: unknown): Promise<ActionResult<{ readonly items: readonly PackageDestinationDto[]; readonly next: PackageDestinationCursor | null }>> {
  return guard({ schema: transferLocationsSchema }, async (i, ctx) => {
    const params = await context(i.slug, "stock.post", ctx), current = await transferCurrent(params, i.packageId);
    await transferWarehouse(params, current, i.warehouseId);
    const page = await getLocationTree(params, { warehouseId: i.warehouseId, ...(i.after === undefined ? {} : { after: i.after }), limit: 200 });
    return { items: page.items.filter(l => l.status === "ACTIVE" && l.kind === "STORAGE").map(l => ({ id: l.id, code: l.code, name: l.name })), next: page.next };
  })(raw);
}
export async function resolvePackageTransferDestinationAction(raw: unknown): Promise<ActionResult<PackageDestinationDto>> {
  return guard({ schema: transferDestinationSchema }, async (i, ctx) => {
    const params = await context(i.slug, "stock.post", ctx), current = await transferCurrent(params, i.packageId);
    await transferWarehouse(params, current, i.warehouseId);
    const l = await findLocationByCode(params, { warehouseId: i.warehouseId, code: i.code });
    if (l === null || l.status !== "ACTIVE" || l.kind !== "STORAGE") throw new AppError("NOT_FOUND");
    return { id: l.id, code: l.code, name: l.name };
  })(raw);
}
