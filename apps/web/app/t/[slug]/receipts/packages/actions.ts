"use server";
// T-935: transport validation only; authorization, conversion and stock effects stay in domain.
import { headers } from "next/headers";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { getItem, listItemConversions, listUnits, resolveBarcodeQuery, searchItems } from "@wms/domain/catalog";
import { getPackageReceipt, postPackageReceipt, preparePackageReceipt } from "@wms/domain/operations";
import { getLocationTree, getWarehouse, listWarehouses } from "@wms/domain/warehouse";
import type { Permission } from "@wms/domain/identity/permissions";
import { AppError } from "@wms/shared/errors";
import { createProductionGuard, limitVerifiedTenant, type ActionContext, type ActionResult } from "../../../../../lib/action-guard.ts";
import { assertPackageReceivingEnabled } from "../../../../../lib/package-receiving-config.ts";

export interface PackageReceiptDto {
  readonly documentId: string; readonly documentStatus: string; readonly documentVersion: number;
  readonly documentNumber: string | null; readonly receiptId: string; readonly receiptStatus: string;
  readonly receiptVersion: number; readonly receiptNumber: string; readonly warehouseId: string;
  readonly supplierRef: string | null; readonly packages: readonly ReceiptPackageDto[];
}
export interface ReceiptPackageDto {
  readonly id: string; readonly qr: string; readonly packageNo: number; readonly kind: string;
  readonly receiptLineId: string; readonly documentLineId: string; readonly itemId: string;
  readonly itemCode: string; readonly itemName: string; readonly unitId: string; readonly unitCode: string;
  readonly unitName: string; readonly quantity: string; readonly conversionFactor: string;
  readonly baseQuantity: string; readonly receivingLocationId: string; readonly stockStatus: string;
  readonly lotId: string | null; readonly lotCode: string | null;
  readonly producedOn: string | null; readonly expiresOn: string | null;
}
export interface PackageCommandDto {
  readonly documentId: string; readonly status: "DRAFT" | "POSTED"; readonly replayed: boolean;
}
export interface PackageItemDto {
  readonly id: string; readonly code: string; readonly name: string; readonly baseUnitId: string;
  readonly trackingMode: "NONE" | "LOT" | "SERIAL" | "LOT_AND_SERIAL"; readonly quantityScale: number;
}
export interface PackageItemOptionsDto {
  readonly item: PackageItemDto;
  readonly baseUnit: { readonly id: string; readonly code: string; readonly name: string };
  readonly units: readonly { readonly unitId: string; readonly unitCode: string; readonly unitName: string; readonly toBaseFactor: string }[];
}
const guard = createProductionGuard(() => headers());
const slug = z.string().min(1).max(63);
const uuid = z.string().uuid();
const decimal = z.string().min(1).max(32);
const metadata = { quantity: decimal, lotCode: z.string().min(1).max(256).optional(), producedOn: z.string().length(10).optional(), expiresOn: z.string().length(10).optional() };
const packages = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("equal"), count: z.number().int().min(1).max(200), ...metadata }).strict(),
  z.object({ mode: z.literal("explicit"), packages: z.array(z.object(metadata).strict()).min(1).max(200) }).strict(),
]);
const prepareSchema = z.object({ slug, clientKey: uuid, warehouseId: uuid, receivingLocationId: uuid, itemId: uuid, unitId: uuid,
  kind: z.enum(["KOLI", "VARIL"]), supplierRef: z.string().max(100).optional(), packages }).strict();
