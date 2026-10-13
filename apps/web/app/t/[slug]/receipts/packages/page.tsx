import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { hasPermission } from "@wms/domain/identity/permissions";
import { packageReceivingEnabled } from "../../../../../lib/package-receiving-config.ts";
import { getPackageReceiptAction } from "./actions.ts";
import { PackageFlow } from "./package-flow.tsx";

export const dynamic = "force-dynamic";
export default async function PackageReceivingPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ document?: string | string[] }>;
}) {
  if (!packageReceivingEnabled()) notFound();
  const { slug } = await params;
  const sp = await searchParams;
  const documentId = Array.isArray(sp.document) ? sp.document[0] : sp.document;
  const base = `/t/${encodeURIComponent(slug)}/receipts/packages`;
  const { getAuthService } = await import("../../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(base)}`);
  const summary = await getMembershipSummary({ db: getAppDb(), principal });
  const member = summary.memberships.find(m => m.slug === slug);
  if (member === undefined) notFound();
  const t = await getTranslations("packageReceiving");
  const canView = hasPermission(member.roles, "stock.view");
  const canWrite = canView && hasPermission(member.roles, "document.create") && hasPermission(member.roles, "stock.post");
  if (!canView || (!documentId && !canWrite)) return <main className="p-4"><h1>{t("title")}</h1><p role="alert">🔒 {t("locked")}</p></main>;
  const result = documentId ? await getPackageReceiptAction({ slug, documentId }) : null;
  if (result !== null && !result.ok) {
    if (result.error.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(`${base}?document=${documentId ?? ""}`)}`);
    return <main className="p-4"><h1>{t("title")}</h1><p role="alert">⚠ {t("loadError")} ({result.error.code})</p></main>;
  }
  return <PackageFlow key={documentId ?? "new"} slug={slug} canWrite={canWrite} initial={result?.ok ? result.data : null} />;
}
