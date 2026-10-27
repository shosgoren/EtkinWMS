// ERP -> Etkin kart yazımı ve eşleme (T-991). Yalnız KATALOG satırları (ürün, cari, depo) + `external_refs`; stok tablolarına dokunmaz (I-04:
// ERP'den gelen kart stok miktarını değiştirmez; Paraşüt'ün `initial_stock_count` / `stock_count` alanları okunmaz). Her yazım çağıranın
// transaction'ındadır (worker: `withSystemTenant`, bağlantıyı kuran yöneticinin üyeliği o anda yeniden doğrulanmıştır) ve audit'e
// "integration" kaynağıyla yazılır.
//
// Eşleme sırası (çift kayıt yok): (1) bu dış kimliğin eşlemesi varsa o kayıt güncellenir; (2) yoksa aynı koda/vergi numarasına/ada sahip,
// EŞLEMESİZ Etkin kaydına bağlanır; (3) yoksa yeni kayıt + eşleme. Kodu başka bir dış kayda bağlı Etkin kaydı ATLANIR (sessiz yeniden bağlama yok).
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { standardUnitCode } from "../catalog/unit-alias.ts";
import type { AccessTx } from "../identity/access.ts";

export type ApplyOutcome = "CREATED" | "UPDATED" | "LINKED" | "UNCHANGED" | "SKIPPED";
export type EntityKind = "ITEM" | "PARTY" | "WAREHOUSE" | "DOCUMENT";

export interface ApplyContext {
  readonly tenantId: string;
  /** `external_refs.system` (ör. PARASUT). */
  readonly system: string;
  /** Bağlantıyı kuran yönetici (audit aktörü). */
  readonly actorUserId: string;
  /** Aynı kişinin üyeliği (`parties.created_by`). */
  readonly membershipId: string;
}

const CTRL = /\p{C}/u;
const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.normalize("NFC").replace(/\s+/g, " ").trim();
  if (s === "" || CTRL.test(s)) return null;
  return Array.from(s).slice(0, max).join("");
};

export async function refEntity(tx: AccessTx, c: ApplyContext, kind: EntityKind, externalId: string): Promise<string | null> {
  const r = await tx.execute<{ entity_id: string }>(
    sql`SELECT entity_id FROM public.external_refs WHERE tenant_id = ${c.tenantId}::uuid AND system = ${c.system} AND entity_type = ${kind} AND external_id = ${externalId}`,
  );
  return r[0]?.entity_id ?? null;
}

export async function refExternal(tx: AccessTx, c: ApplyContext, kind: EntityKind, entityId: string): Promise<string | null> {
  const r = await tx.execute<{ external_id: string }>(
    sql`SELECT external_id FROM public.external_refs WHERE tenant_id = ${c.tenantId}::uuid AND system = ${c.system} AND entity_type = ${kind} AND entity_id = ${entityId}::uuid`,
  );
  return r[0]?.external_id ?? null;
}

/** Eşleme ekler; iki yönlü tekillik DB'dedir (çakışmada `false`, kayıt değişmez). */
export async function link(tx: AccessTx, c: ApplyContext, kind: EntityKind, entityId: string, externalId: string, externalCode: string | null = null): Promise<boolean> {
  const r = await tx.execute<{ id: string }>(
    sql`INSERT INTO public.external_refs (tenant_id, id, system, entity_type, entity_id, external_id, external_code)
        VALUES (${c.tenantId}::uuid, ${randomUUID()}::uuid, ${c.system}, ${kind}, ${entityId}::uuid, ${externalId}, ${externalCode})
        ON CONFLICT DO NOTHING RETURNING id`,
  );
  if (r[0] === undefined) return false;
  await appendAudit(tx, {
    action: "external_ref.linked",
    actorUserId: c.actorUserId,
    entityType: "external_ref",
    entityId: r[0].id,
    // Dış kimlik audit'e yazılmaz (G-09; 0019 ile aynı).
    changeSummary: { system: c.system, linkedEntityType: kind, linkedEntityId: entityId, change: "created", via: "integration" },
  });
  return true;
}

// --- ürün ---------------------------------------------------------------------------------------------------------------------------
export interface ProviderProduct {
  readonly externalId: string;
  readonly code: string | null;
  readonly name: string | null;
  readonly unit: string | null;
}

