// T-1160: ürün görseli yükleme (ekle ya da `?replaces=<görsel>` ile değiştir). Gövde ham dosya baytlarıdır (multipart yok).
// Sıra: routeGuard (Origin zorunlu, IP/kullanıcı sınırı, oturum) → aynı site → slug/kimlik biçimi → `items.edit` + MFA ön denetimi ve
// tenant sayacı (`limitVerifiedTenant`; yetkisiz çağıran gövdeyi okutamaz, dosya çözülmez) → kullanıcı başına dakikada 20 yükleme →
// gövde en çok 5 MiB okunur (fazlası okunmadan kesilir) → `processItemImage` (bayt imzası, yeniden kodlama, EXIF silme) → domain
// `addItemImage` (yetki + RLS + audit aynı transaction'da). Dosya diske/loga yazılmaz; yanıt `no-store`.
import { getAppDb } from "@wms/db";
import { addItemImage, IMAGE_UPLOAD_MAX_BYTES } from "@wms/domain/catalog/item-images";
import { AppError } from "@wms/shared/errors";
import { createProductionRouteGuard, limitVerifiedTenant } from "../../../../../../../lib/action-guard.ts";
import { processItemImage } from "../../../../../../../lib/item-image.ts";
import { createDbRateLimitStore, createRateLimiter } from "../../../../../../../lib/rate-limit.ts";

export const dynamic = "force-dynamic";

const UPLOADS_PER_MINUTE = 20;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const guard = createProductionRouteGuard();
const tooLarge = (): AppError => new AppError("VALIDATION_FAILED", { detail: "IMAGE_TOO_LARGE" });

/** Gövdeyi en çok `max` bayt okur; aşılırsa okumayı keser (bellek sınırı). */
async function readCapped(req: Request, max: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) throw tooLarge();
  const reader = req.body?.getReader();
  if (reader === undefined) return new Uint8Array(0);
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

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
    await createRateLimiter({ store: createDbRateLimitStore(db), secret: process.env.BETTER_AUTH_SECRET ?? "", limits: { user: UPLOADS_PER_MINUTE } }).check("user", `item-image:${principal.userId}`);
    const bytes = await readCapped(req, IMAGE_UPLOAD_MAX_BYTES);
    const image = await processItemImage(bytes);
    const r = await addItemImage({ ...access, requestId: ctx.requestId }, { itemId, image, replaces });
    return new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-request-id": ctx.requestId } });
  })(request);
}
