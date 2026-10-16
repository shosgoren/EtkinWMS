// Panel menüsü (Yonet.dc.html `navList` sırası). Yalnız yapılmış sayfalar listelenir (kademeli aktarım, DESIGN-PARITY §8); Demo
// talepleri sayacı gerçek veridir (bekleyen talep sayısı). Sunucu modülüdür: sayfalar `PanelShell`'e hazır listeyi verir.
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { listDemoRequests } from "@wms/domain/platform/demo-requests";
import type { AccessPrincipal } from "@wms/domain/identity/access";
import { YICON } from "../design/yonet-icons.ts";
import type { PanelNavItem, PanelShellLabels } from "./shell.tsx";

const PAGES = [
  { key: "musteriler", href: "/musteriler", icon: YICON.cust },
  { key: "paketler", href: "/paketler", icon: YICON.pk },
  { key: "talepler", href: "/talepler", icon: YICON.req },
] as const;

export async function panelNav(principal: AccessPrincipal, pendingKnown?: number): Promise<PanelNavItem[]> {
  const t = await getTranslations("panel.nav");
  let pending: number;
  if (pendingKnown !== undefined) pending = pendingKnown;
  else {
    const rows = await listDemoRequests({ db: getAppDb(), principal });
    pending = rows.filter((r) => r.status === "PENDING").length;
  }
  return PAGES.map((p): PanelNavItem => ({ key: p.key, href: p.href, label: t(p.key), icon: p.icon, count: p.key === "talepler" ? pending : 0 }));
}

export async function panelLabels(): Promise<PanelShellLabels> {
  const t = await getTranslations("panel");
  return {
    brand: t("brand"),
    host: t("host"),
    menu: t("menu"),
    who: t("who"),
    signOut: t("signOut"),
    signOutFailed: t("signOutFailed"),
    theme: t("theme"),
    back: t("back"),
  };
}
