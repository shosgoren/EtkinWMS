import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAppDb } from "@wms/db";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { hasPermission } from "@wms/domain/identity/permissions";
import { OkutView } from "./okut-view.tsx";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("saha.okut");
  return { title: t("title") };
}

// T-969 (B-86): OKUT doğrudan okutma ekranıdır (KalipSaha.dc.html (a)). Eski iş seçme menüsü (Kabul / Yerleştirme / Toplama kartları)
// kaldırıldı: okutulan kod işi kendisi bulur (field/actions.ts → domain `resolveFieldScan`). Görev listesi Pano'da ve /field/tasks'tadır.
// `stock.post` yoksa okuma görünümü: kod çözülür ve okuma ekranına gidilir; yazma ekranları kilitli, gerekçe görünür.
export default async function FieldScanPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { getAuthService } = await import("../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(`/t/${slug}/field`)}`);
  const summary = await getMembershipSummary({ db: getAppDb(), principal });
  const mine = summary.memberships.find((m) => m.slug === slug);
  if (mine === undefined) notFound();
  const canPost = hasPermission(mine.roles, "stock.post", mine.grants);
  return <OkutView slug={slug} canPost={canPost} tenantName={mine.tenantName} />;
}
