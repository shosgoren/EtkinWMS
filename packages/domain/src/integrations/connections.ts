// ERP bağlantısı — ekran komutları ve okuması (T-991). Yetki: `settings.manage` (yalnız TENANT_ADMIN; permissions.ts "ayarlar ... entegrasyonları
// taşır"). Bağlan / bağlantıyı kes ayrıca yakın zamanda kimlik doğrulama ister (`recentAuth`). Demo alanında bağlantı kurulmaz (ortak hesap: gerçek
// ERP bilgisi girilmesin). Her yazma aynı transaction'da audit (I-12); sır/parola/belirteç audit'e, loga, dönüşe girmez (G-09).
//
// Ağ çağrısı (sağlayıcıya giriş, şirket doğrulama) transaction DIŞINDADIR: önce yetki + demo denetimi (okuma), sonra ağ, sonra kısa yazma
// transaction'ı. Okuma yolu `credentials` sütununu HİÇ seçmez; ekrana yalnız "bağlı · şirket adı" gider.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { appendAudit } from "@wms/db";
import { AppError } from "@wms/shared/errors";
import type { JobQueue } from "@wms/shared/queue";
import { SealConfigError, type Sealer } from "@wms/shared/seal";
import { runTenantCommand, runTenantQuery, type AccessTx, type TenantAccessParams } from "../identity/access.ts";
import { FLOWS, PROVIDERS, PROVIDER_INFO, defaultDirection, parseDirection, parseFlow, parseProvider, supportedDirections, type Direction, type Flow, type Provider } from "./catalog.ts";
import { ParasutClient, ProviderError, parseCompanyId, type ProviderErrorCode } from "./parasut.ts";
import { integrationSealer, sealSecrets } from "./secrets.ts";
import { IntegrationStateError, accessToken, loadIntegration, type IntegrationStatus } from "./store.ts";

export type ConnectionCallParams = Omit<TenantAccessParams, "permission">;

export interface IntegrationDeps {
  /** Test: sahte HTTP sunucusuna bağlı istemci. Verilmezse sabit Paraşüt adresi (`resolveParasutBaseUrl`). */
  readonly client?: ParasutClient;
  readonly sealer?: Sealer;
  readonly queue?: Pick<JobQueue<AccessTx>, "enqueue"> | undefined;
}

export interface FlowView {
  readonly flow: Flow;
  /** Sağlayıcının sunduğu yönler; boşsa akış bu sağlayıcıda yok (kilitli satır). */
  readonly directions: readonly Direction[];
  readonly enabled: boolean;
  readonly direction: Direction;
  readonly lastRunAt: Date | null;
  readonly lastStatus: "SUCCESS" | "PARTIAL" | "FAILED" | null;
  readonly errorCount: number;
  readonly lastErrorCode: string | null;
}
export interface ConnectionView {
  readonly id: string;
  readonly status: IntegrationStatus;
  /** Şirket adı (sır değildir). */
  readonly label: string | null;
  readonly connectedAt: Date | null;
  readonly lastCheckedAt: Date | null;
  readonly lastErrorCode: string | null;
}
export interface ProviderView {
  readonly provider: Provider;
  readonly available: boolean;
  readonly connection: ConnectionView | null;
  readonly flows: readonly FlowView[];
}
export interface RunView {
  readonly id: string;
  readonly provider: Provider;
  readonly flow: Flow;
  readonly trigger: "SCHEDULE" | "MANUAL";
  readonly status: "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly created: number;
  readonly updated: number;
  readonly linked: number;
  readonly skipped: number;
  readonly failed: number;
  readonly errorCode: string | null;
}
export interface IntegrationOverview {
  readonly demo: boolean;
  readonly providers: readonly ProviderView[];
  readonly runs: readonly RunView[];
  /** Gönderim kuyruğu (irsaliye): bekleyen, kontrol isteyen (belirsiz), başarısız. */
  readonly outbox: { readonly pending: number; readonly check: number; readonly failed: number };
}

export const RUN_LOG_LIMIT = 15;
const d = (v: Date | string | null): Date | null => (v === null ? null : new Date(v));

async function isDemo(tx: AccessTx, tenantId: string): Promise<boolean> {
  const r = await tx.execute<{ is_demo: boolean }>(sql`SELECT is_demo FROM public.tenants WHERE id = ${tenantId}::uuid`);
  return r[0]?.is_demo === true;
}

