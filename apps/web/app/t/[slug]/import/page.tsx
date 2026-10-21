import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Banner } from "@wms/ui";
import { getAppDb } from "@wms/db";
import { getMembershipSummary } from "@wms/domain/identity/member-queries";
import { hasPermission } from "@wms/domain/identity/permissions";
import { IMPORT_CHUNK_SIZE, IMPORT_MAX_ROWS } from "@wms/domain/onboarding/import";
import { AppError } from "@wms/shared/errors";
import { AktarView } from "./aktar-view.tsx";
import type { ImportKindKey } from "../../../../lib/sheet/mapping.ts";
import { THEME_COOKIE } from "../../../design/theme.ts";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("import");
  return { title: t("title") };
}

// Açılış verisi içe aktarma (T-289): sunucu bileşeni yalnız oturum/üyelik ve gösterim yetkisini çözer. İş kuralları ve yetki kararı
// eylemlerde (domain) verilir; `canManage` kilidi yalnız gösterimdir (eylem de `data.import` ister). Şablon metinleri ve sınırlar
// domain'den buraya okunur, istemciye ÖZELLİK olarak geçer (istemci paketine domain/DB kodu girmez).
// T-981b: `?tur=urun|cari|depo|raf|acilis` seçili türle (2. adım: dosya), `?kip=guncelle` "Güncelle" kipinde açar (ekran Excel menüsü,
// Ayarlar › Bağlantılar). Depo / raf türü yalnız `settings.manage` olana çizilir (eylem de ister).
const TUR: Readonly<Record<string, ImportKindKey>> = { urun: "stok", cari: "cari", depo: "depo", raf: "raf", acilis: "acilis" };

export default async function ImportPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const tur = typeof sp.tur === "string" ? TUR[sp.tur] : undefined;
  const kip = sp.kip === "guncelle";
  const returnTo = `/t/${encodeURIComponent(slug)}/import`;
  const { getAuthService } = await import("../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  const t = await getTranslations("import");
  let canManage = false;
  let canMaster = false;
  try {
    const summary = await getMembershipSummary({ db: getAppDb(), principal });
    const current = summary.memberships.find((m) => m.slug === slug);
    if (current === undefined) notFound();
    canManage = hasPermission(current.roles, "data.import", current.grants);
    canMaster = canManage && hasPermission(current.roles, "settings.manage", current.grants);
  } catch (e) {
    if (e instanceof AppError && e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(returnTo)}`);
    throw e;
  }
  const home = `/t/${encodeURIComponent(slug)}`;
  if (!canManage) {
    return (
      <main className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4 px-4 py-6">
        <h1 className="break-words text-2xl font-extrabold text-ink">{t("title")}</h1>
        <Banner kind="warning">
          <p>{t("locked")}</p>
          <p className="mt-1">{t("lockedAction")}</p>
        </Banner>
        <Link
          href={home}
          className="inline-flex min-h-12 min-w-12 items-center justify-center self-start rounded-control border-2 border-border-strong bg-surface px-6 text-base font-bold text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {t("back")}
        </Link>
      </main>
    );
  }
  // T-427: Excel'den aktar (Aktar.dc.html birebir); dosya tarayıcıda okunur, sunucuya mevcut biçimde düz CSV gider.
  const jar = await cookies();
  return (
    <main className="flex w-full min-w-0 flex-col">
      <h1 className="sr-only">{t("title")}</h1>
      <AktarView
        slug={slug}
        dark={jar.get(THEME_COOKIE)?.value === "koyu"}
        maxRows={IMPORT_MAX_ROWS}
        chunkSize={IMPORT_CHUNK_SIZE}
        canMaster={canMaster}
        {...(tur === undefined || ((tur === "depo" || tur === "raf") && !canMaster) ? {} : { initialKind: tur })}
        initialUpdate={kip}
      />
    </main>
  );
}
