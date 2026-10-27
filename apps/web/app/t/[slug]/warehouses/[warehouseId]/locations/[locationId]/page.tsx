import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getLocationCard, getWarehouse } from "@wms/domain/warehouse";
import { AppError } from "@wms/shared/errors";
import { LICON } from "../../../../../../design/kalip-icons.ts";
import { temaKoyu } from "../../../../../../design/theme.ts";
import { KalipKilitliEkran } from "../../../../kalip/liste.tsx";
import { LocationCard } from "./location-card.tsx";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("warehouses.loc");
  return { title: t("title") };
}

async function LockedLocation(slug: string) {
  const t = await getTranslations("warehouses");
  const dark = temaKoyu(await cookies());
  return (
    <main className="flex w-full min-w-0 flex-col">
      <KalipKilitliEkran title={t("loc.title")} icon={{ d: LICON.raf, color: "0E7C7B" }} text={t("k.locked")} hint={t("k.lockedAction")} dark={dark} home={`/t/${encodeURIComponent(slug)}`} />
    </main>
  );
}

// T-1082: raf yeri kartı (sunucu bileşeni). Depo/lokasyon bulunamaz, başka tenant, kapsam dışı depo, depoya ait olmayan lokasyon veya
// geçersiz kimlik → 404 (varlık sızdırılmaz). Okuma `stock.view`; kart salt okumadır (yazma işlemleri lokasyon ağacında kalır).
export default async function LocationCardPage({ params }: { params: Promise<{ slug: string; warehouseId: string; locationId: string }> }) {
  const { slug, warehouseId, locationId } = await params;
  const { getAuthService } = await import("../../../../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  const returnTo = `/t/${encodeURIComponent(slug)}/warehouses/${encodeURIComponent(warehouseId)}/locations/${encodeURIComponent(locationId)}`;
  if (principal === null) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  if (!UUID_RE.test(warehouseId) || !UUID_RE.test(locationId)) notFound();
  const call = { db: getAppDb(), principal, tenantSlug: slug };
  try {
    const card = await getLocationCard(call, { warehouseId, locationId });
    const warehouse = await getWarehouse(call, { warehouseId });
    return (
      <main className="flex w-full min-w-0 flex-col">
        <LocationCard
          slug={slug}
          dark={temaKoyu(await cookies())}
          warehouseId={warehouse.id}
          warehouseName={warehouse.name}
          location={{ id: card.location.id, code: card.location.code, name: card.location.name, depth: card.location.depth, kind: card.location.kind, pickBlocked: card.location.pickBlocked, status: card.location.status }}
          path={card.path}
          contents={card.contents}
          contentsMore={card.contentsMore}
          moves={card.moves}
        />
      </main>
    );
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND" || e.code === "VALIDATION_FAILED") notFound();
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "FORBIDDEN") {
        const Locked = () => LockedLocation(slug);
        return <Locked />;
      }
    }
    throw e;
  }
}