const postSchema = z.object({ slug, clientKey: uuid, documentId: uuid, expectedVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict();
const receiptSchema = z.object({ slug, documentId: uuid }).strict();
const itemSchema = z.object({ slug, itemId: uuid }).strict();
const searchSchema = z.object({ slug, q: z.string().max(128).optional(), after: z.string().min(1).max(512).optional() }).strict();
const scanSchema = z.object({ slug, code: z.string().min(1).max(256) }).strict();
const warehouseSchema = z.object({ slug, afterCode: z.string().min(1).max(64).optional() }).strict();
const locationSchema = z.object({ slug, warehouseId: uuid, after: z.object({ depth: z.number().int().min(0).max(100), code: z.string().max(64), id: uuid }).strict().optional() }).strict();

async function context(tenantSlug: string, permission: Permission, ctx: ActionContext) {
  assertPackageReceivingEnabled();
  const params = { db: getAppDb(), principal: ctx.principal, tenantSlug };
  await limitVerifiedTenant({ ...params, permission }, ctx);
  return params;
}

// Do not perform a read after the write: a read failure must not lose the prepared document ID.
export async function preparePackageReceiptAction(raw: unknown): Promise<ActionResult<PackageCommandDto>> {
  return guard({ schema: prepareSchema }, async (input, ctx): Promise<PackageCommandDto> => {
    const params = await context(input.slug, "document.create", ctx);
    const result = await preparePackageReceipt({ ...params, clientKey: input.clientKey }, {
      warehouseId: input.warehouseId, receivingLocationId: input.receivingLocationId, itemId: input.itemId,
      unitId: input.unitId, kind: input.kind, packages: input.packages,
      ...(input.supplierRef === undefined ? {} : { supplierRef: input.supplierRef }), requestId: ctx.requestId,
    });
    if (result.documentId === undefined || result.status !== "DRAFT") throw new AppError("INTERNAL");
    return { documentId: result.documentId, status: result.status, replayed: result.replayed };
  })(raw);
}
export async function postPackageReceiptAction(raw: unknown): Promise<ActionResult<PackageCommandDto>> {
  return guard({ schema: postSchema }, async (input, ctx): Promise<PackageCommandDto> => {
    const params = await context(input.slug, "stock.post", ctx);
    const result = await postPackageReceipt({ ...params, clientKey: input.clientKey }, { documentId: input.documentId, expectedVersion: input.expectedVersion, requestId: ctx.requestId });
    if (result.documentId === undefined || result.status !== "POSTED") throw new AppError("INTERNAL");
    return { documentId: result.documentId, status: result.status, replayed: result.replayed };
  })(raw);
}
export async function getPackageReceiptAction(raw: unknown): Promise<ActionResult<PackageReceiptDto>> {
  return guard({ schema: receiptSchema }, async (input, ctx): Promise<PackageReceiptDto> =>
    getPackageReceipt(await context(input.slug, "stock.view", ctx), { documentId: input.documentId }))(raw);
}

async function itemOptions(params: Awaited<ReturnType<typeof context>>, itemId: string): Promise<PackageItemOptionsDto> {
  const item = await getItem(params, { itemId });
  if (item.status !== "ACTIVE") throw new AppError("VALIDATION_FAILED");
  const allUnits = await listUnits(params);
  const active = allUnits.filter(u => u.status === "ACTIVE");
  const base = active.find(u => u.id === item.baseUnitId);
  if (base === undefined) throw new AppError("VALIDATION_FAILED");
  const conversions = await listItemConversions(params, itemId);
  return { item: { id: item.id, code: item.code, name: item.name, baseUnitId: item.baseUnitId, trackingMode: item.trackingMode, quantityScale: item.quantityScale },
    baseUnit: { id: base.id, code: base.code, name: base.name },
    units: [{ unitId: base.id, unitCode: base.code, unitName: base.name, toBaseFactor: "1" },
      ...conversions.filter(c => c.unitId !== base.id && active.some(u => u.id === c.unitId)).map(c => ({ unitId: c.unitId, unitCode: c.unitCode, unitName: c.unitName, toBaseFactor: c.factor }))] };
}
export async function packageItemOptionsAction(raw: unknown): Promise<ActionResult<PackageItemOptionsDto>> {
  return guard({ schema: itemSchema }, async (input, ctx) => itemOptions(await context(input.slug, "stock.view", ctx), input.itemId))(raw);
}
export async function searchPackageItemsAction(raw: unknown): Promise<ActionResult<{ readonly items: readonly PackageItemDto[]; readonly nextCursor: string | null }>> {
  return guard({ schema: searchSchema }, async (input, ctx) => {
    const page = await searchItems(await context(input.slug, "stock.view", ctx), { ...(input.q === undefined ? {} : { q: input.q }), ...(input.after === undefined ? {} : { after: input.after }), status: "ACTIVE", limit: 50 });
    return { items: page.items.map(i => ({ id: i.id, code: i.code, name: i.name, baseUnitId: i.baseUnitId, trackingMode: i.trackingMode, quantityScale: i.quantityScale })), nextCursor: page.nextCursor };
  })(raw);
}
// A product barcode selects only item/unit, never a physical package or a quantity.
export async function resolvePackageItemScanAction(raw: unknown): Promise<ActionResult<PackageItemOptionsDto & { readonly selectedUnitId: string }>> {
  return guard({ schema: scanSchema }, async (input, ctx) => {
    const params = await context(input.slug, "stock.view", ctx);
    const found = await resolveBarcodeQuery(params, input.code);
    const options = await itemOptions(params, found.itemId);
    if (!options.units.some(u => u.unitId === found.unitId)) throw new AppError("VALIDATION_FAILED");
    return { ...options, selectedUnitId: found.unitId };
  })(raw);
}
export async function packageWarehousesAction(raw: unknown): Promise<ActionResult<{ readonly items: readonly { readonly id: string; readonly code: string; readonly name: string }[]; readonly nextAfterCode: string | null }>> {
  return guard({ schema: warehouseSchema }, async (input, ctx) => {
    const page = await listWarehouses(await context(input.slug, "stock.view", ctx), { ...(input.afterCode === undefined ? {} : { afterCode: input.afterCode }), limit: 100 });
    return { items: page.items.filter(w => w.status === "ACTIVE").map(w => ({ id: w.id, code: w.code, name: w.name })), nextAfterCode: page.nextAfterCode };
  })(raw);
}
export async function packageReceivingLocationsAction(raw: unknown): Promise<ActionResult<{ readonly items: readonly { readonly id: string; readonly code: string; readonly name: string }[]; readonly next: { readonly depth: number; readonly code: string; readonly id: string } | null }>> {
  return guard({ schema: locationSchema }, async (input, ctx) => {
    const params = await context(input.slug, "stock.view", ctx);
    const warehouse = await getWarehouse(params, { warehouseId: input.warehouseId });
    if (warehouse.status !== "ACTIVE") throw new AppError("VALIDATION_FAILED");
    const page = await getLocationTree(params, { warehouseId: input.warehouseId, ...(input.after === undefined ? {} : { after: input.after }), limit: 200 });
    return { items: page.items.filter(l => l.status === "ACTIVE" && l.kind === "RECEIVING").map(l => ({ id: l.id, code: l.code, name: l.name })), next: page.next };
  })(raw);
}
