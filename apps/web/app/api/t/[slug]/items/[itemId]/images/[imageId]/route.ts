// T-1160: ürün görselini sunma (yalnız kiracı yetkisiyle). Oturum + üyelik + `stock.view` + RLS domain'de (`getItemImage`); başka
// tenant'ın / silinmiş / olmayan görseli `NOT_FOUND` (varlık sızmaz). Yanıt yalnız `image/webp` (saklanan biçim; imza yeniden denetlenir),
// `nosniff`, betik çalıştırmayan CSP + sandbox, `inline` (kaydetme adı sabit), yalnız aynı köken. Adres `?v=<sürüm>` taşır (içerik
// özeti): içerik değişince adres değişir, bu yüzden tarayıcıda özel (paylaşılmayan) uzun önbellek güvenlidir. `?t=1` küçük resim.
import { getAppDb } from "@wms/db";
import { getItemImage, isWebp } from "@wms/domain/catalog/item-images";
import { AppError } from "@wms/shared/errors";
import { createProductionRouteGuard } from "../../../../../../../../lib/action-guard.ts";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const guard = createProductionRouteGuard();

export async function GET(request: Request, nextCtx: { params: Promise<{ slug: string; itemId?: string; imageId?: string }> }): Promise<Response> {
  const { slug, itemId, imageId } = await nextCtx.params;
  return guard({}, async (req, ctx) => {
    const principal = ctx.principal;
    if (principal === null) throw new AppError("UNAUTHENTICATED");
    if (!SLUG_RE.test(slug) || itemId === undefined || imageId === undefined || !UUID_RE.test(itemId) || !UUID_RE.test(imageId)) throw new AppError("NOT_FOUND");
    const variant = new URL(req.url).searchParams.get("t") === "1" ? "thumb" : "full";
    const r = await getItemImage({ db: getAppDb(), principal, tenantSlug: slug }, { itemId, imageId, variant });
    if (!isWebp(r.bytes)) throw new AppError("NOT_FOUND");
    return new Response(r.bytes as unknown as ConstructorParameters<typeof Response>[0], {
      status: 200,
      headers: {
        "content-type": "image/webp",
        "content-length": String(r.bytes.length),
        "content-disposition": 'inline; filename="urun-gorseli.webp"',
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cross-origin-resource-policy": "same-origin",
        "cache-control": "private, max-age=31536000, immutable",
        etag: `"${r.sha256.slice(0, 32)}"`,
        "x-request-id": ctx.requestId,
      },
    });
  })(request);
}
