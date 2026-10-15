// Platform demo talepleri (T-994, ADR-026 §3): satış sitesi talepleri `wms_platform.demo_requests`'ta durur; YALNIZ platform
// operatörü (veritabanındaki `wms_platform.operators` listesi, 0038) listeler ve onaylar/reddeder. Tablolara hiçbir uygulama rolünün
// yetkisi yoktur; bütün erişim `wms_probe.platform_*` SECURITY DEFINER işlevleriyledir. Operatör kararı veritabanındadır; burada ek
// olarak oturum düzeyi MFA (ADR-014 §12) ve karar için yakın zamanda doğrulama (A-39) zorunludur.
// Kişisel veri (ad, e-posta, mesaj) günlüğe yazılmaz (G-09); hata yanıtı ham SQLSTATE taşımaz.
import { sql } from "drizzle-orm";
import { withUser } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { PLATFORM_NO_USER_ID } from "@wms/shared/queue";
import type { AccessDbClient, AccessPrincipal } from "../identity/access.ts";

export type DemoRequestStatus = "PENDING" | "APPROVED" | "REJECTED";
export type DemoDecision = "APPROVED" | "REJECTED";

export interface DemoRequestRow {
  readonly id: string;
  readonly receivedAt: Date;
  readonly name: string;
  readonly company: string;
  readonly email: string;
  readonly sector: string;
  readonly message: string;
  readonly status: DemoRequestStatus;
  readonly decidedAt: Date | null;
}

/** Satış sitesinin JSONL satırı (marketing/server.mjs `record`). */
export interface DemoLeadRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly name: string;
  readonly company: string;
  readonly email: string;
  readonly sector?: string;
  readonly message?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIST_LIMIT = 100;

