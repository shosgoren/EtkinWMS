import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { hasPermission } from "@wms/domain/identity/permissions";
import { getShippingOrder } from "@wms/domain/operations";
import { AppError } from "@wms/shared/errors";
import { KICON } from "../../../../design/kabuk-icons.ts";
import { PrimaryLink } from "../receive/receive-flow.tsx";
import { SahaShell } from "../saha-shell.tsx";
import { ShipFlow } from "./ship-flow.tsx";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sahaIs");
  return { title: t("ship.title") };
}

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

// T-977: `?order=<sipariş>` ile saha sevk. Okuma `getShippingOrder` (stock.view, depo kapsamı); yazma `stock.post` (`shipOrder`).
export default async function FieldShipPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const t = await getTranslations("sahaIs");
  const fieldHome = `/t/${encodeURIComponent(slug)}/field`;
  const tasksHref = `${fieldHome}/tasks`;
  const self = `${fieldHome}/ship`;
  const { getAuthService } = await import("../../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(self)}`);
  const db = getAppDb();
  const message = (title: string, body: string) => (
    <SahaShell hue="blue" iconD={KICON.mSatis} title={title} backHref={tasksHref} footer={<PrimaryLink href={tasksHref}>{t("toTasks")}</PrimaryLink>}>
      <p className="break-words text-lg text-ink" data-testid="ship-message">
        {body}
      </p>
    </SahaShell>
  );
  const summary = await getMembershipSummary({ db, principal });
  const current = summary.memberships.find((m) => m.slug === slug);
  if (current === undefined) notFound();
  if (!hasPermission(current.roles, "stock.post", current.grants)) return message(t("ship.lockedTitle"), t("ship.lockedReason"));
  const orderId = first(sp.order) ?? "";
  let order: Awaited<ReturnType<typeof getShippingOrder>>;
  try {
    order = await getShippingOrder({ db, principal, tenantSlug: slug }, orderId);
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND" || e.code === "VALIDATION_FAILED") return message(t("ship.goneTitle"), t("ship.gone"));
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(self)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(self)}`);
    }
    throw e;
  }
  if (order.status !== "OPEN") return message(t("ship.closedTitle"), t("ship.closed", { number: order.number }));
  return <ShipFlow slug={slug} orderId={order.id} orderNumber={order.number} customerRef={order.customerRef} rows={order.staged} openPicks={order.tasks.length} />;
}
