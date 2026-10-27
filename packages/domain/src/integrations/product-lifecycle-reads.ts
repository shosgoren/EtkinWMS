// Read-only stock/open-work usage. Catalog writes stay in product-lifecycle.ts; G-01 remains intact.
import {sql} from "drizzle-orm";
import type {AccessTx} from "../identity/access.ts";
export async function productLifecycleBusy(tx:AccessTx,t:string,id:string):Promise<boolean> {
 const r=await tx.execute<{busy:boolean}>(sql`SELECT (
 EXISTS(SELECT 1 FROM public.stock_balances b JOIN public.stock_dimensions d ON d.tenant_id=b.tenant_id AND d.id=b.stock_dimension_id WHERE d.tenant_id=${t}::uuid AND d.item_id=${id}::uuid AND (b.quantity<>0 OR b.reserved_quantity<>0))
 OR EXISTS(SELECT 1 FROM public.reservations WHERE tenant_id=${t}::uuid AND item_id=${id}::uuid AND status='ACTIVE')
 OR EXISTS(SELECT 1 FROM public.document_lines l JOIN public.documents d ON d.tenant_id=l.tenant_id AND d.id=l.document_id WHERE l.tenant_id=${t}::uuid AND l.item_id=${id}::uuid AND d.status IN ('DRAFT','APPROVED'))
 OR EXISTS(SELECT 1 FROM public.inbound_receipt_lines l JOIN public.inbound_receipts h ON h.tenant_id=l.tenant_id AND h.id=l.receipt_id WHERE l.tenant_id=${t}::uuid AND l.item_id=${id}::uuid AND h.status IN ('DRAFT','OPEN') AND l.expected_quantity>l.received_quantity)
 OR EXISTS(SELECT 1 FROM public.sales_order_lines l JOIN public.sales_orders h ON h.tenant_id=l.tenant_id AND h.id=l.order_id WHERE l.tenant_id=${t}::uuid AND l.item_id=${id}::uuid AND h.status='OPEN' AND l.requested_quantity>l.shipped_quantity+l.cancelled_quantity)
 OR EXISTS(SELECT 1 FROM public.warehouse_tasks WHERE tenant_id=${t}::uuid AND item_id=${id}::uuid AND status IN ('OPEN','ASSIGNED'))
 OR EXISTS(SELECT 1 FROM public.count_session_lines l JOIN public.count_sessions h ON h.tenant_id=l.tenant_id AND h.id=l.session_id WHERE l.tenant_id=${t}::uuid AND l.item_id=${id}::uuid AND h.status IN ('COUNTING','SUBMITTED','APPROVED'))
 ) AS busy`);return r[0]?.busy!==false;
}
