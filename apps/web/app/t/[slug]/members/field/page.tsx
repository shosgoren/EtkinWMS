import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { listFieldLogins } from "@wms/domain/identity/field-users";
import { getMembershipSummary, listMembers } from "@wms/domain/identity/member-queries";
import { listWarehouses } from "@wms/domain/warehouse";
import { AppError } from "@wms/shared/errors";
import { temaKoyu } from "../../../../design/theme.ts";
import { FieldStaffView } from "./view.tsx";

// Saha personeli ekle (T-997, ADR-026 §7.1; T-971 form kalıbı, view.tsx). Yalnız `users.manage`.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("fieldStaff");
  return { title: t("title"), referrer: "no-referrer" };
}

export default async function FieldStaffPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const returnTo = `/t/${slug}/members/field`;
  const { getAuthService } = await import("../../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  const db = getAppDb();
  try {
    // Yetki kararı sunucuda: saha giriş listesi `users.manage` ister (değilse 404).
    await listFieldLogins({ db, principal, tenantSlug: slug });
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND" || (e.code === "FORBIDDEN" && e.detail === undefined)) notFound();
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
    }
    throw e;
  }
  const [warehouses, summary, members] = await Promise.all([
    listWarehouses({ db, principal, tenantSlug: slug }),
    getMembershipSummary({ db, principal }),
    listMembers({ db, principal, tenantSlug: slug }, { demoEmailDomain: process.env.DEMO_EMAIL_DOMAIN?.trim().toLowerCase() || null }),
  ]);
  const staff = members.flatMap((m) =>
    m.field === undefined
      ? []
      : [{ membershipId: m.membershipId, name: m.displayName, username: m.field.username, role: m.roles[0] ?? "", active: m.field.active, locked: m.field.locked }],
  );
  const tenantName = summary.memberships.find((m) => m.slug === slug)?.tenantName ?? slug;
  const dark = temaKoyu(await cookies());
  let host = (await headers()).get("host") ?? "wms.etkinyazilim.com";
  try {
    const configured = process.env.BETTER_AUTH_URL?.trim();
    if (configured) host = new URL(configured).host;
  } catch {
    // biçimsiz yapılandırma: istek kökü kalır
  }
  return (
    <main className="flex w-full min-w-0 flex-col">
      <FieldStaffView
        dark={dark}
        slug={slug}
        host={host}
        tenantName={tenantName}
        warehouses={warehouses.items.map((w) => ({ id: w.id, name: w.name }))}
        staff={staff}
      />
    </main>
  );
}
