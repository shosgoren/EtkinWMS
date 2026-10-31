// T-1138: Paraşüt webhook kaydı (bağlanınca + günlük uzlaştırma), bağlantı kesilince silme, ekran okuması ve kademeli zamanlayıcı.
//
// Kayıt: ürün × {create, update, delete} ve cari × {create, update, delete} (Paraşüt webhook modeli; depolar modelde YOK → taramada kalır).
// Anahtar: istekte bizim ürettiğimiz 32 baytlık anahtar `encryption_key` olarak gider; Paraşüt yanıtta kendi anahtarını döndürürse o
// saklanır. Paraşüt alanı reddederse (400/422) anahtarsız yeniden denenir; yanıtta anahtar yoksa imza doğrulanamaz → kayıt geri silinir,
// bağlantı FAILED (`WEBHOOK_KEY_UNKNOWN`) ve 30 sn tarama sürer. Gerçek davranış UNKNOWN (BACKLOG; gerçek hesapta doğrulanacak).
//
// Kademe (zamanlayıcı 30 sn'de bir uyanır): anlık bildirim ACTIVE iken ürün/cari alma 15 dk'da bir (uzlaştırma), depolar 3 dk'da bir;
// ACTIVE değilse (kurulamadı / bekliyor) bütün akışlar eski 30 sn kademesinde. Yalnız Etkin → Paraşüt gönderen akışlar (stok, irsaliye,
// yalnız PUSH kart) her zaman 30 sn. Kayıt: OFF/FAILED saatte bir yeniden denenir, ACTIVE günde bir uzlaştırılır.
import { sql } from "drizzle-orm";
import { appendAudit, currentTenantId } from "@wms/db";
import type { JobQueue } from "@wms/shared/queue";
import type { Sealer } from "@wms/shared/seal";
import { runTenantCommand, runTenantQuery, type AccessTx } from "../identity/access.ts";
import { pulls, pushes, type Direction, type Flow } from "./catalog.ts";
import { integrationSyncSingletonKey, type ConnectionCallParams } from "./connections.ts";
import { oauthApplicationOrigin } from "./oauth.ts";
import { ParasutClient, ProviderError, type WebhookRecord } from "./parasut.ts";
import { integrationSealer } from "./secrets.ts";
import { connectorAllowed } from "./sync.ts";
import { IntegrationStateError, accessToken, loadIntegration, type RunTx } from "./store.ts";
import { newWebhookKey, openWebhookKey, sealWebhookKey } from "./webhook.ts";

export const PARASUT_WEBHOOK_PATH = "/api/integrations/parasut/webhook";
export const WEBHOOK_MODELS = ["product", "contact"] as const;
export const WEBHOOK_ACTIONS = ["create", "update", "delete"] as const;
export const CADENCE = Object.freeze({ cardsMs: 15 * 60_000, warehousesMs: 3 * 60_000, fallbackMs: 30_000, registerRetryMs: 60 * 60_000, registerReconcileMs: 24 * 60 * 60_000 });

export type WebhookStatus = "OFF" | "ACTIVE" | "FAILED";

/** Alıcı adres: uygulama kökeni (`BETTER_AUTH_URL`, HTTPS; yerel testte geri döngü http) + sabit yol. Yoksa `null` → kayıt FAILED CONFIG. */
export function parasutWebhookUrl(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const origin = oauthApplicationOrigin(env);
  return origin === null ? null : origin + PARASUT_WEBHOOK_PATH;
}

export const webhookRegisterSingletonKey = (integrationId: string): string => `integration.webhook.register.${integrationId}`;

/** Kayıt işini aynı transaction'da kuyruğa yazar (kayıt noktası: kuyruk düşerse çağıranın yazımı geçerli kalır; zamanlayıcı yeniden dener). */
export async function enqueueWebhookRegister(tx: AccessTx, queue: Pick<JobQueue<AccessTx>, "enqueue"> | undefined, integrationId: string, actorUserId?: string): Promise<boolean> {
  if (queue === undefined) return false;
  try {
    const r = await tx.transaction((sp) =>
      queue.enqueue(sp, { type: "integration.webhook", ...(actorUserId === undefined ? {} : { actorUserId }), payload: { integrationId, kind: "REGISTER" }, singletonKey: webhookRegisterSingletonKey(integrationId) }),
    );
    return r.jobId !== null;
  } catch {
    return false;
  }
}

