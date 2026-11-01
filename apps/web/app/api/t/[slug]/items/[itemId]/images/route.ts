// T-1160: ürün görseli yükleme (ekle ya da `?replaces=<görsel>` ile değiştir). Gövde ham dosya baytlarıdır (multipart yok).
// Sıra: routeGuard (Origin zorunlu, IP/kullanıcı sınırı, oturum) → aynı site → slug/kimlik biçimi → `items.edit` + MFA ön denetimi ve
// tenant sayacı (`limitVerifiedTenant`; yetkisiz çağıran gövdeyi okutamaz, dosya çözülmez) → kullanıcı başına dakikada 20 yükleme →
// gövde en çok 5 MiB okunur (fazlası okunmadan kesilir) → `processItemImage` (bayt imzası, yeniden kodlama, EXIF silme) → domain
// `addItemImage` (yetki + RLS + audit aynı transaction'da). Dosya diske/loga yazılmaz; yanıt `no-store`.
// Güvenlik incelemesi MAJOR-1: kullanıcı sınırına ek olarak çalışma alanı başına dakikada 60 yükleme; gövde okunmadan ÖNCE süreç
// genelindeki işleme yuvası (en çok 2 görsel aynı anda) gövde 20 sn sınırla okunduktan SONRA, yalnız işleme süresince alınır; dolu ise 429
// `IMAGE_BUSY` ("Görsel işleniyor, birazdan tekrar dene"); süre dolarsa 400 `IMAGE_TIMEOUT` (güvenlik incelemesi MINOR-A). MINOR-B: gövde
// okumanın da ayrı süreç sayacı var (en çok 6, dolu ise 429 `IMAGE_BUSY`); `Content-Length` zorunlu (yoksa 400 `IMAGE_LENGTH_REQUIRED`).
import { getAppDb } from "@wms/db";
import { addItemImage, IMAGE_UPLOAD_MAX_BYTES } from "@wms/domain/catalog/item-images";
import { AppError } from "@wms/shared/errors";
import { createProductionRouteGuard, limitVerifiedTenant } from "../../../../../../../lib/action-guard.ts";
import { imageBusy, processItemImage, tryAcquireImageSlot } from "../../../../../../../lib/item-image.ts";
import { createDbRateLimitStore, createRateLimiter } from "../../../../../../../lib/rate-limit.ts";
import { readUploadBody, tryAcquireReadSlot } from "../../../../../../../lib/upload-body.ts";

export const dynamic = "force-dynamic";

const UPLOADS_PER_MINUTE = 20;
const TENANT_UPLOADS_PER_MINUTE = 60;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const guard = createProductionRouteGuard();
export async function POST(request: Request, nextCtx: { params: Promise<{ slug: string; itemId?: string }> }): Promise<Response> {
  const { slug, itemId } = await nextCtx.params;
  return guard({}, async (req, ctx) => {
    const principal = ctx.principal;
    if (principal === null) throw new AppError("UNAUTHENTICATED");
    const site = req.headers.get("sec-fetch-site");
    if (site !== null && site !== "same-origin") throw new AppError("FORBIDDEN");
    if (!SLUG_RE.test(slug) || itemId === undefined || !UUID_RE.test(itemId)) throw new AppError("NOT_FOUND");
    const replaces = new URL(req.url).searchParams.get("replaces");
    if (replaces !== null && !UUID_RE.test(replaces)) throw new AppError("VALIDATION_FAILED");
    const db = getAppDb();
    const access = { db, principal, tenantSlug: slug };
    await limitVerifiedTenant({ ...access, permission: "items.edit" }, ctx);
    const limiter = createRateLimiter({ store: createDbRateLimitStore(db), secret: process.env.BETTER_AUTH_SECRET ?? "", limits: { user: UPLOADS_PER_MINUTE, tenant: TENANT_UPLOADS_PER_MINUTE } });
    await limiter.check("user", `item-image:${principal.userId}`);
    // Üyelik yukarıda doğrulandı (slug → tek tenant); sayaç çalışma alanı başınadır.
    await limiter.check("tenant", `item-image:${slug}`);
    // Gövde önce, süre sınırıyla okunur (yavaş istemci yuva tutamaz); yuva yalnız çözme / kodlama süresince.
    // MINOR-B: aynı anda okunan gövde sayısı da sınırlı (bellekte ≤ 6 × 5 MiB); işleme yuvasından ayrı sayaç.
    const releaseRead = tryAcquireReadSlot();
    if (releaseRead === null) throw imageBusy();
    let bytes: Uint8Array;
    try {
      bytes = await readUploadBody(req, IMAGE_UPLOAD_MAX_BYTES);
    } finally {
      releaseRead();
    }
    const release = tryAcquireImageSlot();
    if (release === null) throw imageBusy();
    let image: Awaited<ReturnType<typeof processItemImage>>;
    try {
      image = await processItemImage(bytes);
    } finally {
      release();
    }
    const r = await addItemImage({ ...access, requestId: ctx.requestId }, { itemId, image, replaces });
    return new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-request-id": ctx.requestId } });
  })(request);
}
