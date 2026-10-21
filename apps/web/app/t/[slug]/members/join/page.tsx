import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { getJoinOverview } from "@wms/domain/identity/team-join";
import { AppError } from "@wms/shared/errors";
import { temaKoyu } from "../../../../design/theme.ts";
import { JoinView } from "./view.tsx";

// Ekibe katılma, yönetici tarafı (T-429, Ekip.dc.html "Onay bekliyor"; T-971 liste kalıbı, view.tsx).
// Yalnız `users.manage`. Doğrulama kodu ve belirteç özetleri bu sayfaya hiç gelmez (uygulama rolü okuyamaz).
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("teamJoin");
  return { title: t("title"), referrer: "no-referrer" };
}

export default async function JoinRequestsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const returnTo = `/t/${slug}/members/join`;
  const { getAuthService } = await import("../../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  const db = getAppDb();
  let overview: Awaited<ReturnType<typeof getJoinOverview>>;
  try {
    overview = await getJoinOverview({ db, principal, tenantSlug: slug });
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND" || (e.code === "FORBIDDEN" && e.detail === undefined)) notFound();
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
    }
    throw e;
  }
  const summary = await getMembershipSummary({ db, principal });
  const tenantName = summary.memberships.find((m) => m.slug === slug)?.tenantName ?? slug;
  const dark = temaKoyu(await cookies());
  return (
    <main className="flex w-full min-w-0 flex-col">
      <JoinView
        dark={dark}
        slug={slug}
        tenantName={tenantName}
        isDemo={overview.isDemo}
        link={overview.link === null ? null : { expiresAt: overview.link.expiresAt.toISOString() }}
        approved={overview.approvedWaiting.map((a) => ({ id: a.id, name: a.name, username: a.username, decidedAt: a.decidedAt.toISOString() }))}
        pending={overview.pending.map((p) => ({ id: p.id, name: p.name, username: p.username, deviceHint: p.deviceHint, createdAt: p.createdAt.toISOString(), wrongTries: p.wrongTries }))}
      />
    </main>
  );
}
