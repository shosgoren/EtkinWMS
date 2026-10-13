import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAppDb } from "@wms/db";
import { getPackageReceipt } from "@wms/domain/operations";
import { AppError } from "@wms/shared/errors";
import { Banner } from "@wms/ui";
import { getAuthService } from "../../../../../../lib/auth-service.ts";
import { packageReceivingEnabled } from "../../../../../../lib/package-receiving-config.ts";
import { postedLabelPackages } from "./package-labels.ts";
import { PackageLabelPreview } from "./package-label-preview.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Paket etiketleri" };
export default async function PackageLabelsPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!packageReceivingEnabled()) notFound();
  const { slug } = await params;
  const documentId = (await searchParams).document;
  if (typeof documentId !== "string") notFound();
  const returnTo = `/t/${encodeURIComponent(slug)}/receipts/packages/labels?${new URLSearchParams({ document: documentId })}`;
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  const shell = (child: React.ReactNode) => <main className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4 px-4 py-6"><h1 className="text-2xl font-extrabold">Paket etiketleri</h1>{child}</main>;
  try {
    // This query owns stock.view, tenant isolation and warehouse ACL. No client status input.
    const receipt = await getPackageReceipt({ db: getAppDb(), principal, tenantSlug: slug }, { documentId });
    const packages = postedLabelPackages(receipt);
    return shell(<PackageLabelPreview key={receipt.documentId} packages={packages} />);
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND" || e.code === "VALIDATION_FAILED") notFound();
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "FORBIDDEN") return shell(<Banner kind="warning">Etiket için işlenmiş kabul ve bu depoda stok görüntüleme yetkisi gerekir.</Banner>);
    }
    throw e;
  }
}
