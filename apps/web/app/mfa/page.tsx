import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { MfaNotice, MfaSetupForm } from "../auth-forms.tsx";
import { THEME_COOKIE } from "../design/theme.ts";
import { MfaVerify } from "../login/flow.tsx";
import { safeNext } from "../../lib/safe-redirect.ts";
import { appSurface } from "../../lib/surface.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { referrer: "no-referrer" };

const TWO_FACTOR_COOKIE = /^(?:__Secure-)?better-auth\.two_factor$/;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

// Mod sunucuda belirlenir: oturum var → kurulum (zorunlu rolde MFA_REQUIRED sonrası buraya gelinir, A-38/M5);
// oturum yok ama geçici 2FA çerezi var → giriş ikinci adımı; hiçbiri yok → giriş.
export default async function MfaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const next = safeNext(first((await searchParams).next));
  const { getAuthService } = await import("../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());

  if (principal === null) {
    const jar = await cookies();
    const pending = jar.getAll().some((c) => TWO_FACTOR_COOKIE.test(c.name) && c.value !== "");
    if (!pending) redirect(`/login?next=${encodeURIComponent(next)}`);
    // T-999b: Giris.dc.html `v.mfa` birebir (login/flow.tsx).
    // T-923 (inceleme M3): panel yüzeyinde "Bu cihazı 30 gün hatırla" yok (sunucu da reddeder).
    return <MfaVerify dark={jar.get(THEME_COOKIE)?.value === "koyu"} next={next} trustOption={appSurface() !== "panel"} />;
  }
  // Karar sunucuda, `principal` alanlarıyla (tek kaynak: @wms/auth `isDemoEmail`).
  if (principal.isDemo) return <MfaNotice kind="demo" next={next} />; // M9
  if (principal.mfaVerified || principal.twoFactorEnabled) return <MfaNotice kind="enabled" next={next} />;
  return <MfaSetupForm next={next} />;
}
