// T-1160 (güvenlik incelemesi MINOR-A, MINOR-B): yükleme gövdesini sınırlı okur.
// - `Content-Length` ZORUNLU (yoksa 400 `IMAGE_LENGTH_REQUIRED`); tampon bu uzunlukla bir kez ayrılır (çift kopya yok); bildirilenden fazla
//   bayt gelirse okuma kesilir (`IMAGE_TOO_LARGE`), eksik gelirse `IMAGE_INVALID`.
// - En çok `max` bayt (fazlası okunmadan kesilir) ve en çok `deadlineMs` sürede (yavaş damlatılan gövde okuyucuyu iptal eder, `IMAGE_TIMEOUT`).
// - Süreç genelinde aynı anda en çok READ_SLOTS gövde okunur (bellekte tutulan gövde toplamı ≤ READ_SLOTS × 5 MiB); dolu ise 429
//   `IMAGE_BUSY`. Bu sayaç görsel İŞLEME yuvalarından (`item-image.ts`, 2) ayrıdır; işleme yuvası gövde okunduktan sonra alınır.
import { AppError } from "@wms/shared/errors";

/** Gövde okuma süresi üst sınırı (ms). */
export const UPLOAD_BODY_DEADLINE_MS = 20_000;
/** Aynı anda okunabilen gövde sayısı (süreç başına). */
export const READ_SLOTS = 6;

let reading = 0;

/** Gövde okuma yuvası al; dolu ise `null`. Dönen işlev yuvayı bir kez bırakır. */
export function tryAcquireReadSlot(): (() => void) | null {
  if (reading >= READ_SLOTS) return null;
  reading += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    reading -= 1;
  };
}

const tooLarge = (): AppError => new AppError("VALIDATION_FAILED", { detail: "IMAGE_TOO_LARGE" });
const timedOut = (): AppError => new AppError("VALIDATION_FAILED", { detail: "IMAGE_TIMEOUT" });
const noLength = (): AppError => new AppError("VALIDATION_FAILED", { detail: "IMAGE_LENGTH_REQUIRED" });
const invalid = (): AppError => new AppError("VALIDATION_FAILED", { detail: "IMAGE_INVALID" });

export async function readUploadBody(req: { readonly headers: Headers; readonly body: ReadableStream<Uint8Array> | null }, max: number, deadlineMs: number = UPLOAD_BODY_DEADLINE_MS): Promise<Uint8Array> {
  const raw = req.headers.get("content-length");
  if (raw === null || !/^\d{1,10}$/.test(raw.trim())) throw noLength();
  const declared = Number(raw.trim());
  if (declared > max) throw tooLarge();
  if (declared === 0) throw invalid();
  const reader = req.body?.getReader();
  if (reader === undefined) throw invalid();
  const out = new Uint8Array(declared);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timedOut()), deadlineMs);
  });
  let at = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
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
