// T-1138: Paraşüt anlık bildirim (webhook) — alıcı uç ve tek kart olayı işi. Kullanıcı önceliği 30 Ekim: ürün/cari kartı Paraşüt'te
// değişince Etkin'e beklemeden aksın; tam katalog taraması uzlaştırma kademesine (webhook-register.ts) düşer.
//
// GÜVENLİK (herkese açık uç):
// - Tenant isteğin `company_id` alanından DEĞİL, bizim eşlememizden bulunur: `wms_probe.integration_webhook_lookup` yalnız bağlı + anlık
//   bildirimi etkin bağlantıları ve onların MÜHÜRLÜ anahtar kutularını döndürür (0067). Kutu tenant AAD'siyle açılır; imza o tenant'ın
//   anahtarıyla sabit zamanlı karşılaştırılır. Eşleşme yoksa / gövde bozuksa / imza yoksa yanıt aynıdır (401, gövde sabit) — hangi
//   adımın düştüğü dışarı sızmaz.
// - Teslim yükü karta YAZILMAZ: iş kaydı Paraşüt'ten kimliğiyle yeniden okur (yetkili belirteçle, aynı şirket). 404 = kaynakta yok →
//   mevcut ürün yaşam döngüsü kuralları (≥30 sn arayla iki yokluk; fiziksel silme yok; T-1140'tan beri cari için de card-lifecycle.ts).
//   Yük yalnız kaynak türü + kimlik + olay zamanı verir. T-1140: iki yönlü akışta kart, eşitleme koşusuyla aynı karar kuralından geçer
//   (card-sync.ts `syncRemoteCard`; yerel taraf daha yeniyse uygulanmaz — LOCAL_NEWER, gönderim koşunun düzeltme turunda).
// - Tekrar teslim: olay anahtarı = özet(tenant, kaynak, kimlik, olay zamanı) → kuyruk singletonKey + `processed_events` (I-07).
// - Gövde en çok 64 KiB; imza adayları sınırlı (tenant başına en çok 6 anahtar × 2 özet × en çok 2 ileti; en çok 5 tenant).
//
// VARSAYIM (UNKNOWN, gerçek hesapta doğrulanacak — BACKLOG): Paraşüt belgesi `Signature` başlığını "olay verisi ve şifreleme anahtarı
// üzerinden SHA256" diye tanımlar; kesin yapı yazmaz. Kabul edilen yapılar: HMAC-SHA256(anahtar, veri) onaltılık / base64 ve
// SHA256(veri + anahtar) onaltılık; "veri" = teslimdeki `data` alanının ham metni (ya da JSON gövdede nesne ise JSON metni) veya ham gövde.
// Hepsi anahtarı bilmeyi gerektirir; anahtarsız yapı (düz SHA256(veri)) kabul edilmez.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { appendAudit, currentTenantId, withSystemTenant, withUser } from "@wms/db";
import type { JobQueue } from "@wms/shared/queue";
import type { Sealer } from "@wms/shared/seal";
import type { AccessDbClient, AccessTx } from "../identity/access.ts";
import { applyContact, applyProduct, type ApplyContext, type ApplyOutcome } from "./apply.ts";
import { PROVIDER_INFO, pulls, type Direction } from "./catalog.ts";
import type { JsonApiResource, ParasutClient } from "./parasut.ts";
import { assertLifecycleBinding, lifecycleBinding, observeProduct, type LifecycleBinding } from "./product-lifecycle.ts";
import { syncRemoteCard } from "./card-sync.ts";
import { observeCard } from "./card-lifecycle.ts";
import { connectorAllowed, toContact, toProduct } from "./sync.ts";
import { IntegrationStateError, accessToken, loadIntegration, type RunTx } from "./store.ts";

