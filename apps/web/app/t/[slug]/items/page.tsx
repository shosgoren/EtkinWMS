import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { searchItems } from "@wms/domain/catalog";
import { sumItemsStock } from "@wms/domain/stock";
import { listUnits } from "@wms/domain/catalog/units";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { hasPermission } from "@wms/domain/identity/permissions";
import { AppError } from "@wms/shared/errors";
import { LICON } from "../../../design/kalip-icons.ts";
import { temaKoyu } from "../../../design/theme.ts";
import { KalipKilitliEkran } from "../kalip/liste.tsx";
import { CARD_TYPES, ItemsView } from "./items-view.tsx";
import type { CardType, ItemListView, ItemStockView } from "./items-view.tsx";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

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
// zorunlu MFA → kurulum; oturum yok → giriş. Yazma yetkisi kararı yalnızca gösterim içindir (eylem sunucuda `settings.manage` ister).
export default async function ItemsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const after = first(sp.after);
  const q = (first(sp.q) ?? "").slice(0, 128);
  const statusRaw = first(sp.status) ?? "";
  const typeRaw = first(sp.type) ?? "";
  const { getAuthService } = await import("../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  const returnTo = `/t/${encodeURIComponent(slug)}/items`;
  if (principal === null) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  // Bilinmeyen durum değeri kullanıcı hatasıdır: DB'ye gitmeden 404.
  if (statusRaw !== "" && statusRaw !== "ACTIVE" && statusRaw !== "ARCHIVED") notFound();
  const status = statusRaw as "" | "ACTIVE" | "ARCHIVED";
  if (typeRaw !== "" && !(CARD_TYPES as readonly string[]).includes(typeRaw)) notFound();
  const cardType = typeRaw as "" | CardType;
  const db = getAppDb();
  const call = { db, principal, tenantSlug: slug };

  let rows: ItemListView[];
  let units: Awaited<ReturnType<typeof listUnits>>;
  let nextCursor: string | null;
  let total: number | undefined;
  let canManage: boolean;
  let canImport: boolean;
  let stock: Record<string, ItemStockView> = {};
  try {
    const summary = await getMembershipSummary({ db, principal });
    const current = summary.memberships.find((m) => m.slug === slug);
    if (current === undefined) notFound();
    canManage = hasPermission(current.roles, "settings.manage", current.grants);
    canImport = hasPermission(current.roles, "data.import", current.grants);
    const page = await searchItems(call, {
      limit: PAGE_SIZE,
      withTotal: true,
      ...(q.trim() === "" ? {} : { q }),
      ...(status === "" ? {} : { status }),
      ...(cardType === "" ? {} : { cardType }),
      ...(after === undefined || after === "" ? {} : { after }),
    });
    units = await listUnits(call);
    const unitCode = new Map(units.map((u) => [u.id, u.code] as const));
    // T-257: arama ESKİ kodla eşleştiyse sonuç kartında "bu kod X olarak değişti" bilgisi (sunucu `renamedFrom` verir; kural istemcide yok).
    const old = new Map((page.renamedFrom ?? []).map((r) => [r.itemId, r.oldCode] as const));
    rows = page.items.map((it) => {
      const oldCode = old.get(it.id);
      return { id: it.id, code: it.code, name: it.name, status: it.status, baseUnitCode: unitCode.get(it.baseUnitId) ?? "", cardType: it.cardType, ...(oldCode === undefined ? {} : { oldCode }) };
    });
    nextCursor = page.nextCursor;
    total = page.total;
    // T-968: kart rozeti (kapsamdaki depoların eldeki toplamı + minimum); okunamazsa rozet çizilmez, liste yine açılır.
    stock = Object.fromEntries(
      (await sumItemsStock(call, rows.map((r) => r.id)).catch(() => [])).map((x) => [x.itemId, { have: x.have, min: x.min }] as const),
    );
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
        canManage={canManage}
        canImport={canImport}
        items={rows}
        stock={stock}
        units={units.filter((u) => u.status === "ACTIVE").map((u) => ({ id: u.id, code: u.code, name: u.name }))}
        nextCursor={nextCursor}
        {...(total === undefined ? {} : { total })}
        firstPage={after === undefined || after === ""}
        query={{ q: q.trim() === "" ? "" : q, status, type: cardType }}
      />
    </main>
  );
}
