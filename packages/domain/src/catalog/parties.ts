// T-428: cari kartlar (müşteri / tedarikçi). Okuma `stock.view`; ekleme/düzenleme/arşiv `settings.manage`; Excel'den aktarım `data.import` (hesap sahibi ya da
// T-421 özel yetki grubu). Fiziksel silme yok. Audit aynı transaction'da (I-12).
// Kod alan içinde benzersizdir (büyük/küçük harf ve boşluktan bağımsız: `code_key`). Vergi no 10/11 hane denetimi uyarıdır, engel değildir.
// Aktarım (`importParties`): aynı kod varsa güncellenir (boş hücre mevcut değeri silmez), dosyada tekrarlayan kod → ilki alınır, sonrakiler sorunlu.
// `dryRun`: hiçbir şey yazılmaz; aynı kurallarla satır başına sonuç döner (kontrol adımı).
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { runTenantCommand, runTenantQuery, type TenantAccessParams } from "../identity/access.ts";
import { hasPermission } from "../identity/permissions.ts";

export type PartyKind = "CUSTOMER" | "SUPPLIER" | "BOTH";
export const PARTY_KINDS: readonly PartyKind[] = ["CUSTOMER", "SUPPLIER", "BOTH"];
export const PARTY_IMPORT_MAX_ROWS = 500;
export const PARTY_LIST_MAX = 200;

type QueryParams = Omit<TenantAccessParams, "permission" | "recentAuth">;
export type PartyCommandParams = Omit<TenantAccessParams, "permission"> & { readonly requestId?: string };

export interface PartyRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: PartyKind;
  readonly taxNo: string | null;
  readonly taxOffice: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly city: string | null;
  readonly address: string | null;
  readonly archived: boolean;
  readonly version: number;
}

/** Ham giriş (ekran ya da Excel satırı): her alan metin; boş = verilmedi. */
export interface PartyInput {
  readonly code?: string;
  readonly name?: string;
  readonly kind?: string;
  readonly taxNo?: string;
  readonly taxOffice?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly city?: string;
  readonly address?: string;
}

export type PartyIssue =
  | "CODE_MISSING"
  | "CODE_INVALID"
  | "NAME_MISSING"
  | "NAME_INVALID"
  | "KIND_UNKNOWN"
  | "TAX_NO_INVALID"
  | "PHONE_INVALID"
  | "EMAIL_INVALID"
  | "TEXT_TOO_LONG"
  | "CODE_DUPLICATE_FILE";
/** Uyarı: kayıt yazılır, kullanıcıya gösterilir. */
export type PartyWarning = "TAX_NO_LENGTH";

interface Clean {
  readonly code: string;
  readonly codeKey: string;
  readonly name: string | null;
  readonly kind: PartyKind | null;
  readonly taxNo: string | null;
  readonly taxOffice: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly city: string | null;
  readonly address: string | null;
}

const CTRL = /[\u0000-\u001f\u007f]/;
const t = (v: string | undefined): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** "müşteri", "Tedarikçi", "ikisi de", "Alıcı/Satıcı", "customer"… → tür; boş → null; tanınmayan → hata. */
export function parseKind(raw: string): PartyKind | null | "UNKNOWN" {
  const k = raw
    .toLocaleLowerCase("tr")
    .replace(/[ışğüöç]/g, (c) => ({ ı: "i", ş: "s", ğ: "g", ü: "u", ö: "o", ç: "c" })[c] ?? c)
    .replace(/[^a-z]+/g, " ")
    .trim();
  if (k === "") return null;
  const cust = /\b(musteri|alici|customer|buyer|m)\b/.test(k);
  const supp = /\b(tedarikci|satici|supplier|vendor|t)\b/.test(k);
  if (/\b(ikisi|her ikisi|both|ikiside)\b/.test(k) || (cust && supp)) return "BOTH";
  if (cust) return "CUSTOMER";
  if (supp) return "SUPPLIER";
  return "UNKNOWN";
}

