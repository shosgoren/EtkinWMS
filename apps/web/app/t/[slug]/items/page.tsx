import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { ITEM_CARD_TYPES } from "@wms/domain/catalog";
import type { listUnits } from "@wms/domain/catalog/units";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { cardRights, type CardRights } from "@wms/domain/identity/permissions";
import { AppError } from "@wms/shared/errors";
import { LICON } from "../../../design/kalip-icons.ts";
import { temaKoyu } from "../../../design/theme.ts";
import { KalipKilitliEkran } from "../kalip/liste.tsx";
import { ItemsView } from "./items-view.tsx";
import type { CardType, ItemListView, ItemStockView } from "./items-view.tsx";
import { loadItemsPage } from "./list-page.ts";
import { parseExtraFilters } from "./filters.ts";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("items");
  return { title: t("title") };
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

async function LockedItems(slug: string) {
  const t = await getTranslations("items");
  const dark = temaKoyu(await cookies());
  return (
    <main className="flex w-full min-w-0 flex-col">
      <KalipKilitliEkran title={t("title")} icon={{ d: LICON.box, color: "2F5DA8" }} text={t("locked")} hint={t("lockedAction")} dark={dark} home={`/t/${encodeURIComponent(slug)}`} />
    </main>
  );
}

// Ürün listesi (T-216): sunucu bileşeni; veri T-240 okuyucularından (keyset, OFFSET yok). Sayfa kendi kararını verir: üye değil → 404;
// zorunlu MFA → kurulum; oturum yok → giriş. Yazma yetkisi kararı yalnızca gösterim içindir (eylem sunucuda T-1141 kart anahtarını ister: `items.*` / `warehouses.*` / `locations.*`).
export default async function ItemsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const extra = parseExtraFilters(sp);
  if (extra === null) notFound();
  const after = first(sp.after);
  const q = (first(sp.q) ?? "").slice(0, 128);
  const statusRaw = first(sp.status) ?? "";
  const typeRaw = first(sp.type) ?? "";
  const { getAuthService } = await import("../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  const returnTo = `/t/${encodeURIComponent(slug)}/items`;
  if (principal === null) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  // Bilinmeyen durum değeri kullanıcı hatasıdır: DB'ye gitmeden 404.
  if (statusRaw !== "" && statusRaw !== "ACTIVE" && statusRaw !== "ARCHIVED" && statusRaw !== "REMOVED") notFound();
  const status = statusRaw as "" | "ACTIVE" | "ARCHIVED" | "REMOVED";
  // T-1057: liste domain'den (sunucu modülü). "use client" dosyasından gelen değer sunucuda istemci referansıdır, dizi değildir
  // (`.includes` yoktu → kart türü süzgecinde sayfa çöküyordu).
  if (typeRaw !== "" && !(ITEM_CARD_TYPES as readonly string[]).includes(typeRaw)) notFound();
  const cardType = typeRaw as "" | CardType;
  const db = getAppDb();
  const call = { db, principal, tenantSlug: slug };

  let rows: ItemListView[];
  let units: Awaited<ReturnType<typeof listUnits>>;
  let nextCursor: string | null;
  let total: number | undefined;
  let rights: CardRights;
  let stock: Record<string, ItemStockView> = {};
  try {
    const summary = await getMembershipSummary({ db, principal });
    const current = summary.memberships.find((m) => m.slug === slug);
    if (current === undefined) notFound();
    rights = cardRights(current.roles, current.grants, "items");
    const page = await loadItemsPage(call, { q, status, cardType, after, ...extra });
    rows = page.rows;
    units = page.units;
    nextCursor = page.nextCursor;
    total = page.total;
    stock = page.stock;
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "NOT_FOUND") notFound();
      if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);
      if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
      // Geçersiz imleç (`after`) kullanıcı hatasıdır: boş liste yerine 404.
      if (e.code === "VALIDATION_FAILED") notFound();
      // `stock.view` izni olmayan üye: hata sayfası değil, neden + sonraki eylemle kilitli görünüm (audit/members deseni).
      if (e.code === "FORBIDDEN") {
        // Kilitli görünüm argümansız sunucu bileşenidir (AC-04 testi bileşeni props'suz çizer); slug kapanışla gelir.
        const Locked = () => LockedItems(slug);
        return <Locked />;
      }
    }
    throw e;
  }

  const dark = temaKoyu(await cookies());
  return (
    <main className="flex w-full min-w-0 flex-col">
      <ItemsView
        slug={slug}
        dark={dark}
        rights={rights}
        items={rows}
        stock={stock}
        units={units.filter((u) => u.status === "ACTIVE").map((u) => ({ id: u.id, code: u.code, name: u.name }))}
        nextCursor={nextCursor}
        {...(total === undefined ? {} : { total })}
        firstPage={after === undefined || after === ""}
        query={{ q: q.trim() === "" ? "" : q, status, type: cardType, ...extra }}
      />
    </main>
  );
}
