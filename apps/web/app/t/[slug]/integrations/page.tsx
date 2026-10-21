import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getIntegrationOverview, type IntegrationOverview } from "@wms/domain/integrations";
import { AppError } from "@wms/shared/errors";
import { THEME_COOKIE } from "../../../design/theme.ts";
import { NICON } from "../../../design/entegrasyon-icons.ts";
import { KalipKilitliEkran } from "../kalip/liste.tsx";
import { IntegrationsView, type OverviewData } from "./integrations-view.tsx";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("integrations");
  return { title: t("title") };
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

/** İstemciye giden veri: tarih metin; sır yok (domain okuması `credentials` sütununu seçmez). */
function serialize(o: IntegrationOverview): OverviewData {
  return {
    demo: o.demo,
    outbox: o.outbox,
    providers: o.providers.map((p) => ({
      provider: p.provider,
      available: p.available,
      connection: p.connection === null ? null : { status: p.connection.status, label: p.connection.label, lastCheckedAt: iso(p.connection.lastCheckedAt), lastErrorCode: p.connection.lastErrorCode },
      flows: p.flows.map((f) => ({ flow: f.flow, directions: [...f.directions], enabled: f.enabled, direction: f.direction, lastRunAt: iso(f.lastRunAt), lastStatus: f.lastStatus, errorCount: f.errorCount, lastErrorCode: f.lastErrorCode })),
    })),
    runs: o.runs.map((r) => ({ id: r.id, flow: r.flow, trigger: r.trigger, status: r.status, startedAt: r.startedAt.toISOString(), created: r.created, updated: r.updated, linked: r.linked, skipped: r.skipped, failed: r.failed, errorCode: r.errorCode })),
  };
}

// T-991: ERP entegrasyonu (Paraşüt; Logo yakında). Yalnız hesap sahibi (`settings.manage`); diğer rollerde kilitli tam ekran. Ayarlar >
// Bağlantılar'daki Paraşüt / Logo kartları (T-981) bu adrese bağlanır.
export default async function IntegrationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const self = `/t/${encodeURIComponent(slug)}/integrations`;
  const { getAuthService } = await import("../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(self)}`);
  const t = await getTranslations("integrations");
  const dark = (await cookies()).get(THEME_COOKIE)?.value === "koyu";
  let overview: IntegrationOverview;
  try {
    overview = await getIntegrationOverview({ db: getAppDb(), principal, tenantSlug: slug });
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    if (e.code === "NOT_FOUND") notFound();
    if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(self)}`);
    if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(self)}`);
    if (e.code !== "FORBIDDEN") throw e;
    return <KalipKilitliEkran title={t("title")} icon={{ d: NICON.plug, color: "2F5DA8" }} text={t("locked")} hint={t("lockedHint")} dark={dark} home={`/t/${encodeURIComponent(slug)}`} />;
  }
  return <IntegrationsView slug={slug} dark={dark} data={serialize(overview)} />;
}
