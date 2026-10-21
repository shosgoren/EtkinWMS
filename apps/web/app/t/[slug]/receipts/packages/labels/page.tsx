import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getPackageReceipt, getPackageProductionBatch } from "@wms/domain/operations";
import { AppError } from "@wms/shared/errors";
import { Banner } from "@wms/ui";
import { getAuthService } from "../../../../../../lib/auth-service.ts";
import { packageReceivingEnabled } from "../../../../../../lib/package-receiving-config.ts";
import { postedLabelPackages } from "./package-labels.ts";
import { PackageLabelPreview } from "./package-label-preview.tsx";
import { PackageLabelEkran } from "./package-label-ekran.tsx";
import { THEME_COOKIE } from "../../../../../design/theme.ts";

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
  // T-973 (B-63): LİSTE kalıbı kabı; Geri kabul belgesine (üretim partisinde Üretim'e) döner. Baskıda kalıp üst/alt çubuğu basılmaz (labels/print.css).
  const dark = (await cookies()).get(THEME_COOKIE)?.value === "koyu";
  const home = `/t/${encodeURIComponent(slug)}`;
  // Belge kimliği yalnız yetkili okuma başarılı olunca bağlantıya girer (yetkisiz ekranda belge verisi çizilmez, AC-04).
  let back = `${home}/receipts`;
  const shell = (child: React.ReactNode) => <PackageLabelEkran dark={dark} back={back}>{child}</PackageLabelEkran>;
  try {
    // This query owns stock.view, tenant isolation and warehouse ACL. No client status input.
    const access = { db: getAppDb(), principal, tenantSlug: slug };
    try {
      const receipt = await getPackageReceipt(access, { documentId });
      const packages = postedLabelPackages(receipt);
      back = `${home}/receipts/packages?${new URLSearchParams({ document: receipt.documentId })}`;
      return shell(<PackageLabelPreview key={receipt.documentId} packages={packages} />);
    } catch (error) {
      // Source is resolved by authorized server document ownership, never a query discriminator.
      if (!(error instanceof AppError) || error.code !== "NOT_FOUND") throw error;
    }
    const batch = await getPackageProductionBatch(access, { documentId });
    if (batch.documentStatus !== "POSTED") throw new AppError("FORBIDDEN");
    back = `${home}/production`;
    if (batch.packages.length === 0 || batch.packages.length > 200) throw new AppError("VALIDATION_FAILED");
    // Only immutable output package metadata crosses the shared label renderer boundary.
    return shell(<PackageLabelPreview key={batch.documentId} packages={batch.packages.map(p => ({id:p.id,qr:p.qr,packageNo:p.packageNo,kind:p.kind,itemCode:p.itemCode,itemName:p.itemName,
      quantity:p.quantity,unitCode:p.unitCode,stockStatus:p.stockStatus,lotCode:p.lotCode,producedOn:p.producedOn,expiresOn:p.expiresOn}))} />);
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND" || e.code === "VALIDATION_FAILED") notFound();
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "FORBIDDEN") return shell(<Banner kind="warning">{(await getTranslations("packageReceiving.labelPreview"))("stockViewRequired")}</Banner>);
    }
    throw e;
  }
}
