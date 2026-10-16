// Demo talebi içe alma (T-994, ADR-026 §3): satış sitesi talebi kendi JSONL dosyasına yazar (marketing/server.mjs); worker aynı
// dosyayı salt okunur bağlamadan okur ve `ingestDemoLeads` ile `wms_platform.demo_requests`'a ekler. Ağ ucu ve ortak sır YOKTUR.
// Kimlik satış sitesinin uuid'idir: aynı satır ikinci kez eklenmez, bu yüzden yeniden başlatmada dosyanın tamamı yeniden okunur.
// Çalışma sırasında yalnız yeni eklenen kısım okunur (bayt konumu bellekte); dosya küçülürse (döndürme) baştan okunur.
// Günlükte yalnız sayılar; ad/e-posta/mesaj yazılmaz (G-09).
import type { Logger } from "@wms/shared/log";

export const DEMO_LEADS_INTERVAL_MS = 60_000;

export interface DemoLeadsDeps {
  /** Dosyanın `from` baytından sonrasını ve toplam boyutu döner; dosya yoksa `null`. */
  readonly readFrom: (from: number) => Promise<{ text: string; size: number } | null>;
  readonly ingest: (jsonl: string) => Promise<{ inserted: number; skipped: number }>;
  readonly logger: Logger;
}

const errName = (e: unknown): string => (e instanceof Error ? e.name : "unknown");

/** Bir koşu: yeni tam satırları içe alır; yarım kalan son satır bir sonraki koşuya bırakılır. Yeni konumu döner. */
export async function runDemoLeadsIngest(deps: DemoLeadsDeps, offset: number): Promise<number> {
  let from = offset;
  let chunk = await deps.readFrom(from);
  if (chunk === null) return 0;
  if (chunk.size < from) {
    // Dosya küçüldü (döndürüldü/yeniden oluşturuldu): baştan oku; yinelenen satırlar veritabanında eklenmez.
    from = 0;
    chunk = await deps.readFrom(0);
    if (chunk === null) return 0;
  }
  if (chunk.text === "") return from;
  const lastNl = chunk.text.lastIndexOf("\n");
  if (lastNl < 0) return from;
  const complete = chunk.text.slice(0, lastNl + 1);
  const r = await deps.ingest(complete);
  if (r.inserted > 0 || r.skipped > 0) deps.logger.info("platform.demo_leads.ingested", { inserted: r.inserted, skipped: r.skipped });
  return from + Buffer.byteLength(complete, "utf8");
}

export interface DemoLeadsScheduleOptions extends DemoLeadsDeps {
  readonly intervalMs?: number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (t: unknown) => void;
}

/** Açılışta bir kez + her `intervalMs`'de; üst üste binen koşu atlanır. */
export function startDemoLeadsSchedule(options: DemoLeadsScheduleOptions): { stop(): void } {
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
  let offset = 0;
  const tick = (): void => {
    if (running || stopped) return;
    running = true;
    runDemoLeadsIngest(options, offset)
      .then((next) => {
        offset = next;
      })
      .catch((e: unknown) => options.logger.error("platform.demo_leads.failed", { reason: errName(e) }))
      .finally(() => {
        running = false;
      });
  };
  tick();
  const handle = setTimer(tick, options.intervalMs ?? DEMO_LEADS_INTERVAL_MS);
  return {
    stop(): void {
      stopped = true;
      clearTimer(handle);
    },
  };
}
