// T-981b: Depolar ve Raflar (lokasyon ağacı) Excel'den içe aktarma / güncelleme. Yalnız MEVCUT domain komutları çağrılır (G-01):
// `createWarehouse` / `renameWarehouse`, `createLocation` / `renameLocation` / `setLocationKind` — her biri kendi transaction'ında yetki
// (`settings.manage`, A-68), depo kapsamı, kilit sırası ve audit'ini (I-12) uygular. Bu dosya stok tablosuna yazmaz, kilit almaz.
//
// - Yetki: `data.import` (toplu dosya) VE `settings.manage` (depo/raf yazımı yalnız Yönetici rolündedir). İkisi de önce denetlenir.
// - Kip: `update=false` ("İçeri al") yalnız YENİ kodları ekler, mevcut kayıt değişmez (UNCHANGED). `update=true` ("Güncelle") kod eşleşen
//   kaydın adını (raf için türünü de) günceller; sistemde olmayan kod `addMissing` ise eklenir, değilse atlanır (SKIPPED).
// - Raf ağacı: üst raf aynı depoda ve dosyada önce gelmiş ya da sistemde olmalı; mevcut rafın üst rafı/derinliği değişmez (tetikleyici
//   zorlar) — farklı üst raf `PARENT_CHANGE` sorunu olur. `TRANSIT` yalnız kökte (komut denetler).
// - `dryRun`: hiçbir şey yazılmaz; aynı kararla satır başına sonuç döner (önizleme "N yeni · M güncellenecek · K hatalı").
// - Kod biçimi `normalizeCode` (kırp + ASCII büyük harf); satır sorunları hata değil sonuçtur. Bir çağrıda en çok 500 satır.
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { runTenantCommand, runTenantQuery, type TenantAccessParams } from "../identity/access.ts";
import { resolveWarehouseScope } from "../warehouse/scope.ts";
import { createWarehouse, normalizeCode, normalizeName, renameWarehouse } from "../warehouse/warehouses.ts";
import { createLocation, renameLocation, setLocationKind, type LocationKindValue } from "../warehouse/locations.ts";

export const MASTER_IMPORT_MAX_ROWS = 500;

export type MasterImportParams = Omit<TenantAccessParams, "permission" | "recentAuth"> & { readonly requestId?: string };
export type MasterStatus = "CREATED" | "UPDATED" | "UNCHANGED" | "SKIPPED" | "INVALID";
export type MasterIssue =
  | "CODE_MISSING"
  | "CODE_INVALID"
  | "NAME_MISSING"
  | "NAME_INVALID"
  | "CODE_DUPLICATE_FILE"
  | "WAREHOUSE_MISSING"
  | "WAREHOUSE_UNKNOWN"
  | "PARENT_UNKNOWN"
  | "PARENT_CHANGE"
  | "PARENT_INVALID"
  | "KIND_UNKNOWN"
  | "IN_USE"
  | "CODE_TAKEN"
  | "TOO_MANY";

export interface MasterRowResult {
  readonly row: number;
  readonly status: MasterStatus;
  readonly issue?: MasterIssue;
}
export interface MasterImportResult {
  readonly rows: readonly MasterRowResult[];
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly skipped: number;
  readonly invalid: number;
}
export interface MasterImportOptions {
  readonly dryRun: boolean;
  /** "Güncelle" kipi: kod eşleşen kaydı günceller. */
  readonly update: boolean;
  /** Güncelle kipinde sistemde olmayan kod eklensin mi (varsayılan evet). İçeri al kipinde hep eklenir. */
  readonly addMissing?: boolean;
}

export interface WarehouseImportRow {
  readonly row: number;
  readonly code?: string;
  readonly name?: string;
}
export interface LocationImportRow {
  readonly row: number;
  readonly warehouseCode?: string;
  readonly code?: string;
  readonly name?: string;
  readonly parentCode?: string;
  readonly kind?: string;
}

const fold = (raw: string): string =>
  raw
    .toLocaleLowerCase("tr")
    .replace(/[ışğüöç]/g, (c) => ({ ı: "i", ş: "s", ğ: "g", ü: "u", ö: "o", ç: "c" })[c] ?? c)
    .replace(/[^a-z]+/g, " ")
    .trim();