/** Tek satırı doğrular ve normalize eder; `requireName` yalnız yeni kayıtta gerekir (karar sunucuda verilir). */
export function cleanParty(input: PartyInput): { readonly ok: true; readonly value: Clean; readonly warnings: PartyWarning[] } | { readonly ok: false; readonly issue: PartyIssue } {
  const code = t(input.code);
  if (code === "") return { ok: false, issue: "CODE_MISSING" };
  if (code.length > 64 || CTRL.test(code)) return { ok: false, issue: "CODE_INVALID" };
  const name = t(input.name);
  if (name.length > 200 || CTRL.test(name)) return { ok: false, issue: "NAME_INVALID" };
  const kindRaw = parseKind(t(input.kind));
  if (kindRaw === "UNKNOWN") return { ok: false, issue: "KIND_UNKNOWN" };
  const warnings: PartyWarning[] = [];
  const taxRaw = t(input.taxNo).replace(/[\s-]/g, "");
  if (taxRaw !== "" && (!/^[0-9A-Za-z]{1,20}$/.test(taxRaw))) return { ok: false, issue: "TAX_NO_INVALID" };
  if (taxRaw !== "" && /^\d+$/.test(taxRaw) && taxRaw.length !== 10 && taxRaw.length !== 11) warnings.push("TAX_NO_LENGTH");
  const phone = t(input.phone);
  if (phone !== "" && (phone.length > 40 || !/^[0-9+() ./-]+$/.test(phone))) return { ok: false, issue: "PHONE_INVALID" };
  const email = t(input.email).toLowerCase();
  if (email !== "" && (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) return { ok: false, issue: "EMAIL_INVALID" };
  const taxOffice = t(input.taxOffice);
  const city = t(input.city);
  const address = t(input.address);
  if (taxOffice.length > 100 || city.length > 100 || address.length > 500 || [taxOffice, city, address].some((v) => CTRL.test(v))) return { ok: false, issue: "TEXT_TOO_LONG" };
  const opt = (v: string): string | null => (v === "" ? null : v);
  return {
    ok: true,
    warnings,
    value: {
      code,
      codeKey: code.toLocaleUpperCase("tr"),
      name: opt(name),
      kind: kindRaw,
      taxNo: opt(taxRaw),
      taxOffice: opt(taxOffice),
      phone: opt(phone),
      email: opt(email),
      city: opt(city),
      address: opt(address),
    },
  };
}

type DbParty = {
  id: string;
  code: string;
  code_key: string;
  name: string;
  kind: PartyKind;
  tax_no: string | null;
  tax_office: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  address: string | null;
  archived_at: string | null;
  version: number;
};
const toRow = (r: DbParty): PartyRow => ({
  id: r.id,
  code: r.code,
  name: r.name,
  kind: r.kind,
  taxNo: r.tax_no,
  taxOffice: r.tax_office,
  phone: r.phone,
  email: r.email,
  city: r.city,
  address: r.address,
  archived: r.archived_at !== null,
  version: Number(r.version),
});

/** Cari listesi (`stock.view`): ad / kod / vergi no / telefon içinde arama; arşivliler yalnız istenirse. */
export async function listParties(params: QueryParams, opts: { readonly q?: string; readonly archived?: boolean; readonly limit?: number } = {}): Promise<{ readonly items: readonly PartyRow[]; readonly total: number }> {
  const q = t(opts.q).slice(0, 100);
  const limit = Math.min(PARTY_LIST_MAX, Math.max(1, Math.trunc(opts.limit ?? 50)));
  const like = q === "" ? null : `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return runTenantQuery({ ...params, permission: "stock.view" }, async (tx, m) => {
    const rows = await tx.execute<DbParty & { total: string }>(sql`
      SELECT id, code, code_key, name, kind, tax_no, tax_office, phone, email, city, address, archived_at::text, version, count(*) OVER ()::text AS total
        FROM public.parties
       WHERE tenant_id = ${m.tenantId}::uuid
         -- T-1037: arşiv görünümü YALNIZ arşivdekiler (ekran "Arşivdeki cariler" der; eskiden etkinler de geliyordu).
         AND (CASE WHEN ${opts.archived === true}::boolean THEN archived_at IS NOT NULL ELSE archived_at IS NULL END)
         AND (${like}::text IS NULL OR name ILIKE ${like} OR code ILIKE ${like} OR tax_no ILIKE ${like} OR phone ILIKE ${like} OR city ILIKE ${like})
       ORDER BY archived_at IS NOT NULL, name, code, id
       LIMIT ${limit}`);
    return { items: rows.map(toRow), total: Number(rows[0]?.total ?? 0) };
  });
}

/** Tek cari kaydet (`settings.manage`): `id` yoksa yeni (ad zorunlu), varsa sürüm denetimli güncelleme (boş alan temizlenir). */
export type SavePartyResult = { readonly ok: true; readonly id: string; readonly version: number } | { readonly ok: false; readonly issue: PartyIssue | "CODE_TAKEN" };

export async function saveParty(params: PartyCommandParams, input: PartyInput & { readonly id?: string; readonly expectedVersion?: number }): Promise<SavePartyResult> {
  const c = cleanParty(input);
  if (!c.ok) return { ok: false, issue: c.issue };
  const v = c.value;
  if (v.name === null) return { ok: false, issue: "NAME_MISSING" };
  const { requestId, ...access } = params;
  return runTenantCommand<SavePartyResult>({ ...access, permission: "settings.manage" }, async (tx, m) => {
    if (input.id === undefined) {
      const rows = await tx.execute<{ id: string; version: number }>(sql`
        INSERT INTO public.parties (tenant_id, id, code, code_key, name, kind, tax_no, tax_office, phone, email, city, address, created_by)
        VALUES (${m.tenantId}::uuid, gen_random_uuid(), ${v.code}, ${v.codeKey}, ${v.name}, ${v.kind ?? "CUSTOMER"}, ${v.taxNo}, ${v.taxOffice}, ${v.phone}, ${v.email}, ${v.city}, ${v.address}, ${m.membershipId}::uuid)
        ON CONFLICT ON CONSTRAINT parties_tenant_code_key DO NOTHING
        RETURNING id, version`);
      const row = rows[0];
      if (row === undefined) return { ok: false, issue: "CODE_TAKEN" } as const;
      await appendAudit(tx, { action: "party.created", actorUserId: m.userId, entityType: "party", entityId: row.id, requestId: requestId ?? null, changeSummary: { ref: v.code, name: v.name } });
      return { ok: true, id: row.id, version: Number(row.version) } as const;
    }
    if (!/^[0-9a-f-]{36}$/i.test(input.id) || input.expectedVersion === undefined) throw new AppError("VALIDATION_FAILED");
    const rows = await tx.execute<{ id: string; version: number }>(sql`
      UPDATE public.parties SET code = ${v.code}, code_key = ${v.codeKey}, name = ${v.name}, kind = ${v.kind ?? "CUSTOMER"}, tax_no = ${v.taxNo},
             tax_office = ${v.taxOffice}, phone = ${v.phone}, email = ${v.email}, city = ${v.city}, address = ${v.address}
       WHERE tenant_id = ${m.tenantId}::uuid AND id = ${input.id}::uuid AND version = ${input.expectedVersion}
         AND NOT EXISTS (SELECT 1 FROM public.parties o WHERE o.tenant_id = ${m.tenantId}::uuid AND o.code_key = ${v.codeKey} AND o.id <> ${input.id}::uuid)
      RETURNING id, version`);
    const row = rows[0];
    if (row === undefined) {
      const exists = await tx.execute<{ taken: boolean; found: boolean }>(sql`
        SELECT EXISTS (SELECT 1 FROM public.parties WHERE tenant_id = ${m.tenantId}::uuid AND code_key = ${v.codeKey} AND id <> ${input.id}::uuid) AS taken,
               EXISTS (SELECT 1 FROM public.parties WHERE tenant_id = ${m.tenantId}::uuid AND id = ${input.id}::uuid) AS found`);
      if (exists[0]?.found !== true) throw new AppError("NOT_FOUND");
      if (exists[0]?.taken === true) return { ok: false, issue: "CODE_TAKEN" } as const;
      throw new AppError("VERSION_CONFLICT");
    }
    await appendAudit(tx, { action: "party.updated", actorUserId: m.userId, entityType: "party", entityId: row.id, requestId: requestId ?? null, changeSummary: { ref: v.code, name: v.name } });
    return { ok: true, id: row.id, version: Number(row.version) } as const;
  });
}

/** Arşivle / geri al (`settings.manage`, sürüm denetimli). */
export async function setPartyArchived(params: PartyCommandParams, input: { readonly id: string; readonly expectedVersion: number; readonly archived: boolean }): Promise<{ readonly version: number }> {
  if (!/^[0-9a-f-]{36}$/i.test(input.id)) throw new AppError("VALIDATION_FAILED");
  const { requestId, ...access } = params;
  return runTenantCommand({ ...access, permission: "settings.manage" }, async (tx, m) => {
    const rows = await tx.execute<{ version: number }>(sql`
      UPDATE public.parties SET archived_at = CASE WHEN ${input.archived}::boolean THEN now() ELSE NULL END
       WHERE tenant_id = ${m.tenantId}::uuid AND id = ${input.id}::uuid AND version = ${input.expectedVersion}
         AND (archived_at IS NULL) = ${input.archived}::boolean
      RETURNING version`);
    const row = rows[0];
    if (row === undefined) throw new AppError("VERSION_CONFLICT");
    await appendAudit(tx, { action: input.archived ? "party.archived" : "party.restored", actorUserId: m.userId, entityType: "party", entityId: input.id, requestId: requestId ?? null });
    return { version: Number(row.version) };
  });
}

export type PartyImportStatus = "CREATED" | "UPDATED" | "UNCHANGED" | "SKIPPED" | "INVALID";
export interface PartyImportResult {
  readonly rows: readonly { readonly row: number; readonly status: PartyImportStatus; readonly issue?: PartyIssue; readonly warning?: PartyWarning }[];
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  /** T-981b: "Güncelle" kipinde yeni kod eklenmeyecekse atlanan satırlar. */
  readonly skipped: number;
  readonly invalid: number;
}

/**
 * Excel'den aktarım (`data.import`; T-421). `rows[i].row`: kullanıcının dosyasındaki satır no (rapor için). Aynı kod varsa yalnız DOLU hücreler yazılır;
 * değişmeyen satır UNCHANGED. Dosyada tekrarlayan kod: ilki alınır. `dryRun` yazmaz (aynı karar). Bir çağrıda en çok 500 satır.
 */
export async function importParties(
  params: PartyCommandParams,
  input: { readonly rows: readonly (PartyInput & { readonly row: number })[]; readonly dryRun: boolean; /** T-981b: `false` = sistemde olmayan kodu ekleme (Güncelle kipi). */ readonly addMissing?: boolean },
): Promise<PartyImportResult> {
  if (!Array.isArray(input.rows) || input.rows.length === 0 || input.rows.length > PARTY_IMPORT_MAX_ROWS) throw new AppError("VALIDATION_FAILED");
  const { requestId, ...access } = params;
  const run = input.dryRun ? runTenantQuery : runTenantCommand;
  return run({ ...access, permission: "data.import" }, async (tx, m) => {
    const personal = hasPermission(m.roles, "settings.manage", m.grants);
    const out: { row: number; status: PartyImportStatus; issue?: PartyIssue; warning?: PartyWarning }[] = [];
    const seen = new Set<string>();
    const cleaned: { row: number; v: Clean; warning?: PartyWarning }[] = [];
    for (const r of input.rows) {
      const c = cleanParty(r);
      if (!c.ok) {
        out.push({ row: r.row, status: "INVALID", issue: c.issue });
        continue;
      }
      if (seen.has(c.value.codeKey)) {
        out.push({ row: r.row, status: "INVALID", issue: "CODE_DUPLICATE_FILE" });
        continue;
      }
      seen.add(c.value.codeKey);
      cleaned.push({ row: r.row, v: c.value, ...(c.warnings[0] === undefined ? {} : { warning: c.warnings[0] }) });
    }
    const keys = cleaned.map((x) => x.v.codeKey);
    const existing = new Map<string, DbParty>();
    if (keys.length > 0) {
      const rows = await tx.execute<DbParty>(sql`
        SELECT id, code, code_key, name, kind, tax_no, tax_office, phone, email, city, address, archived_at::text, version
          FROM public.parties WHERE tenant_id = ${m.tenantId}::uuid AND code_key = ANY(${`{${keys.map((k) => `"${k.replace(/["\\]/g, (c) => `\\${c}`)}"`).join(",")}}`}::text[])`);
      for (const r of rows) existing.set(r.code_key, r);
    }
    for (const x of cleaned) {
      const v = x.v;
      const cur = existing.get(v.codeKey);
      const w = x.warning === undefined ? {} : { warning: x.warning };
      if (cur === undefined && input.addMissing === false) {
        out.push({ row: x.row, status: "SKIPPED", ...w });
        continue;
      }
      if (cur === undefined) {
        if (v.name === null) {
          out.push({ row: x.row, status: "INVALID", issue: "NAME_MISSING" });
          continue;
        }
        if (!input.dryRun) {
          await tx.execute(sql`
            INSERT INTO public.parties (tenant_id, id, code, code_key, name, kind, tax_no, tax_office, phone, email, city, address, created_by)
            VALUES (${m.tenantId}::uuid, gen_random_uuid(), ${v.code}, ${v.codeKey}, ${v.name}, ${v.kind ?? "CUSTOMER"}, ${v.taxNo}, ${v.taxOffice}, ${v.phone}, ${v.email}, ${v.city}, ${v.address}, ${m.membershipId}::uuid)`);
        }
        out.push({ row: x.row, status: "CREATED", ...w });
        continue;
      }
      // Boş hücre mevcut değeri silmez: yalnız dolu ve farklı alanlar yazılır.
      // T-981b (B-67, güvenlik incelemesi MINOR-1): `settings.manage` olmayan (yalnız aktarım yetkili) üye MEVCUT carinin kişisel alanlarını
      // (VKN/TCKN, vergi dairesi, telefon, e-posta, adres) ne karşılaştırır ne yazar — kontrol adımı tahmin doğrulama aracı olamaz; o hücreler yok sayılır.
      const p = personal;
      const next = {
        name: v.name ?? cur.name,
        kind: v.kind ?? cur.kind,
        tax_no: p ? (v.taxNo ?? cur.tax_no) : cur.tax_no,
        tax_office: p ? (v.taxOffice ?? cur.tax_office) : cur.tax_office,
        phone: p ? (v.phone ?? cur.phone) : cur.phone,
        email: p ? (v.email ?? cur.email) : cur.email,
        city: v.city ?? cur.city,
        address: p ? (v.address ?? cur.address) : cur.address,
      };
      const changed = (Object.keys(next) as (keyof typeof next)[]).some((k) => next[k] !== cur[k]);
      if (!changed) {
        out.push({ row: x.row, status: "UNCHANGED", ...w });
        continue;
      }
      if (!input.dryRun) {
        await tx.execute(sql`
          UPDATE public.parties SET name = ${next.name}, kind = ${next.kind}, tax_no = ${next.tax_no}, tax_office = ${next.tax_office}, phone = ${next.phone},
                 email = ${next.email}, city = ${next.city}, address = ${next.address}
           WHERE tenant_id = ${m.tenantId}::uuid AND id = ${cur.id}::uuid`);
      }
      out.push({ row: x.row, status: "UPDATED", ...w });
    }
    out.sort((a, b) => a.row - b.row);
    const count = (s: PartyImportStatus): number => out.filter((r) => r.status === s).length;
    const result = { rows: out, created: count("CREATED"), updated: count("UPDATED"), unchanged: count("UNCHANGED"), skipped: count("SKIPPED"), invalid: count("INVALID") };
    if (!input.dryRun && result.created + result.updated > 0) {
      await appendAudit(tx, { action: "party.imported", actorUserId: m.userId, entityType: "party", requestId: requestId ?? null, changeSummary: { created: result.created, updated: result.updated, unchanged: result.unchanged, invalid: result.invalid } });
    }
    return result;
  });
}
