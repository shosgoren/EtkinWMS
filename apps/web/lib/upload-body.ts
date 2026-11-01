// T-1160 (güvenlik incelemesi MINOR-A): yükleme gövdesini sınırlı okur — en çok `max` bayt (fazlası okunmadan kesilir, `IMAGE_TOO_LARGE`)
// ve en çok `deadlineMs` sürede (yavaş damlatılan gövde okuyucuyu iptal eder, `IMAGE_TIMEOUT`). Görsel işleme yuvası gövde OKUNDUKTAN
// sonra alınır; bu yüzden yavaş istemci yuva tutamaz.
import { AppError } from "@wms/shared/errors";

/** Gövde okuma süresi üst sınırı (ms). */
export const UPLOAD_BODY_DEADLINE_MS = 20_000;

const tooLarge = (): AppError => new AppError("VALIDATION_FAILED", { detail: "IMAGE_TOO_LARGE" });
const timedOut = (): AppError => new AppError("VALIDATION_FAILED", { detail: "IMAGE_TIMEOUT" });

export async function readUploadBody(req: { readonly headers: Headers; readonly body: ReadableStream<Uint8Array> | null }, max: number, deadlineMs: number = UPLOAD_BODY_DEADLINE_MS): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) throw tooLarge();
  const reader = req.body?.getReader();
  if (reader === undefined) return new Uint8Array(0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timedOut()), deadlineMs);
  });
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      total += value.length;
      if (total > max) throw tooLarge();
      parts.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => undefined);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
