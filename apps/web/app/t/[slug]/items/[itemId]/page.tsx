import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getItem, itemInUse, listItemBarcodes, listItemConversions } from "@wms/domain/catalog";
import { listUnits } from "@wms/domain/catalog/units";
import { getItemStockCard } from "@wms/domain/stock";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { hasPermission } from "@wms/domain/identity/permissions";
import { AppError } from "@wms/shared/errors";
import { LICON } from "../../../../design/kalip-icons.ts";
import { temaKoyu } from "../../../../design/theme.ts";
import { KalipKilitliEkran } from "../../kalip/liste.tsx";
import { ItemDetail } from "./item-detail.tsx";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("items");
  return { title: t("detail.title") };
}

async function LockedItem(slug: string) {
  const t = await getTranslations("items");
  const dark = temaKoyu(await cookies());
  return (
    <main className="flex w-full min-w-0 flex-col">
      <KalipKilitliEkran title={t("detail.title")} icon={{ d: LICON.box, color: "2F5DA8" }} text={t("locked")} hint={t("lockedAction")} dark={dark} home={`/t/${encodeURIComponent(slug)}`} />
    </main>
  );
}

// Ürün ayrıntısı (T-216): sunucu bileşeni. Ürün bulunamaz/başka tenant/geçersiz kimlik → 404 (varlık sızdırılmaz). Her okuma tek ürün
// için sınırlıdır (T-240); yazma yetkisi kararı yalnızca gösterim içindir (eylem sunucuda `settings.manage` ister).
export default async function ItemDetailPage({ params }: { params: Promise<{ slug: string; itemId: string }> }) {
  const { slug, itemId } = await params;
  const { getAuthService } = await import("../../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  const returnTo = `/t/${encodeURIComponent(slug)}/items/${encodeURIComponent(itemId)}`;
  if (principal === null) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  // Geçersiz kimlik: DB çağrısı yapmadan 404 (varlık sızdırmaz).
  if (!UUID_RE.test(itemId)) notFound();
  const db = getAppDb();
  const call = { db, principal, tenantSlug: slug };

  try {
    const summary = await getMembershipSummary({ db, principal });
    const current = summary.memberships.find((m) => m.slug === slug);
    if (current === undefined) notFound();
    const canManage = hasPermission(current.roles, "settings.manage", current.grants);
    const item = await getItem(call, { itemId });
    const conversions = await listItemConversions(call, item.id);
    const barcodes = await listItemBarcodes(call, item.id);
    const inUse = await itemInUse(call, item.id);
    const units = await listUnits(call);
    const activeUnits = units.filter((u) => u.status === "ACTIVE").map((u) => ({ id: u.id, code: u.code, name: u.name }));
    const baseUnit = units.find((u) => u.id === item.baseUnitId);
    // T-968: stok özeti (Nerede? + son hareketler) — okunamazsa bölümler çizilmez, kart yine açılır.
    const stockCard = await getItemStockCard(call, item.id).catch(() => null);
    const dark = temaKoyu(await cookies());
    const can = (p: Parameters<typeof hasPermission>[1]): boolean => hasPermission(current.roles, p, current.grants);
    return (
      <main className="flex w-full min-w-0 flex-col">
        <ItemDetail
          slug={slug}
          dark={dark}
          canManage={canManage}
          quick={{ label: can("stock.view"), count: can("document.create"), transfer: can("stock.post") }}
          stockCard={stockCard}
          inUse={inUse}
          units={activeUnits}
          item={{
            id: item.id,
            code: item.code,
            name: item.name,
            status: item.status,
            baseUnitId: item.baseUnitId,
            baseUnitCode: baseUnit?.code ?? "",
            trackingMode: item.trackingMode,
            quantityScale: item.quantityScale,
            pickPolicy: item.pickPolicy,
            cardType: item.cardType,
          }}
          conversions={conversions}
          barcodes={barcodes}
        />
      </main>
    );
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND") notFound();
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
      // `stock.view` izni olmayan üye: hata sayfası değil, neden + sonraki eylemle kilitli görünüm (audit/members deseni).
      if (e.code === "FORBIDDEN") {
        // Kilitli görünüm argümansız sunucu bileşenidir (AC-04 testi bileşeni props'suz çizer); slug kapanışla gelir.
        const Locked = () => LockedItem(slug);
        return <Locked />;
      }
    }
    throw e;
  }
}