/** "Kabul", "Depolama", "Sevk", "Yolda" ya da teknik kod → tür; boş → null; tanınmayan → "UNKNOWN". */
export function parseLocationKind(raw: string | undefined): LocationKindValue | null | "UNKNOWN" {
  const k = fold(raw ?? "");
  if (k === "") return null;
  if (["kabul", "mal kabul", "receiving", "giris"].includes(k)) return "RECEIVING";
  if (["depolama", "depo", "raf", "storage", "stok"].includes(k)) return "STORAGE";
  if (["sevk", "sevkiyat", "staging", "cikis", "hazirlik"].includes(k)) return "STAGING";
  if (["yolda", "transit", "tasima"].includes(k)) return "TRANSIT";
  return "UNKNOWN";
}

function code(raw: string | undefined): { ok: true; v: string } | { ok: false; issue: MasterIssue } {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, issue: "CODE_MISSING" };
  try {
    return { ok: true, v: normalizeCode(raw) };
  } catch {
    return { ok: false, issue: "CODE_INVALID" };
  }
}
function name(raw: string | undefined): { ok: true; v: string | null } | { ok: false; issue: MasterIssue } {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: true, v: null };
  try {
    return { ok: true, v: normalizeName(raw) };
  } catch {
    return { ok: false, issue: "NAME_INVALID" };
  }
}

/** Komut satır hatası → satır sorunu; beklenmeyen (yetki, iç hata) yeniden fırlatılır. */
function rowIssue(e: unknown): MasterIssue {
  if (e instanceof AppError && e.code === "VALIDATION_FAILED") {
    if (e.detail === "CODE_TAKEN") return "CODE_TAKEN";
    if (e.detail === "PARENT_INVALID") return "PARENT_INVALID";
    if (e.detail === "IN_USE") return "IN_USE";
    if (e.detail === "DOCUMENT_TOO_LARGE") return "TOO_MANY";
    return "CODE_INVALID";
  }
  if (e instanceof AppError && e.code === "NOT_FOUND") return "WAREHOUSE_UNKNOWN";
  throw e;
}

async function assertPermissions(params: MasterImportParams): Promise<void> {
  const { requestId: _r, ...access } = params;
  void _r;
  for (const permission of ["data.import", "settings.manage"] as const) await runTenantQuery({ ...access, permission }, () => Promise.resolve(null));
}

function summarize(rows: MasterRowResult[]): MasterImportResult {
  rows.sort((a, b) => a.row - b.row);
  const n = (s: MasterStatus): number => rows.filter((r) => r.status === s).length;
  return { rows, created: n("CREATED"), updated: n("UPDATED"), unchanged: n("UNCHANGED"), skipped: n("SKIPPED"), invalid: n("INVALID") };
}

async function auditSummary(params: MasterImportParams, kind: "warehouses" | "locations", r: MasterImportResult, update: boolean): Promise<void> {
  if (r.created + r.updated === 0) return;
  const { requestId, ...access } = params;
  await runTenantCommand({ ...access, permission: "data.import" }, async (tx, m) => {
    await appendAudit(tx, { action: "data.imported", actorUserId: m.userId, entityType: kind, requestId: requestId ?? null, changeSummary: { kind, mode: update ? "update" : "insert", created: r.created, updated: r.updated, unchanged: r.unchanged, skipped: r.skipped, invalid: r.invalid } });
    return null;
  });
}

function checkInput(rows: readonly unknown[]): void {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MASTER_IMPORT_MAX_ROWS) throw new AppError("VALIDATION_FAILED");
}

