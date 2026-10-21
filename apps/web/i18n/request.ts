import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { cache } from "react";
import { getAppDb } from "@wms/db";
import { getWorkspaceLocale } from "@wms/domain/onboarding/settings-queries";
import { TENANT_SLUG_HEADER } from "./tenant-slug.ts";
import en from "../messages/en.json";
import tr from "../messages/tr.json";

// Yönlendirmesiz kurulum (T-109): dil URL'de değil. Sıra (T-999c): `locale` çerezi (cihaz tercihi; uygulama bugün yazmaz) → tenant
// sayfalarında çalışma alanının dili (Ayarlar > Dil, `tenant_settings.locale`; her üye okur) → `Accept-Language` → varsayılan `tr`.
// `en` yedek dildir. Saat dilimi tenant ayarı T-121'de bağlanana kadar Europe/Istanbul.
export const SUPPORTED_LOCALES = ["tr", "en"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
const MESSAGES: Record<AppLocale, Record<string, unknown>> = { tr, en };
export const DEFAULT_LOCALE: AppLocale = "tr";
export const DEFAULT_TIME_ZONE = "Europe/Istanbul";

function isLocale(value: string | undefined): value is AppLocale {
  return SUPPORTED_LOCALES.some((l) => l === value);
}

function fromAcceptLanguage(header: string | null): AppLocale | undefined {
  if (header === null) return undefined;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q === undefined ? 1 : Number(q.slice(2));
      return { base: tag.trim().toLowerCase().split("-")[0], weight: Number.isNaN(weight) ? 0 : weight };
    })
    .sort((a, b) => b.weight - a.weight);
  return ranked.map((r) => r.base).find(isLocale);
}

/**
 * Çalışma alanının dili (istek başına bir kez). Üyelik, izin, MFA ve RLS domain okumasında (`getWorkspaceLocale`); oturum yok, üye değil,
 * alan askıda ya da okuma hatası → undefined (sonraki kaynağa düşer; sayfa kendi erişim kararını ayrıca verir).
 */
const workspaceLocale = cache(async (slug: string): Promise<AppLocale | undefined> => {
  try {
    const requestHeaders = await headers();
    const { getAuthService } = await import("../lib/auth-service.ts");
    const principal = await getAuthService().getPrincipal(requestHeaders);
    if (principal === null) return undefined;
    const value = await getWorkspaceLocale({ db: getAppDb(), principal, tenantSlug: slug });
    return isLocale(value) ? value : undefined;
  } catch {
    return undefined;
  }
});

export async function resolveLocale(input: {
  readonly cookie: string | undefined;
  readonly workspace: () => Promise<AppLocale | undefined>;
  readonly acceptLanguage: string | null;
}): Promise<AppLocale> {
  if (isLocale(input.cookie)) return input.cookie;
  return (await input.workspace()) ?? fromAcceptLanguage(input.acceptLanguage) ?? DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const requestHeaders = await headers();
  const slug = requestHeaders.get(TENANT_SLUG_HEADER);
  const locale = await resolveLocale({
    cookie: (await cookies()).get("locale")?.value,
    workspace: () => (slug === null ? Promise.resolve(undefined) : workspaceLocale(slug)),
    acceptLanguage: requestHeaders.get("accept-language"),
  });
  return { locale, messages: MESSAGES[locale], timeZone: DEFAULT_TIME_ZONE };
});
