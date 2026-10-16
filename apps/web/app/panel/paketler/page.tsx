import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { listPlans } from "@wms/domain/platform/plans";
import { AppError } from "@wms/shared/errors";
import { THEME_COOKIE } from "../../design/theme.ts";
import { panelOperatorOrExit } from "../gate.ts";
import { panelLabels, panelNav } from "../nav.ts";
import { PanelShell } from "../shell.tsx";
import { savePlanAction } from "./actions.ts";
import { PaketlerView, type PaketlerLabels, type PlanItem } from "./view.tsx";

// Panel · Paketler (yonet.etkinyazilim.com/paketler; ADR-027 §4–6, T-404). Yalnız platform operatörü (veritabanı listesi + MFA).
export const dynamic = "force-dynamic";

const PATH = "/paketler";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("panel.paketler");
  return { title: t("title"), robots: { index: false, follow: false } };
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function PaketlerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const principal = await panelOperatorOrExit(PATH);
  const rows = await listPlans({ db: getAppDb(), principal }).catch((e: unknown) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const query = await searchParams;
  const t = await getTranslations("panel.paketler");
  // Kaynaktaki "Yeni paket" taslağı: ad "Yeni paket", 1/1/1/100, QR açık; fiyat girilene dek boş (yer tutucu uydurulmaz).
  const draft: PlanItem = {
    id: null,
    name: t("newName"),
    price: "",
    limits: { admins: 1, field: 1, warehouses: 1, items: 100 },
    features: { qr: true, ship: false, prod: false, api: false },
    published: false,
    recommended: false,
    customers: 0,
  };
  const plans: PlanItem[] = rows.map((r) => ({ ...r }));
  const wantsNew = first(query.yeni) === "1" || plans.length === 0;
  if (wantsNew) plans.push(draft);
  const picked = first(query.p);
  const found = plans.findIndex((p) => p.id !== null && p.id === picked);
  const selected = wantsNew ? plans.length - 1 : found >= 0 ? found : 0;
  const labels: PaketlerLabels = {
    banTitle: t("banTitle"),
    banBody: t("banBody"),
    published: t("published"),
    draft: t("draft"),
    recommended: t("recommended"),
    perMonth: t("perMonth"),
    customers: t.raw("customers") as string,
    unlimited: t("unlimited"),
    admins: t("admins"),
    field: t("field"),
    warehouses: t("warehouses"),
    items: t("items"),
    edit: t("edit"),
    name: t("name"),
    price: t("price"),
    priceSuffix: t("priceSuffix"),
    limAdmins: t("limAdmins"),
    limField: t("limField"),
    limWarehouses: t("limWarehouses"),
    limItems: t("limItems"),
    atMost: t("atMost"),
    unlimitedSuffix: t("unlimitedSuffix"),
    features: t("features"),
    fQr: t("fQr"),
    fShip: t("fShip"),
    fProd: t("fProd"),
    fApi: t("fApi"),
    publish: t("publish"),
    fPublish: t("fPublish"),
    fRecommended: t("fRecommended"),
    saveDraft: t("saveDraft"),
    savePublish: t("savePublish"),
    error: t.raw("error") as string,
  };
  const dark = (await cookies()).get(THEME_COOKIE)?.value === "koyu";
  return (
    <PanelShell
      dark={dark}
      current="paketler"
      title={t("title")}
      sub={t("sub")}
      nav={await panelNav(principal)}
      labels={await panelLabels()}
      action={{ label: t("newPlan"), href: `${PATH}?yeni=1` }}
    >
      <PaketlerView key={plans[selected]?.id ?? "yeni"} plans={plans} selected={selected} labels={labels} action={savePlanAction} />
    </PanelShell>
  );
}
