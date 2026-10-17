import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { THEME_COOKIE } from "../design/theme.ts";
import { appSurface } from "../../lib/surface.ts";
import { WorkspacePicker } from "./view.tsx";

// Çalışma alanı seçici (T-999, ADR-026 §6): yalnız oturumlu kullanıcının kendi AKTİF ve erişilebilir üyelikleri (`getMembershipSummary`;
// askıda/kapanan alan ve pasif üyelik listede yoktur). Girişten önce kiracı keşfi yok; seçilen `/t/<alan>` üyeliği yeniden doğrular.
// Giris.dc.html `v.pick` birebir (view.tsx). Panel yüzeyinde yok.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("workspaces");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function WorkspacesPage() {
  if (appSurface() === "panel") notFound();
  const { getAuthService } = await import("../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect("/login?next=%2Fworkspaces");
  const summary = await getMembershipSummary({ db: getAppDb(), principal });
  if (summary.memberships.length === 0) redirect("/onboarding");
  const t = await getTranslations("roles");
  const dark = (await cookies()).get(THEME_COOKIE)?.value === "koyu";
  // Gösterilen adres yapılandırılmış uygulama kökünden (istek Host başlığına güvenilmez); tanımsız/biçimsizse ürün adresi.
  let host = "wms.etkinyazilim.com";
  try {
    const configured = process.env.BETTER_AUTH_URL?.trim();
    if (configured) host = new URL(configured).host;
  } catch {
    // biçimsiz yapılandırma: ürün adresi kalır
  }
  const rows = summary.memberships.map((m) => ({
    slug: m.slug,
    name: m.tenantName,
    roles: m.roles.map((r) => t(r)).join(", "),
    last: m.slug === summary.lastSlug,
  }));
  return <WorkspacePicker dark={dark} host={host} rows={rows} />;
}
