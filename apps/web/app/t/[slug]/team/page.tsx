import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { listGroups } from "@wms/domain/identity/groups";
import { getJoinOverview } from "@wms/domain/identity/team-join";
import { AppError } from "@wms/shared/errors";
import { THEME_COOKIE } from "../../../design/theme.ts";
import { TeamView } from "./team-view.tsx";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ekip");
  return { title: t("title"), referrer: "no-referrer" };
}

// T-430 (Ekip.dc.html): kişiler, onay bekleyenler (QR ile katılma), e-posta daveti, katılma QR'ı. Yalnız `users.manage`; e-posta ve
// doğrulama kodu bu sayfaya gelmez. Ayrıntılı kişi yönetimi (rol, depo kapsamı, sıfırlama) mevcut Kullanıcılar ekranında.
export default async function TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const returnTo = `/t/${encodeURIComponent(slug)}/team`;
  const { getAuthService } = await import("../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  const db = getAppDb();
  let groups: Awaited<ReturnType<typeof listGroups>>;
  let join: Awaited<ReturnType<typeof getJoinOverview>>;
  try {
    groups = await listGroups({ db, principal, tenantSlug: slug });
    join = await getJoinOverview({ db, principal, tenantSlug: slug });
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND" || (e.code === "FORBIDDEN" && e.detail === undefined)) notFound();
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
    }
    throw e;
  }
  const dark = (await cookies()).get(THEME_COOKIE)?.value === "koyu";
  return (
    <main className="flex w-full min-w-0 flex-col">
      <TeamView
        slug={slug}
        dark={dark}
        canEditGroups={groups.canEdit}
        isDemo={join.isDemo}
        groups={groups.groups.filter((g) => !g.archived).map((g) => ({ id: g.id, name: g.name, color: g.color, sensitive: g.grants.some((x) => x !== "stock.post" && x !== "document.create") }))}
        people={groups.members.map((m) => ({ id: m.membershipId, name: m.name, isOwner: m.isOwner, isField: m.isField, role: m.roles[0] ?? "READ_ONLY", groupId: m.groupId }))}
        pending={join.pending.map((p) => ({ id: p.id, name: p.name, username: p.username, deviceHint: p.deviceHint, createdAt: p.createdAt.toISOString(), wrongTries: p.wrongTries }))}
        hasLink={join.link !== null}
      />
    </main>
  );
}
