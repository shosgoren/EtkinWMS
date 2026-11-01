import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getParty } from "@wms/domain/catalog/parties";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { cardRights } from "@wms/domain/identity/permissions";
import { getSourceLock } from "@wms/domain/integrations";
import { AppError } from "@wms/shared/errors";
import { temaKoyu } from "../../../../design/theme.ts";
import { PartyCard } from "./party-card.tsx";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("parties.kart");
  return { title: t("title") };
}

// T-1090: cari kartı (sunucu bileşeni). Üye değil, başka tenant, bilinmeyen ya da geçersiz kimlik → 404 (varlık sızdırılmaz).
// Okuma `stock.view`; düzenleme yetkisi yalnız gösterim içindir (kaydetme eyleminde `settings.manage` denetlenir).
export default async function PartyCardPage({ params }: { params: Promise<{ slug: string; partyId: string }> }) {
  const { slug, partyId } = await params;
  const { getAuthService } = await import("../../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  const returnTo = `/t/${encodeURIComponent(slug)}/parties/${encodeURIComponent(partyId)}`;
  if (principal === null) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  if (!UUID_RE.test(partyId)) notFound();
  const db = getAppDb();
  try {
    const summary = await getMembershipSummary({ db, principal });
    const current = summary.memberships.find((m) => m.slug === slug);
    if (current === undefined) notFound();
    const rights = cardRights(current.roles, current.grants, "parties");
    const party = await getParty({ db, principal, tenantSlug: slug }, partyId);
    // T-1201: "Paraşüt'ten al" bölümünde bağlı carinin kaynak kilidi (yalnız gösterim; karar domain komutunda).
    const kaynak = await getSourceLock({ db, principal, tenantSlug: slug }, "PARTY", party.id);
    return (
      <main className="flex w-full min-w-0 flex-col">
        <PartyCard slug={slug} dark={temaKoyu(await cookies())} rights={rights} kaynak={kaynak} party={party} />
      </main>
    );
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND" || e.code === "VALIDATION_FAILED") notFound();
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
    }
    throw e;
  }
}
