// `integration.sync` işi + 30 saniyelik zamanlayıcı (T-991). İş kuralı `@wms/domain/integrations` `runIntegrationSync`'tedir; burada yalnız bağlama,
// sağlayıcı istemcisi ve günlük vardır. Tenant bağlamı işin zarfından (`ctx.inTenant` = `withSystemTenant`, tenant ACTIVE denetimli).
// Günlüğe sır/adres/şirket/kayıt adı yazılmaz: yalnız iş kimliği, sayılar ve sabit kodlar (G-09).
//
// Zamanlayıcı: açılışta bir kez + 30 saniyede bir; ACTIVE tenant'lar keyset sayfalarla (`listActiveTenantIds`), her tenant'ta açık akışı olan bağlı
// entegrasyon başına bir iş (`singletonKey` = bağlantı: kuyrukta/çalışırken ikinci iş açılmaz; elle "Şimdi çalıştır" ile aynı anahtar).
import { ParasutClient, integrationSealer, resolveParasutBaseUrl, runIntegrationSync, type FetchLike } from "@wms/domain/integrations";
import type { AccessTx } from "@wms/domain/identity/access";
import type { Logger } from "@wms/shared/log";
import type { JobHandler } from "@wms/shared/queue";

export const INTEGRATION_SCHEDULE_INTERVAL_MS = 30_000;
const FIRST_PAGE = "00000000-0000-0000-0000-000000000000";
const PAGE_SIZE = 500;
const errName = (e: unknown): string => (e instanceof Error ? e.name : "unknown");
const codeOf = (e: unknown): string | undefined => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" && /^[A-Z][A-Z_]{1,31}$/.test(c) ? c : undefined;
};

export interface IntegrationSyncDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly logger: Logger;
  /** Test: sahte HTTP. */
  readonly fetch?: FetchLike;
}

export function createIntegrationSyncHandler(deps: IntegrationSyncDeps): JobHandler<"integration.sync"> {
  return async (ctx) => {
    let result: Awaited<ReturnType<typeof runIntegrationSync>>;
    try {
      const sealer = integrationSealer(deps.env);
      const client = new ParasutClient({ baseUrl: resolveParasutBaseUrl(deps.env), ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }) });
      result = await runIntegrationSync(
        { inTenant: (fn) => ctx.inTenant((tx) => fn(tx as AccessTx)), client, sealer },
        { integrationId: ctx.payload.integrationId, flow: ctx.payload.flow, trigger: ctx.payload.trigger, flows: ctx.payload.flows },
        ctx.actorUserId,
      );
    } catch (e) {
      const code = codeOf(e);
      deps.logger.error("integration.sync failed", { jobId: ctx.jobId, error: errName(e), ...(code === undefined ? {} : { code }) });
      throw e;
    }
    if (result.kind === "skipped") {
      deps.logger.info("integration.sync skipped", { jobId: ctx.jobId, reason: result.reason });
      return;
    }
    deps.logger.info("integration.sync done", {
      jobId: ctx.jobId,
      flows: result.flows.length,
      failedFlows: result.flows.filter((f) => f.status === "FAILED").length,
      partialFlows: result.flows.filter((f) => f.status === "PARTIAL").length,
    });
  };
}

export interface IntegrationScheduleDeps {
  readonly listActiveTenantIds: (after: string, limit: number) => Promise<readonly string[]>;
  /** Tenant'ın açık akışlı bağlantıları için işleri kuyruğa yazar; yazılan iş sayısı. */
  readonly enqueueFor: (tenantId: string) => Promise<number>;
  readonly logger: Logger;
}

const INACTIVE_CODES: ReadonlySet<string> = new Set(["TENANT_SUSPENDED", "TENANT_CLOSING", "FORBIDDEN"]);

export async function runIntegrationSchedule(deps: IntegrationScheduleDeps): Promise<{ readonly tenants: number; readonly queued: number; readonly failed: number }> {
  let tenants = 0;
  let queued = 0;
  let failed = 0;
  let after = FIRST_PAGE;
  try {
    for (;;) {
      const ids = await deps.listActiveTenantIds(after, PAGE_SIZE);
      tenants += ids.length;
      for (const id of ids) {
        try {
          queued += await deps.enqueueFor(id);
        } catch (e) {
          const code = codeOf(e);
          if (code !== undefined && INACTIVE_CODES.has(code)) continue;
          failed += 1;
          deps.logger.error("integration.schedule_enqueue_failed", { tenantId: id, reason: errName(e) });
        }
      }
      if (ids.length < PAGE_SIZE) break;
      after = ids[ids.length - 1] as string;
    }
  } catch (e) {
    failed += 1;
    deps.logger.error("integration.schedule_list_failed", { tenants, reason: errName(e) });
  }
  deps.logger.info("integration.scheduled", { tenants, queued, failed });
  return { tenants, queued, failed };
}

export function startIntegrationSchedule(options: IntegrationScheduleDeps & { readonly intervalMs?: number; readonly setTimer?: (fn: () => void, ms: number) => unknown; readonly clearTimer?: (t: unknown) => void }): { stop(): void } {
  const setTimer =
    options.setTimer ??
    ((fn, ms) => {
      const h = setInterval(fn, ms);
      h.unref();
      return h;
    });
  const clearTimer = options.clearTimer ?? ((t) => clearInterval(t as NodeJS.Timeout));
  let running = false;
  let stopped = false;
  const tick = (): void => {
    if (running || stopped) return;
    running = true;
    runIntegrationSchedule(options)
      .catch((e: unknown) => options.logger.error("integration.schedule_failed", { reason: errName(e) }))
      .finally(() => {
        running = false;
      });
  };
  tick();
  const handle = setTimer(tick, options.intervalMs ?? INTEGRATION_SCHEDULE_INTERVAL_MS);
  return {
    stop(): void {
      stopped = true;
      clearTimer(handle);
    },
  };
}
