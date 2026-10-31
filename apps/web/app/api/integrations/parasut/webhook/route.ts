// T-1138: Paraşüt anlık bildirim alıcısı (herkese açık POST; Paraşüt sunucusu çağırır, oturum/köken yok). Caddy yalnız `/api/public/*`
// yolunu dışarıya kapatır; bu yol dışarıdan erişilebilir olmalıdır (OPERATIONS). Sıra: kip (yalnız müşteri uygulaması) → IP hız sınırı →
// gövde en çok 64 KiB (akışla; Content-Length'e güvenilmez) → domain `receiveParasutWebhook` (tenant eşlemesi + imza + kuyruk).
// Ret yanıtı tek biçimdir (401, sabit gövde): bilinmeyen şirket, bozuk gövde, yanlış imza ayırt edilemez. Gövde/imza/şirket loga yazılmaz.
import { getAppDb } from "@wms/db";
import { WEBHOOK_BODY_MAX, integrationSealer, receiveParasutWebhook } from "@wms/domain/integrations";
import { AppError } from "@wms/shared/errors";
import { createConsoleLogger } from "@wms/shared/log";
import { clientIp, createProductionLimiter, RateLimitedError } from "../../../../../lib/rate-limit.ts";
import { getSenderQueue } from "../../../../../lib/queue.ts";
import { appSurface } from "../../../../../lib/surface.ts";

export const dynamic = "force-dynamic";
const logger = createConsoleLogger("web");
const limiter = createProductionLimiter();
const HEADERS = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-robots-tag": "noindex" };
const reply = (status: number, body: string): Response => new Response(body, { status, headers: { ...HEADERS, "content-type": "text/plain; charset=utf-8" } });

/** Akışı en çok `max` bayta kadar okur; aşarsa `null`. */
async function readBounded(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  const reader = request.body?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(r.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(request: Request): Promise<Response> {
  if (appSurface() !== "app") return reply(404, "not found");
  try {
    await limiter.check("ip", clientIp(request.headers));
  } catch (e) {
    if (e instanceof RateLimitedError) {
      const r = reply(429, "slow down");
      r.headers.set("retry-after", String(e.retryAfterSeconds));
      return r;
    }
    if (e instanceof AppError) return reply(403, "forbidden");
    logger.error("parasut webhook limiter failed", { error: e instanceof Error ? e.name : "unknown" });
    return reply(503, "unavailable");
  }
  const body = await readBounded(request, WEBHOOK_BODY_MAX).catch(() => null);
  if (body === null) return reply(413, "too large");
  try {
    const r = await receiveParasutWebhook({ db: getAppDb(), sealer: integrationSealer(), queue: await getSenderQueue() }, { body, signature: request.headers.get("signature") });
    if (r.status === 200) return reply(200, "ok");
    if (r.status === 503) return reply(503, "unavailable");
    return reply(401, "rejected");
  } catch (e) {
    logger.error("parasut webhook failed", { error: e instanceof Error ? e.name : "unknown" });
    return reply(503, "unavailable");
  }
}
