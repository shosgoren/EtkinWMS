// T-969 (B-86): OKUT ekranında okutulan kodu çözen TEK okuma sorgusu. `runTenantQuery` + `stock.view`; `tenant_id` yalnız doğrulanmış
// üyelikten gelir ve her sorguda AÇIK süzgeçtir (RLS ikinci savunma). Depo kapsamı (A-46) teslim ve lokasyon aramasında uygulanır: kapsam
// dışı depodaki teslim/lokasyon görünmez. Başka tenant'ın kodu `unknown` döner (varlık sızmaz). Yazma yok; yönlendirme kararı (hangi ekran)
// web katmanındadır — burada yalnız "bu kod nedir" sorusu yanıtlanır. Sıra: ürün barkodu (`resolveBarcode`, GS1 dahil) → ürün kodu →
// açık teslim numarası → lokasyon kodu. Ürün bulunursa aynı ürünün AÇIK satırı olan en eski açık teslim de döner (bekleyen kabul işi).
import { sql } from "drizzle-orm";
import { AppError } from "@wms/shared/errors";
import { resolveBarcode } from "../catalog/barcodes.ts";
import { runTenantQuery } from "../identity/access.ts";
import { pgUuidArray, resolveWarehouseScope } from "../warehouse/scope.ts";
import type { TaskCallParams } from "./tasks.ts";

export const FIELD_SCAN_CODE_MAX = 256;

export interface FieldScanReceipt {
  readonly id: string;
  readonly number: string;
}
export type FieldScanResult =
  | {
      readonly kind: "item";
      readonly itemId: string;
      readonly itemCode: string;
      readonly itemName: string;
      /** Bu ürünün açık (beklenen > kabul) satırı olan en eski açık teslim; yoksa `null`. */
      readonly receipt: FieldScanReceipt | null;
    }
  | { readonly kind: "receipt"; readonly receipt: FieldScanReceipt }
  | { readonly kind: "location"; readonly locationId: string; readonly warehouseId: string; readonly code: string; readonly name: string }
  | { readonly kind: "unknown"; readonly reason: "not_found" | "ambiguous" };

/** Kod: kırpılır; boş, çok uzun ya da denetim karakterli değer `VALIDATION_FAILED`. */
function codeOf(raw: unknown): string {
  if (typeof raw !== "string") throw new AppError("VALIDATION_FAILED");
  const v = raw.normalize("NFC").trim();
  const control = [...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
  if (v === "" || v.length > FIELD_SCAN_CODE_MAX || control) throw new AppError("VALIDATION_FAILED");
  return v;
}
/** Kod karşılaştırması için ASCII büyük harf (depo/ürün kodu normalleştirmesiyle aynı; `normalizeCode`). */
const upper = (v: string): string => v.replace(/[a-z]/g, (c) => c.toUpperCase());

export async function resolveFieldScan(params: TaskCallParams, input: { readonly code: string }): Promise<FieldScanResult> {
  const code = codeOf(input.code);
  const key = upper(code);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, m) => {
    const scope = await resolveWarehouseScope(tx, m);
    const inScope = scope === null ? null : pgUuidArray(scope);

    // 1) Ürün: barkod (GS1 dahil) → yoksa ürün kodu (yalnız etkin ürün).
    let item: { id: string; code: string; name: string } | null = null;
    try {
      const r = await resolveBarcode(tx, m.tenantId, code);
      const rows = await tx.execute<{ id: string; code: string; name: string }>(
        sql`SELECT id, code, name FROM public.items WHERE tenant_id = ${m.tenantId}::uuid AND id = ${r.itemId}::uuid`,
      );
      item = rows[0] ?? null;
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      if (e.code === "VALIDATION_FAILED" && e.detail === "BARCODE_AMBIGUOUS") return { kind: "unknown", reason: "ambiguous" };
      if (e.code !== "NOT_FOUND" && e.code !== "VALIDATION_FAILED") throw e;
    }
    if (item === null) {
      const rows = await tx.execute<{ id: string; code: string; name: string }>(
        sql`SELECT id, code, name FROM public.items WHERE tenant_id = ${m.tenantId}::uuid AND code = ${key} AND status = 'ACTIVE' LIMIT 1`,
      );
      item = rows[0] ?? null;
    }
    if (item !== null) {
      const open = await tx.execute<{ id: string; number: string }>(
        sql`SELECT r.id, r.number FROM public.inbound_receipts r
             WHERE r.tenant_id = ${m.tenantId}::uuid AND r.status = 'OPEN'
               AND (${inScope}::uuid[] IS NULL OR r.warehouse_id = ANY(${inScope}::uuid[]))
               AND EXISTS (SELECT 1 FROM public.inbound_receipt_lines x
                            WHERE x.tenant_id = r.tenant_id AND x.receipt_id = r.id AND x.item_id = ${item.id}::uuid
                              AND x.expected_quantity > x.received_quantity)
             ORDER BY r.created_at, r.id
             LIMIT 1`,
      );
      const r0 = open[0];
      return { kind: "item", itemId: item.id, itemCode: item.code, itemName: item.name, receipt: r0 === undefined ? null : { id: r0.id, number: r0.number } };
    }

    // 2) Açık teslim numarası (irsaliye / teslim etiketi).
    const receipt = await tx.execute<{ id: string; number: string }>(
      sql`SELECT r.id, r.number FROM public.inbound_receipts r
           WHERE r.tenant_id = ${m.tenantId}::uuid AND r.status = 'OPEN' AND upper(r.number) = ${key}
             AND (${inScope}::uuid[] IS NULL OR r.warehouse_id = ANY(${inScope}::uuid[]))
           ORDER BY r.created_at, r.id
           LIMIT 1`,
    );
    if (receipt[0] !== undefined) return { kind: "receipt", receipt: { id: receipt[0].id, number: receipt[0].number } };

    // 3) Lokasyon (raf / göz) kodu: görünür depolarda etkin lokasyon. Aynı kod birden çok depoda varsa sessizce biri seçilmez.
    const locs = await tx.execute<{ id: string; warehouse_id: string; code: string; name: string }>(
      sql`SELECT l.id, l.warehouse_id, l.code, l.name FROM public.locations l
            JOIN public.warehouses w ON w.tenant_id = l.tenant_id AND w.id = l.warehouse_id AND w.status = 'ACTIVE'
           WHERE l.tenant_id = ${m.tenantId}::uuid AND l.code = ${key} AND l.status = 'ACTIVE'
             AND (${inScope}::uuid[] IS NULL OR l.warehouse_id = ANY(${inScope}::uuid[]))
           ORDER BY l.warehouse_id, l.id
           LIMIT 2`,
    );
    if (locs.length > 1) return { kind: "unknown", reason: "ambiguous" };
    const loc = locs[0];
    if (loc !== undefined) return { kind: "location", locationId: loc.id, warehouseId: loc.warehouse_id, code: loc.code, name: loc.name };
    return { kind: "unknown", reason: "not_found" };
  });
}
