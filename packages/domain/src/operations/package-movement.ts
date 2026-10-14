// T-942: immutable physical identity, whole-HU QC/putaway through the existing stock engine.
import { sql } from "drizzle-orm";
import type { LockedState } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import type { AccessTx } from "../identity/access.ts";
import { executeStockCommand, type StockCommandResult, type StockDocCallParams } from "../stock/index.ts";
import { decimalToMicro, emptyPlan, planFieldPosting, postFieldDocument, uuidOf, type FieldPostSpec } from "./field-posting.ts";

export interface PackageMovementInput {
  readonly packageId: string;
  /** Origin = 0, otherwise the latest immutable step sequence. */
  readonly predecessorVersion: number;
  /** bigint stock-balance version: never coerced into a floating-point number. */
  readonly currentBalanceVersion: string;
  readonly requestId?: string | null;
}
export interface PutawayPackageInput extends PackageMovementInput { readonly targetLocationId: string }
type Operation = "QC_RELEASE" | "PUTAWAY";
type Value = Omit<PackageMovementInput, "requestId"> & { readonly targetLocationId: string | null };

export function parsePackageMovementInput(raw: unknown, operation: Operation): Value {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new AppError("VALIDATION_FAILED");
  const proto: unknown = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) throw new AppError("VALIDATION_FAILED");
  const r = raw as Record<string, unknown>;
  const allowed = ["packageId", "predecessorVersion", "currentBalanceVersion", "requestId", ...(operation === "PUTAWAY" ? ["targetLocationId"] : [])];
  if (Object.keys(r).some(k => !allowed.includes(k))) throw new AppError("VALIDATION_FAILED");
  if (typeof r.predecessorVersion !== "number" || !Number.isSafeInteger(r.predecessorVersion) || r.predecessorVersion < 0 || r.predecessorVersion >= 2_147_483_647) throw new AppError("VALIDATION_FAILED");
  if (typeof r.currentBalanceVersion !== "string" || !/^(0|[1-9]\d{0,18})$/.test(r.currentBalanceVersion) || BigInt(r.currentBalanceVersion) > 9_223_372_036_854_775_807n) throw new AppError("VALIDATION_FAILED");
  if (r.requestId !== undefined && r.requestId !== null && (typeof r.requestId !== "string" || r.requestId.length > 200 || /\p{C}/u.test(r.requestId))) throw new AppError("VALIDATION_FAILED");
  return { packageId: uuidOf(r.packageId), predecessorVersion: r.predecessorVersion, currentBalanceVersion: r.currentBalanceVersion,
    targetLocationId: operation === "PUTAWAY" ? uuidOf(r.targetLocationId) : null };
}