export interface RegisterDeps {
  readonly inTenant: RunTx;
  readonly client: ParasutClient;
  readonly sealer: Sealer;
  readonly callbackUrl: string | null;
  readonly now?: () => number;
}

export type RegisterResult =
  | { readonly kind: "skipped"; readonly reason: string }
  | { readonly kind: "ok"; readonly created: number; readonly kept: number }
  /** `errorName`: yalnız beklenmeyen hatada sınıf adı (ileti/sır yok; worker günlüğü için). */
  | { readonly kind: "failed"; readonly code: string; readonly errorName?: string };

type Row = { model: string; action: string; external_id: string; status: string; key_box: unknown };
const errCode = (e: unknown): string => (e instanceof ProviderError ? `PROVIDER_${e.code}` : e instanceof IntegrationStateError ? e.code : "INTERNAL");

async function markStatus(tx: AccessTx, tenantId: string, integrationId: string, status: WebhookStatus, code: string | null): Promise<void> {
  await tx.execute(sql`UPDATE public.integrations SET webhook_status = ${status}, webhook_checked_at = now(), webhook_last_error_code = ${code}
                        WHERE tenant_id = ${tenantId}::uuid AND id = ${integrationId}::uuid AND status <> 'DISCONNECTED'`);
}

/** Webhook kayıtlarını kur/uzlaştır (idempotent: model × eylem başına tek kayıt; Paraşüt'te duran ve bize ait kayıt korunur). */
export async function registerParasutWebhooks(deps: RegisterDeps, integrationId: string): Promise<RegisterResult> {
  const head = await deps.inTenant(async (tx) => {
    const tenantId = (await currentTenantId(tx)) ?? null;
    if (tenantId === null) return { kind: "skip" as const, reason: "NO_TENANT" };
    const row = await loadIntegration(tx, tenantId, { id: integrationId });
    if (row === null || row.provider !== "PARASUT" || row.status !== "CONNECTED" || row.connectedBy === null || row.connectedMembershipId === null) return { kind: "skip" as const, reason: "NOT_CONNECTED" };
    if (!(await connectorAllowed(tx, tenantId, row.connectedMembershipId, row.connectedBy))) return { kind: "skip" as const, reason: "CONNECTOR_REVOKED" };
    const rows = await tx.execute<Row>(sql`SELECT model, action, external_id, status, key_box FROM public.integration_webhooks WHERE tenant_id = ${tenantId}::uuid AND integration_id = ${integrationId}::uuid`);
    return { kind: "go" as const, tenantId, actor: row.connectedBy, rows };
  });
  if (head.kind === "skip") return { kind: "skipped", reason: head.reason };
  const { tenantId, actor } = head;
  const fail = async (code: string): Promise<RegisterResult> => {
    await deps.inTenant(async (tx) => {
      await markStatus(tx, tenantId, integrationId, "FAILED", code);
      await appendAudit(tx, { action: "integration.webhook_registered", actorUserId: actor, entityType: "integration", entityId: integrationId, changeSummary: { provider: "PARASUT", ok: false, reason: code } });
    });
    return { kind: "failed", code };
  };
  if (deps.callbackUrl === null) return fail("CONFIG");
  const uri = deps.callbackUrl;
  let created = 0, kept = 0;
  /** Bu koşuda Paraşüt'te açılanlar (inceleme MINOR-B): kesme yarışında hepsi, beklenmeyen hatada kalıcı yazılmamışlar geri silinir. */
  const opened: { id: string; persisted: boolean }[] = [];
  let tokenRef: { token: string; accountRef: string } | null = null;
  const rollback = async (all: boolean): Promise<void> => {
    if (tokenRef === null) return;
    for (const o of opened) if (all || !o.persisted) await deps.client.deleteWebhook(tokenRef.token, tokenRef.accountRef, o.id).catch(() => undefined);
  };
  /**
   * PR 273 P3: her başarılı kayıt HEMEN kalıcı yazılır (kimlik + mühürlü anahtar); sonraki kayıt düşse de sonraki deneme ve kesme onu görür
   * (çoğaltma ve sahipsiz kayıt yok). Bağlantı bu arada kesildiyse yazılmaz, Paraşüt'teki kayıt geri silinir.
   */
  const persist = (w: { model: string; action: string; externalId: string; key: string }): Promise<boolean> =>
    deps.inTenant(async (tx) => {
      const cur = await loadIntegration(tx, tenantId, { id: integrationId }, true);
      if (cur === null || cur.status !== "CONNECTED") return false;
      const box = JSON.stringify(sealWebhookKey(deps.sealer, tenantId, w.key));
      await tx.execute(sql`
        INSERT INTO public.integration_webhooks (tenant_id, integration_id, model, action, external_id, key_box, status)
        VALUES (${tenantId}::uuid, ${integrationId}::uuid, ${w.model}, ${w.action}, ${w.externalId}, ${box}::jsonb, 'ACTIVE')
        ON CONFLICT ON CONSTRAINT integration_webhooks_model_action_key DO UPDATE SET external_id = EXCLUDED.external_id, key_box = EXCLUDED.key_box, status = 'ACTIVE'`);
      return true;
    });
  try {
    const token = await accessToken({ runTx: deps.inTenant, tenantId, integrationId, client: deps.client, sealer: deps.sealer, ...(deps.now === undefined ? {} : { now: deps.now }) });
    tokenRef = token;
    const remote = await deps.client.listWebhooks(token.token, token.accountRef);
    const existingKey = head.rows.map((r) => (r.status === "ACTIVE" ? openWebhookKey(deps.sealer, tenantId, r.key_box) : null)).find((k) => k !== null) ?? null;
    const ourKey = existingKey ?? newWebhookKey();
    for (const model of WEBHOOK_MODELS) {
      for (const action of WEBHOOK_ACTIONS) {
        const mine = head.rows.find((r) => r.model === model && r.action === action && r.status === "ACTIVE");
        const live = mine === undefined ? undefined : remote.find((w) => w.id === mine.external_id && w.uri === uri && w.model === model && w.action === action);
        if (mine !== undefined && live !== undefined && openWebhookKey(deps.sealer, tenantId, mine.key_box) !== null) {
          kept++;
          continue;
        }
        let rec: WebhookRecord;
        try {
          rec = await deps.client.createWebhook(token.token, token.accountRef, { model, action, uri, encryptionKey: ourKey });
        } catch (e) {
          if (!(e instanceof ProviderError && e.code === "INVALID")) throw e;
          // Paraşüt anahtarı kendisi atıyor olabilir: alan olmadan yeniden dene; yanıtta anahtar yoksa doğrulanamaz → kaydı geri sil.
          rec = await deps.client.createWebhook(token.token, token.accountRef, { model, action, uri, encryptionKey: "" });
          if (rec.encryptionKey === null) {
            await deps.client.deleteWebhook(token.token, token.accountRef, rec.id).catch(() => undefined);
            return fail("WEBHOOK_KEY_UNKNOWN");
          }
        }
        // Eski (artık bize dönmeyen) kayıt Paraşüt'te kaldıysa temizlenir; başka tenant'ın kaydına dokunulmaz (yalnız bizim kimliğimiz).
        // T-1139: satır DELETED olsa da (kesmede Paraşüt'te silinemedi ya da migration 0068 belirteçsiz kesti) kimlik bizimdir → yeniden
        // bağlanınca Paraşüt'te kalan eski kayıt burada silinir (en iyi çaba).
        const prev = head.rows.find((r) => r.model === model && r.action === action);
        if (prev !== undefined && prev.external_id !== rec.id && remote.some((w) => w.id === prev.external_id)) {
          await deps.client.deleteWebhook(token.token, token.accountRef, prev.external_id).catch(() => undefined);
        }
        const entry = { id: rec.id, persisted: false };
        opened.push(entry);
        if (!(await persist({ model, action, externalId: rec.id, key: rec.encryptionKey ?? ourKey }))) {
          // Bağlantı bu koşu sırasında kesildi: kesme bu koşunun açtıklarını görmemiş olabilir → hepsi Paraşüt'te geri silinir.
          await rollback(true);
          return { kind: "skipped", reason: "NOT_CONNECTED" };
        }
        entry.persisted = true;
        created++;
      }
    }
  } catch (e) {
    if (e instanceof ProviderError || e instanceof IntegrationStateError) return fail(errCode(e));
    return unexpected(e);
  }
  try {
    return await finishOk();
  } catch (e) {
    return unexpected(e);
  }

  /**
   * Beklenmeyen hata (inceleme MINOR-A): durum FAILED `INTERNAL` olur → zamanlayıcının saatlik yeniden denemesi geçerli (OFF kalıp 30 sn'de
   * bir yeniden kayıt açmaz); kalıcı yazılmamış uzak kayıt geri silinir. Fırlatılmaz (kuyruk yeniden denemesi de çoğaltmasın); yalnız sınıf adı döner.
   */
  async function unexpected(e: unknown): Promise<RegisterResult> {
    await rollback(false);
    await fail("INTERNAL");
    return { kind: "failed", code: "INTERNAL", errorName: e instanceof Error ? e.name : "unknown" };
  }

  async function finishOk(): Promise<RegisterResult> {
    const r = await deps.inTenant(async (tx) => {
      const cur = await loadIntegration(tx, tenantId, { id: integrationId }, true);
      if (cur === null || cur.status !== "CONNECTED") return { kind: "skipped", reason: "NOT_CONNECTED" } as const;
      await markStatus(tx, tenantId, integrationId, "ACTIVE", null);
      await appendAudit(tx, { action: "integration.webhook_registered", actorUserId: actor, entityType: "integration", entityId: integrationId, changeSummary: { provider: "PARASUT", ok: true, created, kept } });
      return { kind: "ok", created, kept } as const;
    });
    if (r.kind === "skipped") await rollback(true); // döngü bittikten sonra kesildiyse de bu koşunun açtıkları geri silinir
    return r;
  }
}

