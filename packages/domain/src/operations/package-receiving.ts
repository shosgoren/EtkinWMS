// T-933: persisted physical packages; stock writes remain exclusively in posting.ts.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import type { AccessTx } from "../identity/access.ts";
import { parseNfcText } from "../catalog/lots.ts";
import { compareDecimal } from "../catalog/quantity.ts";
import { assertItemsActive, assertNotProcessing, executeStockCommand, nextDocumentNumber, postApprovedDocumentInTx, readDocumentHeader, type StockCommandParams, type StockCommandResult, type StockDocCallParams } from "../stock/index.ts";
import { buildPostCommand } from "../stock/posting.ts";
import { emptyPlan, lockFieldHeader, tenantToday, uuidOf, documentState } from "./field-posting.ts";
import { validatePackageReceiptInput, type PackageReceiptRow, type PackageReceiptItemContext } from "./package-receipt-input.ts";

export interface PreparePackageReceiptInput {
  readonly warehouseId: string;
  readonly receivingLocationId: string;
  readonly itemId: string;
  readonly unitId: string;
  readonly kind: "KOLI" | "VARIL";
  readonly supplierRef?: string | null;
  readonly packages: unknown;
  readonly requestId?: string | null;
}
export interface PostPackageReceiptInput {
  readonly documentId: string;
  readonly expectedVersion: number;
  readonly requestId?: string | null;
}
function record(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new AppError("VALIDATION_FAILED");
  const proto: unknown = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) throw new AppError("VALIDATION_FAILED");
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some((k) => !keys.includes(k))) throw new AppError("VALIDATION_FAILED");
  return r;
}
/** Expand equal/explicit to the same canonical physical rows before hashing; no server values enter the hash. */
export function canonicalPackageReceiptInput(raw: unknown) {
  const r = record(raw, ["warehouseId", "receivingLocationId", "itemId", "unitId", "kind", "supplierRef", "packages", "requestId"]);
  if (r.kind !== "KOLI" && r.kind !== "VARIL") throw new AppError("VALIDATION_FAILED");
  const supplierRef = r.supplierRef === undefined || r.supplierRef === null ? null : parseNfcText(r.supplierRef, 100);
  const rows = validatePackageReceiptInput(r.packages, { quantityScale: 6, toBaseFactor: "1", trackingMode: "NONE" }).packages;
  return { warehouseId: uuidOf(r.warehouseId), receivingLocationId: uuidOf(r.receivingLocationId), itemId: uuidOf(r.itemId), unitId: uuidOf(r.unitId), kind: r.kind, supplierRef,
    packages: rows.map((row) => ({ quantity:row.quantity, ...(row.lotCode===undefined?{}:{lotCode:row.lotCode}), ...(row.producedOn===undefined?{}:{producedOn:row.producedOn}), ...(row.expiresOn===undefined?{}:{expiresOn:row.expiresOn}) })) };
}
async function run<I>(params: StockDocCallParams, spec: Pick<StockCommandParams<I>, "commandType" | "permission" | "input" | "plan" | "apply">) {
  const result = await executeStockCommand({ db: params.db, principal: params.principal, tenantSlug: params.tenantSlug, clientKey: params.clientKey,
    ...(params.retry === undefined ? {} : { retry: params.retry }), ...(params.timeouts === undefined ? {} : { timeouts: params.timeouts }), ...(params.logger === undefined ? {} : { logger: params.logger }), ...spec });
  if (result.status !== "COMPLETED") throw new AppError("VERSION_CONFLICT", { retryable: true });
  return { ...result.result, replayed: result.replayed };
}
async function context(tx: AccessTx, tenant: string, item: string, unit: string): Promise<PackageReceiptItemContext> {
  await assertItemsActive(tx, tenant, [item]);
  const units = await tx.execute<{ id: string; status: string }>(sql`SELECT id,status FROM public.units WHERE tenant_id=${tenant}::uuid AND id=${unit}::uuid ORDER BY id FOR KEY SHARE`);
  if (units[0] === undefined || units[0].status !== "ACTIVE") throw new AppError("VALIDATION_FAILED");
  const conversions = await tx.execute<{ to_base_factor: string }>(sql`SELECT to_base_factor::text FROM public.unit_conversions WHERE tenant_id=${tenant}::uuid AND item_id=${item}::uuid AND unit_id=${unit}::uuid ORDER BY item_id,unit_id FOR SHARE`);
  const items = await tx.execute<{ quantity_scale: number; tracking_mode: PackageReceiptItemContext["trackingMode"]; base_unit_id: string }>(sql`SELECT quantity_scale,tracking_mode,base_unit_id FROM public.items WHERE tenant_id=${tenant}::uuid AND id=${item}::uuid`);
  const i = items[0];
  if (i === undefined) throw new AppError("NOT_FOUND");
  const factor = i.base_unit_id === unit ? "1" : conversions[0]?.to_base_factor;
  if (factor === undefined) throw new AppError("VALIDATION_FAILED");
  return { quantityScale: Number(i.quantity_scale), trackingMode: i.tracking_mode, toBaseFactor: factor };
}
type Snapshot = PackageReceiptRow & { lotId: string | null };
async function snapshots(tx: AccessTx, tenant: string, item: string, rows: readonly PackageReceiptRow[], tracking: PackageReceiptItemContext["trackingMode"]): Promise<Snapshot[]> {
  if (tracking === "NONE") return rows.map((r) => ({ ...r, lotId: null }));
  const lots = new Map<string, { id: string; produced: string | null; expires: string | null }>();
  // Stable code order; no manual lot lock. The generated-date FK protects the final snapshot.
  for (const code of [...new Set(rows.map((r) => r.lotCode as string))].sort()) {
    const group = rows.filter((r) => r.lotCode === code);
    const produced = [...new Set(group.flatMap((r) => r.producedOn === undefined ? [] : [r.producedOn]))];
    const expires = [...new Set(group.flatMap((r) => r.expiresOn === undefined ? [] : [r.expiresOn]))];
    if (produced.length > 1 || expires.length > 1) throw new AppError("VALIDATION_FAILED");
    const id = randomUUID();
    await tx.execute(sql`INSERT INTO public.lots(tenant_id,id,item_id,lot_code,production_date,expiry_date) VALUES(${tenant}::uuid,${id}::uuid,${item}::uuid,${code},${produced[0] ?? null}::date,${expires[0] ?? null}::date) ON CONFLICT ON CONSTRAINT lots_tenant_item_lot_code_key DO NOTHING`);
    const found = await tx.execute<{ id: string; produced: string | null; expires: string | null }>(sql`SELECT id,production_date::text AS produced,expiry_date::text AS expires FROM public.lots WHERE tenant_id=${tenant}::uuid AND item_id=${item}::uuid AND lot_code=${code}`);
    const lot = found[0];
    if (lot === undefined) throw new AppError("VERSION_CONFLICT", { retryable: true });
    if ((produced[0] !== undefined && produced[0] !== lot.produced) || (expires[0] !== undefined && expires[0] !== lot.expires)) throw new AppError("VALIDATION_FAILED");
    lots.set(code, lot);
  }
  return rows.map((r) => { const lot = lots.get(r.lotCode as string); if (lot === undefined) throw new AppError("INTERNAL");
    return { quantity: r.quantity, baseQuantity: r.baseQuantity, lotCode: r.lotCode, ...(lot.produced === null ? {} : { producedOn: lot.produced }), ...(lot.expires === null ? {} : { expiresOn: lot.expires }), lotId: lot.id }; });
}
export async function preparePackageReceipt(params: StockDocCallParams, input: PreparePackageReceiptInput): Promise<StockCommandResult & { readonly replayed: boolean }> {
  const value = canonicalPackageReceiptInput(input);
  return run(params, { commandType: "package_receipt.prepare", permission: "document.create", input: value, plan: async () => emptyPlan([value.warehouseId]), apply: async (tx, _locked, ctx) => {
    const t = ctx.tenantId;
    const warehouse = await tx.execute<{ status: string }>(sql`SELECT status FROM public.warehouses WHERE tenant_id=${t}::uuid AND id=${value.warehouseId}::uuid FOR SHARE`);
    if (warehouse[0] === undefined) throw new AppError("NOT_FOUND");
    if (warehouse[0].status !== "ACTIVE") throw new AppError("VALIDATION_FAILED");
    const location = await tx.execute<{ warehouse_id: string; kind: string; status: string }>(sql`SELECT warehouse_id,kind,status FROM public.locations WHERE tenant_id=${t}::uuid AND id=${value.receivingLocationId}::uuid FOR SHARE`);
    if (location[0] === undefined) throw new AppError("NOT_FOUND");
    if (location[0].warehouse_id !== value.warehouseId || location[0].kind !== "RECEIVING" || location[0].status !== "ACTIVE") throw new AppError("VALIDATION_FAILED");
    const trusted = await context(tx, t, value.itemId, value.unitId);
    const validated = validatePackageReceiptInput({ mode: "explicit", packages: value.packages }, trusted);
    const rows = await snapshots(tx, t, value.itemId, validated.packages, trusted.trackingMode);
    const qc = await tx.execute<{ enabled: boolean }>(sql`SELECT receiving_qc_enabled AS enabled FROM public.tenant_settings WHERE tenant_id=${t}::uuid`);
    const stockStatus = qc[0]?.enabled === false ? "AVAILABLE" : "QUARANTINE";
    const type = await tx.execute<{ id: string }>(sql`SELECT id FROM public.document_type_versions WHERE tenant_id IS NULL AND key='STOCK_IN' AND version=1`);
    if (type[0] === undefined) throw new AppError("INTERNAL");
    const date = await tenantToday(tx,t), receiptId = randomUUID(), documentId = randomUUID();
    const allocated = rows.map((row) => ({ ...row, id: randomUUID(), receiptLineId: randomUUID(), documentLineId: randomUUID() }));
    for (const row of allocated) await tx.execute(sql`INSERT INTO public.handling_units(tenant_id,id,kind,code,package_receipt_id) VALUES(${t}::uuid,${row.id}::uuid,${value.kind},${row.id},${receiptId}::uuid)`);
    // Seal metadata first: deferred parent FKs allow this order, while the immediate lot snapshot FK
    // acquires its internal key lock before the final sequence lock. No manual lot lock is added.
    for (const [i,row] of allocated.entries()) {
      await tx.execute(sql`INSERT INTO public.receipt_packages(tenant_id,id,receipt_id,receipt_line_id,document_id,document_line_id,package_no,lot_code,produced_on,expires_on,catalog_lot_id) VALUES(${t}::uuid,${row.id}::uuid,${receiptId}::uuid,${row.receiptLineId}::uuid,${documentId}::uuid,${row.documentLineId}::uuid,${i+1},${row.lotCode ?? null},${row.producedOn ?? null}::date,${row.expiresOn ?? null}::date,${row.lotId}::uuid)`);
    }
    // Final source lock is numbering. All external references have already been resolved/locked.
    const number = await nextDocumentNumber(tx,t,"INBOUND_RECEIPT",date);
    await tx.execute(sql`INSERT INTO public.inbound_receipts(tenant_id,id,warehouse_id,number,supplier_ref,created_by,package_document_id) VALUES(${t}::uuid,${receiptId}::uuid,${value.warehouseId}::uuid,${number},${value.supplierRef},${ctx.userId}::uuid,${documentId}::uuid)`);
    await tx.execute(sql`INSERT INTO public.documents(tenant_id,id,kind,type_version_id,warehouse_id,business_date,created_by,source_kind,source_id) VALUES(${t}::uuid,${documentId}::uuid,'STOCK_IN',${type[0].id}::uuid,${value.warehouseId}::uuid,${date}::date,${ctx.userId}::uuid,'INBOUND_RECEIPT',${receiptId}::uuid)`);
    for (const [i,row] of allocated.entries()) {
      await tx.execute(sql`INSERT INTO public.inbound_receipt_lines(tenant_id,id,receipt_id,line_no,item_id,unit_id,conversion_factor,expected_quantity) VALUES(${t}::uuid,${row.receiptLineId}::uuid,${receiptId}::uuid,${i+1},${value.itemId}::uuid,${value.unitId}::uuid,${validated.toBaseFactor}::numeric,${row.quantity}::numeric)`);
      await tx.execute(sql`INSERT INTO public.document_lines(tenant_id,id,document_id,line_no,item_id,unit_id,quantity,conversion_factor,base_quantity,target_location_id,stock_status,handling_unit_id,source_line_id,lot_id) VALUES(${t}::uuid,${row.documentLineId}::uuid,${documentId}::uuid,${i+1},${value.itemId}::uuid,${value.unitId}::uuid,${row.quantity}::numeric,${validated.toBaseFactor}::numeric,${row.baseQuantity}::numeric,${value.receivingLocationId}::uuid,${stockStatus},${row.id}::uuid,${row.receiptLineId}::uuid,${row.lotId}::uuid)`);

    }
    return { result: { documentId,status: "DRAFT" }, audit: { action: "inbound_receipt.created",entityType: "inbound_receipt",entityId: receiptId,requestId: input.requestId ?? null,changeSummary: { documentId,warehouseId:value.warehouseId,lineCount:rows.length } } };
  } });
}
export async function postPackageReceipt(params: StockDocCallParams, input: PostPackageReceiptInput): Promise<StockCommandResult & { readonly replayed: boolean }> {
  record(input,["documentId","expectedVersion","requestId"]);
  const documentId = uuidOf(input.documentId), expectedVersion = input.expectedVersion;
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new AppError("VALIDATION_FAILED");
  const core = buildPostCommand({ documentId,expectedVersion,moves:undefined,requestId:input.requestId,worker:false });
  return run(params,{ commandType:"package_receipt.post",permission:"stock.post",input:{documentId,expectedVersion},plan:core.plan,apply:async(tx,locked,ctx)=> {
    if (locked.document === undefined) throw new AppError("INTERNAL");
    const header = await readDocumentHeader(tx,ctx.tenantId,documentId);
    assertNotProcessing(header);
    if (header.status !== "DRAFT" || header.kind !== "STOCK_IN") throw documentState();
    const warehouse = await tx.execute<{ status:string }>(sql`SELECT status FROM public.warehouses WHERE tenant_id=${ctx.tenantId}::uuid AND id=${header.warehouseId}::uuid FOR SHARE`);
    if (warehouse[0]?.status !== "ACTIVE") throw new AppError("VALIDATION_FAILED");
    const receipt = await tx.execute<{ id: string }>(sql`SELECT id FROM public.inbound_receipts WHERE tenant_id=${ctx.tenantId}::uuid AND package_document_id=${documentId}::uuid`);
    if (receipt[0] === undefined) throw new AppError("NOT_FOUND");
    const h = await lockFieldHeader(tx,ctx.tenantId,"inbound_receipts",receipt[0].id);
    if (h.status !== "DRAFT" && h.status !== "OPEN") throw documentState();
    await tx.execute(sql`SELECT public.receipt_package_assert(${ctx.tenantId}::uuid,${h.id}::uuid)`);
    const rows = await tx.execute<{ quantity:string; base_quantity:string; conversion_factor:string; quantity_scale:number; tracking_mode:PackageReceiptItemContext["trackingMode"]; lot_code:string|null; produced_on:string|null; expires_on:string|null }>(sql`SELECT l.quantity::text,l.base_quantity::text,l.conversion_factor::text,i.quantity_scale,i.tracking_mode,p.lot_code,p.produced_on::text,p.expires_on::text FROM public.receipt_packages p JOIN public.document_lines l ON l.tenant_id=p.tenant_id AND l.id=p.document_line_id JOIN public.items i ON i.tenant_id=l.tenant_id AND i.id=l.item_id WHERE p.tenant_id=${ctx.tenantId}::uuid AND p.document_id=${documentId}::uuid ORDER BY p.package_no`);
    if (rows.length < 1 || rows.length > 200) throw new AppError("VALIDATION_FAILED");
    for (const row of rows) {
      const checked=validatePackageReceiptInput({mode:"equal",count:1,quantity:row.quantity,...(row.lot_code===null?{}:{lotCode:row.lot_code}),...(row.produced_on===null?{}:{producedOn:row.produced_on}),...(row.expires_on===null?{}:{expiresOn:row.expires_on})},{quantityScale:Number(row.quantity_scale),toBaseFactor:row.conversion_factor,trackingMode:row.tracking_mode});
      if (compareDecimal(checked.totalBaseQuantity,row.base_quantity)!==0) throw new AppError("VALIDATION_FAILED");
    }
    const approved=await tx.execute<{id:string}>(sql`UPDATE public.documents SET status='APPROVED' WHERE tenant_id=${ctx.tenantId}::uuid AND id=${documentId}::uuid AND status='DRAFT' RETURNING id`);
    if(approved[0]===undefined)throw new AppError("INTERNAL");
    const posted=await postApprovedDocumentInTx(tx,locked,ctx,documentId,{requestId:input.requestId ?? null});
    const received=await tx.execute<{id:string}>(sql`UPDATE public.inbound_receipt_lines SET received_quantity=expected_quantity,damaged_quantity=0 WHERE tenant_id=${ctx.tenantId}::uuid AND receipt_id=${h.id}::uuid RETURNING id`);
    if(received.length!==rows.length)throw new AppError("INTERNAL");
    const closed=await tx.execute<{id:string}>(sql`UPDATE public.inbound_receipts SET status='CLOSED' WHERE tenant_id=${ctx.tenantId}::uuid AND id=${h.id}::uuid RETURNING id`);
    if(closed[0]===undefined)throw new AppError("INTERNAL");
    await appendAudit(tx,{action:"inbound_receipt.received",actorUserId:ctx.userId,entityType:"inbound_receipt",entityId:h.id,requestId:input.requestId ?? null,changeSummary:{documentId,lineCount:rows.length,closed:true}});
    return posted;
  }});
}