/** Depolar: `depo kodu` + `depo adı`. */
export async function importWarehouses(params: MasterImportParams, input: { readonly rows: readonly WarehouseImportRow[] } & MasterImportOptions): Promise<MasterImportResult> {
  checkInput(input.rows);
  await assertPermissions(params);
  const addMissing = !input.update || input.addMissing !== false;
  const { requestId, ...access } = params;
  // Mevcut depolar (kapsam dışı depo yok sayılır: varlığı sızmaz; aynı koda ekleme komutta CODE_TAKEN olur).
  const existing = await runTenantQuery({ ...access, permission: "settings.manage" }, async (tx, m) => {
    const scope = await resolveWarehouseScope(tx, m);
    const r = await tx.execute<{ id: string; code: string; name: string; status: string }>(sql`SELECT id, code, name, status FROM public.warehouses WHERE tenant_id = ${m.tenantId}::uuid`);
    return new Map(r.filter((x) => scope === null || scope.includes(x.id.toLowerCase())).map((x) => [x.code, x] as const));
  });
  const out: MasterRowResult[] = [];
  const seen = new Set<string>();
  for (const r of input.rows) {
    const c = code(r.code);
    if (!c.ok) {
      out.push({ row: r.row, status: "INVALID", issue: c.issue });
      continue;
    }
    const nm = name(r.name);
    if (!nm.ok) {
      out.push({ row: r.row, status: "INVALID", issue: nm.issue });
      continue;
    }
    if (seen.has(c.v)) {
      out.push({ row: r.row, status: "INVALID", issue: "CODE_DUPLICATE_FILE" });
      continue;
    }
    seen.add(c.v);
    const cur = existing.get(c.v);
    if (cur === undefined) {
      if (!addMissing) {
        out.push({ row: r.row, status: "SKIPPED" });
        continue;
      }
      if (nm.v === null) {
        out.push({ row: r.row, status: "INVALID", issue: "NAME_MISSING" });
        continue;
      }
      if (!input.dryRun) {
        try {
          await createWarehouse(access, { code: c.v, name: nm.v, requestId: requestId ?? null });
        } catch (e) {
          out.push({ row: r.row, status: "INVALID", issue: rowIssue(e) });
          continue;
        }
      }
      out.push({ row: r.row, status: "CREATED" });
      continue;
    }
    if (!input.update || cur.status !== "ACTIVE" || nm.v === null || nm.v === cur.name) {
      out.push({ row: r.row, status: "UNCHANGED" });
      continue;
    }
    if (!input.dryRun) {
      try {
        await renameWarehouse(access, { warehouseId: cur.id, name: nm.v, requestId: requestId ?? null });
      } catch (e) {
        out.push({ row: r.row, status: "INVALID", issue: rowIssue(e) });
        continue;
      }
    }
    out.push({ row: r.row, status: "UPDATED" });
  }
  const result = summarize(out);
  if (!input.dryRun) await auditSummary(params, "warehouses", result, input.update);
  return result;
}

interface LocInfo {
  readonly id: string | null;
  readonly name: string;
  readonly kind: LocationKindValue;
  readonly parentCode: string | null;
  readonly active: boolean;
}

