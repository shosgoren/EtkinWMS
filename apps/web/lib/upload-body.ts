// T-1200 (güvenlik incelemesi MINOR-A, MINOR-B, MINOR-C): yükleme gövdesini sınırlı okur.
// - `Content-Length` ZORUNLU (yoksa 400 `IMAGE_LENGTH_REQUIRED`); tampon bu uzunlukla bir kez ayrılır (çift kopya yok); bildirilenden fazla
//   bayt gelirse okuma kesilir (`IMAGE_TOO_LARGE`), eksik gelirse `IMAGE_INVALID`.
// - En çok `max` bayt. Süre bildirilen uzunlukla orantılı: 5 sn + her 256 KiB için 1 sn, en çok 20 sn; ayrıca 3 sn hiç bayt gelmezse
//   (takılan / damlatılan gövde) okuma kesilir. İkisi de okuyucuyu iptal eder, `IMAGE_TIMEOUT`.
// - Süreç genelinde aynı anda en çok READ_SLOTS gövde okunur (bellekte ≤ READ_SLOTS × 5 MiB); çalışma alanı başına 2, kullanıcı başına 1
//   (tek kullanıcı ya da tek alan ötekileri aç bırakamaz). Dolu ise 429 `IMAGE_BUSY`. Bu sayaç görsel İŞLEME yuvalarından
//   (`item-image.ts`) ayrıdır; işleme yuvası gövde okunduktan sonra alınır.
import { AppError } from "@wms/shared/errors";
import { createKeyedSlots } from "./upload-slots.ts";

/** Toplam süre üst sınırı ve bileşenleri (ms). */
export const UPLOAD_BODY_DEADLINE_MS = 20_000;
export const UPLOAD_BODY_BASE_MS = 5_000;
export const UPLOAD_BODY_MS_PER_CHUNK = 1_000;
export const UPLOAD_BODY_CHUNK_BYTES = 256 * 1024;
/** Hiç bayt gelmeden geçebilecek en uzun süre (ms). */
export const UPLOAD_BODY_STALL_MS = 3_000;
/** Aynı anda okunabilen gövde sayısı (süreç başına) ve paylar. */
export const READ_SLOTS = 6;
export const READ_SLOTS_PER_TENANT = 2;
export const READ_SLOTS_PER_USER = 1;

const reads = createKeyedSlots({ total: READ_SLOTS, perTenant: READ_SLOTS_PER_TENANT, perUser: READ_SLOTS_PER_USER });

/** Gövde okuma yuvası al; toplam ya da çalışma alanı / kullanıcı payı doluysa `null`. Dönen işlev yuvayı bir kez bırakır. */
export function tryAcquireReadSlot(tenant: string, user: string): (() => void) | null {
  return reads.acquire(tenant, user);
}

/** Bildirilen uzunluğa göre toplam süre (ms): 5 sn + her 256 KiB için 1 sn, en çok 20 sn. */
export function uploadDeadlineMs(declared: number): number {
  return Math.min(UPLOAD_BODY_DEADLINE_MS, UPLOAD_BODY_BASE_MS + Math.ceil(Math.max(0, declared) / UPLOAD_BODY_CHUNK_BYTES) * UPLOAD_BODY_MS_PER_CHUNK);
}

const tooLarge = (): AppError => new AppError("VALIDATION_FAILED", { detail: "IMAGE_TOO_LARGE" });
const timedOut = (): AppError => new AppError("VALIDATION_FAILED", { detail: "IMAGE_TIMEOUT" });
const noLength = (): AppError => new AppError("VALIDATION_FAILED", { detail: "IMAGE_LENGTH_REQUIRED" });
const invalid = (): AppError => new AppError("VALIDATION_FAILED", { detail: "IMAGE_INVALID" });

export interface ReadOptions {
  /** Toplam süre (verilmezse `uploadDeadlineMs(bildirilen)`). */
  readonly deadlineMs?: number;
  /** Bayt gelmeden geçebilecek süre. */
  readonly stallMs?: number;
}

export async function readUploadBody(req: { readonly headers: Headers; readonly body: ReadableStream<Uint8Array> | null }, max: number, opts: ReadOptions = {}): Promise<Uint8Array> {
  const raw = req.headers.get("content-length");
  if (raw === null || !/^\d{1,10}$/.test(raw.trim())) throw noLength();
  const declared = Number(raw.trim());
  if (declared > max) throw tooLarge();
  if (declared === 0) throw invalid();
  const reader = req.body?.getReader();
  if (reader === undefined) throw invalid();
  const out = new Uint8Array(declared);
  const until = Date.now() + (opts.deadlineMs ?? uploadDeadlineMs(declared));
  const stallMs = opts.stallMs ?? UPLOAD_BODY_STALL_MS;
  let at = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    for (;;) {
      // Her parça için bekleme: takılma süresi ile kalan toplam süreden kısası.
      const wait = Math.min(stallMs, until - Date.now());
      if (wait <= 0) throw timedOut();
      const tick = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(timedOut()), wait);
      });
      const { done, value } = await Promise.race([reader.read(), tick]);
      clearTimeout(timer);
      if (done) break;
      if (at + value.length > declared) throw tooLarge();
      out.set(value, at);
      at += value.length;
    }
  } catch (e) {
    await reader.cancel().catch(() => undefined);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (at !== declared) throw invalid();
  return out;
}
