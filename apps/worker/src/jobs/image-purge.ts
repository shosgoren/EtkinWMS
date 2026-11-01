// T-1160 (güvenlik incelemesi MINOR-2, KVKK): silinen ürün görsellerinin baytlarının süreli boşaltılması. Zamanlayıcı deseni `count-abandon.ts`
// (worker içi döngü: açılışta bir + 15 dakikada bir, ACTIVE tenant'lar keyset sayfalarla). Her tenant için `withSystemTenant` bağlamında
// (aynı RLS + FORCE; tenant kimliği yalnız `wms_worker` dar listeleme işlevinden) domain `purgeRemovedItemImages` çalışır: yalnız 10 dakikadan
// eski silinmiş satırların `data`/`thumb` sütunları NULL'a çekilir (0074 bekçisi süreyi ayrıca zorlar). Kuyruk işi değildir (yeniden
// denemede yan etki aynıdır; idempotent). Sessiz OK yok: her koşu sayıları loglar; hata `level=error`. Log alanları yalnız kimlik/sayı.
import type { Logger } from "@wms/shared/log";

export const IMAGE_PURGE_INTERVAL_MS = 900_000;
const FIRST_PAGE = "00000000-0000-0000-0000-000000000000";
const PAGE_SIZE = 500;

export interface ImagePurgeDeps {
  readonly listActiveTenantIds: (after: string, limit: number) => Promise<readonly string[]>;
  /** `withSystemTenant(db, id, "item_images.purge", tx => purgeRemovedItemImages(tx, id))`; boşaltılan satır sayısı. */
  readonly purgeFor: (tenantId: string) => Promise<number>;
  readonly logger: Logger;
}

export interface ImagePurgeResult {
  readonly listed: number;
  readonly purged: number;
  readonly inactive: number;
  readonly failed: number;
  readonly listFailed: boolean;
}

const INACTIVE_CODES: ReadonlySet<string> = new Set(["TENANT_SUSPENDED", "TENANT_CLOSING", "FORBIDDEN"]);
const errName = (e: unknown): string => (e instanceof Error ? e.name : "unknown");

export async function runImagePurge(deps: ImagePurgeDeps): Promise<ImagePurgeResult> {
  const { logger } = deps;
  let listed = 0;
  let purged = 0;
  let inactive = 0;
  let failed = 0;
  let listFailed = false;
  let after = FIRST_PAGE;
  try {
    for (;;) {
      const ids = await deps.listActiveTenantIds(after, PAGE_SIZE);
      listed += ids.length;
      for (const tenantId of ids) {
        try {
          purged += await deps.purgeFor(tenantId);
        } catch (e) {
          const code = (e as { code?: unknown } | null)?.code;
          if (typeof code === "string" && INACTIVE_CODES.has(code)) inactive += 1;
          else {
            failed += 1;
            logger.error("item_images.purge_failed", { tenantId, reason: errName(e) });
          }
        }
      }
      if (ids.length < PAGE_SIZE) break;
      after = ids[ids.length - 1] as string;
    }
  } catch (e) {
    listFailed = true;
    logger.error("item_images.purge_list_failed", { listed, purged, reason: errName(e) });
  }
  const result: ImagePurgeResult = { listed, purged, inactive, failed, listFailed };
  if (listFailed || failed > 0) logger.error("item_images.purge_incomplete", { ...result });
  else logger.info("item_images.purged", { listed, purged, inactive });
  return result;
}

export interface ImagePurgeScheduleOptions extends ImagePurgeDeps {
  readonly intervalMs?: number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (t: unknown) => void;
}

/** Açılışta bir kez + her `intervalMs`'de; üst üste binen koşu atlanır. */
export function startImagePurgeSchedule(options: ImagePurgeScheduleOptions): { stop(): void } {
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
    runImagePurge(options)
      .catch((e: unknown) => options.logger.error("item_images.purge_crashed", { reason: errName(e) }))
      .finally(() => {
        running = false;
      });
  };
  tick();
  const handle = setTimer(tick, options.intervalMs ?? IMAGE_PURGE_INTERVAL_MS);
  return {
    stop(): void {
      stopped = true;
      clearTimer(handle);
    },
  };
}