/** Tanınmayan birim sessizce ADET yapılmaz; satır kontrol için başarısız olur. */
export const unitCodeFor = standardUnitCode;

/** Sayılabilir ambalajlar tam sayı; ağırlık/uzunluk/hacim 6 ondalığı kayıpsız taşır. */
export function productQuantityScale(unitCode: string): number {
  return ["KG", "GR", "MT", "CM", "LT", "M2", "M3"].includes(unitCode) ? 6 : 0;
}

export async function applyProduct(tx: AccessTx, c: ApplyContext, p: ProviderProduct): Promise<ApplyOutcome> {
  const name = clean(p.name, 200);
  if (name === null) return "SKIPPED";
  const unitCode = unitCodeFor(p.unit);
  if (unitCode === null) throw new AppError("VALIDATION_FAILED", { detail: "UNIT_CONVERSION_INVALID" });
  const units = await tx.execute<{ id: string }>(
    sql`SELECT id FROM public.units WHERE tenant_id = ${c.tenantId}::uuid AND code = ${unitCode} AND status = 'ACTIVE'`,
  );
  const unitId = units[0]?.id;
  if (unitId === undefined) throw new AppError("VALIDATION_FAILED", { detail: "UNIT_CONVERSION_INVALID" });
  const existing = await refEntity(tx, c, "ITEM", p.externalId);
  if (existing !== null) {
    const current = await tx.execute<{ base_unit_id: string }>(
      sql`SELECT base_unit_id FROM public.items WHERE tenant_id = ${c.tenantId}::uuid AND id = ${existing}::uuid`,
    );
    if (current[0]?.base_unit_id !== unitId) throw new AppError("VALIDATION_FAILED", { detail: "UNIT_CONVERSION_INVALID" });
    const r = await tx.execute<{ id: string }>(
      sql`UPDATE public.items SET name = ${name} WHERE tenant_id = ${c.tenantId}::uuid AND id = ${existing}::uuid AND status = 'ACTIVE' AND name IS DISTINCT FROM ${name} RETURNING id`,
    );
    if (r[0] === undefined) return "UNCHANGED";
    await appendAudit(tx, { action: "item.updated", actorUserId: c.actorUserId, entityType: "item", entityId: existing, changeSummary: { name, via: "integration", system: c.system } });
    return "UPDATED";
  }
  const code = clean(p.code, 64) ?? `PRS-${p.externalId}`;
  const byCode = await tx.execute<{ id: string; base_unit_id: string; linked: boolean }>(
    sql`SELECT i.id, i.base_unit_id, EXISTS (SELECT 1 FROM public.external_refs r WHERE r.tenant_id = i.tenant_id AND r.system = ${c.system} AND r.entity_type = 'ITEM' AND r.entity_id = i.id) AS linked
          FROM public.items i WHERE i.tenant_id = ${c.tenantId}::uuid AND i.code = ${code}`,
  );
  const hit = byCode[0];
  if (hit !== undefined) {
    if (hit.base_unit_id !== unitId) throw new AppError("VALIDATION_FAILED", { detail: "UNIT_CONVERSION_INVALID" });
    if (hit.linked) return "SKIPPED";
    return (await link(tx, c, "ITEM", hit.id, p.externalId, code)) ? "LINKED" : "SKIPPED";
  }
  const ins = await tx.execute<{ id: string }>(
    sql`INSERT INTO public.items (tenant_id, id, code, name, base_unit_id, quantity_scale) VALUES (${c.tenantId}::uuid, gen_random_uuid(), ${code}, ${name}, ${unitId}::uuid, ${productQuantityScale(unitCode)})
        ON CONFLICT ON CONSTRAINT items_tenant_code_key DO NOTHING RETURNING id`,
  );
  const itemId = ins[0]?.id;
  if (itemId === undefined) return "SKIPPED";
  await appendAudit(tx, { action: "item.created", actorUserId: c.actorUserId, entityType: "item", entityId: itemId, changeSummary: { code, name, base_unit_id: unitId, via: "integration", system: c.system } });
  await link(tx, c, "ITEM", itemId, p.externalId, code);
  return "CREATED";
}

// --- cari ---------------------------------------------------------------------------------------------------------------------------
export interface ProviderContact {
  readonly externalId: string;
  readonly name: string | null;
  readonly accountType: "customer" | "supplier" | null;
  readonly taxNumber: string | null;
  readonly taxOffice: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly city: string | null;
  readonly address: string | null;
}

