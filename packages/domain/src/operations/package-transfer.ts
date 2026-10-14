// T-947: one immutable package step and two linked stock documents, one existing-engine transaction.
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import type { AccessTx } from "../identity/access.ts";
import { executeStockCommand, postApprovedDocumentInTx, type StockDocCallParams } from "../stock/index.ts";
import { emptyPlan, planFieldPosting, prepareFieldDocument, type FieldPostSpec } from "./field-posting.ts";
import { assertPackageCurrent, packageWarehouseIds, parsePackageMovementInput, readPackageState, packageQuantityForBase, type PutawayPackageInput } from "./package-movement.ts";
import { mergeFieldPlans } from "./warehouse-transfer.ts";

export type PackageTransferInput = PutawayPackageInput;
/** Reuse the strict package/version parser; none of the source stock facts come from the client. */
export const parsePackageTransferInput = (raw: unknown) => parsePackageMovementInput(raw, "PUTAWAY");
type Value = ReturnType<typeof parsePackageTransferInput>;
type State = Awaited<ReturnType<typeof readPackageState>>;
async function targetLocation(tx: AccessTx, tenantId: string, value: Value) {
  const rows = await tx.execute<{ id: string; warehouse_id: string; kind: string; status: string }>(sql`SELECT id,warehouse_id,kind,status FROM public.locations WHERE tenant_id=${tenantId}::uuid AND id=${value.targetLocationId}::uuid`);
  const row = rows[0]; if (row === undefined) throw new AppError("NOT_FOUND"); return row;
}
async function specs(tx: AccessTx, tenantId: string, value: Value, state: State): Promise<readonly [FieldPostSpec, FieldPostSpec]> {
  const target = await targetLocation(tx, tenantId, value);
  if (state.stock_status !== "AVAILABLE" || !["RECEIVING", "STORAGE"].includes(state.location_kind) || target.kind !== "STORAGE" || target.status !== "ACTIVE" || target.warehouse_id === state.warehouse_id) throw new AppError("VALIDATION_FAILED");
  const line = { itemId: state.item_id, unitId: state.unit_id, quantity: packageQuantityForBase(state,state.remaining_base_quantity), conversionFactor: state.conversion_factor,
    baseQuantity: state.remaining_base_quantity, lotId: state.lot_id, handlingUnitId: value.packageId, stockStatus: "AVAILABLE" as const, targetStockStatus: null, sourceLineId: null };
  return [
    { kind: "STOCK_OUT", warehouseId: state.warehouse_id, sourceKind: null, sourceId: null, reason: "PACKAGE_TRANSFER", lines: [{ ...line, sourceLocationId: state.location_id, targetLocationId: null }] },
    { kind: "STOCK_IN", warehouseId: target.warehouse_id, sourceKind: null, sourceId: null, reason: "PACKAGE_TRANSFER", lines: [{ ...line, sourceLocationId: null, targetLocationId: target.id }] },
  ];
}
export async function transferPackage(params: StockDocCallParams, input: PackageTransferInput) {
  const value = parsePackageTransferInput(input);
  const outcome = await executeStockCommand({ db: params.db, principal: params.principal, tenantSlug: params.tenantSlug, clientKey: params.clientKey,
    commandType: "package.warehouse_transfer", permission: "stock.post", input: value,
    ...(params.retry === undefined ? {} : { retry: params.retry }), ...(params.timeouts === undefined ? {} : { timeouts: params.timeouts }), ...(params.logger === undefined ? {} : { logger: params.logger }),
    plan: async (tx, _i, m) => {
      try {
        const pair = await specs(tx, m.tenantId, value, await readPackageState(tx, m.tenantId, value.packageId));
        const plans = []; for (const spec of pair) plans.push(await planFieldPosting(tx, m.tenantId, spec));
        return mergeFieldPlans(plans);
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        const source = await packageWarehouseIds(tx, m.tenantId, value.packageId);
        const target = await tx.execute<{ warehouse_id: string }>(sql`SELECT warehouse_id FROM public.locations WHERE tenant_id=${m.tenantId}::uuid AND id=${value.targetLocationId}::uuid`);
        return emptyPlan([...new Set([...source, ...target.map(r => r.warehouse_id)])]);
      }
    },
    apply: async (tx, locked, ctx) => {
      const current = await readPackageState(tx, ctx.tenantId, value.packageId); assertPackageCurrent(locked, value, current);
      const [source, target] = await specs(tx, ctx.tenantId, value, current);
      // Actual parent documents/lines exist before registering the step; no future UUID/deferred-FK adoption.
      const out = await prepareFieldDocument(tx, ctx, source), into = await prepareFieldDocument(tx, ctx, target);
      const outLine = out.lineIds[0], inLine = into.lineIds[0]; if (outLine === undefined || inLine === undefined) throw new AppError("INTERNAL");
      await tx.execute(sql`INSERT INTO public.package_movement_steps(tenant_id,handling_unit_id,document_id,document_line_id,operation,sequence_no,
        previous_document_line_id,source_location_id,target_location_id,source_stock_status,target_stock_status,base_quantity,source_document_id,source_document_line_id)
        VALUES(${ctx.tenantId}::uuid,${value.packageId}::uuid,${into.documentId}::uuid,${inLine}::uuid,'WAREHOUSE_TRANSFER',${current.sequence_no + 1},
        ${current.previous_document_line_id}::uuid,${current.location_id}::uuid,${value.targetLocationId}::uuid,'AVAILABLE','AVAILABLE',${current.remaining_base_quantity}::numeric,${out.documentId}::uuid,${outLine}::uuid)`);
      // The existing link schema permits actual APPROVED parents; final package validation is deferred to commit.
      await tx.execute(sql`INSERT INTO public.stock_document_links(tenant_id,source_document_id,target_document_id,kind)
        VALUES(${ctx.tenantId}::uuid,${out.documentId}::uuid,${into.documentId}::uuid,'TRANSFER')`);
      const removed = await postApprovedDocumentInTx(tx, locked, ctx, out.documentId, { requestId: input.requestId ?? null, consumes: out.consumes });
      const received = await postApprovedDocumentInTx(tx, locked, ctx, into.documentId, { requestId: input.requestId ?? null, consumes: into.consumes });
      if (removed.numbering === undefined || received.numbering === undefined || removed.audit === null || received.audit === null) throw new AppError("INTERNAL");
      await appendAudit(tx, { ...removed.audit, actorUserId: ctx.userId });
      // Canonical result is the terminal IN; both real numbering steps remain the command's final locks.
      return { ...received, additionalNumbering: [removed.numbering] };
    } });
  if (outcome.status !== "COMPLETED") throw new AppError("VERSION_CONFLICT", { retryable: true });
  return { ...outcome.result, replayed: outcome.replayed };
}
