// T-1001 (ALTIN-KURAL 6): kiracı ekranı yüklenirken iskelet (üst çubuk, arama, kartlar). İçeriğin kopyası DEĞİLDİR (T-965: tek render).
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { temaKoyu } from "../../design/theme.ts";

export default async function TenantLoading() {
  const dark = temaKoyu(await cookies());
  const t = await getTranslations("kural");
  return (
    <div className={`kisk${dark ? " dk" : ""}`} role="status" aria-live="polite" aria-busy="true" data-testid="iskelet">
      <span className="sr-only">{t("loading")}</span>
      <div className="kisk-in" aria-hidden="true">
        <div className="kisk-b kisk-top" />
        <div className="kisk-b kisk-ara" />
        <div className="kisk-b kisk-kart" />
        <div className="kisk-b kisk-kart" />
        <div className="kisk-b kisk-kart" />
      </div>
    </div>
  );
}