/** Ekran okuması (`settings.manage`). Sır sütunu seçilmez. */
export async function getIntegrationOverview(params: ConnectionCallParams): Promise<IntegrationOverview> {
  return runTenantQuery({ ...params, permission: "settings.manage" }, async (tx, m) => {
    const conns = await tx.execute<{ id: string; provider: Provider; status: IntegrationStatus; account_label: string | null; connected_at: Date | string | null; last_checked_at: Date | string | null; last_error_code: string | null }>(
      sql`SELECT id, provider, status, account_label, connected_at, last_checked_at, last_error_code FROM public.integrations WHERE tenant_id = ${m.tenantId}::uuid`,
    );
    const flows = await tx.execute<{ integration_id: string; flow: Flow; enabled: boolean; direction: Direction; last_run_at: Date | string | null; last_status: FlowView["lastStatus"]; error_count: number; last_error_code: string | null }>(
      sql`SELECT integration_id, flow, enabled, direction, last_run_at, last_status, error_count, last_error_code FROM public.integration_flows WHERE tenant_id = ${m.tenantId}::uuid`,
    );
    const runs = await tx.execute<{ id: string; provider: Provider; flow: Flow; trigger: RunView["trigger"]; status: RunView["status"]; started_at: Date | string; finished_at: Date | string | null; created_count: number; updated_count: number; linked_count: number; skipped_count: number; failed_count: number; error_code: string | null }>(
      sql`SELECT r.id, i.provider, r.flow, r.trigger, r.status, r.started_at, r.finished_at, r.created_count, r.updated_count, r.linked_count, r.skipped_count, r.failed_count, r.error_code
            FROM public.integration_runs r JOIN public.integrations i ON i.tenant_id = r.tenant_id AND i.id = r.integration_id
           WHERE r.tenant_id = ${m.tenantId}::uuid ORDER BY r.started_at DESC, r.id LIMIT ${RUN_LOG_LIMIT}`,
    );
    const ob = await tx.execute<{ status: string; n: number }>(
      sql`SELECT status, count(*)::int AS n FROM public.integration_outbox WHERE tenant_id = ${m.tenantId}::uuid AND status IN ('PENDING', 'CHECK', 'FAILED') GROUP BY status`,
    );
    const nOf = (st: string): number => Number(ob.find((r) => r.status === st)?.n ?? 0);
    const providers = PROVIDERS.map((provider): ProviderView => {
      const c = conns.find((x) => x.provider === provider);
      const mine = c === undefined ? [] : flows.filter((f) => f.integration_id === c.id);
      return {
        provider,
        available: PROVIDER_INFO[provider].available,
        connection:
          c === undefined || c.status === "DISCONNECTED"
            ? null
            : { id: c.id, status: c.status, label: c.account_label, connectedAt: d(c.connected_at), lastCheckedAt: d(c.last_checked_at), lastErrorCode: c.last_error_code },
        flows: FLOWS.map((flow): FlowView => {
          const f = mine.find((x) => x.flow === flow);
          return {
            flow,
            directions: supportedDirections(provider, flow),
            enabled: f?.enabled === true,
            direction: f?.direction ?? defaultDirection(provider, flow),
            lastRunAt: d(f?.last_run_at ?? null),
            lastStatus: f?.last_status ?? null,
            errorCount: Number(f?.error_count ?? 0),
            lastErrorCode: f?.last_error_code ?? null,
          };
        }),
      };
    });
    return {
      demo: await isDemo(tx, m.tenantId),
      providers,
      runs: runs.map((r) => ({
        id: r.id,
        provider: r.provider,
        flow: r.flow,
        trigger: r.trigger,
        status: r.status,
        startedAt: new Date(r.started_at),
        finishedAt: d(r.finished_at),
        created: Number(r.created_count),
        updated: Number(r.updated_count),
        linked: Number(r.linked_count),
        skipped: Number(r.skipped_count),
        failed: Number(r.failed_count),
        errorCode: r.error_code,
      })),
      outbox: { pending: nOf("PENDING"), check: nOf("CHECK"), failed: nOf("FAILED") },
    };
  });
}

export type ConnectReason = ProviderErrorCode | "DEMO" | "COMPANY_CHANGED" | "UNAVAILABLE_PROVIDER";
export type ConnectResult = { readonly ok: true; readonly label: string } | { readonly ok: false; readonly reason: ConnectReason };

export interface ConnectParasutInput {
  readonly companyId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly username: string;
  readonly password: string;
  readonly requestId?: string | null;
}

