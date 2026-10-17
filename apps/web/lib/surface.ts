// ADR-027 §1: aynı imaj iki kipte çalışır. `APP_SURFACE=panel` → yonet.etkinyazilim.com (Etkin Yönetim paneli); aksi müşteri
// uygulaması (wms.etkinyazilim.com). Kip yalnız ortamdan okunur (istek başlığından değil): bir kökende diğerinin sayfaları açılmaz.
import { RESERVED_SLUGS } from "@wms/domain/onboarding/reserved";

export type Surface = "app" | "panel";

export function appSurface(env: Readonly<Record<string, string | undefined>> = process.env): Surface {
  return env.APP_SURFACE?.trim() === "panel" ? "panel" : "app";
}

/** Panelin temiz adresleri (yonet.etkinyazilim.com/<yol>) → iç yol `/panel/<yol>`. Yeni panel sayfası buraya eklenir. */
export const PANEL_PAGES: readonly string[] = ["/", "/musteriler", "/paketler", "/odemeler", "/talepler", "/satis", "/kayit"];

/** Panel kipinde açık kalan ortak yollar: giriş, iki adımlı doğrulama, parola sıfırlama, kimlik ve sağlık uçları. */
const PANEL_SHARED = /^\/(?:login|mfa|reset-password)(?:\/|$)|^\/api\/auth(?:\/|$)|^\/api\/health\/live$/;
/** Statik dosyalar (simge, manifest, yazı tipi). */
const STATIC_FILE = /^\/[^/]+\.(?:svg|png|ico|webmanifest|txt|woff2?)$|^\/(?:icon|apple-icon|manifest)(?:\.[a-z]+)?$/;

export type PanelRoute = { kind: "page"; internal: string } | { kind: "shared" } | { kind: "missing" };

/** Panel kipinde bir yolun ne olduğu: panel sayfası (iç yola yeniden yazılır), ortak yol ya da yok (404). */
export function panelRoute(pathname: string): PanelRoute {
  if (PANEL_PAGES.includes(pathname)) return { kind: "page", internal: pathname === "/" ? "/panel" : `/panel${pathname}` };
  if (PANEL_SHARED.test(pathname) || STATIC_FILE.test(pathname)) return { kind: "shared" };
  return { kind: "missing" };
}

/** Müşteri kipinde panel iç yolları yoktur (doğrudan `/panel/...` 404). */
export function isPanelInternal(pathname: string): boolean {
  return pathname === "/panel" || pathname.startsWith("/panel/");
}

/** Kısa çalışma alanı adresi (ADR-026 §1): `wms.etkinyazilim.com/<alan>` → `/t/<alan>`. Biçim tenant slug'ı; ayrılmış adlar (bütün üst düzey
 * uygulama yolları) asla kısa adres sayılmaz. Yalnız yönlendirme: oturum/çerez taşımaz, üyelik `/t/<alan>`'da yine denetlenir (I-01). */
const SHORT_WORKSPACE = /^\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\/?$/;
export function shortWorkspaceTarget(pathname: string): string | null {
  const m = SHORT_WORKSPACE.exec(pathname);
  const slug = m?.[1];
  if (slug === undefined || RESERVED_SLUGS.has(slug)) return null;
  return `/t/${slug}`;
}
