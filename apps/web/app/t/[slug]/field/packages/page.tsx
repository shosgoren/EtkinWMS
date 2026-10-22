import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { getCurrentPackage } from "@wms/domain/operations";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { hasPermission } from "@wms/domain/identity/permissions";
import { AppError } from "@wms/shared/errors";
import { packageReceivingEnabled } from "../../../../../lib/package-receiving-config.ts";
import { LICON } from "../../../../design/kalip-icons.ts";
import { temaKoyu } from "../../../../design/theme.ts";
import { KalipHataEkran, KalipKilitliEkran } from "../../kalip/liste.tsx";
import { PackageMovementFlow } from "./package-flow.tsx";

export const dynamic = "force-dynamic";

export default async function PackageMovementPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ package?: string | string[] }>;
}) {
  if (!packageReceivingEnabled()) notFound();
  const { slug } = await params;
  const raw = (await searchParams).package;
  const packageId = Array.isArray(raw) ? raw[0] : raw;
  if (packageId !== undefined && !z.string().uuid().safeParse(packageId).success) notFound();
  const base = `/t/${encodeURIComponent(slug)}/field/packages`;
  const returnTo = packageId ? `${base}?${new URLSearchParams({ package: packageId })}` : base;
  const { getAuthService } = await import("../../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (!principal) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  const db = getAppDb();
  const member = (await getMembershipSummary({ db, principal })).memberships.find(m => m.slug === slug);
  if (!member) notFound();
  const t = await getTranslations("packageMovement");
  // T-973: kilitli / yükleme hatası ekranları liste kalıbında (tema çerezi; Geri: Saha).
  const dark = temaKoyu(await cookies());
  const icon = { d: LICON.koli, color: "0E7C7B" };
  const field = `/t/${encodeURIComponent(slug)}/field`;
  if (!hasPermission(member.roles, "stock.view", member.grants)) return <KalipKilitliEkran title={t("title")} icon={icon} text={t("locked")} hint={t("lockedHint")} dark={dark} home={field} />;
  let initial = null;
  try {
    // Read-only GET uses domain authorization, never the POST Origin guard.
    if (packageId) initial = await getCurrentPackage({ db, principal, tenantSlug: slug }, { packageId });
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
    if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);
    return <KalipHataEkran title={t("title")} icon={icon} text={`${t("loadError")} (${e.code})`} hint={t("loadHint")} dark={dark} back={field} />;
  }
  return <PackageMovementFlow key={packageId ?? "scan"} slug={slug} initial={initial} />;
}
