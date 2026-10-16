import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getMessages, getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { listPlans } from "@wms/domain/platform/plans";
import { getSiteContent } from "@wms/domain/platform/site-content";
import { AppError } from "@wms/shared/errors";
import { THEME_COOKIE } from "../../design/theme.ts";
import { panelOperatorOrExit } from "../gate.ts";
import { panelLabels, panelNav } from "../nav.ts";
import { PanelShell } from "../shell.tsx";
import { siteContentAction } from "./actions.ts";
import { SatisView, type SatisLabels, type SitePlanItem } from "./view.tsx";

// Panel · Satış sayfası (yonet.etkinyazilim.com/satis; ADR-027 §6, T-407). Yalnız platform operatörü. Ana başlık, vurgulu satır, alt metin
// ve fiyat bölümünde gösterilecek paketler; süreli önizleme bağlantısı ve yayın. Satış sitesi son yayını okur.
export const dynamic = "force-dynamic";

const TZ = "Europe/Istanbul";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("panel.satis");
  return { title: t("title"), robots: { index: false, follow: false } };
}

interface Msgs extends SatisLabels {
  readonly title: string;
  readonly sub: string;
  /** Henüz içerik yokken forma gelen, satış sayfasının bugünkü metni. */
  readonly defTitle1: string;
  readonly defTitle2: string;
  readonly defSubtitle: string;
  readonly pubNever: string;
  /** `{when}` ve `{v}` yer tutuculu. */
  readonly pubAt: string;
}

function when(d: Date): string {
  const p = new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (k: string): string => p.find((x) => x.type === k)?.value ?? "";
  return `${g("day")}.${g("month")} ${g("hour")}:${g("minute")}`;
}

export default async function SatisPage() {
  const principal = await panelOperatorOrExit("/satis");
  const db = getAppDb();
  const [content, plans] = await Promise.all([getSiteContent({ db, principal }), listPlans({ db, principal })]).catch((e: unknown) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const t = ((await getMessages()).panel as unknown as { satis: Msgs }).satis;
  // İlk kez: satış sayfasının bugünkü metni ve yayındaki bütün paketler seçili (kaynaktaki varsayılan).
  const selected = new Set(content?.planIds ?? plans.filter((p) => p.published).map((p) => p.id));
  const items: SitePlanItem[] = plans.map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    limits: p.limits,
    published: p.published,
    recommended: p.recommended,
    on: selected.has(p.id),
  }));
  const pub =
    content?.publishedAt == null || content.publishedVersion === null
      ? t.pubNever
      : t.pubAt.replace("{when}", when(content.publishedAt)).replace("{v}", String(content.publishedVersion));
  const dark = (await cookies()).get(THEME_COOKIE)?.value === "koyu";
  return (
    <PanelShell dark={dark} current="satis" title={t.title} sub={t.sub} nav={await panelNav(principal)} labels={await panelLabels()}>
      <SatisView
        initial={{
          title1: content?.title1 ?? t.defTitle1,
          title2: content?.title2 ?? t.defTitle2,
          subtitle: content?.subtitle ?? t.defSubtitle,
        }}
        plans={items}
        published={pub}
        labels={t}
        action={siteContentAction}
      />
    </PanelShell>
  );
}