interface PartyFields {
  readonly name: string;
  readonly kind: "CUSTOMER" | "SUPPLIER";
  readonly taxNo: string | null;
  readonly taxOffice: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly city: string | null;
  readonly address: string | null;
}

/** 0050 CHECK'lerine uymayan alan atılır (kayıt düşmez). */
function partyFields(p: ProviderContact): PartyFields | null {
  const name = clean(p.name, 200);
  if (name === null) return null;
  const tax = clean(p.taxNumber, 20)?.replace(/[\s-]/g, "") ?? null;
  const phone = clean(p.phone, 40);
  const email = clean(p.email, 254)?.toLowerCase() ?? null;
  return {
    name,
    kind: p.accountType === "supplier" ? "SUPPLIER" : "CUSTOMER",
    taxNo: tax !== null && /^[0-9A-Za-z]{1,20}$/.test(tax) ? tax : null,
    taxOffice: clean(p.taxOffice, 100),
    email: email !== null && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null,
    phone: phone !== null && /^[0-9+() ./-]+$/.test(phone) ? phone : null,
    city: clean(p.city, 100),
    address: clean(p.address, 500),
  };
}

export async function applyContact(tx: AccessTx, c: ApplyContext, p: ProviderContact): Promise<ApplyOutcome> {
  const f = partyFields(p);
  if (f === null) return "SKIPPED";
  const existing = await refEntity(tx, c, "PARTY", p.externalId);
  if (existing !== null) {
    // Tür farklı gelirse (müşteri iken tedarikçi) BOTH olur; kod Etkin'de kalır.
    const r = await tx.execute<{ id: string }>(
      sql`UPDATE public.parties SET name = ${f.name}, kind = CASE WHEN kind = ${f.kind} OR kind = 'BOTH' THEN kind ELSE 'BOTH' END,
                 tax_no = COALESCE(${f.taxNo}, tax_no), tax_office = COALESCE(${f.taxOffice}, tax_office), email = COALESCE(${f.email}, email),
                 phone = COALESCE(${f.phone}, phone), city = COALESCE(${f.city}, city), address = COALESCE(${f.address}, address)
           WHERE tenant_id = ${c.tenantId}::uuid AND id = ${existing}::uuid AND archived_at IS NULL
             AND (name IS DISTINCT FROM ${f.name} OR (kind <> ${f.kind} AND kind <> 'BOTH')
                  OR (${f.taxNo}::text IS NOT NULL AND tax_no IS DISTINCT FROM ${f.taxNo}) OR (${f.taxOffice}::text IS NOT NULL AND tax_office IS DISTINCT FROM ${f.taxOffice})
                  OR (${f.email}::text IS NOT NULL AND email IS DISTINCT FROM ${f.email}) OR (${f.phone}::text IS NOT NULL AND phone IS DISTINCT FROM ${f.phone})
                  OR (${f.city}::text IS NOT NULL AND city IS DISTINCT FROM ${f.city}) OR (${f.address}::text IS NOT NULL AND address IS DISTINCT FROM ${f.address}))
          RETURNING id`,
    );
    if (r[0] === undefined) return "UNCHANGED";
    await appendAudit(tx, { action: "party.updated", actorUserId: c.actorUserId, entityType: "party", entityId: existing, changeSummary: { name: f.name, via: "integration", system: c.system } });
    return "UPDATED";
  }
  // Eşlemesiz aynı vergi numaralı cari varsa ona bağlanır (ada göre birleştirme yapılmaz: yanlış birleşme riski).
  if (f.taxNo !== null) {
    const byTax = await tx.execute<{ id: string }>(
      sql`SELECT p.id FROM public.parties p
           WHERE p.tenant_id = ${c.tenantId}::uuid AND p.tax_no = ${f.taxNo} AND p.archived_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM public.external_refs r WHERE r.tenant_id = p.tenant_id AND r.system = ${c.system} AND r.entity_type = 'PARTY' AND r.entity_id = p.id)
           ORDER BY p.created_at LIMIT 2`,
    );
    if (byTax.length === 1) return (await link(tx, c, "PARTY", (byTax[0] as { id: string }).id, p.externalId)) ? "LINKED" : "SKIPPED";
    if (byTax.length > 1) return "SKIPPED";
  }
  const code = `PRS-${p.externalId}`;
  const ins = await tx.execute<{ id: string }>(
    sql`INSERT INTO public.parties (tenant_id, id, code, code_key, name, kind, tax_no, tax_office, phone, email, city, address, created_by)
        VALUES (${c.tenantId}::uuid, gen_random_uuid(), ${code}, ${code.toLocaleUpperCase("tr")}, ${f.name}, ${f.kind}, ${f.taxNo}, ${f.taxOffice}, ${f.phone}, ${f.email}, ${f.city}, ${f.address}, ${c.membershipId}::uuid)
        ON CONFLICT ON CONSTRAINT parties_tenant_code_key DO NOTHING RETURNING id`,
  );
  const partyId = ins[0]?.id;
  if (partyId === undefined) return "SKIPPED";
  await appendAudit(tx, { action: "party.created", actorUserId: c.actorUserId, entityType: "party", entityId: partyId, changeSummary: { ref: code, name: f.name, via: "integration", system: c.system } });
  await link(tx, c, "PARTY", partyId, p.externalId, code);
  return "CREATED";
}

