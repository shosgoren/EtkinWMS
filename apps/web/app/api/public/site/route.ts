// Satış sitesi içerik ucu (T-407, ADR-027 §6): son yayınlanan satış sayfası içeriği ve fiyat bölümündeki yayındaki paketler. Kimlik
// gerektirmez; kişisel/müşteri verisi yoktur (`wms_probe.platform_site_public`). Satış sitesi sunucusu (marketing/server.mjs) iç ağdan
// okur. Önizleme sırrı `x-site-preview` başlığıyla gelir (adres/sorgu yerine: erişim günlüğüne ve Referer'a girmez); biçimsiz ya da
// süresi geçmiş sır yok sayılır ve yayındaki içerik döner. Yayındaki içerik kısa süre bellekte tutulur (her istek DB'ye gitmez).
import { getAppDb } from "@wms/db";
import { getPublicSite, type PublicSite } from "@wms/domain/platform/site-content";
import { createConsoleLogger } from "@wms/shared/log";

const logger = createConsoleLogger("web");

export const dynamic = "force-dynamic";

const CACHE_MS = 15_000;
let cached: { at: number; site: PublicSite | null } | null = null;

export async function GET(request: Request): Promise<Response> {
  const preview = request.headers.get("x-site-preview");
  try {
    if (preview !== null && preview !== "") {
      const site = await getPublicSite(getAppDb(), preview);
      return Response.json({ site }, { headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
    }
    const now = Date.now();
    if (cached === null || now - cached.at > CACHE_MS) cached = { at: now, site: await getPublicSite(getAppDb(), null) };
    return Response.json({ site: cached.site?.preview === false ? cached.site : null }, { headers: { "cache-control": "public, max-age=15" } });
  } catch (e) {
    logger.error("public site content failed", { errorName: e instanceof Error ? e.name : "unknown" });
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
