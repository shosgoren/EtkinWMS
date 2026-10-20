import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { hasPermission } from "@wms/domain/identity/permissions";
import { getCountWork, type CountWork } from "@wms/domain/operations";
import { AppError } from "@wms/shared/errors";
import { KICON } from "../../../../design/kabuk-icons.ts";
import { PrimaryLink } from "../receive/receive-flow.tsx";
import { SahaShell } from "../saha-shell.tsx";
import { CountFlow } from "./count-flow.tsx";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sahaIs");
  return { title: t("count.title") };
}

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

// T-977 (B-51 saha): `?task=<COUNT görevi>` ile saha sayım. Okuma `getCountWork` (document.create; kör sayımda referans miktar DÖNMEZ; başkasına atanmış görev
// yalnız onay yetkisine görünür). Yazma `recordCount`/`submitCount` (document.create). Toplama eksiğinden doğan oturumsuz COUNT görevi bu ekranda
// yürütülemez (önce yönetici sayım başlatır) → açıklama.
export default async function FieldCountPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const t = await getTranslations("sahaIs");
  const fieldHome = `/t/${encodeURIComponent(slug)}/field`;
  const tasksHref = `${fieldHome}/tasks`;
  const self = `${fieldHome}/count`;
  const { getAuthService } = await import("../../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(self)}`);
  const db = getAppDb();
  const message = (title: string, body: string, href = tasksHref, label = t("toTasks")) => (
    <SahaShell hue="purple" iconD={KICON.mSayim} title={title} backHref={href} footer={<PrimaryLink href={href}>{label}</PrimaryLink>}>
      <p className="break-words text-lg text-ink" data-testid="count-message">
        {body}
      </p>
    </SahaShell>
  );
  const summary = await getMembershipSummary({ db, principal });
  const current = summary.memberships.find((m) => m.slug === slug);
  if (current === undefined) notFound();
  if (!hasPermission(current.roles, "document.create", current.grants)) return message(t("count.lockedTitle"), t("count.lockedReason"), fieldHome, t("toField"));
  const taskId = first(sp.task) ?? "";
  let work: CountWork;
  try {
    work = await getCountWork({ db, principal, tenantSlug: slug }, { taskId });
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "VALIDATION_FAILED") return message(t("count.noSessionTitle"), t("count.noSession"));
      if (e.code === "NOT_FOUND") return message(t("count.goneTitle"), t("count.gone"));
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(self)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(self)}`);
    }
    throw e;
  }
  if (work.session.status !== "COUNTING" && work.session.status !== "SUBMITTED") return message(t("count.closedTitle"), t("count.closed"));
  if (work.task.status !== "OPEN" && work.task.status !== "ASSIGNED") return message(t("count.goneTitle"), t("count.gone"));
  const code = first(sp.code);
  return (
    <CountFlow
      slug={slug}
      work={{
        taskId: work.task.id,
        sessionId: work.session.id,
        sessionStatus: work.session.status,
        blind: work.session.blind,
        warehouseName: work.session.warehouseName,
        locationId: work.location.id,
        locationCode: work.location.code,
        locationName: work.location.name,
        lines: work.lines,
        progress: work.progress,
      }}
      {...(code === undefined || code === "" ? {} : { initialCode: code.slice(0, 256) })}
    />
  );
}
