import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getPackageReceipt } from "@wms/domain/operations";
import { AppError } from "@wms/shared/errors";
import { z } from "zod";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { hasPermission } from "@wms/domain/identity/permissions";
import { packageReceivingEnabled } from "../../../../../lib/package-receiving-config.ts";
import { THEME_COOKIE } from "../../../../design/theme.ts";
import { PackageFlow } from "./package-flow.tsx";

export const dynamic = "force-dynamic";
export default async function PackageReceivingPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ document?: string | string[] }>;
}) {
  if (!packageReceivingEnabled()) notFound();
  const { slug } = await params;
  const sp = await searchParams;
  const documentId = Array.isArray(sp.document) ? sp.document[0] : sp.document;
  if (documentId !== undefined && !z.string().uuid().safeParse(documentId).success) notFound();
  const base = `/t/${encodeURIComponent(slug)}/receipts/packages`;
  const returnTo = documentId ? `${base}?${new URLSearchParams({ document: documentId })}` : base;
  const { getAuthService } = await import("../../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  const db = getAppDb();
  const summary = await getMembershipSummary({ db, principal });
  const member = summary.memberships.find(m => m.slug === slug);
  if (member === undefined) notFound();
  const t = await getTranslations("packageReceiving");
  const canView = hasPermission(member.roles, "stock.view", member.grants);
  const canWrite = canView && hasPermission(member.roles, "document.create", member.grants) && hasPermission(member.roles, "stock.post", member.grants);
  if (!canView || (!documentId && !canWrite)) return <main className="p-4"><h1>{t("title")}</h1><p role="alert">🔒 {t("locked")}</p></main>;
  let initial = null;
  try {
    // Server GET reads use domain authorization; the client action still requires Origin.
    if (documentId) initial = await getPackageReceipt({ db, principal, tenantSlug: slug }, { documentId });
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
    if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);
    return <main className="p-4"><h1>{t("title")}</h1><p role="alert">⚠ {t("loadError")} ({e.code})</p></main>;
  }
  // T-973: kalıp kabının teması (kullanıcı tema çerezi; Pano / Ayarlar ile aynı).
  const dark = (await cookies()).get(THEME_COOKIE)?.value === "koyu";
  return <PackageFlow key={documentId ?? "new"} slug={slug} canWrite={canWrite} initial={initial} dark={dark} />;
}