/** Raflar: `depo kodu` + `raf kodu` + `raf adı` + `üst raf kodu` + `tür`. */
export async function importLocations(params: MasterImportParams, input: { readonly rows: readonly LocationImportRow[] } & MasterImportOptions): Promise<MasterImportResult> {
  checkInput(input.rows);
  await assertPermissions(params);
  const addMissing = !input.update || input.addMissing !== false;
  const { requestId, ...access } = params;
  const snap = await runTenantQuery({ ...access, permission: "settings.manage" }, async (tx, m) => {
    const scope = await resolveWarehouseScope(tx, m);
    const ws = await tx.execute<{ id: string; code: string; status: string }>(sql`SELECT id, code, status FROM public.warehouses WHERE tenant_id = ${m.tenantId}::uuid`);
    const visible = ws.filter((w) => scope === null || scope.includes(w.id.toLowerCase()));
    const ls = await tx.execute<{ id: string; warehouse_id: string; code: string; name: string; kind: LocationKindValue; status: string; parent: string | null }>(sql`
      SELECT l.id, l.warehouse_id, l.code, l.name, l.kind, l.status, p.code AS parent
        FROM public.locations l LEFT JOIN public.locations p ON p.tenant_id = l.tenant_id AND p.id = l.parent_id
       WHERE l.tenant_id = ${m.tenantId}::uuid`);
    return { warehouses: visible, locations: ls };
  });
  const whByCode = new Map(snap.warehouses.map((w) => [w.code, w] as const));
  const visibleIds = new Set(snap.warehouses.map((w) => w.id));
  // depo id → (raf kodu → bilgi); dosyada eklenenler de buraya girer (sonraki satırların üst rafı olabilsin).
  const locs = new Map<string, Map<string, LocInfo>>();
  for (const l of snap.locations) {
    if (!visibleIds.has(l.warehouse_id)) continue;
    const inner = locs.get(l.warehouse_id) ?? new Map<string, LocInfo>();
    inner.set(l.code, { id: l.id, name: l.name, kind: l.kind, parentCode: l.parent, active: l.status === "ACTIVE" });
    locs.set(l.warehouse_id, inner);
  }
  const out: MasterRowResult[] = [];
  const seen = new Set<string>();
  const bad = (row: number, issue: MasterIssue): void => {
    out.push({ row, status: "INVALID", issue });
  };
  for (const r of input.rows) {
    if (typeof r.warehouseCode !== "string" || r.warehouseCode.trim() === "") {
      bad(r.row, "WAREHOUSE_MISSING");
      continue;
    }
    const wc = code(r.warehouseCode);
    const wh = wc.ok ? whByCode.get(wc.v) : undefined;
    if (wh === undefined || wh.status !== "ACTIVE") {
      bad(r.row, "WAREHOUSE_UNKNOWN");
      continue;
    }
    const c = code(r.code);
    if (!c.ok) {
      bad(r.row, c.issue);
      continue;
    }
    const nm = name(r.name);
    if (!nm.ok) {
      bad(r.row, nm.issue);
      continue;
    }
    const kind = parseLocationKind(r.kind);
    if (kind === "UNKNOWN") {
      bad(r.row, "KIND_UNKNOWN");
      continue;
    }
    let parentCode: string | null = null;
    if (typeof r.parentCode === "string" && r.parentCode.trim() !== "") {
      const pc = code(r.parentCode);
      if (!pc.ok) {
        bad(r.row, "PARENT_UNKNOWN");
        continue;
      }
      parentCode = pc.v;
    }
    const key = `${wh.id}|${c.v}`;
    if (seen.has(key)) {
      bad(r.row, "CODE_DUPLICATE_FILE");
      continue;
    }
    seen.add(key);
    const tree = locs.get(wh.id) ?? new Map<string, LocInfo>();
    locs.set(wh.id, tree);
    const cur = tree.get(c.v);
    if (cur === undefined) {
      if (!addMissing) {
        out.push({ row: r.row, status: "SKIPPED" });
        continue;
      }
      if (nm.v === null) {
        bad(r.row, "NAME_MISSING");
        continue;
      }
      const parent = parentCode === null ? undefined : tree.get(parentCode);
      if (parentCode !== null && (parent === undefined || !parent.active)) {
        bad(r.row, "PARENT_UNKNOWN");
        continue;
      }
      const k = kind ?? "STORAGE";
      if (k === "TRANSIT" && parentCode !== null) {
        bad(r.row, "PARENT_INVALID");
        continue;
      }
      let id: string | null = null;
      if (!input.dryRun) {
        if (parent !== undefined && parent.id === null) {
          bad(r.row, "PARENT_UNKNOWN");
          continue;
        }
        try {
          id = (await createLocation(access, { warehouseId: wh.id, parentId: parent?.id ?? null, code: c.v, name: nm.v, kind: k, requestId: requestId ?? null })).locationId;
        } catch (e) {
          bad(r.row, rowIssue(e));
          continue;
        }
      }
      // Önizlemede kimlik yok; sonraki satır bu rafı üst raf olarak kullanabilir (yazımda gerçek kimlik).
      tree.set(c.v, { id, name: nm.v, kind: k, parentCode, active: true });
      out.push({ row: r.row, status: "CREATED" });
      continue;
    }
    if (!cur.active) {
      out.push({ row: r.row, status: "UNCHANGED" });
      continue;
    }
    if (!input.update) {
      out.push({ row: r.row, status: "UNCHANGED" });
      continue;
    }
    if (parentCode !== null && parentCode !== cur.parentCode) {
      bad(r.row, "PARENT_CHANGE");
      continue;
    }
    const rename = nm.v !== null && nm.v !== cur.name;
    const rekind = kind !== null && kind !== cur.kind;
    if (!rename && !rekind) {
      out.push({ row: r.row, status: "UNCHANGED" });
      continue;
    }
    if (rekind && kind === "TRANSIT" && cur.parentCode !== null) {
      bad(r.row, "PARENT_INVALID");
      continue;
    }
    if (!input.dryRun && cur.id !== null) {
      try {
        // Önce tür (stoklu rafta IN_USE ile reddedilebilir), sonra ad: tür reddedilirse satırın hiçbir alanı yazılmamış olur.
        if (rekind && kind !== null) await setLocationKind(access, { locationId: cur.id, kind, requestId: requestId ?? null });
        if (rename && nm.v !== null) await renameLocation(access, { locationId: cur.id, name: nm.v, requestId: requestId ?? null });
      } catch (e) {
        bad(r.row, rowIssue(e));
        continue;
      }
    }
    out.push({ row: r.row, status: "UPDATED" });
  }
  const result = summarize(out);
  if (!input.dryRun) await auditSummary(params, "locations", result, input.update);
  return result;
}
