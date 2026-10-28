// T-981b: ekran bazlı Excel dışa aktarma (Ürünler, Cariler, Depolar, Raflar, Açılış stoku). Yalnız OKUMA + `data.exported` audit'i.
//
// - Yetki: `data.import` (hesap sahibi her zaman; diğerlerine yalnız özel yetki grubuyla, MFA zorunlu — MFA_GRANTS). Gerekçe: ayrı bir
//   `data.export` izni yok; dosya aynı içe aktarma şablonudur (geri yüklenebilir), dolayısıyla toplu veri dosyasını yöneten izinle sınırlanır.
//   Bu, mevcut izinler içinde en dar olanıdır (`stock.view` her üyede vardır; `takeout.request` tam veri teslimi içindir, B-67).
// - Kiracı: `runTenantQuery` (doğrulanmış üyelik + transaction-yerel bağlam, RLS; I-01/I-02). Depo kapsamı: `resolveWarehouseScope` —
//   depo, raf ve stok satırları yalnız kapsamdaki depolardan (kapsam dışı depo görünmez, varlık sızmaz).
// - Kişisel veri (B-67): cari VKN/TCKN, vergi dairesi, telefon, e-posta ve adres sütunları yalnız `settings.manage` (cariyi düzenleyebilen)
//   üyede doldurulur; diğerinde sütun BOŞ gelir (içe aktarmada boş hücre mevcut değeri silmez — dosya yine güvenle geri yüklenir).
//   Kişisel sütunlu cari dosyası (toplu kişisel veri çıkışı) ayrıca YENİDEN DOĞRULAMA ister (`recentAuth`, denetim kaydı dışa aktarmasıyla aynı
//   A-39 kuralı; güvenlik incelemesi MINOR-2): çalınmış ama MFA'lı oturumla tüm cari iletişim listesi indirilemez. `recentAuth` yoksa ret (fail-closed).
// - Sınır: en çok `EXPORT_MAX_ROWS` satır (içe aktarma sınırıyla aynı; dosya tek seferde geri yüklenebilsin). Fazlası kesilir, `truncated`
//   bildirilir (sahte "tamamı" yok). Tek kısa transaction, OFFSET yok (I-14: 5.000 satır kısa okumadır).
// - Audit (I-12): her dışa aktarma aynı transaction'da `data.exported` — kim (aktör), ne (tür), kaç satır, kesildi mi, arama var mı. Arama
//   metninin kendisi yazılmaz (kişisel veri içerebilir).
// - Sütunlar içe aktarma şablonuyla AYNI (başlıklar Aktar eşleştirme sözlüğünde birebir bulunur); dosya düzenlenip geri yüklenebilir.
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { hasPermission } from "../identity/permissions.ts";
import { runTenantQuery, type TenantAccessParams } from "../identity/access.ts";
import { pgUuidArray, resolveWarehouseScope } from "../warehouse/scope.ts";
import { IMPORT_MAX_ROWS, PACK_UNIT_CODE, PRODUCT_HEADERS, STOCK_HEADERS } from "./import-parse.ts";

