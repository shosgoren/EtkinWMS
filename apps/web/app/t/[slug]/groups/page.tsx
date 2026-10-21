import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Banner } from "@wms/ui";
import { getAppDb } from "@wms/db";
import { listGroups } from "@wms/domain/identity/groups";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { hasPermission } from "@wms/domain/identity/permissions";
import { AppError } from "@wms/shared/errors";
import { temaKoyu } from "../../../design/theme.ts";
import { GroupsView } from "./groups-view.tsx";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("gruplar");
  return { title: t("title") };
}

// T-421: yetki grupları (Gruplar.dc.html). Okuma `users.manage`; yazma yalnız hesap sahibi (domain + eylem; `canEdit` yalnız gösterim).
export default async function GroupsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const returnTo = `/t/${encodeURIComponent(slug)}/groups`;
  const { getAuthService } = await import("../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  const t = await getTranslations("gruplar");
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
  if (data === null) {
    return (
      <main className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4 px-4 py-6">
        <h1 className="break-words text-2xl font-extrabold text-ink">{t("title")}</h1>
        <Banner kind="warning">
          <p>{t("locked")}</p>
          <p className="mt-1">{t("lockedAction")}</p>
        </Banner>
        <Link
          href={home}
          className="inline-flex min-h-12 min-w-12 items-center justify-center self-start rounded-control border-2 border-border-strong bg-surface px-6 text-base font-bold text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {t("backHome")}
        </Link>
      </main>
    );
  }
  const jar = await cookies();
  return (
    <main className="flex w-full min-w-0 flex-col">
      <h1 className="sr-only">{t("title")}</h1>
      <GroupsView slug={slug} dark={temaKoyu(jar)} data={data} />
    </main>
  );
}
