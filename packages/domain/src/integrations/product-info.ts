// T-1062: kaynak yanıtını saklamak yerine yalnız izinli miktarsal kart alanlarını seçer.
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { runTenantQuery, type AccessTx } from "../identity/access.ts";
import { parseUuid, type CatalogCommandParams } from "../catalog/units.ts";
import type { ApplyContext } from "./apply.ts";
import type { JsonApiResource } from "./parasut.ts";

export interface ProductSourceInfo {
  readonly unit?: string | null;
  readonly gtip?: string | null;
  readonly categoryId?: string | null;
  readonly categoryName?: string | null;
  readonly archived?: boolean | null;
  readonly inventoryTracking?: boolean | null;
  /** Read-only derived lifecycle; never written into provider JSON. */
  readonly lifecycle?: "NONE"|"PENDING"|"ARCHIVED"|"REMOVED";
  readonly sourceState?: "ACTIVE"|"ARCHIVED"|"DELETED";
}

function text(raw: unknown, max: number): string | null {
  if (raw === null) return null;
  if (typeof raw !== "string" || raw.length > max || /\p{C}/u.test(raw)) throw new AppError("VALIDATION_FAILED");
  return raw.normalize("NFC").trim() || null;
}
function flag(raw: unknown): boolean | null {
  if (raw === null || typeof raw === "boolean") return raw;
  throw new AppError("VALIDATION_FAILED");
}

/** T-1135: satırı düşürmeyen uyarılar (koşu sayacına ve koşu audit'ine girer; dış kimlik taşımaz). */
export type ProductSourceWarning = "CATEGORY_UNRESOLVED";

export interface ParsedProductSource {
  readonly info: ProductSourceInfo;
  readonly warnings: readonly ProductSourceWarning[];
}

/** Eksik alan patch'e girmez; açık null temizler. Fiyat/vergi/döviz/miktar asla seçilmez. Kategori çözülemezse satır düşmez (uyarı). */
export function productSourceInfo(r: JsonApiResource, included: readonly JsonApiResource[] = []): ProductSourceInfo {
  return parseProductSource(r, included).info;
}

/**
 * Kategori ilişkisi var ama `included` içinde yok ya da türü "Product" değilse (T-1135): ürün KATEGORİSİZ alınır (categoryId/categoryName
 * null — önceki kategori adı yeni kimlikle karışmaz) ve `CATEGORY_UNRESOLVED` uyarısı döner; satır başarısız sayılmaz.
 */
export function parseProductSource(r: JsonApiResource, included: readonly JsonApiResource[] = []): ParsedProductSource {
  const a = r.attributes;
  const warnings: ProductSourceWarning[] = [];
  const result: { -readonly [K in keyof ProductSourceInfo]: ProductSourceInfo[K] } = {};
  if ("unit" in a) result.unit = text(a.unit, 64);
  if ("gtip" in a) result.gtip = text(a.gtip, 64);
  if ("archived" in a) result.archived = flag(a.archived);
  if ("inventory_tracking" in a) result.inventoryTracking = flag(a.inventory_tracking);
  const relationship = r.relationships.category;
  if (relationship !== undefined) {
    if (relationship === null || typeof relationship !== "object" || !("data" in relationship)) throw new AppError("VALIDATION_FAILED");
    const data: unknown = relationship.data;
    if (data === null) {
      result.categoryId = null;
      result.categoryName = null;
    } else {
      if (typeof data !== "object" || !("type" in data) || data.type !== "item_categories" || !("id" in data)) throw new AppError("VALIDATION_FAILED");
      const id = text(data.id, 255);
      if (id === null) throw new AppError("VALIDATION_FAILED");
      const category = included.find((c) => c.type === "item_categories" && c.id === id);
      if (category === undefined || category.attributes.category_type !== "Product") {
        // Yeni kategori adına erişilemiyor ya da ürün kategorisi değil: önceki kategori adı tutulmaz, ürün kategorisiz alınır.
        result.categoryId = null;
        result.categoryName = null;
        warnings.push("CATEGORY_UNRESOLVED");
      } else {
        result.categoryId = id;
        result.categoryName = text(category.attributes.name, 200);
      }
    }
  }
  return { info: result, warnings };
}

export async function saveProductSourceInfo(tx: AccessTx, c: ApplyContext, itemId: string, patch: ProductSourceInfo | undefined): Promise<boolean> {
  if (patch === undefined || Object.keys(patch).length === 0) return false;
  const rows = await tx.execute<{ id: string }>(sql`UPDATE public.items
    SET source_product_info = jsonb_set(source_product_info, ARRAY[${c.system}]::text[], COALESCE(source_product_info->${c.system}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)
    WHERE tenant_id=${c.tenantId}::uuid AND id=${itemId}::uuid
      AND COALESCE(source_product_info->${c.system}, '{}'::jsonb) IS DISTINCT FROM (COALESCE(source_product_info->${c.system}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)
    RETURNING id`);
  if (rows.length === 0) return false;
  await appendAudit(tx, { action: "item.updated", actorUserId: c.actorUserId, entityType: "item", entityId: itemId,
    changeSummary: { via: "integration", system: c.system, sourceFields: Object.keys(patch) } });
  return true;
}

/** WMS stok/takip kurallarından ayrı, bilgilendirme amaçlı kaynak kart alanları. */
export async function getProductSourceInfo(params: CatalogCommandParams, rawItemId: string): Promise<Readonly<Record<string, ProductSourceInfo>>> {
  const itemId = parseUuid(rawItemId);
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, actor) => {
    const r = await tx.execute<{ info: Record<string, ProductSourceInfo>; source_disposition:NonNullable<ProductSourceInfo["lifecycle"]>;source_state:NonNullable<ProductSourceInfo["sourceState"]> }>(sql`SELECT source_product_info AS info,source_disposition,source_state FROM public.items WHERE tenant_id=${actor.tenantId}::uuid AND id=${itemId}::uuid`);
    if (r[0] === undefined) throw new AppError("NOT_FOUND");
    const row=r[0];return {...row.info,...(row.info.PARASUT&&row.source_disposition!=="NONE"?{PARASUT:{...row.info.PARASUT,lifecycle:row.source_disposition,sourceState:row.source_state}}:{})};
  });
}