const CTRL = /[\p{C}\s]/u;
function token(raw: unknown, max: number): string {
  if (typeof raw !== "string") throw new AppError("VALIDATION_FAILED");
  const v = raw.trim();
  if (v === "" || v.length > max || CTRL.test(v)) throw new AppError("VALIDATION_FAILED");
  return v;
}
function email(raw: unknown): string {
  if (typeof raw !== "string") throw new AppError("VALIDATION_FAILED");
  const v = raw.trim();
  if (v.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new AppError("VALIDATION_FAILED");
  return v;
}
function password(raw: unknown): string {
  if (typeof raw !== "string" || raw === "" || raw.length > 200 || /\p{Cc}/u.test(raw)) throw new AppError("VALIDATION_FAILED");
  return raw;
}

function sealerOf(deps: IntegrationDeps): Sealer | null {
  try {
    return deps.sealer ?? integrationSealer();
  } catch (e) {
    if (e instanceof SealConfigError) return null;
    throw e;
  }
}

/**
 * Paraşüt'e bağlan: parola akışı → şirket listesinde istenen şirket → mühürlü kutu + akış satırları (hepsi kapalı, varsayılan yön). Parola
 * saklanmaz. Farklı şirkete yeniden bağlanma reddedilir (`COMPANY_CHANGED`): eski eşlemeler başka şirketin kimlikleridir.
 */
export async function connectParasut(params: ConnectionCallParams, input: ConnectParasutInput, deps: IntegrationDeps = {}): Promise<ConnectResult> {
  const companyId = parseCompanyId(input.companyId);
  const clientId = token(input.clientId, 200);
  const clientSecret = token(input.clientSecret, 200);
  const username = email(input.username);
  const pass = password(input.password);
  // Yakın zamanda giriş domain'de zorunlu (inceleme MINOR-3): çağıran bağlamazsa ret.
  if (params.recentAuth === undefined) throw new AppError("UNAUTHENTICATED", { detail: "RECENT_AUTH_REQUIRED" });
  const pre = await runTenantQuery({ ...params, permission: "settings.manage" }, async (tx, m) => {
    const cur = await loadIntegration(tx, m.tenantId, { provider: "PARASUT" });
    const links = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM public.external_refs WHERE tenant_id = ${m.tenantId}::uuid AND system = 'PARASUT'`);
    return { tenantId: m.tenantId, demo: await isDemo(tx, m.tenantId), prevRef: cur?.accountRef ?? null, hasLinks: Number(links[0]?.n ?? 0) > 0 };
  });
  if (pre.demo) return { ok: false, reason: "DEMO" };
  if (pre.prevRef !== null && pre.prevRef !== companyId && pre.hasLinks) return { ok: false, reason: "COMPANY_CHANGED" };
  const sealer = sealerOf(deps);
  if (sealer === null) return { ok: false, reason: "CONFIG" };
  let label: string;
  let box: ReturnType<typeof sealSecrets>;
  try {
    const client = deps.client ?? new ParasutClient();
    const t = await client.passwordGrant({ clientId, clientSecret, username, password: pass });
    const company = (await client.companies(t.accessToken)).find((c) => c.id === companyId);
    if (company === undefined) return { ok: false, reason: "COMPANY_NOT_FOUND" };
    label = company.name;
    box = sealSecrets(sealer, pre.tenantId, "PARASUT", { clientId, clientSecret, refreshToken: t.refreshToken, accessToken: t.accessToken, accessExpiresAt: String(t.expiresAt) });
  } catch (e) {
    if (e instanceof ProviderError) return { ok: false, reason: e.code };
    throw e;
  }
  return runTenantCommand({ ...params, permission: "settings.manage" }, async (tx, m) => {
    if (m.tenantId !== pre.tenantId) throw new AppError("FORBIDDEN");
    // Şirket değişimi denetimi yazma transaction'ında kilit altında yinelenir (inceleme MINOR-4: okuma ile yazma arası yarış).
    const cur = await loadIntegration(tx, m.tenantId, { provider: "PARASUT" }, true);
    if (cur?.accountRef != null && cur.accountRef !== companyId) {
      const links = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM public.external_refs WHERE tenant_id = ${m.tenantId}::uuid AND system = 'PARASUT'`);
      if (Number(links[0]?.n ?? 0) > 0) return { ok: false, reason: "COMPANY_CHANGED" } as const;
    }
    const ins = await tx.execute<{ id: string }>(sql`
      INSERT INTO public.integrations (tenant_id, id, provider, status, account_label, account_ref, credentials, connected_by, connected_membership_id, connected_at, last_checked_at)
      VALUES (${m.tenantId}::uuid, ${randomUUID()}::uuid, 'PARASUT', 'CONNECTED', ${label}, ${companyId}, ${JSON.stringify(box)}::jsonb, ${m.userId}::uuid, ${m.membershipId}::uuid, now(), now())
      ON CONFLICT ON CONSTRAINT integrations_tenant_provider_key DO UPDATE
        SET status = 'CONNECTED', account_label = EXCLUDED.account_label, account_ref = EXCLUDED.account_ref, credentials = EXCLUDED.credentials,
            connected_by = EXCLUDED.connected_by, connected_membership_id = EXCLUDED.connected_membership_id, connected_at = now(), last_checked_at = now(), last_error_code = NULL
      RETURNING id`);
    const integrationId = (ins[0] as { id: string }).id;
    for (const flow of FLOWS) {
      await tx.execute(sql`
        INSERT INTO public.integration_flows (tenant_id, id, integration_id, flow, enabled, direction)
        VALUES (${m.tenantId}::uuid, ${randomUUID()}::uuid, ${integrationId}::uuid, ${flow}, false, ${defaultDirection("PARASUT", flow)})
        ON CONFLICT ON CONSTRAINT integration_flows_flow_key DO NOTHING`);
    }
    await appendAudit(tx, {
      action: "integration.connected",
      actorUserId: m.userId,
      entityType: "integration",
      entityId: integrationId,
      requestId: input.requestId ?? null,
      changeSummary: { provider: "PARASUT", account_label: label },
    });
    return { ok: true, label } as const;
  });
}

