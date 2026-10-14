// T-943: immutable origin metadata and current physical balance are deliberately distinct.
import { sql } from "drizzle-orm";
import { AppError } from "@wms/shared/errors";
import { runTenantQuery } from "../identity/access.ts";
import { hasPermission } from "../identity/permissions.ts";
import { assertWarehouseVisible } from "../warehouse/scope.ts";
import type { TaskCallParams } from "./tasks.ts";
import { uuidOf } from "./field-posting.ts";
import { decodePackageQr, encodePackageQr } from "./package-receipt-input.ts";
export interface CurrentPackageDto {
  readonly id: string; readonly qr: string; readonly kind: string; readonly packageNo: number;
  readonly itemId: string; readonly itemCode: string; readonly itemName: string;
  readonly baseUnitId: string; readonly baseUnitCode: string; readonly baseUnitName: string;
  readonly originBaseQuantity: string; readonly currentBaseQuantity: string;
  readonly lotId: string | null; readonly lotCode: string | null; readonly producedOn: string | null; readonly expiresOn: string | null;
  readonly warehouseId: string; readonly warehouseCode: string; readonly warehouseName: string;
  readonly currentLocation: { readonly id: string; readonly code: string; readonly name: string; readonly kind: string } | null;
  readonly currentStockStatus: string | null; readonly predecessorVersion: number; readonly currentBalanceVersion: string | null;
  readonly canTransfer: boolean;
  readonly allowedActions: readonly ("QC_RELEASE" | "PUTAWAY")[];
  readonly blockedReason: null | "DRAFT" | "NO_PERMISSION" | "UNSUPPORTED_STATE";
}
type Row = {
  id: string; kind: string; package_no: number; item_id: string; item_code: string; item_name: string; base_unit_id: string; base_unit_code: string; base_unit_name: string;
  base_quantity: string; lot_id: string | null; lot_code: string | null; produced_on: string | null; expires_on: string | null;
  warehouse_id: string; warehouse_code: string; warehouse_name: string; document_status: string; warehouse_status: string; item_status: string; tracking_mode: string;
  expected_warehouse_id: string; sequence_no: number; latest_location: string; latest_status: string; positives: number;
  current_quantity: string | null; current_version: string | null; current_status: string | null; reserved_quantity: string | null;
  location_id: string | null; location_code: string | null; location_name: string | null; location_kind: string | null; location_status: string | null;
};
export async function getCurrentPackage(params: TaskCallParams, input: { readonly packageId: string }): Promise<CurrentPackageDto> {
  const packageId = uuidOf(input.packageId);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, m) => {
    const rows = await tx.execute<Row>(sql`SELECT rp.id,hu.kind,rp.package_no,l.item_id,i.code AS item_code,i.name AS item_name,
      i.base_unit_id,u.code AS base_unit_code,u.name AS base_unit_name,l.base_quantity::text,l.lot_id,rp.lot_code,rp.produced_on::text,rp.expires_on::text,
      w.id AS warehouse_id,coalesce(terminal.warehouse_id,d.warehouse_id) AS expected_warehouse_id,w.code AS warehouse_code,w.name AS warehouse_name,d.status AS document_status,w.status AS warehouse_status,i.status AS item_status,i.tracking_mode,
      coalesce(ms.sequence_no,0) AS sequence_no,coalesce(ms.target_location_id,l.target_location_id) AS latest_location,
      coalesce(ms.target_stock_status,l.stock_status) AS latest_status,
      (SELECT count(*)::int FROM public.stock_dimensions x JOIN public.stock_balances b ON b.tenant_id=x.tenant_id AND b.stock_dimension_id=x.id
        WHERE x.tenant_id=rp.tenant_id AND x.handling_unit_id=rp.id AND b.quantity>0) AS positives,
      b.quantity::text AS current_quantity,b.version::text AS current_version,sd.stock_status AS current_status,b.reserved_quantity::text,
      loc.id AS location_id,loc.code AS location_code,loc.name AS location_name,loc.kind AS location_kind,loc.status AS location_status
      FROM public.receipt_packages rp JOIN public.handling_units hu ON hu.tenant_id=rp.tenant_id AND hu.id=rp.id
      JOIN public.document_lines l ON l.tenant_id=rp.tenant_id AND l.id=rp.document_line_id
      JOIN public.documents d ON d.tenant_id=l.tenant_id AND d.id=l.document_id
      JOIN public.items i ON i.tenant_id=l.tenant_id AND i.id=l.item_id
      JOIN public.units u ON u.tenant_id=i.tenant_id AND u.id=i.base_unit_id
      LEFT JOIN LATERAL(SELECT document_id,sequence_no,target_location_id,target_stock_status FROM public.package_movement_steps
        WHERE tenant_id=rp.tenant_id AND handling_unit_id=rp.id ORDER BY sequence_no DESC LIMIT 1) ms ON true
      LEFT JOIN public.documents terminal ON terminal.tenant_id=rp.tenant_id AND terminal.id=ms.document_id
      LEFT JOIN LATERAL(SELECT x.* FROM public.stock_dimensions x JOIN public.stock_balances y ON y.tenant_id=x.tenant_id AND y.stock_dimension_id=x.id
        WHERE x.tenant_id=rp.tenant_id AND x.handling_unit_id=rp.id AND y.quantity>0 ORDER BY x.id LIMIT 1) sd ON true
      LEFT JOIN public.stock_balances b ON b.tenant_id=sd.tenant_id AND b.stock_dimension_id=sd.id
      LEFT JOIN public.locations loc ON loc.tenant_id=sd.tenant_id AND loc.id=sd.location_id
      JOIN public.warehouses w ON w.tenant_id=rp.tenant_id AND w.id=coalesce(loc.warehouse_id,terminal.warehouse_id,d.warehouse_id)
      WHERE rp.tenant_id=${m.tenantId}::uuid AND rp.id=${packageId}::uuid`);
    const r = rows[0]; if (r === undefined) throw new AppError("NOT_FOUND");
    await assertWarehouseVisible(tx, m, [r.warehouse_id]);
    const supported = r.warehouse_id === r.expected_warehouse_id && r.positives === 1 && r.current_quantity === r.base_quantity && r.location_id === r.latest_location && r.current_status === r.latest_status
      && r.reserved_quantity === "0.000000" && r.warehouse_status === "ACTIVE" && r.item_status === "ACTIVE" && r.location_status === "ACTIVE"
      && !["SERIAL", "LOT_AND_SERIAL"].includes(r.tracking_mode);
    const allowed: ("QC_RELEASE" | "PUTAWAY")[] = [];
    if (r.document_status === "POSTED" && supported) {
      if (r.current_status === "QUARANTINE" && hasPermission(m.roles, "document.approve")) allowed.push("QC_RELEASE");
      if (r.current_status === "AVAILABLE" && ["RECEIVING", "STORAGE"].includes(r.location_kind ?? "") && hasPermission(m.roles, "stock.post")) allowed.push("PUTAWAY");
    }
    return { id: r.id, qr: encodePackageQr(r.id), kind: r.kind, packageNo: Number(r.package_no), itemId: r.item_id, itemCode: r.item_code, itemName: r.item_name,
      baseUnitId: r.base_unit_id, baseUnitCode: r.base_unit_code, baseUnitName: r.base_unit_name, originBaseQuantity: r.base_quantity,
      currentBaseQuantity: r.current_quantity ?? "0.000000", lotId: r.lot_id, lotCode: r.lot_code, producedOn: r.produced_on, expiresOn: r.expires_on,
      warehouseId: r.warehouse_id, warehouseCode: r.warehouse_code, warehouseName: r.warehouse_name,
      currentLocation: r.location_id === null ? null : { id: r.location_id, code: r.location_code ?? "", name: r.location_name ?? "", kind: r.location_kind ?? "" },
      currentStockStatus: r.current_status, predecessorVersion: Number(r.sequence_no), currentBalanceVersion: r.current_version,
      canTransfer: r.document_status === "POSTED" && supported && r.current_status === "AVAILABLE" && ["RECEIVING", "STORAGE"].includes(r.location_kind ?? "") && hasPermission(m.roles, "stock.post"),
      allowedActions: allowed, blockedReason: r.document_status !== "POSTED" ? "DRAFT" : !supported ? "UNSUPPORTED_STATE" : allowed.length === 0 ? "NO_PERMISSION" : null };
  });
}
export const resolveCurrentPackageQr = async (params: TaskCallParams, input: { readonly qr: string }) => getCurrentPackage(params, { packageId: decodePackageQr(input.qr) });