/**
 * Bağlantı kesilirken Paraşüt'teki kayıtları sil (en iyi çaba; ilk hatada durur, kesme işlemini asla engellemez). DB tarafı (anahtar NULL,
 * satır DELETED, durum OFF) kesme transaction'ında `clearWebhooksInTx` ile yapılır.
 */
export async function removeParasutWebhooks(params: ConnectionCallParams, deps: { readonly client?: ParasutClient; readonly sealer?: Sealer } = {}): Promise<number> {
  const access = { ...params, permission: "settings.manage" as const };
  try {
    const sealer = deps.sealer ?? integrationSealer();
    const pre = await runTenantQuery(access, async (tx, m) => {
      const row = await loadIntegration(tx, m.tenantId, { provider: "PARASUT" });
      if (row === null || row.status === "DISCONNECTED") return null;
      const ids = await tx.execute<{ external_id: string }>(sql`SELECT external_id FROM public.integration_webhooks WHERE tenant_id = ${m.tenantId}::uuid AND integration_id = ${row.id}::uuid AND status = 'ACTIVE'`);
      return { tenantId: m.tenantId, integrationId: row.id, ids: ids.map((r) => r.external_id) };
    });
    if (pre === null || pre.ids.length === 0) return 0;
    const client = deps.client ?? new ParasutClient();
    const t = await accessToken({ runTx: (fn) => runTenantCommand(access, (tx) => fn(tx)), tenantId: pre.tenantId, integrationId: pre.integrationId, client, sealer });
    let n = 0;
    for (const id of pre.ids) {
      await client.deleteWebhook(t.token, t.accountRef, id);
      n++;
    }
    return n;
  } catch {
    return 0;
  }
}

