// T-981b: ekran bazlı Excel dışa aktarma + boş şablon (.xlsx). İnce giriş: yetki, kiracı/depo kapsamı, kişisel veri kuralı, satır sınırı ve
// audit `@wms/domain/onboarding/data-export`'ta (`exportData`). Burada yalnız istek doğrulama, hız sınırı ve dosya üretimi.
// Sıra: routeGuard (IP/kullanıcı sınırı) → aynı site denetimi → `data.import` ön denetimi (yetkisiz çağıran sayaç tüketmez) → kullanıcı
// başına dakikada EXPORTS_PER_MINUTE dışa aktarma (şablon ayrı sayaç) → okuma + `data.exported` audit'i (aynı transaction) → dosya.
// Dosya içeriği diske/loga yazılmaz (G-09); yanıt `no-store`.
import { ensureRecentAuth } from "../../../../../../lib/auth-service.ts";
import { getAppDb } from "@wms/db";
import { EXPORT_HEADERS, EXPORT_KINDS, assertExportAllowed, exportData, type ExportKind } from "@wms/domain/onboarding/data-export";
import { AppError } from "@wms/shared/errors";
import { createProductionRouteGuard } from "../../../../../../lib/action-guard.ts";
import { createDbRateLimitStore, createRateLimiter } from "../../../../../../lib/rate-limit.ts";
import { buildXlsx } from "../../../../../../lib/sheet/write.ts";

export const dynamic = "force-dynamic";

const EXPORTS_PER_MINUTE = 6;
const TEMPLATES_PER_MINUTE = 20;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Dosya adı (ASCII) ve sayfa adı. */
const NAMES: Readonly<Record<ExportKind, readonly [string, string]>> = {
  items: ["urunler", "Ürünler"],
  parties: ["cariler", "Cariler"],
  warehouses: ["depolar", "Depolar"],
  locations: ["raflar", "Raflar"],
  stock: ["acilis-stoku", "Açılış stoku"],
};

const guard = createProductionRouteGuard();

export async function GET(request: Request, nextCtx: { params: Promise<{ slug: string; kind: string }> }): Promise<Response> {
  const { slug, kind: rawKind } = await nextCtx.params;
  return guard({}, async (req, ctx) => {
    const principal = ctx.principal;
    if (principal === null) throw new AppError("UNAUTHENTICATED");
    // Çapraz site indirme yok: GET durum değiştirir (audit + sayaç). Yalnız aynı site isteği ya da doğrudan açma; sayaç tüketmez.
    const site = req.headers.get("sec-fetch-site");
    if (site !== "same-origin" && site !== "none") throw new AppError("FORBIDDEN");
    if (!SLUG_RE.test(slug)) throw new AppError("NOT_FOUND");
    if (!(EXPORT_KINDS as readonly string[]).includes(rawKind)) throw new AppError("NOT_FOUND");
    const kind = rawKind as ExportKind;
    const url = new URL(req.url);
    const template = url.searchParams.get("template") === "1";
    const q = (url.searchParams.get("q") ?? "").slice(0, 100);
    const warehouse = url.searchParams.get("warehouse");
    if (warehouse !== null && !UUID_RE.test(warehouse)) throw new AppError("VALIDATION_FAILED");
    const db = getAppDb();
    const access = { db, principal, tenantSlug: slug };
    // Ön denetim: üyelik + `data.import` + MFA; geçmeyen çağıran sayaç tüketmez.
    await assertExportAllowed(access);
    await createRateLimiter({
      store: createDbRateLimitStore(db),
      secret: process.env.BETTER_AUTH_SECRET ?? "",
      limits: { user: template ? TEMPLATES_PER_MINUTE : EXPORTS_PER_MINUTE },
    }).check("user", `${template ? "data-template" : "data-export"}:${principal.userId}`);
    const [file, sheet] = NAMES[kind];
    const day = new Date().toISOString().slice(0, 10);
    const headers: Record<string, string> = {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-request-id": ctx.requestId,
    };
    if (template) {
      const body = buildXlsx(sheet, EXPORT_HEADERS[kind], []);
      return new Response(body as BodyInit, { status: 200, headers: { ...headers, "content-disposition": `attachment; filename="etkin-sablon-${file}.xlsx"` } });
    }
    // Kişisel sütunlu cari dosyası yeniden doğrulama ister (domain karar verir; diğer türlerde çağrılmaz).
    const r = await exportData(
      { ...access, requestId: ctx.requestId, recentAuth: () => ensureRecentAuth(req.headers) },
      { kind, ...(q === "" ? {} : { q }), ...(warehouse === null ? {} : { warehouseId: warehouse }), ...(url.searchParams.get("arsiv") === "1" ? { archived: true } : {}) },
    );
    const body = buildXlsx(sheet, r.headers, r.rows);
    return new Response(body as BodyInit, {
      status: 200,
      headers: {
        ...headers,
        "content-disposition": `attachment; filename="etkin-${file}-${slug}-${day}.xlsx"`,
        "x-export-rows": String(r.rows.length),
        "x-export-truncated": r.truncated ? "1" : "0",
        "x-export-personal-omitted": r.personalOmitted ? "1" : "0",
      },
    });
  })(request);
}
