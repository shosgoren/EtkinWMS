// Platform demo talepleri (T-994, ADR-026 §3): satış sitesi talepleri `wms_platform.demo_requests`'ta durur; YALNIZ platform
// operatörü (veritabanındaki `wms_platform.operators` listesi, 0038) listeler ve onaylar/reddeder. Tablolara hiçbir uygulama rolünün
// yetkisi yoktur; bütün erişim `wms_probe.platform_*` SECURITY DEFINER işlevleriyledir. Operatör kararı veritabanındadır; burada ek
// olarak oturum düzeyi MFA (ADR-014 §12) ve karar için yakın zamanda doğrulama (A-39) zorunludur.
// Kişisel veri (ad, e-posta, mesaj) günlüğe yazılmaz (G-09); hata yanıtı ham SQLSTATE taşımaz.
import { sql } from "drizzle-orm";
import { withUser } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { canDeliver, type MailConfig } from "@wms/shared/mailer";
import { PLATFORM_NO_USER_ID, type JobQueue } from "@wms/shared/queue";
import type { AccessDbClient, AccessPrincipal } from "../identity/access.ts";
import { generateActivationToken, hashActivationToken, placeholderActivationHash } from "./activation.ts";

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
  /** Verilmiş aktivasyon bağlantısı (belirteç/özet dönmez): teslim yolu ve son geçerlilik. */
  readonly activation: { readonly delivery: "EMAIL" | "SCREEN"; readonly expiresAt: Date } | null;
  /** Müşteri bağlantıyı kullanıp çalışma alanını açtıysa. */
  readonly activatedAt: Date | null;
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
export function mapPlatformError(e: unknown): unknown {
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

export function principalOrThrow(principal: AccessPrincipal | null | undefined): AccessPrincipal {
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
        activation_delivery: string | null;
        activation_expires_at: Date | string | null;
        activated_at: Date | string | null;
      }>(
        sql`SELECT id, received_at, name, company, email, sector, message, status, decided_at,
                   activation_delivery, activation_expires_at, activated_at
              FROM wms_probe.platform_list_demo_requests(${LIST_LIMIT}::integer)`,
      ),
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
      activation:
        (r.activation_delivery === "EMAIL" || r.activation_delivery === "SCREEN") && r.activation_expires_at !== null
          ? { delivery: r.activation_delivery, expiresAt: new Date(r.activation_expires_at) }
          : null,
      activatedAt: r.activated_at === null ? null : new Date(r.activated_at),
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

/** Onayın aktivasyon bağlantısı teslimi (ADR-026 §3.3, A-42 deseni). */
export interface ActivationDeliveryDeps {
  readonly mailConfig: MailConfig;
  /** Platform işi (tenant'sız): `platform.activation.deliver` yalnız talep kimliğiyle. */
  readonly queue: Pick<JobQueue, "enqueuePlatform">;
  readonly log?: (entry: Readonly<Record<string, unknown>>) => void;
}

export interface IssuedActivation {
  readonly delivery: "EMAIL" | "SCREEN";
  readonly expiresAt: Date;
  /** Yalnızca `SCREEN`: düz belirteç, yalnızca bu sonuçta bir kez (operatör müşteriye iletir). */
  readonly token?: string;
  /** `SCREEN` nedeni: posta teslimi kapalı/uygun değil ya da iş kuyruğa yazılamadı. */
  readonly screenReason?: "DELIVERY_UNAVAILABLE" | "QUEUE_UNAVAILABLE";
}

export interface DecideDemoRequestResult {
  readonly decision: DemoDecision;
  /** Yalnızca onayda. */
  readonly activation?: IssuedActivation;
}

export async function operatorWithRecentAuth(params: {
  readonly db: AccessDbClient;
  readonly principal: AccessPrincipal | null;
  readonly recentAuth: () => Promise<void>;
}): Promise<AccessPrincipal> {
  const principal = principalOrThrow(params.principal);
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
  return principal;
}

type IssueTx = Parameters<Parameters<typeof withUser>[2]>[0];

/** Aynı transaction'da bağlantı yazar: posta uygunsa yer tutucu özet (`EMAIL`), değilse ekranda gösterilecek belirteç (`SCREEN`). */
async function issueInTx(tx: IssueTx, id: string, mailConfig: MailConfig): Promise<{ delivery: "EMAIL" | "SCREEN"; expiresAt: Date; token?: string }> {
  const emailRows = await tx.execute<{ email: string }>(sql`SELECT wms_probe.platform_demo_request_email(${id}::uuid) AS email`);
  const email = emailRows[0]?.email;
  if (email === undefined) throw new AppError("NOT_FOUND");
  const delivery: "EMAIL" | "SCREEN" = canDeliver(mailConfig, email) ? "EMAIL" : "SCREEN";
  const token = delivery === "SCREEN" ? generateActivationToken() : undefined;
  const hash = token === undefined ? placeholderActivationHash() : hashActivationToken(token);
  const rows = await tx.execute<{ expires_at: Date | string }>(
    sql`SELECT wms_probe.platform_issue_activation(${id}::uuid, ${hash}, ${delivery}) AS expires_at`,
  );
  const raw = rows[0]?.expires_at;
  if (raw === undefined || raw === null) throw new AppError("INTERNAL");
  return { delivery, expiresAt: new Date(raw), ...(token === undefined ? {} : { token }) };
}

/**
 * E-postayla teslimde işi kuyruğa yazar (commit SONRASI: platform işi kendi transaction'ındadır). Yazılamazsa bağlantı ekranda
 * teslime çevrilir (yeni belirteç; yer tutucu geçersiz kalır) — operatör sessizce "gönderildi" görmez (G-07).
 */
async function deliverOrFallback(
  db: AccessDbClient,
  principal: AccessPrincipal,
  id: string,
  issued: { delivery: "EMAIL" | "SCREEN"; expiresAt: Date; token?: string },
  deps: ActivationDeliveryDeps,
): Promise<IssuedActivation> {
  if (issued.delivery === "SCREEN") return { ...issued, screenReason: "DELIVERY_UNAVAILABLE" };
  try {
    await deps.queue.enqueuePlatform({ type: "platform.activation.deliver", actorUserId: principal.userId, payload: { demoRequestId: id } });
    return { delivery: "EMAIL", expiresAt: issued.expiresAt };
  } catch (cause) {
    const c = cause as { name?: unknown; code?: unknown } | null;
    deps.log?.({
      level: "error",
      msg: "activation enqueue failed",
      error: typeof c?.name === "string" ? c.name : "unknown",
      ...(typeof c?.code === "string" ? { code: c.code } : {}),
    });
    const token = generateActivationToken();
    const rows = await withUser(db, principal.userId, (tx) =>
      tx.execute<{ expires_at: Date | string }>(
        sql`SELECT wms_probe.platform_issue_activation(${id}::uuid, ${hashActivationToken(token)}, 'SCREEN') AS expires_at`,
      ),
    );
    const raw = rows[0]?.expires_at;
    if (raw === undefined || raw === null) throw new AppError("INTERNAL");
    return { delivery: "SCREEN", expiresAt: new Date(raw), token, screenReason: "QUEUE_UNAVAILABLE" };
  }
}

export async function decideDemoRequest(params: DecideDemoRequestParams, deps: ActivationDeliveryDeps): Promise<DecideDemoRequestResult> {
  const { id, decision } = params;
  principalOrThrow(params.principal);
  if (typeof id !== "string" || !UUID.test(id)) throw new AppError("VALIDATION_FAILED");
  if (decision !== "APPROVED" && decision !== "REJECTED") throw new AppError("VALIDATION_FAILED");
  const principal = await operatorWithRecentAuth(params);
  try {
    // Karar ve (onayda) bağlantı TEK transaction'da: bağlantısız onay kalmaz.
    const out = await withUser(params.db, principal.userId, async (tx) => {
      const rows = await tx.execute<{ d: DemoDecision }>(sql`SELECT wms_probe.platform_decide_demo_request(${id}::uuid, ${decision}) AS d`);
      const d = rows[0]?.d;
      if (d !== "APPROVED" && d !== "REJECTED") throw new AppError("INTERNAL");
      return { d, issued: d === "APPROVED" ? await issueInTx(tx, id, deps.mailConfig) : undefined };
    });
    if (out.issued === undefined) return { decision: out.d };
    return { decision: out.d, activation: await deliverOrFallback(params.db, principal, id, out.issued, deps) };
  } catch (e) {
    throw mapPlatformError(e);
  }
}

/**
 * Onaylı ve henüz etkinleşmemiş talebe YENİ aktivasyon bağlantısı (süresi dolan, ekranda gösterilip kaybolan ya da teslim edilemeyen
 * bağlantı için). Eski bağlantı geçersiz olur. Operatör + MFA + yakın zamanda doğrulama.
 */
export async function reissueActivation(
  params: { readonly db: AccessDbClient; readonly principal: AccessPrincipal | null; readonly id: unknown; readonly recentAuth: () => Promise<void> },
  deps: ActivationDeliveryDeps,
): Promise<IssuedActivation> {
  const { id } = params;
  principalOrThrow(params.principal);
  if (typeof id !== "string" || !UUID.test(id)) throw new AppError("VALIDATION_FAILED");
  const principal = await operatorWithRecentAuth(params);
  try {
    const issued = await withUser(params.db, principal.userId, (tx) => issueInTx(tx, id, deps.mailConfig));
    return await deliverOrFallback(params.db, principal, id, issued, deps);
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

export { DEMO_SEAL_CONTEXT, normalizeDemoEmails, parseDemoSubmission, submitDemo, consumeDemoStatus, claimDemoMail, finishDemoMail } from './demo-submit.ts';
