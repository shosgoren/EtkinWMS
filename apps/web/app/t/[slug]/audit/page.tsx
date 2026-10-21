import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Banner, tarih } from "@wms/ui";
import { AUDIT_ACTIONS, getAppDb } from "@wms/db";
import { listAudit, type AuditFilters, type AuditPage } from "@wms/domain/audit/audit-query";
import { AppError } from "@wms/shared/errors";
import { LICON } from "../../../design/kalip-icons.ts";
import { temaKoyu } from "../../../design/theme.ts";
import { KalipKilitliEkran } from "../kalip/liste.tsx";
import { AuditView } from "./audit-view.tsx";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auditLog");
  return { title: t("title") };
}

const SHOWN = ["forbidden", "recent_auth_required", "rate_limited", "validation_failed", "internal"] as const;
function first(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s === undefined || s === "" ? undefined : s;
}

// Denetim kaydı (T-126; T-971 liste kalıbı, audit-view.tsx): `audit.view`; yetki kararı sunucudadır (listAudit). Yetkisiz kullanıcı kilitli
// ekran (KalipKilitliEkran) görür, veri görmez.
export default async function AuditPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const query = await searchParams;
  const here = `/t/${encodeURIComponent(slug)}/audit`;
  const { getAuthService } = await import("../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(here)}`);
  const t = await getTranslations("auditLog");
  const ts = await getTranslations("serverErrors");
  const locale = await getLocale(); // T-1001 (ALTIN-KURAL 16): kullanıcının dili

  const filters: { from?: string; to?: string; action?: string; q?: string } = {};
  for (const k of ["from", "to", "action", "q"] as const) {
    const v = first(query[k]);
    if (v !== undefined) filters[k] = v;
  }
  const cursor = first(query.cursor);

  let page: AuditPage | null = null;
  let errorCode: string | undefined = SHOWN.find((c) => c === first(query.error));
  let locked = false;
  try {
    page = await listAudit({ db: getAppDb(), principal, tenantSlug: slug }, { filters: filters as AuditFilters, ...(cursor === undefined ? {} : { cursor }) });
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    if (e.code === "NOT_FOUND") notFound();
    if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(here)}`);
    if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(here)}`);
    if (e.code === "FORBIDDEN") locked = true;
    else if (e.code === "VALIDATION_FAILED") errorCode = "validation_failed";
    else throw e;
  }

  const qs = (extra: Record<string, string | undefined>): string => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, ...extra })) if (v !== undefined) p.set(k, v);
    const s = p.toString();
    return s === "" ? "" : `?${s}`;
  };
  const exportHref = `/api/t/${encodeURIComponent(slug)}/audit/export${qs({})}`;
  const home = `/t/${encodeURIComponent(slug)}`;
  const dark = temaKoyu(await cookies());
  if (locked) {
    return (
      <main className="flex w-full min-w-0 flex-col">
        <KalipKilitliEkran title={t("title")} icon={{ d: LICON.shield, color: "172E42" }} text={t("locked")} hint={t("lockedAction")} dark={dark} home={home} />
      </main>
    );
  }
  const timeZone = page?.timeZone ?? "UTC";
  const fmt = (d: Date): string => tarih(d, locale, { dateStyle: "medium", timeStyle: "medium", timeZone });
  const actionName = (a: string, known: boolean): string => (known ? t(`actions.${a}`) : t("actions.other"));
  // Hızlı çipler: bugünün tarihi kiracı saat diliminde (YYYY-AA-GG); süzgeç sunucuda aynı `from`/`to` alanlarıdır.
  const day = (d: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const now = new Date();
  const today = day(now);
  const weekFrom = day(new Date(now.getTime() - 6 * 86_400_000));
  const link = (p: Record<string, string | undefined>): string => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v !== undefined) u.set(k, v);
    const s = u.toString();
    return s === "" ? here : `${here}?${s}`;
  };
  const quick = [
    { id: "all", label: t("quickAll"), href: here, on: filters.from === undefined && filters.to === undefined && filters.action === undefined && filters.q === undefined },
    { id: "today", label: t("quickToday"), href: link({ from: today, to: today, action: filters.action, q: filters.q }), on: filters.from === today && filters.to === today },
    { id: "week", label: t("quickWeek"), href: link({ from: weekFrom, to: today, action: filters.action, q: filters.q }), on: filters.from === weekFrom && filters.to === today },
    ...(filters.action === undefined
      ? []
      : [{ id: "action", label: (AUDIT_ACTIONS as readonly string[]).includes(filters.action) ? t(`actions.${filters.action}`) : t("actions.other"), href: link({ from: filters.from, to: filters.to, q: filters.q }), on: true }]),
  ];
  const banner =
    errorCode === undefined ? null : (
      <Banner kind="error">
        <p>
          {errorCode === "recent_auth_required" ? t("recentAuth") : ts(errorCode)} {errorCode === "recent_auth_required" ? t("recentAuthAction") : ts(`${errorCode}Action`)}
        </p>
        {errorCode === "recent_auth_required" ? (
          <a className="btn n" style={{ marginTop: 8 }} href={`/login?reauth=1&next=${encodeURIComponent(here)}`}>
            {t("loginLink")}
          </a>
        ) : null}
        <p className="mt-1 text-sm">{ts("code", { code: errorCode.toUpperCase() })}</p>
      </Banner>
    );

  return (
    <main className="flex w-full min-w-0 flex-col">
      <AuditView
        dark={dark}
        home={home}
        here={here}
        rows={
          page === null
            ? null
            : page.items.map((r) => ({
                id: r.id,
                when: fmt(r.occurredAt),
                actor: r.actorName ?? t("system"),
                action: r.action,
                actionLabel: actionName(r.action, r.actionKnown),
                record: r.entityType === null ? null : `${r.entityType}${r.entityId === null ? "" : ` · ${r.entityId}`}`,
                reason: r.reason,
              }))
        }
        filters={filters}
        actions={AUDIT_ACTIONS.map((a) => ({ id: a, label: t(`actions.${a}`) }))}
        quick={quick}
        exportHref={exportHref}
        moreHref={page === null || page.nextCursor === null ? null : `${here}${qs({ cursor: page.nextCursor })}`}
        banner={banner}
      />
    </main>
  );
}
