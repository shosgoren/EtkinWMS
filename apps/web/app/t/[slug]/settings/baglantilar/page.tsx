import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { hasPermission } from "@wms/domain/identity/permissions";
import { AppError } from "@wms/shared/errors";
import { THEME_COOKIE } from "../../../../design/theme.ts";
import { BaglantilarView } from "./baglantilar-view.tsx";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("baglantilar");
  return { title: t("title") };
}

// T-981b: Ayarlar › Bağlantılar — alan (Ürünler, Cariler, Depolar, Raflar, Açılış stoku) + işlem (İçeri al / Güncelle / Dışarı aktar) seçimiyle
// toplu Excel işlemi, boş şablon indirme ve Entegrasyonlar yer tutucusu (Paraşüt, Logo: YAKINDA; bağlantı yok). Yetki gösterimdir: aktarım
// `data.import`, depo/raf ayrıca `settings.manage`; asıl karar Aktar eylemlerinde ve `/api/t/<alan>/export/<tür>`'de.
export default async function BaglantilarPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const returnTo = `/t/${encodeURIComponent(slug)}/settings/baglantilar`;
  const { getAuthService } = await import("../../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  let data = false;
  let master = false;
  let erp = false;
  try {
    const summary = await getMembershipSummary({ db: getAppDb(), principal });
    const current = summary.memberships.find((m) => m.slug === slug);
    if (current === undefined) notFound();
    data = hasPermission(current.roles, "data.import", current.grants);
    erp = hasPermission(current.roles, "settings.manage", current.grants);
    master = data && erp;
  } catch (e) {
    if (e instanceof AppError && e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
    throw e;
  }
  const dark = (await cookies()).get(THEME_COOKIE)?.value === "koyu";
  return <BaglantilarView slug={slug} dark={dark} canData={data} canMaster={master} erp={erp} />;
}