export const WEBHOOK_BODY_MAX = 64 * 1024;
export const WEBHOOK_CONSUMER = "integration.webhook.event";
const KEY_AAD = (tenantId: string) => ({ jobType: "integration.webhook.key", template: "PARASUT", tenantId });
const NIL_USER_ID = "00000000-0000-0000-0000-000000000000";
const COMPANY_RE = /^[0-9]{1,12}$/;
const ID_RE = /^[0-9]{1,18}$/;
/** İkinci yokluk gözleminden önce bekleme (product-lifecycle: ≥30 sn). */
export const MISSING_RECHECK_MS = 31_000;

export type WebhookResource = "product" | "contact";
export type WebhookAction = "create" | "update" | "delete";

export interface ParsedDelivery {
  readonly companyId: string;
  /** Kart kaynağı; başka model (fatura, irsaliye…) `null` → imza doğrulanır, iş açılmaz. */
  readonly resource: WebhookResource | null;
  readonly action: WebhookAction;
  readonly externalId: string;
  /** Dış `event_date` (yoksa kaydın `updated_at`'i, o da yoksa veri özeti). Yalnız ham gövde imzalıysa kullanılır. */
  readonly eventDate: string;
  /** İmzalı `data` içinden olay zamanı: `updated_at`, yoksa `data` metninin özeti. Yalnız `data` imzalıysa kullanılır (T-1138 inceleme MINOR-1). */
  readonly dataEventDate: string;
  /** İmza adayları: `data` alanının metni ve ham gövde (tekrarsız). */
  readonly signed: readonly string[];
  /** `signed` içinde ham gövdenin sırası (dış alanlar yalnız bu ileti eşleşince imzalıdır). */
  readonly rawIndex: number;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null);

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function idOf(data: unknown): string | null {
  if (data === null || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const direct = str(d.id);
  if (direct !== null) return direct;
  const inner = d.data;
  return inner !== null && typeof inner === "object" ? str((inner as Record<string, unknown>).id) : null;
}

function updatedAtOf(data: unknown): string | null {
  if (data === null || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const pick = (o: unknown): string | null => (o !== null && typeof o === "object" ? str((o as Record<string, unknown>).updated_at) : null);
  const inner = d.data;
  return str(d.updated_at) ?? pick(d.attributes) ?? (inner !== null && typeof inner === "object" ? pick((inner as Record<string, unknown>).attributes) : null);
}

/** Paraşüt `resource` / `model` adı → kart kaynağı (çoğul da kabul). Tanınmayan model `null`. */
function resourceOf(raw: string): WebhookResource | null {
  const r = raw.trim().toLowerCase().replace(/s$/, "");
  return r === "product" || r === "contact" ? r : null;
}

/**
 * Teslim gövdesi: `www-url-encoded` (belge) ya da JSON; ikisi de kabul. Biçimsiz / eksik alan → `null` (çağıran 401 döner).
 * `data` metin olarak gelirse (belge: "ayrıştırılmamış metin olabilir") JSON olarak okunur.
 */
export function parseWebhookBody(raw: string): ParsedDelivery | null {
  if (raw.length === 0 || raw.length > WEBHOOK_BODY_MAX) return null;
  let fields: Record<string, unknown>;
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("{")) {
    const o = json(trimmed);
    if (o === null || typeof o !== "object" || Array.isArray(o)) return null;
    fields = o as Record<string, unknown>;
  } else {
    const p = new URLSearchParams(raw);
    fields = {};
    for (const k of ["company_id", "resource", "model", "action", "event_date", "data"]) {
      const all = p.getAll(k);
      if (all.length > 1) return null; // yinelenen alan: belirsiz → ret
      if (all.length === 1) fields[k] = all[0];
    }
  }
  const companyId = str(fields.company_id)?.trim() ?? "";
  const resourceRaw = str(fields.resource) ?? str(fields.model);
  const action = str(fields.action)?.trim().toLowerCase();
  if (!COMPANY_RE.test(companyId) || resourceRaw === null || resourceRaw.length > 40) return null;
  if (action !== "create" && action !== "update" && action !== "delete") return null;
  const rawData = fields.data;
  let dataText: string | null = null;
  let data: unknown;
  if (typeof rawData === "string") {
    dataText = rawData;
    data = json(rawData);
  } else if (rawData !== null && typeof rawData === "object") {
    data = rawData;
    dataText = JSON.stringify(rawData);
  }
  const externalId = idOf(data);
  if (externalId === null || !ID_RE.test(externalId)) return null;
  const eventRaw = str(fields.event_date) ?? updatedAtOf(data);
  const eventDate = eventRaw !== null && eventRaw.length <= 64 && !/\p{C}/u.test(eventRaw) ? eventRaw.trim() : createHash("sha256").update(dataText ?? raw).digest("hex");
  const dataUpdated = updatedAtOf(data);
  const dataEventDate = dataUpdated !== null && dataUpdated.length <= 64 && !/\p{C}/u.test(dataUpdated) ? dataUpdated.trim() : createHash("sha256").update(dataText ?? raw).digest("hex");
  const signed = [...new Set([...(dataText === null ? [] : [dataText]), raw])];
  return { companyId, resource: resourceOf(resourceRaw), action, externalId, eventDate, dataEventDate, signed, rawIndex: signed.indexOf(raw) };
}

/** Yeni imza anahtarı (32 bayt, onaltılık). Paraşüt anahtar atarsa onunki kullanılır (webhook-register.ts). */
export function newWebhookKey(): string {
  return randomBytes(32).toString("hex");
}

export function sealWebhookKey(sealer: Sealer, tenantId: string, key: string): unknown {
  return sealer.seal({ key }, KEY_AAD(tenantId));
}

/** Kutu açılmazsa / şekil bozuksa `null` (başka tenant'a kopyalanmış kutu AAD yüzünden açılmaz). */
export function openWebhookKey(sealer: Sealer, tenantId: string, box: unknown): string | null {
  try {
    const o = sealer.open(box, KEY_AAD(tenantId));
    return typeof o.key === "string" && o.key.length >= 16 && o.key.length <= 512 ? o.key : null;
  } catch {
    return null;
  }
}

/** Kabul edilen imza yapıları (VARSAYIM, dosya başı). */
export function signatureCandidates(key: string, message: string): readonly string[] {
  const hmac = createHmac("sha256", key).update(message, "utf8").digest();
  return [hmac.toString("hex"), hmac.toString("base64"), createHash("sha256").update(message + key, "utf8").digest("hex")];
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8"), y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Başlık değerini sabit zamanlı karşılaştırır (önek `sha256=` ve büyük/küçük harf onaltılıkta tolere edilir). Eşleşen iletinin sırası
 * döner (yoksa -1): çağıran yalnız imzalı iletideki alanlara güvenir (MINOR-1). Ham gövde eşleşmesi önceliklidir (her şeyi kapsar).
 */
export function matchSignature(header: string | null, keys: readonly string[], messages: readonly string[], prefer = -1): number {
  if (header === null) return -1;
  const sig = header.trim().replace(/^sha256=/i, "");
  if (sig.length < 32 || sig.length > 128) return -1;
  const lower = /^[0-9a-fA-F]+$/.test(sig) ? sig.toLowerCase() : sig;
  let hit = -1;
  for (const key of keys)
    messages.forEach((m, i) => {
      for (const c of signatureCandidates(key, m)) if (same(lower, c) && (hit === -1 || i === prefer)) hit = i; // erken çıkış yok
    });
  return hit;
}

export function verifySignature(header: string | null, keys: readonly string[], messages: readonly string[]): boolean {
  return matchSignature(header, keys, messages) !== -1;
}

/** İmzalı alanlar: ham gövde eşleştiyse dış `event_date`/`action`; yalnız `data` eşleştiyse `data` içindeki zaman, eylem YOK (imzasız). */
export function signedFields(p: ParsedDelivery, matched: number): { readonly eventDate: string; readonly action: WebhookAction | null } {
  return matched === p.rawIndex ? { eventDate: p.eventDate, action: p.action } : { eventDate: p.dataEventDate, action: null };
}

/** Olay anahtarı: (tenant, kaynak, kimlik, olay zamanı) özetinden UUID biçimi (processed_events + singletonKey). */
export function webhookEventKey(tenantId: string, resource: string, externalId: string, eventDate: string): string {
  const h = createHash("sha256").update(JSON.stringify(["parasut-webhook", tenantId, resource, externalId, eventDate])).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** Kuyruk tekil anahtarı kayıt başınadır (bağlantı, kaynak, kimlik): bekleyen/çalışan iş varken yeni teslim iş açmaz (MINOR-1). */
export const webhookEventSingletonKey = (integrationId: string, resource: WebhookResource, externalId: string): string => `integration.webhook.event.${integrationId}.${resource}.${externalId}`;

// --- alıcı ---------------------------------------------------------------------------------------------------------------------------
export interface ReceiveDeps {
  readonly db: AccessDbClient;
  readonly sealer: Sealer;
  /** Kuyruk yoksa 503 (Paraşüt yeniden dener; uzlaştırma taraması da yakalar). */
  readonly queue: Pick<JobQueue<AccessTx>, "enqueue"> | undefined;
}

export type ReceiveResult =
  | { readonly status: 200; readonly outcome: "QUEUED" | "DUPLICATE" | "IGNORED" }
  | { readonly status: 401; readonly outcome: "REJECTED" }
  | { readonly status: 503; readonly outcome: "UNAVAILABLE" };

type LookupRow = { tenant_id: string; integration_id: string; key_boxes: unknown };

/**
 * Teslimi doğrula ve kuyruğa yaz. Dönüş yalnız durum + sabit sonuç (çağıran gövdeye sabit metin yazar). Tenant yalnız imza eşleşen
 * eşlemedir; aynı şirkete bağlı birden çok tenant varsa her biri kendi anahtarıyla denenir, eşleşmeyen tenant'a dokunulmaz.
 */
export async function receiveParasutWebhook(deps: ReceiveDeps, input: { readonly body: string; readonly signature: string | null }): Promise<ReceiveResult> {
  const reject = { status: 401, outcome: "REJECTED" } as const;
  const parsed = parseWebhookBody(input.body);
  if (parsed === null || input.signature === null) return reject;
  const rows = await withUser(deps.db, NIL_USER_ID, (tx) =>
    tx.execute<LookupRow>(sql`SELECT tenant_id, integration_id, key_boxes FROM wms_probe.integration_webhook_lookup('PARASUT', ${parsed.companyId})`),
  );
  let match: LookupRow | null = null;
  let matched = -1;
  for (const row of rows) {
    const boxes = Array.isArray(row.key_boxes) ? row.key_boxes.slice(0, 6) : [];
    const keys = [...new Set(boxes.map((b) => openWebhookKey(deps.sealer, row.tenant_id, b)).filter((k): k is string => k !== null))];
    const i = keys.length > 0 ? matchSignature(input.signature, keys, parsed.signed, parsed.rawIndex) : -1;
    if (i !== -1 && match === null) {
      match = row;
      matched = i;
    }
  }
  if (match === null) return reject;
  const trusted = signedFields(parsed, matched);
  const { tenant_id: tenantId, integration_id: integrationId } = match;
  if (parsed.resource === null) {
    // Kart dışı model (fatura, irsaliye…): doğrulandı, iş yok (satış akışı bekliyor — kullanıcı önceliği 30 Ekim).
    return { status: 200, outcome: "IGNORED" };
  }
  if (deps.queue === undefined) return { status: 503, outcome: "UNAVAILABLE" };
  const queue = deps.queue;
  const eventKey = webhookEventKey(tenantId, parsed.resource, parsed.externalId, trusted.eventDate);
  const resource = parsed.resource;
  try {
    const jobId = await withSystemTenant(deps.db as never, tenantId, "integration.webhook", async (tx) => {
      await tx.execute(sql`UPDATE public.integrations SET webhook_last_event_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${integrationId}::uuid AND status = 'CONNECTED'`);
      const r = await queue.enqueue(tx as AccessTx, {
        type: "integration.webhook",
        payload: { integrationId, kind: "EVENT", resource, ...(trusted.action === null ? {} : { action: trusted.action }), externalId: parsed.externalId, eventKey },
        // Kayıt başına tek bekleyen iş: yeniden tarihlenmiş tekrar teslim seli tek işe çöker; iş çalışınca güncel durumu okur.
        singletonKey: webhookEventSingletonKey(integrationId, resource, parsed.externalId),
      });
      return r.jobId;
    });
    return { status: 200, outcome: jobId === null ? "DUPLICATE" : "QUEUED" };
  } catch (e) {
    // Askıdaki/kapanan tenant: bilinmeyen bağlantıyla aynı yanıt (durum sızmaz).
    if ((e as { code?: unknown } | null)?.code === "FORBIDDEN") return reject;
    throw e;
  }
}

// --- tek kart olayı (worker) ---------------------------------------------------------------------------------------------------------
export type ConsumeOnce = <R>(tx: AccessTx, consumer: string, eventId: string, fn: (tx: AccessTx) => Promise<R>) => Promise<{ readonly applied: true; readonly result: R } | { readonly applied: false }>;

export interface WebhookJobDeps {
  readonly inTenant: RunTx;
  readonly client: ParasutClient;
  readonly sealer: Sealer;
  readonly consumeOnce: ConsumeOnce;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface WebhookEventPayload {
  readonly integrationId: string;
  readonly resource: WebhookResource;
  /** Yalnız imzalıysa (ham gövde eşleşmesi); yoksa audit'e yazılmaz. İşin mantığı eyleme bakmaz (kimlikle yeniden okur). */
  readonly action?: WebhookAction | undefined;
  readonly externalId: string;
  readonly eventKey: string;
}

/** T-1140: `LOCAL_NEWER` — iki yönlüde yerel taraf kazandı (uygulanmadı; gönderim eşitleme koşusunun düzeltme turunda). */
export type WebhookOutcome = ApplyOutcome | "REMOVED_CHECKED" | "FAILED" | "IGNORED" | "LOCAL_NEWER";
export type WebhookEventResult =
  | { readonly kind: "skipped"; readonly reason: string }
  | { readonly kind: "duplicate" }
  | { readonly kind: "applied"; readonly outcome: WebhookOutcome };
type Finish = (outcome: WebhookOutcome, apply?: (tx: AccessTx) => Promise<WebhookOutcome | void>) => Promise<WebhookEventResult>;

/**
 * Yazım anı yetki denetimi (PR 273 P1): ağ okumasından sonra, yazan transaction'da bağlantı (aynı şirket + aynı bağlayan) CONNECTED,
 * bağlayan hâlâ ACTIVE üye + TENANT_ADMIN ve ilgili akış (Paraşüt → Etkin) açık mı — satırlar FOR SHARE kilitlenir: eşzamanlı kesme/akış
 * kapatma bu transaction bitene kadar bekler ya da biz onun sonucunu görürüz. Biri tutmazsa hiçbir şey yazılmaz.
 */
export async function webhookWriteAllowed(tx: AccessTx, w: { readonly tenantId: string; readonly integrationId: string; readonly companyId: string; readonly userId: string; readonly membershipId: string; readonly flow: "PRODUCTS" | "CONTACTS" }): Promise<boolean> {
  const r = await tx.execute<{ ok: boolean }>(sql`
    SELECT true AS ok
      FROM public.integrations i
      JOIN public.integration_flows f ON f.tenant_id = i.tenant_id AND f.integration_id = i.id AND f.flow = ${w.flow}
      JOIN public.tenant_memberships m ON m.tenant_id = i.tenant_id AND m.id = i.connected_membership_id AND m.user_id = i.connected_by
      JOIN public.membership_roles mr ON mr.tenant_id = m.tenant_id AND mr.membership_id = m.id AND mr.role_key = 'TENANT_ADMIN'
     WHERE i.tenant_id = ${w.tenantId}::uuid AND i.id = ${w.integrationId}::uuid AND i.provider = 'PARASUT' AND i.status = 'CONNECTED'
       AND i.account_ref = ${w.companyId} AND i.connected_by = ${w.userId}::uuid AND i.connected_membership_id = ${w.membershipId}::uuid
       AND m.status = 'ACTIVE' AND f.enabled AND f.direction IN ('PULL', 'BOTH')
     FOR SHARE OF i, f, m, mr`);
  return r[0]?.ok === true;
}

/** Geçici hata (yeniden denenmeli): kilitlenme/serileştirme, bağlantı, kaynak/kapanma. FAILED'a çevrilmez, yukarı fırlatılır (PR 273 P2). */
export function isTransientDbError(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 6 && cur !== null && cur !== undefined; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return /^(40|08|53|57|58)/.test(code) || code === "55P03";
    if (typeof code === "string" && /^(ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|CONNECTION_)/.test(code)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

async function processed(tx: AccessTx, eventKey: string): Promise<boolean> {
  const r = await tx.execute(sql`SELECT 1 AS one FROM public.processed_events WHERE consumer = ${WEBHOOK_CONSUMER} AND event_id = ${eventKey}::uuid LIMIT 1`);
  return r.length > 0;
}

/**
 * Tek kart olayını uygular: bağlantı + bağlayanın yetkisi + akış (Paraşüt → Etkin açık) yeniden doğrulanır, kart Paraşüt'ten kimliğiyle
 * okunur ve sync.ts'in tek kayıt yoluyla (apply.ts + yaşam döngüsü) yazılır. Etki `processed_events` ile tek kez.
 */
export async function runWebhookEvent(deps: WebhookJobDeps, p: WebhookEventPayload): Promise<WebhookEventResult> {
  const now = deps.now ?? Date.now;
  const head = await deps.inTenant(async (tx) => {
    const tenantId = (await currentTenantId(tx)) ?? null;
    if (tenantId === null) return { kind: "skip" as const, reason: "NO_TENANT" };
    if (await processed(tx, p.eventKey)) return { kind: "dup" as const };
    const row = await loadIntegration(tx, tenantId, { id: p.integrationId });
    if (row === null || row.provider !== "PARASUT" || row.status !== "CONNECTED" || row.connectedBy === null || row.connectedMembershipId === null) return { kind: "skip" as const, reason: "NOT_CONNECTED" };
    if (!(await connectorAllowed(tx, tenantId, row.connectedMembershipId, row.connectedBy))) return { kind: "skip" as const, reason: "CONNECTOR_REVOKED" };
    const flow = p.resource === "product" ? "PRODUCTS" : "CONTACTS";
    const f = await tx.execute<{ direction: Direction; enabled: boolean }>(sql`SELECT direction, enabled FROM public.integration_flows WHERE tenant_id = ${tenantId}::uuid AND integration_id = ${row.id}::uuid AND flow = ${flow}`);
    if (f[0] === undefined || !f[0].enabled || !pulls(f[0].direction)) return { kind: "skip" as const, reason: "FLOW_OFF" };
    // T-1140: cari de ürün gibi yaşam döngüsü bağlamı alır (yalnız OAuth bağlantısında; yoksa null → yokluk yok sayılır).
    const binding = await lifecycleBinding(tx, tenantId, row.id, false, flow);
    const ac: ApplyContext = { tenantId, system: PROVIDER_INFO.PARASUT.system, actorUserId: row.connectedBy, membershipId: row.connectedMembershipId };
    return { kind: "go" as const, tenantId, row, binding, ac, direction: f[0].direction };
  });
  if (head.kind === "dup") return { kind: "duplicate" };
  if (head.kind === "skip") return { kind: "skipped", reason: head.reason };
  const { tenantId, row, binding, ac, direction } = head;
  let token: { token: string; accountRef: string };
  try {
    token = await accessToken({ runTx: deps.inTenant, tenantId, integrationId: row.id, client: deps.client, sealer: deps.sealer, ...(deps.now === undefined ? {} : { now: deps.now }) });
  } catch (e) {
    if (e instanceof IntegrationStateError) return { kind: "skipped", reason: e.code };
    throw e;
  }
  const guard = { tenantId, integrationId: row.id, companyId: token.accountRef, userId: ac.actorUserId, membershipId: ac.membershipId, flow: p.resource === "product" ? ("PRODUCTS" as const) : ("CONTACTS" as const) };
  const finish: Finish = (outcome, apply) =>
    deps.inTenant<WebhookEventResult>(async (tx) => {
      if (!(await webhookWriteAllowed(tx, guard))) return { kind: "skipped", reason: "NOT_CONNECTED" } as const;
      if (binding !== null && !(await assertLifecycleBinding(tx, binding))) return { kind: "skipped", reason: "NOT_CONNECTED" } as const;
      const r = await deps.consumeOnce(tx, WEBHOOK_CONSUMER, p.eventKey, async (t) => {
        let out: WebhookOutcome = outcome;
        if (apply !== undefined) {
          try {
            out = (await apply(t)) ?? out;
          } catch (e) {
            // Geçici hata: transaction + processed_events işareti geri alınır, kuyruk yeniden dener. Kesin red (doğrulama/kısıt): FAILED.
            if (isTransientDbError(e)) throw e;
            out = "FAILED";
          }
        }
        await appendAudit(t, { action: "integration.webhook_received", actorUserId: ac.actorUserId, entityType: "integration", entityId: row.id, changeSummary: { provider: "PARASUT", resource: p.resource, ...(p.action === undefined ? {} : { action: p.action }), outcome: out } });
        return out;
      });
      return r.applied ? ({ kind: "applied", outcome: r.result } as const) : ({ kind: "duplicate" } as const);
    });

  const read = async (): Promise<{ item: JsonApiResource; included: readonly JsonApiResource[] } | null> => {
    if (p.resource === "product") return deps.client.productDetail(token.token, token.accountRef, p.externalId);
    const c = await deps.client.contact(token.token, token.accountRef, p.externalId);
    return c === null ? null : { item: c, included: [] };
  };
  const found = (d: { item: JsonApiResource; included: readonly JsonApiResource[] }) =>
    p.resource === "product" ? applyFound(finish, ac, binding, tenantId, row.id, d.item, d.included, now, direction) : applyContactFound(finish, ac, binding, d.item, now, direction);
  const observeMissing = (tx: AccessTx, b: LifecycleBinding) =>
    p.resource === "product" ? observeProduct(tx, b, ac, p.externalId, { exists: false }, now()) : observeCard(tx, b, ac, "PARTY", p.externalId, { exists: false }, now());

  const detail = await read();
  if (detail !== null) return found(detail);
  // 404: tek gözlem silme değildir. Şirkete erişim kanıtlanır, ilk yokluk yazılır, ≥30 sn sonra kimlik yeniden sorulur (ürün ve T-1140'tan
  // beri cari için aynı kural; yaşam döngüsü bağlamı yoksa — eski yöntem bağlantısı — yokluk yok sayılır).
  if (binding === null) return finish("IGNORED");
  if (!(await deps.client.companies(token.token)).some((c) => c.id === binding.companyId)) return { kind: "skipped", reason: "NOT_CONNECTED" };
  const first = await deps.inTenant(async (tx) => {
    if (!(await webhookWriteAllowed(tx, guard)) || !(await assertLifecycleBinding(tx, binding))) return false;
    await observeMissing(tx, binding);
    return true;
  });
  if (!first) return { kind: "skipped", reason: "NOT_CONNECTED" };
  await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(MISSING_RECHECK_MS);
  const again = await read();
  if (again !== null) return found(again);
  return finish("REMOVED_CHECKED", async (tx) => {
    await observeMissing(tx, binding);
  });
}

/** T-1140: cari kartı — iki yönlü karar kuralı (card-sync.ts) + yaşam döngüsü (arşiv / yeniden etkin). */
async function applyContactFound(finish: Finish, ac: ApplyContext, binding: LifecycleBinding | null, item: JsonApiResource, now: () => number, direction: Direction): Promise<WebhookEventResult> {
  if (item.type !== "contacts") return { kind: "skipped", reason: "BAD_RESPONSE" };
  return finish("SKIPPED", async (tx) => {
    let outcome: WebhookOutcome = "SKIPPED";
    try {
      const r = await tx.transaction((sp) => syncRemoteCard(sp, ac, { entity: "PARTY", direction, flow: "CONTACTS", resource: item, apply: (t) => applyContact(t, ac, toContact(item)) }));
      outcome = r.outcome === "DEFERRED" ? "LOCAL_NEWER" : r.outcome;
    } catch (e) {
      if (isTransientDbError(e)) throw e;
      outcome = "SKIPPED";
    }
    if (binding !== null && (await tx.transaction((sp) => observeCard(sp, binding, ac, "PARTY", item.id, { exists: true, archived: item.attributes.archived }, now()))) && outcome === "UNCHANGED") outcome = "UPDATED";
    return outcome;
  });
}

async function applyFound(
  finish: Finish,
  ac: ApplyContext,
  binding: Awaited<ReturnType<typeof lifecycleBinding>>,
  tenantId: string,
  integrationId: string,
  item: JsonApiResource,
  included: readonly JsonApiResource[],
  now: () => number,
  direction: Direction,
): Promise<WebhookEventResult> {
  if (item.type !== "products") return { kind: "skipped", reason: "BAD_RESPONSE" };
  return finish("SKIPPED", async (tx) => {
    let outcome: WebhookOutcome = "SKIPPED";
    const s = await tx.execute<{ enabled: boolean }>(sql`SELECT pull_product_barcodes AS enabled FROM public.integrations WHERE tenant_id = ${tenantId}::uuid AND id = ${integrationId}::uuid`);
    const withBarcodes = { ...ac, pullProductBarcodes: s[0]?.enabled === true };
    try {
      // T-1140: iki yönlüde karar kuralı (yerel taraf kazanırsa uygulanmaz → LOCAL_NEWER); almada her zaman uygulanır.
      const r = await tx.transaction((sp) => syncRemoteCard(sp, ac, { entity: "ITEM", direction, flow: "PRODUCTS", resource: item, apply: (t) => applyProduct(t, withBarcodes, toProduct(item, included)) }));
      outcome = r.outcome === "DEFERRED" ? "LOCAL_NEWER" : r.outcome;
    } catch (e) {
      if (isTransientDbError(e)) throw e;
      outcome = "SKIPPED";
      // Ad/birim/barkod okunamasa da yaşam döngüsü durumu ayrıca işlenir (sync.ts ile aynı).
    }
    if (binding !== null && (await tx.transaction((sp) => observeProduct(sp, binding, ac, item.id, { exists: true, archived: item.attributes.archived }, now()))) && outcome === "UNCHANGED") outcome = "UPDATED";
    return outcome;
  });
}

