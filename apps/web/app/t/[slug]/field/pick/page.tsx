import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { hasPermission } from "@wms/domain/identity/permissions";
import { getPickWork, type PickWork } from "@wms/domain/operations";
import { AppError } from "@wms/shared/errors";
import { KICON } from "../../../../design/kabuk-icons.ts";
import { PrimaryLink } from "../receive/receive-flow.tsx";
import { SahaMesaj, SahaShell } from "../saha-shell.tsx";
import { PickFlow } from "./pick-flow.tsx";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sahaIs");
  return { title: t("pick.title") };
}

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

// T-977 (B-52 saha): `?task=<PICK görevi>` ile saha toplama. Kart `getPickWork` (stock.view; kapsam + başkasına atanmış görev gizli) ile okunur;
// yazma `stock.post` (`confirmPick`). Yetki yoksa kilitli ekran + gerekçe; görev bitti/iptal ise Görevlerim'e dönüş.
export default async function FieldPickPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const t = await getTranslations("sahaIs");
  const fieldHome = `/t/${encodeURIComponent(slug)}/field`;
  const tasksHref = `${fieldHome}/tasks`;
  const self = `${fieldHome}/pick`;
  const { getAuthService } = await import("../../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(self)}`);
  const db = getAppDb();
  // T-1122: mesaj / kilit gerekçesi saha mesaj kartında (eski düz paragraf yerine).
  const message = (title: string, body: string, href: string, label: string, lock = false) => (
    <SahaShell hue="orange" iconD={KICON.mTopla} title={title} backHref={href} footer={<PrimaryLink href={href}>{label}</PrimaryLink>}>
      <SahaMesaj tone={lock ? "lock" : "info"} text={body} testId="pick-message" />
    </SahaShell>
  );
  const summary = await getMembershipSummary({ db, principal });
  const current = summary.memberships.find((m) => m.slug === slug);
  if (current === undefined) notFound();
  if (!hasPermission(current.roles, "stock.post", current.grants)) return message(t("pick.lockedTitle"), t("pick.lockedReason"), fieldHome, t("toField"), true);
  const taskId = first(sp.task) ?? "";
  if (taskId === "") return message(t("pick.goneTitle"), t("pick.pickFromTasks"), tasksHref, t("toTasks"));
  let work: PickWork;
  try {
    work = await getPickWork({ db, principal, tenantSlug: slug }, { taskId });
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND" || e.code === "VALIDATION_FAILED") return message(t("pick.goneTitle"), t("pick.gone"), tasksHref, t("toTasks"));
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(self)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(self)}`);
    }
    throw e;
  }
  if ((work.task.status !== "OPEN" && work.task.status !== "ASSIGNED") || work.order.status !== "OPEN") {
    const href = work.order.status === "OPEN" ? `${fieldHome}/ship?${new URLSearchParams({ order: work.order.id })}` : tasksHref;
    return message(t("pick.doneAlreadyTitle"), t("pick.doneAlready"), href, work.order.status === "OPEN" ? t("pick.toShip") : t("toTasks"));
  }
  const code = first(sp.code);
  return (
    <PickFlow
      slug={slug}
      work={{
        taskId: work.task.id,
        quantity: work.task.quantity,
        itemName: work.item.name,
        itemCode: work.item.code,
        unitCode: work.item.unitCode,
        locationCode: work.location.code,
        locationName: work.location.name,
        stagingName: work.staging === null ? null : work.staging.name || work.staging.code,
        orderId: work.order.id,
        orderNumber: work.order.number,
        customerRef: work.order.customerRef,
        nextTaskId: work.nextTaskId,
        remaining: work.remaining,
      }}
      {...(code === undefined || code === "" ? {} : { initialCode: code.slice(0, 256) })}
    />
  );
}
