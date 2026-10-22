import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { hasPermission } from "@wms/domain/identity/permissions";
import { countLocationsByWarehouse, getLocationTree, getWarehouse } from "@wms/domain/warehouse";
import type { WarehouseRow } from "@wms/domain/warehouse";
import { AppError } from "@wms/shared/errors";
import { LICON } from "../../../../design/kalip-icons.ts";
import { temaKoyu } from "../../../../design/theme.ts";
import { KalipKilitliEkran } from "../../kalip/liste.tsx";
import { LocationTree } from "./location-tree.tsx";

export const dynamic = "force-dynamic";

const TREE_PAGE = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("warehouses");
  return { title: t("tree.title") };
}

async function isDark(): Promise<boolean> {
  return temaKoyu(await cookies());
}

/** Okuma izni olmayan üye: hata sayfası değil, neden + sonraki eylemle kilitli ekran (ürünler deseni). */
async function LockedTree({ slug }: { slug: string }) {
  const t = await getTranslations("warehouses");
  return (
    <main className="flex w-full min-w-0 flex-col">
      <KalipKilitliEkran title={t("tree.title")} icon={{ d: LICON.raf, color: "0E7C7B" }} text={t("k.locked")} hint={t("k.lockedAction")} dark={await isDark()} home={`/t/${encodeURIComponent(slug)}`} />
    </main>
  );
}

// Lokasyon ağacı (T-207): sunucu bileşeni. Depo bulunamaz/kapsam dışı/geçersiz kimlik → 404 (varlık sızdırılmaz).
// Yazma yetkisi kararı yalnızca gösterim içindir (eylem sunucuda `settings.manage` ister).
export default async function LocationTreePage({ params }: { params: Promise<{ slug: string; warehouseId: string }> }) {
  const { slug, warehouseId } = await params;
  const { getAuthService } = await import("../../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  const returnTo = `/t/${encodeURIComponent(slug)}/warehouses/${encodeURIComponent(warehouseId)}`;
  if (principal === null) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  // Geçersiz kimlik: DB çağrısı yapmadan 404 (varlık sızdırmaz).
  if (!UUID_RE.test(warehouseId)) notFound();
  const db = getAppDb();
  const call = { db, principal, tenantSlug: slug };

  let warehouse: WarehouseRow;
  let tree: Awaited<ReturnType<typeof getLocationTree>>;
  let canManage: boolean;
  let activeTotal: number | undefined;
  try {
    const summary = await getMembershipSummary({ db, principal });
    const current = summary.memberships.find((m) => m.slug === slug);
    if (current === undefined) notFound();
    canManage = hasPermission(current.roles, "settings.manage", current.grants);
    warehouse = await getWarehouse(call, { warehouseId });
    tree = await getLocationTree(call, { warehouseId: warehouse.id, includeArchived: true, limit: TREE_PAGE });
    // ALTIN-KURAL 15: toplam aktif lokasyon (aynı izin `stock.view`, aynı kapsam); ağaç sayfalı kalır.
    activeTotal = (await countLocationsByWarehouse(call, { warehouseIds: [warehouse.id] })).get(warehouse.id);
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND") notFound();
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "FORBIDDEN") return <LockedTree slug={slug} />;
    }
    throw e;
  }

  return (
    <main className="flex w-full min-w-0 flex-col">
      <LocationTree
        slug={slug}
        dark={await isDark()}
        warehouseId={warehouse.id}
        warehouseName={warehouse.name}
        warehouseCode={warehouse.code}
        warehouseActive={warehouse.status === "ACTIVE"}
        canManage={canManage}
        initialItems={tree.items.map((i) => ({ id: i.id, parentId: i.parentId, code: i.code, name: i.name, depth: i.depth, kind: i.kind, status: i.status }))}
        initialNext={tree.next}
        {...(activeTotal === undefined ? {} : { activeTotal })}
      />
    </main>
  );
}