export const EXPORT_KINDS = ["items", "parties", "warehouses", "locations", "stock"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
/** Dosya başına en çok satır (içe aktarma sınırıyla aynı). */
export const EXPORT_MAX_ROWS = IMPORT_MAX_ROWS;

export const PARTY_EXPORT_HEADERS = ["Cari kodu", "Unvan", "VKN/TCKN", "Vergi dairesi", "Telefon", "E-posta", "İl", "Adres", "Tür", "Kısa ad", "İlçe", "Teslimat"] as const;
export const WAREHOUSE_EXPORT_HEADERS = ["depo kodu", "depo adı"] as const;
export const LOCATION_EXPORT_HEADERS = ["depo kodu", "raf kodu", "raf adı", "üst raf kodu", "tür"] as const;

/** Şablon başlıkları (boş şablon indirme ve dışa aktarma aynı başlıkları kullanır). */
export const EXPORT_HEADERS: Readonly<Record<ExportKind, readonly string[]>> = {
  items: PRODUCT_HEADERS,
  parties: PARTY_EXPORT_HEADERS,
  warehouses: WAREHOUSE_EXPORT_HEADERS,
  locations: LOCATION_EXPORT_HEADERS,
  stock: STOCK_HEADERS,
};

const PARTY_KIND_LABEL: Readonly<Record<string, string>> = { CUSTOMER: "Müşteri", SUPPLIER: "Tedarikçi", BOTH: "İkisi de" };
// T-1117: teslimat etiketi Aktar'da geri okunur (`parseDeliveryMode`: "kendi…" → OWN, "kargo…" → CARRIER).
const PARTY_DELIVERY_LABEL: Readonly<Record<string, string>> = { OWN: "Kendi personelim", CARRIER: "Kargo firması" };
/** Raf türü etiketi (içe aktarma `parseLocationKind` bu etiketleri ve teknik kodları tanır). */
export const LOCATION_KIND_LABEL: Readonly<Record<string, string>> = { RECEIVING: "Kabul", STORAGE: "Depolama", STAGING: "Sevk", TRANSIT: "Yolda" };

export type ExportParams = Omit<TenantAccessParams, "permission"> & { readonly requestId?: string };

export interface ExportInput {
  readonly kind: ExportKind;
  /** Ekrandaki arama (kod / ad içinde; en çok 100 karakter). */
  readonly q?: string;
  /** Raflar: yalnız bu depo (lokasyon ağacı ekranı); verilmezse kapsamdaki tüm depolar. */
  readonly warehouseId?: string;
  /** Cariler: arşivliler de (ekrandaki "Arşivli" süzgeci). */
  readonly archived?: boolean;
}

export interface ExportResult {
  readonly kind: ExportKind;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** Sınır yüzünden kesildi mi (dosyada ilk EXPORT_MAX_ROWS satır). */
  readonly truncated: boolean;
  /** Cariler: kişisel sütunlar yetki yüzünden boş bırakıldı mı. */
  readonly personalOmitted: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function likeOf(raw: string | undefined): string | null {
  if (raw !== undefined && typeof raw !== "string") throw new AppError("VALIDATION_FAILED");
  const q = (raw ?? "").replace(/\p{C}/gu, " ").trim().slice(0, 100);
  return q === "" ? null : `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** "12.500000" → "12,5"; tam sayı gruplanmaz ("1250"): Türkçe içe aktarma "1.250"yi belirsiz sayar. */
export function trQuantity(v: string): string {
  const [i = "0", f = ""] = v.split(".");
  const frac = f.replace(/0+$/, "");
  return frac === "" ? i : `${i},${frac}`;
}

/**
 * Dışa aktarma: satırları okur ve audit'i aynı transaction'da yazar. Yetkisiz → `FORBIDDEN`; geçersiz tür/depo → `VALIDATION_FAILED`;
 * kapsam dışı ya da başka kiracının deposu → `NOT_FOUND` (varlık sızmaz).
 */
export async function exportData(params: ExportParams, input: ExportInput): Promise<ExportResult> {
  if (!(EXPORT_KINDS as readonly string[]).includes(input.kind)) throw new AppError("VALIDATION_FAILED");
  if (input.warehouseId !== undefined && (typeof input.warehouseId !== "string" || !UUID_RE.test(input.warehouseId))) throw new AppError("VALIDATION_FAILED");
  const like = likeOf(input.q);
  const { requestId, recentAuth, ...access } = params;
  const limit = EXPORT_MAX_ROWS;
  // Kişisel sütunlar dolacaksa (cari + settings.manage) önce yeniden doğrulama; diğer türlerde istenmez.
  const reauth = input.kind === "parties" && (await runTenantQuery({ ...access, permission: "data.import" }, (_tx, m) => Promise.resolve(hasPermission(m.roles, "settings.manage", m.grants))));
  if (reauth && recentAuth === undefined) throw new AppError("UNAUTHENTICATED", { detail: "RECENT_AUTH_REQUIRED" });
  return runTenantQuery({ ...access, permission: "data.import", ...(reauth && recentAuth !== undefined ? { recentAuth } : {}) }, async (tx, m) => {
    const scope = await resolveWarehouseScope(tx, m);
    const inScope = scope === null ? sql`true` : sql`w.id = ANY(${pgUuidArray(scope)}::uuid[])`;
    let rows: string[][] = [];
    let personalOmitted = false;
    const kind = input.kind;
    if (kind === "items") {
      const r = await tx.execute<{ code: string; name: string; unit: string; pack: string | null; bc: string | null; kbc: string | null }>(sql`
        SELECT i.code, i.name, u.code AS unit,
               (SELECT c.to_base_factor::text FROM public.unit_conversions c
                  JOIN public.units ku ON ku.tenant_id = c.tenant_id AND ku.id = c.unit_id AND ku.code = ${PACK_UNIT_CODE}
                 WHERE c.tenant_id = i.tenant_id AND c.item_id = i.id LIMIT 1) AS pack,
               (SELECT b.barcode FROM public.item_barcodes b
                 WHERE b.tenant_id = i.tenant_id AND b.item_id = i.id AND (b.unit_id IS NULL OR b.unit_id = i.base_unit_id)
                 ORDER BY b.barcode COLLATE "C" LIMIT 1) AS bc,
               (SELECT b.barcode FROM public.item_barcodes b
                  JOIN public.units ku ON ku.tenant_id = b.tenant_id AND ku.id = b.unit_id AND ku.code = ${PACK_UNIT_CODE}
                 WHERE b.tenant_id = i.tenant_id AND b.item_id = i.id ORDER BY b.barcode COLLATE "C" LIMIT 1) AS kbc
          FROM public.items i
          JOIN public.units u ON u.tenant_id = i.tenant_id AND u.id = i.base_unit_id
         WHERE i.tenant_id = ${m.tenantId}::uuid AND i.status = 'ACTIVE'
           AND (${like}::text IS NULL OR i.code ILIKE ${like} OR i.name ILIKE ${like})
         ORDER BY i.code COLLATE "C"
         LIMIT ${limit + 1}`);
      rows = r.map((x) => [x.code, x.name, x.unit, x.pack === null ? "" : trQuantity(x.pack), x.bc ?? "", x.kbc ?? ""]);
    } else if (kind === "parties") {
      const personal = hasPermission(m.roles, "settings.manage", m.grants);
      personalOmitted = !personal;
      const r = await tx.execute<{ code: string; name: string; kind: string; tax_no: string | null; tax_office: string | null; phone: string | null; email: string | null; city: string | null; address: string | null; short_name: string | null; district: string | null; delivery_mode: string }>(sql`
        SELECT code, name, kind, tax_no, tax_office, phone, email, city, address, short_name, district, delivery_mode
          FROM public.parties
         WHERE tenant_id = ${m.tenantId}::uuid
           AND (${input.archived === true}::boolean OR archived_at IS NULL)
           AND (${like}::text IS NULL OR name ILIKE ${like} OR code ILIKE ${like} OR city ILIKE ${like}
                OR (${personal}::boolean AND (tax_no ILIKE ${like} OR phone ILIKE ${like})))
         ORDER BY code_key COLLATE "C", id
         LIMIT ${limit + 1}`);
      const p = (v: string | null): string => (personal ? (v ?? "") : "");
      rows = r.map((x) => [x.code, x.name, p(x.tax_no), p(x.tax_office), p(x.phone), p(x.email), x.city ?? "", p(x.address), PARTY_KIND_LABEL[x.kind] ?? "", x.short_name ?? "", x.district ?? "", PARTY_DELIVERY_LABEL[x.delivery_mode] ?? ""]);
    } else if (kind === "warehouses") {
      const r = await tx.execute<{ code: string; name: string }>(sql`
        SELECT w.code, w.name FROM public.warehouses w
         WHERE w.tenant_id = ${m.tenantId}::uuid AND w.status = 'ACTIVE' AND ${inScope}
           AND (${like}::text IS NULL OR w.code ILIKE ${like} OR w.name ILIKE ${like})
         ORDER BY w.code COLLATE "C"
         LIMIT ${limit + 1}`);
      rows = r.map((x) => [x.code, x.name]);
    } else if (kind === "locations") {
      if (input.warehouseId !== undefined) {
        const w = await tx.execute<{ x: number }>(sql`SELECT 1 AS x FROM public.warehouses w WHERE w.tenant_id = ${m.tenantId}::uuid AND w.id = ${input.warehouseId}::uuid AND ${inScope}`);
        if (w[0] === undefined) throw new AppError("NOT_FOUND");
      }
      // Ebeveyn önce (derinlik sırası): dosya olduğu gibi geri yüklenince üst raf her zaman önceki satırdadır.
      const r = await tx.execute<{ wcode: string; code: string; name: string; parent: string | null; kind: string }>(sql`
        SELECT w.code AS wcode, l.code, l.name, p.code AS parent, l.kind
          FROM public.locations l
          JOIN public.warehouses w ON w.tenant_id = l.tenant_id AND w.id = l.warehouse_id
          LEFT JOIN public.locations p ON p.tenant_id = l.tenant_id AND p.id = l.parent_id
         WHERE l.tenant_id = ${m.tenantId}::uuid AND l.status = 'ACTIVE' AND w.status = 'ACTIVE' AND ${inScope}
           AND (${input.warehouseId ?? null}::uuid IS NULL OR w.id = ${input.warehouseId ?? null}::uuid)
           AND (${like}::text IS NULL OR l.code ILIKE ${like} OR l.name ILIKE ${like})
         ORDER BY w.code COLLATE "C", l.depth, l.code COLLATE "C"
         LIMIT ${limit + 1}`);
      rows = r.map((x) => [x.wcode, x.code, x.name, x.parent ?? "", LOCATION_KIND_LABEL[x.kind] ?? x.kind]);
    } else {
      // Açılış stoku şablonu biçiminde eldeki miktar (ürün + raf toplamı; yalnız okuma). Geri yükleme stoğu DEĞİŞTİRMEZ: içe aktarma stoğu olan
      // (ürün, raf) çiftine yazmaz (A-289-9); stok yalnız belgeyle değişir (I-04).
      const r = await tx.execute<{ code: string; loc: string; q: string }>(sql`
        SELECT i.code, l.code AS loc, sum(b.quantity)::text AS q
          FROM public.stock_balances b
          JOIN public.stock_dimensions d ON d.tenant_id = b.tenant_id AND d.id = b.stock_dimension_id
          JOIN public.items i ON i.tenant_id = d.tenant_id AND i.id = d.item_id
          JOIN public.locations l ON l.tenant_id = d.tenant_id AND l.id = d.location_id
          JOIN public.warehouses w ON w.tenant_id = l.tenant_id AND w.id = l.warehouse_id
         WHERE b.tenant_id = ${m.tenantId}::uuid AND b.quantity > 0 AND ${inScope}
           AND (${like}::text IS NULL OR i.code ILIKE ${like} OR i.name ILIKE ${like} OR l.code ILIKE ${like})
         GROUP BY i.code, l.code, w.code
         ORDER BY i.code COLLATE "C", w.code COLLATE "C", l.code COLLATE "C"
         LIMIT ${limit + 1}`);
      rows = r.map((x) => [x.code, x.loc, trQuantity(x.q)]);
    }
    const truncated = rows.length > limit;
    if (truncated) rows = rows.slice(0, limit);
    await appendAudit(tx, {
      action: "data.exported",
      actorUserId: m.userId,
      entityType: kind,
      requestId: requestId ?? null,
      changeSummary: { kind, rows: rows.length, truncated, search: like !== null, ...(kind === "parties" ? { personal_columns: !personalOmitted } : {}), ...(input.warehouseId === undefined ? {} : { warehouse_id: input.warehouseId }) },
    });
    return { kind, headers: EXPORT_HEADERS[kind], rows, truncated, personalOmitted };
  });
}

/** Boş şablon için yetki denetimi (veri okumaz, audit yazmaz): `data.import`. */
export async function assertExportAllowed(params: Omit<TenantAccessParams, "permission">): Promise<void> {
  await runTenantQuery({ ...params, permission: "data.import" }, () => Promise.resolve(null));
}