export type CheckResult = { readonly ok: true; readonly label: string | null } | { readonly ok: false; readonly reason: ProviderErrorCode | IntegrationStateError["code"] };

const STATE_CODES: readonly string[] = ["NOT_CONNECTED", "REAUTH_REQUIRED", "SECRET_UNREADABLE"];
/** DB `last_error_code`: bağlantı durumu kodu olduğu gibi, sağlayıcı kodu `PROVIDER_` önekli (sync.ts ile aynı). */
const errorCodeOf = (reason: string): string => (STATE_CODES.includes(reason) ? reason : `PROVIDER_${reason}`);

/** Bağlantıyı sına: geçerli belirteçle şirket listesi, şirket hâlâ erişilebilir mi. Sonuç bağlantı satırına + audit'e. */
export async function checkIntegration(params: ConnectionCallParams, input: { readonly provider: string; readonly requestId?: string | null }, deps: IntegrationDeps = {}): Promise<CheckResult> {
  const provider = parseProvider(input.provider);
  if (provider !== "PARASUT") return { ok: false, reason: "NOT_CONNECTED" };
  const access = { ...params, permission: "settings.manage" as const };
  const pre = await runTenantQuery(access, async (tx, m) => ({ tenantId: m.tenantId, row: await loadIntegration(tx, m.tenantId, { provider }) }));
  if (pre.row === null || pre.row.status === "DISCONNECTED") return { ok: false, reason: "NOT_CONNECTED" };
  const sealer = sealerOf(deps);
  if (sealer === null) return { ok: false, reason: "CONFIG" };
  const client = deps.client ?? new ParasutClient();
  const integrationId = pre.row.id;
  let outcome: CheckResult;
  try {
    const t = await accessToken({ runTx: (fn) => runTenantCommand(access, (tx) => fn(tx)), tenantId: pre.tenantId, integrationId, client, sealer });
    const found = (await client.companies(t.token)).find((c) => c.id === t.accountRef);
    outcome = found === undefined ? { ok: false, reason: "COMPANY_NOT_FOUND" } : { ok: true, label: found.name };
  } catch (e) {
    if (e instanceof ProviderError) outcome = { ok: false, reason: e.code };
    else if (e instanceof IntegrationStateError) outcome = { ok: false, reason: e.code };
    else throw e;
  }
  return runTenantCommand(access, async (tx, m) => {
    if (outcome.ok) {
      await tx.execute(sql`UPDATE public.integrations SET status = 'CONNECTED', last_checked_at = now(), last_error_code = NULL, account_label = COALESCE(${outcome.label}, account_label)
                            WHERE tenant_id = ${m.tenantId}::uuid AND id = ${integrationId}::uuid AND status <> 'DISCONNECTED'`);
    } else if (outcome.reason !== "NOT_CONNECTED") {
      await tx.execute(sql`UPDATE public.integrations SET status = 'ERROR', last_checked_at = now(), last_error_code = ${errorCodeOf(outcome.reason)}
                            WHERE tenant_id = ${m.tenantId}::uuid AND id = ${integrationId}::uuid AND status <> 'DISCONNECTED'`);
    }
    await appendAudit(tx, {
      action: "integration.checked",
      actorUserId: m.userId,
      entityType: "integration",
      entityId: integrationId,
      requestId: input.requestId ?? null,
      changeSummary: { provider, ok: outcome.ok, ...(outcome.ok ? {} : { reason: outcome.reason }) },
    });
    return outcome;
  });
}