function sqlstateOf(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 6 && cur !== undefined && cur !== null; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Veritabanı retlerini sözleşme kodlarına çevirir; kök neden yalnızca `cause`'da kalır. */
function mapPlatformError(e: unknown): unknown {
  if (e instanceof AppError) return e;
  const state = sqlstateOf(e);
  const wrap = (code: "FORBIDDEN" | "NOT_FOUND" | "VERSION_CONFLICT" | "VALIDATION_FAILED" | "INTERNAL"): AppError => {
    const err = new AppError(code);
    err.cause = e;
    return err;
  };
  if (state === "42501") return wrap("NOT_FOUND"); // operatör değil: ekranın varlığı da sızdırılmaz
  if (state === "P0002") return wrap("NOT_FOUND");
  if (state === "55000") return wrap("VERSION_CONFLICT"); // zaten karara bağlanmış
  if (state === "22023") return wrap("VALIDATION_FAILED");
  return wrap("INTERNAL");
}

function principalOrThrow(principal: AccessPrincipal | null | undefined): AccessPrincipal {
  if (principal === null || principal === undefined) throw new AppError("UNAUTHENTICATED");
  if (!principal.mfaVerified) throw new AppError("FORBIDDEN", { detail: "MFA_REQUIRED" });
  return principal;
}

/** Çağıran platform operatörü mü (MFA'sız oturum için de doğru yanıt verir; ekran MFA'yı ayrıca ister). */
export async function isPlatformOperator(params: { readonly db: AccessDbClient; readonly principal: AccessPrincipal | null }): Promise<boolean> {
  const { db, principal } = params;
  if (principal === null) return false;
  const rows = await withUser(db, principal.userId, (tx) => tx.execute<{ ok: boolean }>(sql`SELECT wms_probe.platform_is_operator() AS ok`));
  return rows[0]?.ok === true;
}

export async function listDemoRequests(params: { readonly db: AccessDbClient; readonly principal: AccessPrincipal | null }): Promise<readonly DemoRequestRow[]> {
  const principal = principalOrThrow(params.principal);
  try {
    const rows = await withUser(params.db, principal.userId, (tx) =>
      tx.execute<{
        id: string;
        received_at: Date | string;
        name: string;
        company: string;
        email: string;
        sector: string;
        message: string;
        status: DemoRequestStatus;
        decided_at: Date | string | null;
      }>(sql`SELECT id, received_at, name, company, email, sector, message, status, decided_at FROM wms_probe.platform_list_demo_requests(${LIST_LIMIT}::integer)`),
    );
    return rows.map((r) => ({
      id: r.id,
      receivedAt: new Date(r.received_at),
      name: r.name,
      company: r.company,
      email: r.email,
      sector: r.sector,
      message: r.message,
      status: r.status,
      decidedAt: r.decided_at === null ? null : new Date(r.decided_at),
    }));
  } catch (e) {
    throw mapPlatformError(e);
  }
}

export interface DecideDemoRequestParams {
  readonly db: AccessDbClient;
  readonly principal: AccessPrincipal | null;
  readonly id: unknown;
  readonly decision: unknown;
  /** A-39 yakın zamanda doğrulama; transaction DIŞINDA çağrılır (access.ts ile aynı sıra). */
  readonly recentAuth: () => Promise<void>;
}

export async function decideDemoRequest(params: DecideDemoRequestParams): Promise<DemoDecision> {
  const principal = principalOrThrow(params.principal);
  const { id, decision } = params;
  if (typeof id !== "string" || !UUID.test(id)) throw new AppError("VALIDATION_FAILED");
  if (decision !== "APPROVED" && decision !== "REJECTED") throw new AppError("VALIDATION_FAILED");
  // Önce operatör mü (yetkisiz çağrı gereksiz kimlik sorgusu üretmez), sonra yakın zamanda doğrulama, sonra karar (işlev yeniden denetler).
  if (!(await isPlatformOperator({ db: params.db, principal }))) throw new AppError("NOT_FOUND");
  try {
    await params.recentAuth();
  } catch (e) {
    const o = e as { code?: unknown; reason?: unknown } | null;
    if (o?.reason === "REAUTH_REQUIRED") throw new AppError("UNAUTHENTICATED", { detail: "RECENT_AUTH_REQUIRED" });
    if (o?.code === "UNAUTHENTICATED") throw new AppError("UNAUTHENTICATED");
    throw mapPlatformError(e);
  }
  try {
    const rows = await withUser(params.db, principal.userId, (tx) =>
      tx.execute<{ d: DemoDecision }>(sql`SELECT wms_probe.platform_decide_demo_request(${id}::uuid, ${decision}) AS d`),
    );
    const d = rows[0]?.d;
    if (d !== "APPROVED" && d !== "REJECTED") throw new AppError("INTERNAL");
    return d;
  } catch (e) {
    throw mapPlatformError(e);
  }
}

/** Bir JSONL satırını doğrular; geçersizse `null` (satış sitesi `validateLead` ile aynı sınırlar). */
export function parseDemoLead(line: string): DemoLeadRecord | null {
  let o: unknown;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (o === null || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const s = (k: string, max: number): string | null => (typeof r[k] === "string" && (r[k] as string).length <= max ? (r[k] as string) : null);
  const id = s("id", 36);
  const createdAt = s("createdAt", 40);
  const name = s("name", 100);
  const company = s("company", 150);
  const email = s("email", 254);
  const sector = r.sector === undefined ? "" : s("sector", 100);
  const message = r.message === undefined ? "" : s("message", 2000);
  if (id === null || !UUID.test(id) || createdAt === null || Number.isNaN(Date.parse(createdAt))) return null;
  if (name === null || name.trim() === "" || company === null || company.trim() === "" || email === null || !EMAIL.test(email.trim())) return null;
  if (sector === null || message === null) return null;
  return { id, createdAt, name, company, email, sector, message };
}

/**
 * JSONL içeriğini içe alır (idempotent: aynı kimlik ikinci kez eklenmez). Geçersiz satır atlanır ve sayılır; içerik günlüğe yazılmaz.
 * Dönen `inserted` yeni eklenen talep sayısıdır.
 */
export async function ingestDemoLeads(params: { readonly db: AccessDbClient; readonly jsonl: string }): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const line of params.jsonl.split("\n")) {
    if (line.trim() === "") continue;
    const lead = parseDemoLead(line);
    if (lead === null) {
      skipped++;
      continue;
    }
    try {
      const rows = await withUser(params.db, PLATFORM_NO_USER_ID, (tx) =>
        tx.execute<{ ok: boolean }>(
          sql`SELECT wms_probe.platform_ingest_demo_request(${lead.id}::uuid, ${lead.createdAt}::timestamptz, ${lead.name}, ${lead.company}, ${lead.email}, ${lead.sector ?? ""}, ${lead.message ?? ""}) AS ok`,
        ),
      );
      if (rows[0]?.ok === true) inserted++;
    } catch (e) {
      // Tek bozuk satır (ör. kısıt reddi) sonrakileri durdurmaz; veritabanı/bağlantı hatası (22/23 sınıfı dışı) yukarı çıkar.
      const state = sqlstateOf(e);
      if (state === undefined || !/^(22|23)/.test(state)) throw e;
      skipped++;
    }
  }
  return { inserted, skipped };
}