// --- depo ---------------------------------------------------------------------------------------------------------------------------
export interface ProviderWarehouse {
  readonly externalId: string;
  readonly name: string | null;
  readonly archived: boolean;
}

/** Ad → depo kodu: ASCII büyük harf, harf/rakam dışı tire, en çok 20 karakter. */
export function warehouseCodeFor(name: string): string {
  const base = name
    .toLocaleUpperCase("tr")
    .replace(/[ÇĞİÖŞÜ]/g, (ch) => ({ Ç: "C", Ğ: "G", İ: "I", Ö: "O", Ş: "S", Ü: "U" })[ch] ?? ch)
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  return base === "" ? "DEPO" : base;
}

export async function applyWarehouse(tx: AccessTx, c: ApplyContext, w: ProviderWarehouse): Promise<ApplyOutcome> {
  const name = clean(w.name, 200);
  if (name === null || w.archived) return "SKIPPED";
  const existing = await refEntity(tx, c, "WAREHOUSE", w.externalId);
  if (existing !== null) {
    const r = await tx.execute<{ id: string }>(
      sql`UPDATE public.warehouses SET name = ${name} WHERE tenant_id = ${c.tenantId}::uuid AND id = ${existing}::uuid AND status = 'ACTIVE' AND name IS DISTINCT FROM ${name} RETURNING id`,
    );
    if (r[0] === undefined) return "UNCHANGED";
    await appendAudit(tx, { action: "warehouse.updated", actorUserId: c.actorUserId, entityType: "warehouse", entityId: existing, changeSummary: { name, via: "integration", system: c.system } });
    return "UPDATED";
  }
  const byName = await tx.execute<{ id: string }>(
    sql`SELECT w.id FROM public.warehouses w
         WHERE w.tenant_id = ${c.tenantId}::uuid AND w.status = 'ACTIVE' AND lower(btrim(w.name)) = lower(${name})
           AND NOT EXISTS (SELECT 1 FROM public.external_refs r WHERE r.tenant_id = w.tenant_id AND r.system = ${c.system} AND r.entity_type = 'WAREHOUSE' AND r.entity_id = w.id)
         LIMIT 2`,
  );
  if (byName.length === 1) return (await link(tx, c, "WAREHOUSE", (byName[0] as { id: string }).id, w.externalId)) ? "LINKED" : "SKIPPED";
  if (byName.length > 1) return "SKIPPED";
  const base = warehouseCodeFor(name);
  for (let i = 1; i <= 20; i++) {
    const code = i === 1 ? base : `${base.slice(0, 17)}-${i}`;
    const id = randomUUID();
    const ins = await tx.execute<{ id: string }>(
      sql`INSERT INTO public.warehouses (tenant_id, id, code, name) VALUES (${c.tenantId}::uuid, ${id}::uuid, ${code}, ${name})
          ON CONFLICT ON CONSTRAINT warehouses_tenant_code_key DO NOTHING RETURNING id`,
    );
    if (ins[0] === undefined) continue;
    await appendAudit(tx, { action: "warehouse.created", actorUserId: c.actorUserId, entityType: "warehouse", entityId: id, changeSummary: { name, via: "integration", system: c.system } });
    await link(tx, c, "WAREHOUSE", id, w.externalId, code);
    return "CREATED";
  }
  return "SKIPPED";
}
