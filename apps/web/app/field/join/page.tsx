import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { THEME_COOKIE } from "../../design/theme.ts";
import { appSurface } from "../../../lib/surface.ts";
import { JoinTeam } from "./flow.tsx";

// Ekibe katılma, personel telefonu (T-429, Ekip.dc.html; 0052): yöneticinin QR'ı bu adresi açar; katılma belirteci adresin `#` parçasındadır
// (sunucuya gelmez). Giris.dc.html kabuğu (`v.auth`) ile aynı görünüm. Panel yüzeyinde yok.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("fieldLogin");
  return { title: t("join1H"), referrer: "no-referrer", robots: { index: false, follow: false } };
}

export default async function JoinPage() {
  if (appSurface() === "panel") notFound();
  const dark = (await cookies()).get(THEME_COOKIE)?.value === "koyu";
  return <JoinTeam dark={dark} />;
}