/** Bağlantıyı kes: mühürlü kutu silinir (NULL), bütün akışlar kapanır; eşlemeler yeniden bağlanma için kalır. */
export async function disconnectIntegration(params: ConnectionCallParams, input: { readonly provider: string; readonly requestId?: string | null }): Promise<{ readonly changed: boolean }> {
  const provider = parseProvider(input.provider);
  if (params.recentAuth === undefined) throw new AppError("UNAUTHENTICATED", { detail: "RECENT_AUTH_REQUIRED" });
  return runTenantCommand({ ...params, permission: "settings.manage" }, async (tx, m) => {
    const r = await tx.execute<{ id: string }>(sql`
      UPDATE public.integrations SET status = 'DISCONNECTED', credentials = NULL, last_error_code = NULL
       WHERE tenant_id = ${m.tenantId}::uuid AND provider = ${provider} AND status <> 'DISCONNECTED' RETURNING id`);
    const id = r[0]?.id;
    if (id === undefined) return { changed: false };
    await tx.execute(sql`UPDATE public.integration_flows SET enabled = false WHERE tenant_id = ${m.tenantId}::uuid AND integration_id = ${id}::uuid AND enabled`);
    await appendAudit(tx, { action: "integration.disconnected", actorUserId: m.userId, entityType: "integration", entityId: id, requestId: input.requestId ?? null, changeSummary: { provider } });
    return { changed: true };
  });
}

export type FlowResultReason = "NOT_CONNECTED" | "UNSUPPORTED";
export type SetFlowResult =
  | { readonly ok: true; readonly enabled: boolean; readonly direction: Direction; readonly changed: boolean; readonly queued: boolean }
  | { readonly ok: false; readonly reason: FlowResultReason };

const singletonKey = (integrationId: string): string => `integration.sync.${integrationId}`;

async function enqueueRun(tx: AccessTx, deps: IntegrationDeps, userId: string, integrationId: string, flow: Flow | undefined): Promise<boolean> {
  if (deps.queue === undefined) return false;
  const queue = deps.queue;
  // Kayıt noktası: kuyruk yazımı düşerse ayar kaydı yine geçerli (zamanlanmış koşu alır).
  try {
    const r = await tx.transaction((sp) =>
      queue.enqueue(sp, { type: "integration.sync", actorUserId: userId, payload: { integrationId, ...(flow === undefined ? {} : { flow }), trigger: "MANUAL" }, singletonKey: singletonKey(integrationId) }),
    );
    return r.jobId !== null;
  } catch {
    return false;
  }
}

