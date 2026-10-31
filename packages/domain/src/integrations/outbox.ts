// T-1137: ERP gönderim kuyruğunda (`integration_outbox`) insan kararı bekleyen satırlar — okuma + iki çözüm komutu. Yetki `settings.manage`
// (yalnız hesap sahibi); tenant bağlamı doğrulanmış üyelikten (I-01…I-03, RLS); her durum değişikliği aynı transaction'da audit (I-12).
// Şema değişikliği yok: 0055/0066 kolon yetkileri (status, attempts, next_attempt_at, last_error_code) yeterli.
//
// Satır türleri:
//  - İrsaliye CHECK: Paraşüt yanıt vermedi; belge Paraşüt'te oluşmuş olabilir (tekrar anahtarı yok → kör yeniden gönderim çift irsaliye).
//    İnsan karar verir: "Yeniden gönder" (PENDING; ekran önce onay sorar) ya da "Gönderildi say" / "Gönderme" (FAILED + MANUAL_* kodu:
//    sorun sayılmaz, fark sorgusu belgeyi bir daha kuyruğa almaz çünkü satır kalır).
//  - İrsaliye FAILED: kesin red ya da 10 deneme (oluşmadı) → yeniden gönder güvenli; ya da elle çözüldü say.
//  - Kart FAILED `EXTERNAL_ALREADY_LINKED` (T-1135 bekletme): Paraşüt'teki karşılık başka karta bağlı; "Yeniden dene" bekletmeyi kaldırır
//    (PENDING) → sonraki koşu kartı yeniden dener; yine çakışırsa satır tekrar FAILED olur (sync.ts `parkCard`).
// Komutlar idempotenttir: aynı hedef duruma ikinci çağrı `changed: false` döner, audit yazılmaz.
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import { runTenantCommand, runTenantQuery, type AccessTx } from "../identity/access.ts";
import { MANUAL_OUTBOX_CODES, enqueueRun, type ConnectionCallParams, type IntegrationDeps } from "./connections.ts";
import type { Flow } from "./catalog.ts";

export const OUTBOX_ISSUE_LIMIT = 50;
export type OutboxFlow = Extract<Flow, "SHIPMENTS" | "PRODUCTS" | "CONTACTS" | "WAREHOUSES">;
export type OutboxEntity = "DOCUMENT" | "ITEM" | "PARTY" | "WAREHOUSE";
export type OutboxResolution = "SENT" | "SKIP";

