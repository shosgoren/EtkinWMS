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
import { GroupsView } from "./groups-view.tsx";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("gruplar");
  return { title: t("title") };
}

// T-421: yetki grupları (Gruplar.dc.html). Okuma `users.manage`; yazma yalnız hesap sahibi (domain + eylem; `canEdit` yalnız gösterim).
export default async function GroupsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  // T-1142: Yetkiler ekranının ana işlemi (GRUP EKLE) `?new=1` ile yeni grup adımını doğrudan açar.
  const yeni = (await searchParams)?.new === "1";
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
    // T-1121: kilitli durum ortak kalıp kilitli ekranıdır (eski Banner + Tailwind bağlantı düğmesi yerine); Geri ana ekrana döner.
    return (
      <main className="flex w-full min-w-0 flex-col">
        <KalipKilitliEkran title={t("title")} icon={{ d: LICON.shield, color: "6C4BD8" }} text={t("locked")} hint={t("lockedAction")} dark={temaKoyu(await cookies())} home={home} backLabel={t("backHome")} />
      </main>
    );
  }
  const jar = await cookies();
  return (
    <main className="flex w-full min-w-0 flex-col">
      <h1 className="sr-only">{t("title")}</h1>
      <GroupsView slug={slug} dark={temaKoyu(jar)} data={data} openNew={yeni} />
    </main>
  );
}