/** Akışı aç/kapa ve yönünü seç. Sağlayıcının sunmadığı yön/akış reddedilir; açılınca ilk koşu hemen kuyruğa girer. */
export async function setIntegrationFlow(
  params: ConnectionCallParams,
  input: { readonly provider: string; readonly flow: string; readonly enabled: boolean; readonly direction: string; readonly requestId?: string | null },
  deps: IntegrationDeps = {},
): Promise<SetFlowResult> {
  const provider = parseProvider(input.provider);
  const flow = parseFlow(input.flow);
  const direction = parseDirection(input.direction);
  if (typeof input.enabled !== "boolean") throw new AppError("VALIDATION_FAILED");
  if (!supportedDirections(provider, flow).includes(direction)) return { ok: false, reason: "UNSUPPORTED" };
  return runTenantCommand({ ...params, permission: "settings.manage" }, async (tx, m) => {
    const row = await loadIntegration(tx, m.tenantId, { provider }, true);
    if (row === null || row.status === "DISCONNECTED") return { ok: false, reason: "NOT_CONNECTED" } as const;
    const prev = await tx.execute<{ enabled: boolean; direction: Direction }>(
      sql`SELECT enabled, direction FROM public.integration_flows WHERE tenant_id = ${m.tenantId}::uuid AND integration_id = ${row.id}::uuid AND flow = ${flow} FOR UPDATE`,
    );
    const before = prev[0];
    if (before === undefined) {
      await tx.execute(sql`INSERT INTO public.integration_flows (tenant_id, id, integration_id, flow, enabled, direction)
                            VALUES (${m.tenantId}::uuid, ${randomUUID()}::uuid, ${row.id}::uuid, ${flow}, ${input.enabled}, ${direction})`);
    } else if (before.enabled !== input.enabled || before.direction !== direction) {
      await tx.execute(sql`UPDATE public.integration_flows SET enabled = ${input.enabled}, direction = ${direction}, cursor = CASE WHEN direction = ${direction} THEN cursor ELSE NULL END
                            WHERE tenant_id = ${m.tenantId}::uuid AND integration_id = ${row.id}::uuid AND flow = ${flow}`);
    }
    const changed = before === undefined || before.enabled !== input.enabled || before.direction !== direction;
    if (changed) {
      await appendAudit(tx, {
        action: "integration.flow_changed",
        actorUserId: m.userId,
        entityType: "integration",
        entityId: row.id,
        requestId: input.requestId ?? null,
        changeSummary: { provider, flow, enabled: input.enabled, direction, before: before === undefined ? null : { enabled: before.enabled, direction: before.direction } },
      });
    }
    const queued = changed && input.enabled && row.status === "CONNECTED" ? await enqueueRun(tx, deps, m.userId, row.id, flow) : false;
    return { ok: true, enabled: input.enabled, direction, changed, queued } as const;
  });
}

export type RunResult = { readonly ok: true; readonly queued: boolean } | { readonly ok: false; readonly reason: "NOT_CONNECTED" | "NO_ENABLED_FLOW" | "QUEUE_UNAVAILABLE" };

/** Şimdi çalıştır (tek akış ya da bütün açık akışlar). Kuyrukta/çalışan iş varsa yenisi açılmaz (`queued: false`). */
export async function requestIntegrationRun(params: ConnectionCallParams, input: { readonly provider: string; readonly flow?: string; readonly requestId?: string | null }, deps: IntegrationDeps = {}): Promise<RunResult> {
  const provider = parseProvider(input.provider);
  const flow = input.flow === undefined ? undefined : parseFlow(input.flow);
  if (deps.queue === undefined) return { ok: false, reason: "QUEUE_UNAVAILABLE" };
  return runTenantCommand({ ...params, permission: "settings.manage" }, async (tx, m) => {
    const row = await loadIntegration(tx, m.tenantId, { provider });
    if (row === null || row.status !== "CONNECTED") return { ok: false, reason: "NOT_CONNECTED" } as const;
    const on = await tx.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM public.integration_flows WHERE tenant_id = ${m.tenantId}::uuid AND integration_id = ${row.id}::uuid AND enabled AND (${flow ?? null}::text IS NULL OR flow = ${flow ?? null})`,
    );
    if (Number(on[0]?.n ?? 0) === 0) return { ok: false, reason: "NO_ENABLED_FLOW" } as const;
    const queued = await enqueueRun(tx, deps, m.userId, row.id, flow);
    await appendAudit(tx, { action: "integration.run_requested", actorUserId: m.userId, entityType: "integration", entityId: row.id, requestId: input.requestId ?? null, changeSummary: { provider, flow: flow ?? "ALL", queued } });
    return { ok: true, queued } as const;
  });
}

/** Worker zamanlayıcısı: bu tenant'ta açık akışı olan bağlı entegrasyonlar (kimlik listesi). */
export async function scheduledIntegrations(tx: AccessTx, tenantId: string): Promise<readonly string[]> {
  const r = await tx.execute<{ id: string }>(sql`
    SELECT i.id FROM public.integrations i
     WHERE i.tenant_id = ${tenantId}::uuid AND i.status = 'CONNECTED'
       AND EXISTS (SELECT 1 FROM public.integration_flows f WHERE f.tenant_id = i.tenant_id AND f.integration_id = i.id AND f.enabled)`);
  return r.map((x) => x.id);
}

export { singletonKey as integrationSyncSingletonKey };