export interface OutboxIssue {
  readonly id: string;
  readonly flow: OutboxFlow;
  readonly entityType: OutboxEntity;
  readonly entityId: string;
  /** Belge numarası ya da kart kodu (sır değil). */
  readonly code: string | null;
  readonly name: string | null;
  readonly status: "CHECK" | "FAILED";
  readonly errorCode: string | null;
  readonly attempts: number;
  readonly updatedAt: Date;
  /** Elle çözülebilir mi (yalnız irsaliye). */
  readonly resolvable: boolean;
}
export interface OutboxIssues {
  readonly items: readonly OutboxIssue[];
  readonly total: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function outboxId(raw: unknown): string {
  if (typeof raw !== "string" || !UUID_RE.test(raw)) throw new AppError("VALIDATION_FAILED");
  return raw.toLowerCase();
}
const manualIn = sql.join(MANUAL_OUTBOX_CODES.map((c) => sql`${c}`), sql`, `);

/** Karar bekleyen kuyruk satırları (CHECK + elle çözülmemiş FAILED); en çok `OUTBOX_ISSUE_LIMIT`, toplam ayrıca. CHECK önce. */
export async function getIntegrationOutboxIssues(params: ConnectionCallParams): Promise<OutboxIssues> {
  return runTenantQuery({ ...params, permission: "settings.manage" }, async (tx, m) => {
    const where = sql`o.tenant_id = ${m.tenantId}::uuid AND o.status IN ('CHECK', 'FAILED') AND NOT (o.status = 'FAILED' AND o.last_error_code IN (${manualIn}))`;
    const rows = await tx.execute<{ id: string; flow: OutboxFlow; entity_type: OutboxEntity; entity_id: string; status: "CHECK" | "FAILED"; last_error_code: string | null; attempts: number; updated_at: Date | string; code: string | null; name: string | null }>(sql`
      SELECT o.id, o.flow, o.entity_type, o.entity_id, o.status, o.last_error_code, o.attempts, o.updated_at,
             COALESCE(d.number, i.code, p.code, w.code) AS code, COALESCE(i.name, p.name, w.name) AS name
        FROM public.integration_outbox o
        LEFT JOIN public.documents d ON o.entity_type = 'DOCUMENT' AND d.tenant_id = o.tenant_id AND d.id = o.entity_id
        LEFT JOIN public.items i ON o.entity_type = 'ITEM' AND i.tenant_id = o.tenant_id AND i.id = o.entity_id
        LEFT JOIN public.parties p ON o.entity_type = 'PARTY' AND p.tenant_id = o.tenant_id AND p.id = o.entity_id
        LEFT JOIN public.warehouses w ON o.entity_type = 'WAREHOUSE' AND w.tenant_id = o.tenant_id AND w.id = o.entity_id
       WHERE ${where}
       ORDER BY (o.status = 'CHECK') DESC, o.updated_at DESC, o.id
       LIMIT ${OUTBOX_ISSUE_LIMIT}`);
    const total = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM public.integration_outbox o WHERE ${where}`);
    return {
      total: Number(total[0]?.n ?? 0),
      items: rows.map((r) => ({
        id: r.id,
        flow: r.flow,
        entityType: r.entity_type,
        entityId: r.entity_id,
        code: r.code,
        name: r.name,
        status: r.status,
        errorCode: r.last_error_code,
        attempts: Number(r.attempts),
        updatedAt: new Date(r.updated_at),
        resolvable: r.flow === "SHIPMENTS",
      })),
    };
  });
}

export type OutboxActionResult =
  | { readonly ok: true; readonly changed: boolean; readonly queued: boolean }
  | { readonly ok: false; readonly reason: "NOT_FOUND" | "NOT_RETRYABLE" | "UNSUPPORTED" };

type Locked = { id: string; integration_id: string; flow: OutboxFlow; entity_type: OutboxEntity; entity_id: string; status: string; last_error_code: string | null; conn_status: string };

/** Satırı kilitle (tenant + kimlik; RLS ayrıca süzer). Bağlantı durumu kuyruk kararı için birlikte okunur. */
async function lockRow(tx: AccessTx, tenantId: string, id: string): Promise<Locked | undefined> {
  const r = await tx.execute<Locked>(sql`
    SELECT o.id, o.integration_id, o.flow, o.entity_type, o.entity_id, o.status, o.last_error_code, i.status AS conn_status
      FROM public.integration_outbox o JOIN public.integrations i ON i.tenant_id = o.tenant_id AND i.id = o.integration_id
     WHERE o.tenant_id = ${tenantId}::uuid AND o.id = ${id}::uuid
       FOR UPDATE OF o`);
  return r[0];
}

/**
 * Yeniden dene / gönder: CHECK ya da FAILED satır PENDING olur (deneme sayacı sıfır, hemen sırada); kart bekletmesi kalkar. Bağlantı
 * bağlıysa o akışın koşusu kuyruğa girer. Zaten PENDING ise değişiklik yok. Gönderilmiş / gönderilmekte olan satır değişmez.
 */
export async function retryIntegrationOutbox(params: ConnectionCallParams, input: { readonly id: string; readonly requestId?: string | null }, deps: IntegrationDeps = {}): Promise<OutboxActionResult> {
  const id = outboxId(input.id);
  return runTenantCommand({ ...params, permission: "settings.manage" }, async (tx, m) => {
    const row = await lockRow(tx, m.tenantId, id);
    if (row === undefined) return { ok: false, reason: "NOT_FOUND" } as const;
    if (row.status === "PENDING") return { ok: true, changed: false, queued: false } as const;
    if (row.status !== "CHECK" && row.status !== "FAILED") return { ok: false, reason: "NOT_RETRYABLE" } as const;
    await tx.execute(sql`UPDATE public.integration_outbox SET status = 'PENDING', attempts = 0, next_attempt_at = now(), last_error_code = NULL
                          WHERE tenant_id = ${m.tenantId}::uuid AND id = ${row.id}::uuid`);
    await appendAudit(tx, {
      action: "integration.outbox_retried",
      actorUserId: m.userId,
      entityType: "integration",
      entityId: row.integration_id,
      requestId: input.requestId ?? null,
      changeSummary: { outbox_id: row.id, flow: row.flow, entity_type: row.entity_type, entity_id: row.entity_id, before: { status: row.status, error: row.last_error_code } },
    });
    const queued = row.conn_status === "CONNECTED" ? await enqueueRun(tx, deps, m.userId, row.integration_id, row.flow) : false;
    return { ok: true, changed: true, queued } as const;
  });
}

/**
 * İrsaliyeyi elle çözüldü say: "SENT" = Paraşüt'te zaten var, "SKIP" = gönderilmesin. Satır FAILED + MANUAL_* kodu olur (sorun sayılmaz,
 * belge bir daha kuyruğa girmez). Yalnız irsaliye satırı ve yalnız CHECK / FAILED durumunda. Aynı karar ikinci kez: değişiklik yok.
 */
export async function resolveIntegrationOutbox(
  params: ConnectionCallParams,
  input: { readonly id: string; readonly resolution: OutboxResolution; readonly requestId?: string | null },
): Promise<OutboxActionResult> {
  const id = outboxId(input.id);
  if (input.resolution !== "SENT" && input.resolution !== "SKIP") throw new AppError("VALIDATION_FAILED");
  const code = input.resolution === "SENT" ? "MANUAL_SENT" : "MANUAL_SKIPPED";
  return runTenantCommand({ ...params, permission: "settings.manage" }, async (tx, m) => {
    const row = await lockRow(tx, m.tenantId, id);
    if (row === undefined) return { ok: false, reason: "NOT_FOUND" } as const;
    if (row.flow !== "SHIPMENTS") return { ok: false, reason: "UNSUPPORTED" } as const;
    if (row.status === "FAILED" && row.last_error_code === code) return { ok: true, changed: false, queued: false } as const;
    if (row.status !== "CHECK" && row.status !== "FAILED") return { ok: false, reason: "NOT_RETRYABLE" } as const;
    await tx.execute(sql`UPDATE public.integration_outbox SET status = 'FAILED', last_error_code = ${code}
                          WHERE tenant_id = ${m.tenantId}::uuid AND id = ${row.id}::uuid`);
    await appendAudit(tx, {
      action: "integration.outbox_resolved",
      actorUserId: m.userId,
      entityType: "integration",
      entityId: row.integration_id,
      requestId: input.requestId ?? null,
      changeSummary: { outbox_id: row.id, flow: row.flow, entity_id: row.entity_id, resolution: input.resolution, before: { status: row.status, error: row.last_error_code } },
    });
    return { ok: true, changed: true, queued: false } as const;
  });
}
