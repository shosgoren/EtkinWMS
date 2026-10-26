import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { hasPermission } from "@wms/domain/identity/permissions";
import { AppError } from "@wms/shared/errors";
import { LICON } from "../../../design/kalip-icons.ts";
import { temaKoyu } from "../../../design/theme.ts";
import { KalipKilitliEkran } from "../kalip/liste.tsx";
import { WarehousesView } from "./warehouses-view.tsx";
import type { WarehouseView } from "./warehouses-view.tsx";
import { loadWarehousesPage } from "./list-page.ts";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("warehouses");
  return { title: t("title") };
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

async function isDark(): Promise<boolean> {
  return temaKoyu(await cookies());
}

/** Okuma izni olmayan üye: hata sayfası değil, neden + sonraki eylemle kilitli ekran (ürünler deseni). */
async function LockedWarehouses({ slug }: { slug: string }) {
  const t = await getTranslations("warehouses");
  return (
    <main className="flex w-full min-w-0 flex-col">
      <KalipKilitliEkran title={t("title")} icon={{ d: LICON.depo, color: "30475A" }} text={t("k.locked")} hint={t("k.lockedAction")} dark={await isDark()} home={`/t/${encodeURIComponent(slug)}`} />
    </main>
  );
}

// Depo listesi (T-207): sunucu bileşeni; veri T-205 okuyucularından. Sayfa kendi kararını verir: üye değil → 404;
// zorunlu MFA → kurulum; oturum yok → giriş. Yazma yetkisi kararı yalnızca gösterim içindir (eylem sunucuda `settings.manage` ister).
export default async function WarehousesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const after = first(sp.after);
  const q = (first(sp.q) ?? "").trim().slice(0, 100);
  // T-1040 (kullanıcı 26 Ekim): arşivli depo normal listede yok; yalnız "Arşivli" süzgecinde (`?arsiv=1`).
  const archived = first(sp.arsiv) === "1";
  const { getAuthService } = await import("../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  const returnTo = `/t/${encodeURIComponent(slug)}/warehouses`;
  if (principal === null) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  const db = getAppDb();
  const call = { db, principal, tenantSlug: slug };

  let rows: WarehouseView[];
  let nextAfter: string | null;
  let total: number | undefined;
  let canManage: boolean;
  try {
    const summary = await getMembershipSummary({ db, principal });
    const current = summary.memberships.find((m) => m.slug === slug);
    if (current === undefined) notFound();
    canManage = hasPermission(current.roles, "settings.manage", current.grants);
    const page = await loadWarehousesPage(call, { q, archived, after });
    rows = page.rows;
    nextAfter = page.nextAfter;
    total = page.total;
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND") notFound();
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
      // Geçersiz imleç (`after`) kullanıcı hatasıdır: boş liste yerine 404.
      if (e.code === "VALIDATION_FAILED") notFound();
      if (e.code === "FORBIDDEN") return <LockedWarehouses slug={slug} />;
    }
    throw e;
  }

  return (
    <main className="flex w-full min-w-0 flex-col">
      <WarehousesView slug={slug} dark={await isDark()} canManage={canManage} warehouses={rows} nextAfter={nextAfter} firstPage={after === undefined || after === ""} q={q} archived={archived} {...(total === undefined ? {} : { total })} />
    </main>
  );
}
