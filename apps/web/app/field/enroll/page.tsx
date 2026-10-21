import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { temaKoyu } from "../../design/theme.ts";
import { appSurface } from "../../../lib/surface.ts";
import { EnrollDevice } from "./flow.tsx";

// Ortak cihaz kaydı, terminal tarafı (T-998, ADR-026 §7.5): yöneticinin QR'ı bu adresi açar; kayıt belirteci adresin `#` parçasındadır
// (sunucuya gelmez). Giris.dc.html `v.enr` birebir (flow.tsx). Panel yüzeyinde yok.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("fieldLogin");
  return { title: t("enr1H"), referrer: "no-referrer", robots: { index: false, follow: false } };
}

export default async function EnrollPage() {
  if (appSurface() === "panel") notFound();
  const dark = temaKoyu(await cookies());
  return <EnrollDevice dark={dark} />;
}
