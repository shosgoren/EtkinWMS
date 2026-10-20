import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { isWellFormedInvitationToken, previewInvitation } from "@wms/domain/identity/invitations";
import { guardInvitePreview } from "../../../lib/invite-guard.ts";
import { createProductionLimiter } from "../../../lib/rate-limit.ts";
import { InviteAcceptForm } from "../../auth-forms.tsx";
import { THEME_COOKIE } from "../../design/theme.ts";
import { GirisBant, GirisBaslik, GirisKabuk } from "../../giris-ui.tsx";

export const dynamic = "force-dynamic";

// Belirteç yolda taşınır: Referer ile sızmaz (T-117 MINOR-5; `proxy.ts` aynı başlığı da ekler).
export const metadata: Metadata = { referrer: "no-referrer" };

// T-974 (B-63 grup B): Giris.dc.html `v.auth` kabuğu (giriş / MFA ile aynı); güvenlik akışı (biçim, hız sınırı, nötr metin) aynı.
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("auth");
  const dark = (await cookies()).get(THEME_COOKIE)?.value === "koyu";
  const notFound = (
    <GirisKabuk dark={dark} testId="invite">
      <GirisBaslik title={t("invite.title")} />
      <GirisBant kind="err" title={t("invite.errors.not_found")}>
        {t("invite.errors.not_foundAction")}
      </GirisBant>
    </GirisKabuk>
  );
  if (!isWellFormedInvitationToken(token)) return notFound;
  const requestHeaders = await headers();
  // Belirteç denemesi hız sınırı (T-127 IP sınırı; A-41). IP çözülemezse nötr metin (500 yok, belirteçli URL hata günlüğüne düşmez).
  const guard = await guardInvitePreview(requestHeaders, createProductionLimiter());
  if (guard === "unavailable") return notFound;
  if (guard === "rate_limited") {
    return (
      <GirisKabuk dark={dark} testId="invite">
        <GirisBaslik title={t("invite.title")} />
        <GirisBant kind="err">{t("invite.rateLimited")}</GirisBant>
      </GirisKabuk>
    );
  }
  const preview = await previewInvitation({ db: getAppDb(), token });
  // Yok/süresi dolmuş/iptal/kabul/askıda/demo: hepsi aynı nötr metin (varlık sızdırılmaz).
  if (preview === null) return notFound;
  const tRoot = await getTranslations();
  const hoursLeft = Math.ceil((preview.expiresAt.getTime() - Date.now()) / 3_600_000);
  const { getAuthService } = await import("../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(requestHeaders);
  return (
    <InviteAcceptForm
      token={token}
      signedIn={principal !== null}
      dark={dark}
      preview={
        <GirisBant kind="info">
          {t("invite.preview", { tenant: preview.tenantName, role: tRoot(`roles.${preview.roleKey}`) })}{" "}
          {hoursLeft <= 1 ? t("invite.expiresSoon") : t("invite.expiresInHours", { hours: hoursLeft })}
        </GirisBant>
      }
    />
  );
}