/** Kesme transaction'ında: anahtarlar silinir (NULL), satırlar DELETED, anlık bildirim OFF ve kayıt denetimi sıfır (yeniden bağlanınca hemen kurulur). */
export async function clearWebhooksInTx(tx: AccessTx, tenantId: string, integrationId: string): Promise<void> {
  await tx.execute(sql`UPDATE public.integration_webhooks SET status = 'DELETED', key_box = NULL WHERE tenant_id = ${tenantId}::uuid AND integration_id = ${integrationId}::uuid AND status = 'ACTIVE'`);
  await tx.execute(sql`UPDATE public.integrations SET webhook_status = 'OFF', webhook_checked_at = NULL, webhook_last_error_code = NULL WHERE tenant_id = ${tenantId}::uuid AND id = ${integrationId}::uuid`);
}

// --- ekran okuması ------------------------------------------------------------------------------------------------------------------
export interface WebhookView {
  readonly status: WebhookStatus;
  readonly lastEventAt: Date | null;
  readonly checkedAt: Date | null;
}

/** "Anlık bildirim açık · son bildirim SS:DD" satırı (`settings.manage`). Anahtar/kimlik seçilmez. */
export async function getWebhookStatus(params: ConnectionCallParams): Promise<WebhookView | null> {
  return runTenantQuery({ ...params, permission: "settings.manage" }, async (tx, m) => {
    const r = await tx.execute<{ webhook_status: WebhookStatus; webhook_last_event_at: Date | string | null; webhook_checked_at: Date | string | null }>(
      sql`SELECT webhook_status, webhook_last_event_at, webhook_checked_at FROM public.integrations WHERE tenant_id = ${m.tenantId}::uuid AND provider = 'PARASUT' AND status <> 'DISCONNECTED'`,
    );
    const row = r[0];
    if (row === undefined) return null;
    const d = (v: Date | string | null): Date | null => (v === null ? null : new Date(v));
    return { status: row.webhook_status, lastEventAt: d(row.webhook_last_event_at), checkedAt: d(row.webhook_checked_at) };
  });
}

