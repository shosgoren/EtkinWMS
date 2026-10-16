import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getMessages, getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { listPanelEvents } from "@wms/domain/platform/events";
import { AppError } from "@wms/shared/errors";
import { THEME_COOKIE } from "../../design/theme.ts";
import { panelOperatorOrExit } from "../gate.ts";
import { panelLabels, panelNav } from "../nav.ts";
import { PanelShell } from "../shell.tsx";
import { describe, stamp, type KayitMsgs } from "./describe.ts";
import { KayitView } from "./view.tsx";

// Panel · İşlem kaydı (yonet.etkinyazilim.com/kayit; ADR-027 §9, T-408). Yalnız platform operatörü. Satırlar `platform.*` güvenlik
// olaylarından (silinemez); en yeni önce, en çok 200.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("panel.kayit");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function KayitPage() {
  const principal = await panelOperatorOrExit("/kayit");
  const events = await listPanelEvents({ db: getAppDb(), principal, limit: 200 }).catch((e: unknown) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const t = ((await getMessages()).panel as unknown as { kayit: KayitMsgs }).kayit;
  const rows = events.map((e) => ({ t: stamp(e.at), l: describe(e, t) }));
  const dark = (await cookies()).get(THEME_COOKIE)?.value === "koyu";
  return (
    <PanelShell dark={dark} current="kayit" title={t.title} sub={t.sub} nav={await panelNav(principal)} labels={await panelLabels()}>
      <KayitView rows={rows} head={t.head} tag={t.tag} empty={t.empty} />
    </PanelShell>
  );
}
