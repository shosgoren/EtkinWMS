// T-933: metadata only. A QR identifies a package; tenant permission and warehouse ACL authorize it.
import { sql } from "drizzle-orm";
import type { HandlingUnitKind } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { runTenantQuery, type AccessTx, type Membership } from "../identity/access.ts";
import { assertWarehouseVisible } from "../warehouse/scope.ts";
import { uuidOf } from "./field-posting.ts";
import { decodePackageQr, encodePackageQr } from "./package-receipt-input.ts";
import type { TaskCallParams } from "./tasks.ts";

export interface ReceiptPackageView {
  readonly id: string;
  readonly qr: string;
  readonly packageNo: number;
  readonly kind: HandlingUnitKind;
  readonly receiptLineId: string;
  readonly documentLineId: string;
  readonly itemId: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly unitId: string;
  readonly unitCode: string;
  readonly unitName: string;
  readonly quantity: string;
  readonly conversionFactor: string;
  readonly baseQuantity: string;
  readonly receivingLocationId: string;
  readonly stockStatus: string;
  readonly lotId: string | null;
  readonly lotCode: string | null;
  readonly producedOn: string | null;
  readonly expiresOn: string | null;
}
export interface PackageReceiptView {
  readonly documentId: string;
  readonly documentStatus: string;
  readonly documentVersion: number;
  readonly documentNumber: string | null;
  readonly receiptId: string;
  readonly receiptStatus: string;
  readonly receiptVersion: number;
  readonly receiptNumber: string;
  readonly warehouseId: string;
  readonly supplierRef: string | null;
  readonly packages: readonly ReceiptPackageView[];
}
type HeaderRow = { document_id:string; document_status:string; document_version:number; document_number:string|null; receipt_id:string; receipt_status:string; receipt_version:number; receipt_number:string; warehouse_id:string; supplier_ref:string|null }
type PackageRow = { id:string; package_no:number; kind:HandlingUnitKind; receipt_line_id:string; document_line_id:string; item_id:string; item_code:string; item_name:string; unit_id:string; unit_code:string; unit_name:string; quantity:string; conversion_factor:string; base_quantity:string; target_location_id:string; stock_status:string; lot_id:string|null; lot_code:string|null; produced_on:string|null; expires_on:string|null }
export async function getPackageReceipt(params: TaskCallParams, input: {readonly documentId:string}): Promise<PackageReceiptView> {
  const documentId=uuidOf(input.documentId);
  return runTenantQuery({...params,permission:"stock.view"},(tx,m)=>readReceipt(tx,m,documentId));
}
async function readReceipt(tx:AccessTx,m:Membership,documentId:string):Promise<PackageReceiptView> {
    const heads=await tx.execute<HeaderRow>(sql`SELECT d.id AS document_id,d.status AS document_status,d.version AS document_version,d.number AS document_number,r.id AS receipt_id,r.status AS receipt_status,r.version AS receipt_version,r.number AS receipt_number,r.warehouse_id,r.supplier_ref FROM public.inbound_receipts r JOIN public.documents d ON d.tenant_id=r.tenant_id AND d.id=r.package_document_id WHERE r.tenant_id=${m.tenantId}::uuid AND d.id=${documentId}::uuid`);
    const h=heads[0]; if(h===undefined) throw new AppError("NOT_FOUND");
    await assertWarehouseVisible(tx,m,[h.warehouse_id]);
    const rows=await tx.execute<PackageRow>(sql`SELECT p.id,p.package_no,hu.kind,p.receipt_line_id,p.document_line_id,l.item_id,i.code AS item_code,i.name AS item_name,l.unit_id,u.code AS unit_code,u.name AS unit_name,l.quantity::text,l.conversion_factor::text,l.base_quantity::text,l.target_location_id,l.stock_status,l.lot_id,p.lot_code,p.produced_on::text,p.expires_on::text FROM public.receipt_packages p JOIN public.document_lines l ON l.tenant_id=p.tenant_id AND l.document_id=p.document_id AND l.id=p.document_line_id JOIN public.handling_units hu ON hu.tenant_id=p.tenant_id AND hu.id=p.id JOIN public.items i ON i.tenant_id=l.tenant_id AND i.id=l.item_id JOIN public.units u ON u.tenant_id=l.tenant_id AND u.id=l.unit_id WHERE p.tenant_id=${m.tenantId}::uuid AND p.document_id=${documentId}::uuid ORDER BY p.package_no`);
    return {documentId:h.document_id,documentStatus:h.document_status,documentVersion:Number(h.document_version),documentNumber:h.document_number,receiptId:h.receipt_id,receiptStatus:h.receipt_status,receiptVersion:Number(h.receipt_version),receiptNumber:h.receipt_number,warehouseId:h.warehouse_id,supplierRef:h.supplier_ref,
      packages:rows.map(r=>({id:r.id,qr:encodePackageQr(r.id),packageNo:Number(r.package_no),kind:r.kind,receiptLineId:r.receipt_line_id,documentLineId:r.document_line_id,itemId:r.item_id,itemCode:r.item_code,itemName:r.item_name,unitId:r.unit_id,unitCode:r.unit_code,unitName:r.unit_name,quantity:r.quantity,conversionFactor:r.conversion_factor,baseQuantity:r.base_quantity,receivingLocationId:r.target_location_id,stockStatus:r.stock_status,lotId:r.lot_id,lotCode:r.lot_code,producedOn:r.produced_on,expiresOn:r.expires_on}))};
}
export async function getReceiptPackage(params: TaskCallParams, input: {readonly packageId:string}): Promise<PackageReceiptView & {readonly package:ReceiptPackageView}> {
  const packageId=uuidOf(input.packageId);
  // Identity lookup and complete view share one authorized tenant transaction.
  return runTenantQuery({...params,permission:"stock.view"},async(tx,m)=> {
    const rows=await tx.execute<{ document_id:string; warehouse_id:string }>(sql`SELECT p.document_id,r.warehouse_id FROM public.receipt_packages p JOIN public.inbound_receipts r ON r.tenant_id=p.tenant_id AND r.id=p.receipt_id WHERE p.tenant_id=${m.tenantId}::uuid AND p.id=${packageId}::uuid`);
    const row=rows[0];if(row===undefined)throw new AppError("NOT_FOUND");
    await assertWarehouseVisible(tx,m,[row.warehouse_id]);
    const receipt=await readReceipt(tx,m,row.document_id);
    const found=receipt.packages.find(p=>p.id===packageId);
    if(found===undefined)throw new AppError("NOT_FOUND");
    return {...receipt,package:found};
  });
}
export async function resolvePackageQr(params: TaskCallParams, input: {readonly qr:string}) {
  return getReceiptPackage(params,{packageId:decodePackageQr(input.qr)});
}
