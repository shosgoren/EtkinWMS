import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { listDevices, listSuspendedDevices } from "@wms/domain/identity/devices";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { AppError } from "@wms/shared/errors";
import { THEME_COOKIE } from "../../../../design/theme.ts";
import { DevicesView } from "./view.tsx";

// Saha cihazları (T-998, ADR-026 §7.5): Giris.dc.html `v.mgr` bandı + `v.dev` birebir (view.tsx). Yalnız `users.manage`.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("fieldDevices");
  return { title: t("title"), referrer: "no-referrer" };
}

export default async function DevicesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const returnTo = `/t/${slug}/members/devices`;
  const { getAuthService } = await import("../../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  const db = getAppDb();
  let devices: Awaited<ReturnType<typeof listDevices>>;
  try {
    devices = await listDevices({ db, principal, tenantSlug: slug });
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND" || (e.code === "FORBIDDEN" && e.detail === undefined)) notFound();
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
    }
    throw e;
  }
  const [summary, suspended] = await Promise.all([getMembershipSummary({ db, principal }), listSuspendedDevices({ db, principal, tenantSlug: slug })]);
  const tenantName = summary.memberships.find((m) => m.slug === slug)?.tenantName ?? slug;
  const dark = (await cookies()).get(THEME_COOKIE)?.value === "koyu";
  return (
    <DevicesView
      dark={dark}
      slug={slug}
      tenantName={tenantName}
      suspended={suspended.map((d) => ({ id: d.id, name: d.name }))}
      devices={devices.map((d) => ({ id: d.id, kind: d.kind, name: d.name, owner: d.owner, lastUsedAt: d.lastUsedAt.toISOString() }))}
    />
  );
}
