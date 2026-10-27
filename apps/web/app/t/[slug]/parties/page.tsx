import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { listParties } from "@wms/domain/catalog/parties";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { hasPermission } from "@wms/domain/identity/permissions";
import { AppError } from "@wms/shared/errors";
import { temaKoyu } from "../../../design/theme.ts";
import { PARTIES_PAGE_SIZE } from "./list-page.ts";
import { PartiesView } from "./parties-view.tsx";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("parties");
  return { title: t("title") };
}

// T-428: cari kartlar listesi. Okuma `stock.view`, düzenleme `settings.manage` (eylemde de denetlenir). Arama sunucuda (`?q=`).
export default async function PartiesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string; arsiv?: string }> }) {
  const { slug } = await params;
  const sp: { q?: string; arsiv?: string } = (await searchParams) ?? {};
  const returnTo = `/t/${encodeURIComponent(slug)}/parties`;
  const { getAuthService } = await import("../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const archived = sp.arsiv === "1";
  let canEdit = false;
  let data: Awaited<ReturnType<typeof listParties>>;
  try {
    const summary = await getMembershipSummary({ db: getAppDb(), principal });
    const current = summary.memberships.find((m) => m.slug === slug);
    if (current === undefined) notFound();
    canEdit = hasPermission(current.roles, "settings.manage", current.grants);
    data = await listParties({ db: getAppDb(), principal, tenantSlug: slug }, { q, archived, limit: PARTIES_PAGE_SIZE });
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "NOT_FOUND") notFound();
    }
    throw e;
  }
  const jar = await cookies();
  return (
    <main className="flex w-full min-w-0 flex-col">
      <PartiesView slug={slug} dark={temaKoyu(jar)} canEdit={canEdit} q={q} archived={archived} items={data.items} total={data.total} nextCursor={data.nextCursor} />
    </main>
  );
}
