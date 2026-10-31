import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { listGroups } from "@wms/domain/identity/groups";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { hasPermission } from "@wms/domain/identity/permissions";
import { AppError } from "@wms/shared/errors";
import { LICON } from "../../../design/kalip-icons.ts";
import { temaKoyu } from "../../../design/theme.ts";
import { KalipKilitliEkran } from "../kalip/liste.tsx";
import { yetkiKatalogu } from "./katalog-sunucu.ts";
import { YetkilerView } from "./yetkiler-view.tsx";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("yetkiler");
  return { title: t("title") };
}

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

// T-1142 (kullanıcı kararı 31 Ekim: "kullanıcı yetkilendirme bölümü pratik ve akıcı olmalı, tüm yetkiler toggle ile"): Ayarlar › Kullanıcılar
// ve yetki › Yetkiler (STANDART §5 ayar kalıbı). Okuma `users.manage` (listGroups); yazma yalnız hesap sahibi (domain `changeGroupGrants`,
// `setMemberGroup`, `changeRole`; `canEdit` yalnız gösterim). Katalog domain tek kaynağından (`yetkiKatalogu`), istemci domain içe aktarmaz.
export default async function YetkilerPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const query = await searchParams;
  const returnTo = `/t/${encodeURIComponent(slug)}/yetkiler`;
  const { getAuthService } = await import("../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  const t = await getTranslations("yetkiler");
  const home = `/t/${encodeURIComponent(slug)}`;
  let data: Awaited<ReturnType<typeof listGroups>> | null = null;
  try {
    const summary = await getMembershipSummary({ db: getAppDb(), principal });
    const current = summary.memberships.find((m) => m.slug === slug);
    if (current === undefined) notFound();
    if (hasPermission(current.roles, "users.manage", current.grants)) data = await listGroups({ db: getAppDb(), principal, tenantSlug: slug });
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "NOT_FOUND") notFound();
    }
    throw e;
  }
  const dark = temaKoyu(await cookies());
  if (data === null) {
    return (
      <main className="flex w-full min-w-0 flex-col">
        <KalipKilitliEkran title={t("title")} icon={{ d: LICON.shield, color: "6C4BD8" }} text={t("locked")} hint={t("lockedAction")} dark={dark} home={home} backLabel={t("backHome")} />
      </main>
    );
  }
  return (
    <main className="flex w-full min-w-0 flex-col">
      <YetkilerView
        slug={slug}
        dark={dark}
        katalog={yetkiKatalogu()}
        bolum={first(query.bolum) ?? null}
        kisi={first(query.kisi) ?? null}
        data={{
          canEdit: data.canEdit,
          groups: data.groups.filter((g) => !g.archived).map((g) => ({ id: g.id, name: g.name, color: g.color, grants: g.grants, version: g.version })),
          members: data.members.map((m) => ({ membershipId: m.membershipId, name: m.name, isOwner: m.isOwner, isField: m.isField, role: m.roles[0] ?? "READ_ONLY", roles: [...m.roles], groupId: m.groupId })),
        }}
      />
    </main>
  );
}