type State = {
  warehouse_id: string; item_id: string; unit_id: string; quantity: string; conversion_factor: string; base_quantity: string;
  lot_id: string | null; inventory_owner_id: string | null; serial_id: string | null; origin_status: string;
  previous_document_line_id: string; sequence_no: number; location_id: string; stock_status: string;
  stock_dimension_id: string; balance_version: string; balance_quantity: string; reserved_quantity: string; location_kind: string;
};
async function readState(tx: AccessTx, tenantId: string, packageId: string): Promise<State> {
  const rows = await tx.execute<State>(sql`SELECT d.warehouse_id,l.item_id,l.unit_id,l.quantity::text,l.conversion_factor::text,l.base_quantity::text,
    l.lot_id,l.inventory_owner_id,l.serial_id,d.status AS origin_status,
    coalesce(ms.document_line_id,l.id) AS previous_document_line_id,coalesce(ms.sequence_no,0) AS sequence_no,
    sd.location_id,sd.stock_status,sd.id AS stock_dimension_id,b.version::text AS balance_version,
    b.quantity::text AS balance_quantity,b.reserved_quantity::text,loc.kind AS location_kind
    FROM public.receipt_packages rp JOIN public.document_lines l ON l.tenant_id=rp.tenant_id AND l.id=rp.document_line_id
    JOIN public.documents d ON d.tenant_id=l.tenant_id AND d.id=l.document_id
    LEFT JOIN LATERAL (SELECT document_line_id,sequence_no FROM public.package_movement_steps
      WHERE tenant_id=rp.tenant_id AND handling_unit_id=rp.id ORDER BY sequence_no DESC LIMIT 1) ms ON true
    JOIN public.stock_dimensions sd ON sd.tenant_id=rp.tenant_id AND sd.handling_unit_id=rp.id
    JOIN public.stock_balances b ON b.tenant_id=sd.tenant_id AND b.stock_dimension_id=sd.id AND b.quantity>0
    JOIN public.locations loc ON loc.tenant_id=sd.tenant_id AND loc.id=sd.location_id
    WHERE rp.tenant_id=${tenantId}::uuid AND rp.id=${packageId}::uuid`);
  if (rows.length === 0) {
    const visible = await tx.execute<{ id: string }>(sql`SELECT id FROM public.receipt_packages WHERE tenant_id=${tenantId}::uuid AND id=${packageId}::uuid`);
    throw new AppError(visible.length === 0 ? "NOT_FOUND" : "VALIDATION_FAILED");
  }
  const s = rows[0];
  if (rows.length !== 1 || s === undefined || s.origin_status !== "POSTED" || s.serial_id !== null || s.inventory_owner_id !== null || decimalToMicro(s.balance_quantity) !== decimalToMicro(s.base_quantity)) throw new AppError("VALIDATION_FAILED");
  return s;
}
async function warehouseOf(tx: AccessTx, tenantId: string, packageId: string): Promise<string[]> {
  const rows = await tx.execute<{ warehouse_id: string }>(sql`SELECT d.warehouse_id FROM public.receipt_packages rp
    JOIN public.documents d ON d.tenant_id=rp.tenant_id AND d.id=rp.document_id WHERE rp.tenant_id=${tenantId}::uuid AND rp.id=${packageId}::uuid`);
  return rows.map(r => r.warehouse_id);
}
async function specOf(tx: AccessTx, tenantId: string, value: Value, operation: Operation, state: State): Promise<FieldPostSpec> {
  let target = state.location_id;
  if (operation === "QC_RELEASE") {
    if (state.stock_status !== "QUARANTINE") throw new AppError("VALIDATION_FAILED");
  } else {
    if (state.stock_status !== "AVAILABLE" || !["RECEIVING", "STORAGE"].includes(state.location_kind) || value.targetLocationId === null || value.targetLocationId === state.location_id) throw new AppError("VALIDATION_FAILED");
    const dst = await tx.execute<{ warehouse_id: string; kind: string }>(sql`SELECT warehouse_id,kind FROM public.locations WHERE tenant_id=${tenantId}::uuid AND id=${value.targetLocationId}::uuid`);
    if (dst[0] === undefined) throw new AppError("NOT_FOUND");
    if (dst[0].warehouse_id !== state.warehouse_id || dst[0].kind !== "STORAGE") throw new AppError("VALIDATION_FAILED");
    target = value.targetLocationId;
  }
  return { kind: "STOCK_MOVE", warehouseId: state.warehouse_id, sourceKind: null, sourceId: null,
    lines: [{ itemId: state.item_id, unitId: state.unit_id, quantity: state.quantity, conversionFactor: state.conversion_factor,
      baseQuantity: state.base_quantity, lotId: state.lot_id, handlingUnitId: value.packageId, sourceLocationId: state.location_id,
      targetLocationId: target, stockStatus: operation === "QC_RELEASE" ? "QUARANTINE" : "AVAILABLE", targetStockStatus: "AVAILABLE", sourceLineId: null }] };
}
function assertCurrent(locked: LockedState, value: Value, state: State): void {
  const balance = locked.balances.find(b => b.stockDimensionId === state.stock_dimension_id);
  if (state.sequence_no !== value.predecessorVersion || balance === undefined || balance.version !== value.currentBalanceVersion || state.balance_version !== balance.version || decimalToMicro(balance.quantity) !== decimalToMicro(state.base_quantity)) throw new AppError("VERSION_CONFLICT", { retryable: true });
  if (decimalToMicro(balance.reservedQuantity) !== 0n) throw new AppError("VALIDATION_FAILED");
}
async function move(params: StockDocCallParams, input: PackageMovementInput | PutawayPackageInput, operation: Operation): Promise<StockCommandResult & { readonly replayed: boolean }> {
  const value = parsePackageMovementInput(input, operation);
  const outcome = await executeStockCommand({ db: params.db, principal: params.principal, tenantSlug: params.tenantSlug, clientKey: params.clientKey,
    commandType: operation === "QC_RELEASE" ? "package.quality_release" : "package.putaway", permission: operation === "QC_RELEASE" ? "document.approve" : "stock.post", input: value,
    ...(params.retry === undefined ? {} : { retry: params.retry }), ...(params.timeouts === undefined ? {} : { timeouts: params.timeouts }), ...(params.logger === undefined ? {} : { logger: params.logger }),
    plan: async (tx, _input, m) => {
      try { return await planFieldPosting(tx, m.tenantId, await specOf(tx, m.tenantId, value, operation, await readState(tx, m.tenantId, value.packageId))); }
      catch (e) { if (!(e instanceof AppError)) throw e; return emptyPlan(await warehouseOf(tx, m.tenantId, value.packageId)); }
    },
    apply: async (tx, locked, ctx) => {
      const state = await readState(tx, ctx.tenantId, value.packageId);
      assertCurrent(locked, value, state);
      const spec = await specOf(tx, ctx.tenantId, value, operation, state);
      return postFieldDocument(tx, locked, ctx, spec, input.requestId ?? null, async (documentId, lineIds) => {
        const lineId = lineIds[0]; if (lineId === undefined) throw new AppError("INTERNAL");
        await tx.execute(sql`INSERT INTO public.package_movement_steps(tenant_id,handling_unit_id,document_id,document_line_id,operation,sequence_no,
          previous_document_line_id,source_location_id,target_location_id,source_stock_status,target_stock_status,base_quantity)
          VALUES(${ctx.tenantId}::uuid,${value.packageId}::uuid,${documentId}::uuid,${lineId}::uuid,${operation},${state.sequence_no + 1},
          ${state.previous_document_line_id}::uuid,${state.location_id}::uuid,${spec.lines[0]?.targetLocationId}::uuid,${state.stock_status},'AVAILABLE',${state.base_quantity}::numeric)`);
      });
    } });
  if (outcome.status !== "COMPLETED") throw new AppError("VERSION_CONFLICT", { retryable: true });
  return { ...outcome.result, replayed: outcome.replayed };
}
export const approvePackageQuality = (params: StockDocCallParams, input: PackageMovementInput) => move(params, input, "QC_RELEASE");
export const putawayPackage = (params: StockDocCallParams, input: PutawayPackageInput) => move(params, input, "PUTAWAY");
