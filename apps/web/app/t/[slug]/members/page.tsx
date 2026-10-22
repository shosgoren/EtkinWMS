import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { listMembers, listPendingInvitations } from "@wms/domain/identity/member-queries";
import { ROLE_KEYS } from "@wms/domain/identity/permissions";
import { isWarehouseScopeEnabled, listWarehouses } from "@wms/domain/warehouse";
import { AppError } from "@wms/shared/errors";
import { temaKoyu } from "../../../design/theme.ts";
import { MembersView } from "./members-view.tsx";
import type { PendingView, WarehouseOption } from "./members-view.tsx";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("members");
  return { title: t("title") };
}

export default async function MembersPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const qRaw = (await searchParams).q;
  const q = (Array.isArray(qRaw) ? qRaw[0] : qRaw)?.trim().slice(0, 100) ?? "";
  const { getAuthService } = await import("../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(`/t/${slug}/members`)}`);
  const db = getAppDb();
  const returnTo = `/t/${slug}/members`;
  let members: Awaited<ReturnType<typeof listMembers>>;
  try {
    members = await listMembers({ db, principal, tenantSlug: slug }, { demoEmailDomain: process.env.DEMO_EMAIL_DOMAIN?.trim().toLowerCase() || null }, { q });
  } catch (e) {
    // Layout'tan bağımsız (sayfa kendi kararını verir): üye değil → 404; zorunlu MFA → kurulum; oturum yok → giriş.
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND") notFound();
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
    }
    throw e;
  }

  // Yönetim yetkisi kararı sunucudadır: bekleyen davet listesi `users.manage` ister; FORBIDDEN → eylemler kilitli.
  let pending: PendingView[] | null = null;
  try {
    const rows = await listPendingInvitations({ db, principal, tenantSlug: slug });
    pending = rows.map((r) => ({ invitationId: r.invitationId, email: r.email, role: r.role, expiresAt: r.expiresAt.toISOString(), invitedBy: r.invitedBy }));
  } catch (e) {
    if (!(e instanceof AppError && e.code === "FORBIDDEN" && e.detail === undefined)) throw e;
  }

  // T-417: depo kısıtı düzenleme yalnız yöneticiye; arşivli depolar da listelenir (eski kapsam satırı adıyla görünsün).
  let warehouses: WarehouseOption[] = [];
  if (pending !== null) {
    const res = await listWarehouses({ db, principal, tenantSlug: slug }, { limit: 1000, includeArchived: true });
    warehouses = res.items.map((w) => ({ id: w.id, code: w.code, name: w.name, archived: w.status !== "ACTIVE" }));
  }

  const dark = temaKoyu(await cookies());
  return (
    <main className="flex w-full min-w-0 flex-col">
      <MembersView slug={slug} dark={dark} selfUserId={principal.userId} members={members.map((m) => ({ membershipId: m.membershipId, userId: m.userId, displayName: m.displayName, email: m.email, roles: m.roles, isOwner: m.isOwner, isDemo: m.isDemo, resetLinkAvailable: m.resetLinkAvailable, ...(m.warehouseIds === undefined ? {} : { warehouseIds: m.warehouseIds }), ...(m.field === undefined ? {} : { field: { username: m.field.username, active: m.field.active, pendingUntil: m.field.pendingUntil === null ? null : m.field.pendingUntil.toISOString(), locked: m.field.locked } }) }))} pending={pending} roleKeys={[...ROLE_KEYS]} warehouses={warehouses} scopeEnabled={isWarehouseScopeEnabled()} q={q} />
    </main>
  );
}