// --- kademeli zamanlayıcı -----------------------------------------------------------------------------------------------------------
export interface CadenceFlow {
  readonly flow: Flow;
  readonly direction: Direction;
  readonly lastRunAt: Date | null;
}

/** Bu tikte çalışması gereken akışlar (saf işlev; birim testli). */
export function dueFlows(flows: readonly CadenceFlow[], webhookActive: boolean, now: number): Flow[] {
  return flows
    .filter((f) => {
      const age = f.lastRunAt === null ? Number.POSITIVE_INFINITY : now - f.lastRunAt.getTime();
      if (!webhookActive) return true;
      if (f.flow === "WAREHOUSES" && pulls(f.direction)) return age >= CADENCE.warehousesMs;
      if ((f.flow === "PRODUCTS" || f.flow === "CONTACTS") && pulls(f.direction)) return age >= CADENCE.cardsMs;
      return pushes(f.direction) || f.flow === "STOCK" || f.flow === "SHIPMENTS";
    })
    .map((f) => f.flow);
}

/**
 * Kayıt işi bu tikte gerekli mi: OFF (hiç kurulmadı ya da bağlantı kesilip yeniden kuruldu) her tik — iş singletonKey ile tekil;
 * FAILED saatte bir; ACTIVE günde bir (uzlaştırma). CI e2e bulgusu (PR 273): kes → yeniden bağlan sonrası eski `webhook_checked_at`
 * OFF kaydı bir saat bekletiyordu.
 */
export function registerDue(status: WebhookStatus, checkedAt: Date | null, now: number): boolean {
  if (status === "OFF" || checkedAt === null) return true;
  const age = now - checkedAt.getTime();
  return status === "ACTIVE" ? age >= CADENCE.registerReconcileMs : age >= CADENCE.registerRetryMs;
}

/**
 * Worker zamanlayıcısı (30 sn): tenant'ın bağlı entegrasyonları için kademeye göre `integration.sync` (yalnız vadesi gelen akışlar) ve
 * gerekiyorsa webhook kayıt işi. singletonKey'ler aynı: kuyrukta/çalışırken ikinci iş açılmaz. Yazılan iş sayısı döner.
 */
export async function enqueueScheduledIntegrations(tx: AccessTx, tenantId: string, queue: Pick<JobQueue<AccessTx>, "enqueue">, now: number = Date.now()): Promise<number> {
  const conns = await tx.execute<{ id: string; webhook_status: WebhookStatus; webhook_checked_at: Date | string | null }>(
    sql`SELECT id, webhook_status, webhook_checked_at FROM public.integrations WHERE tenant_id = ${tenantId}::uuid AND provider = 'PARASUT' AND status = 'CONNECTED'`,
  );
  let n = 0;
  for (const c of conns) {
    const flows = await tx.execute<{ flow: Flow; direction: Direction; last_run_at: Date | string | null }>(
      sql`SELECT flow, direction, last_run_at FROM public.integration_flows WHERE tenant_id = ${tenantId}::uuid AND integration_id = ${c.id}::uuid AND enabled`,
    );
    const due = dueFlows(flows.map((f) => ({ flow: f.flow, direction: f.direction, lastRunAt: f.last_run_at === null ? null : new Date(f.last_run_at) })), c.webhook_status === "ACTIVE", now);
    if (due.length > 0) {
      const r = await queue.enqueue(tx, { type: "integration.sync", payload: { integrationId: c.id, trigger: "SCHEDULE", flows: due }, singletonKey: integrationSyncSingletonKey(c.id) });
      if (r.jobId !== null) n++;
    }
    if (registerDue(c.webhook_status, c.webhook_checked_at === null ? null : new Date(c.webhook_checked_at), now)) {
      const r = await queue.enqueue(tx, { type: "integration.webhook", payload: { integrationId: c.id, kind: "REGISTER" }, singletonKey: webhookRegisterSingletonKey(c.id) });
      if (r.jobId !== null) n++;
    }
  }
  return n;
}
