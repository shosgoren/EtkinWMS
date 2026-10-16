import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { listDemoRequests } from "@wms/domain/platform/demo-requests";
import { AppError } from "@wms/shared/errors";
import { THEME_COOKIE } from "../../design/theme.ts";
import { YICON } from "../../design/yonet-icons.ts";
import { panelOperatorOrExit } from "../gate.ts";
import { PanelShell } from "../shell.tsx";
import { demoRequestAction } from "./actions.ts";
import { TaleplerView, type TaleplerLabels } from "./view.tsx";

// Panel · Demo talepleri (yonet.etkinyazilim.com/talepler; ADR-026 §3, ADR-027). Yalnız platform operatörü (veritabanı listesi + MFA).
export const dynamic = "force-dynamic";

const PATH = "/talepler";
const ERRORS = ["NOT_FOUND", "VERSION_CONFLICT", "VALIDATION_FAILED", "RATE_LIMITED", "INTERNAL", "FORBIDDEN"];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("panel.talepler");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function TaleplerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const principal = await panelOperatorOrExit(PATH);
  const rows = await listDemoRequests({ db: getAppDb(), principal }).catch((e: unknown) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const query = await searchParams;
  const rawErr = Array.isArray(query.error) ? query.error[0] : query.error;
  const errorCode = ERRORS.find((c) => c === rawErr);
  const t = await getTranslations("panel");
  const tt = await getTranslations("panel.talepler");
  const labels: TaleplerLabels = {
    banTitle: tt("banTitle"),
    banBody: tt("banBody"),
    linkTitle: tt("linkTitle"),
    linkBody: tt("linkBody"),
    copy: tt("copy"),
    copied: tt("copied"),
    colWho: tt("colWho"),
    colSector: tt("colSector"),
    colNeed: tt("colNeed"),
    colWhen: tt("colWhen"),
    lSector: tt("lSector"),
    lNeed: tt("lNeed"),
    lWhen: tt("lWhen"),
    reject: tt("reject"),
    approve: tt("approve"),
    again: tt("again"),
    sentEmail: tt("sentEmail"),
    sentScreen: tt("sentScreen"),
    expired: tt("expired"),
    activated: tt("activated"),
    rejected: tt("rejected"),
    today: tt("today"),
    yesterday: tt("yesterday"),
    empty: tt("empty"),
    error: tt.raw("error") as string,
  };
  const pending = rows.filter((r) => r.status === "PENDING").length;
  const dark = (await cookies()).get(THEME_COOKIE)?.value === "koyu";
  return (
    <PanelShell
      dark={dark}
      current="talepler"
      title={tt("title")}
      sub={tt("sub")}
      nav={[{ key: "talepler", href: "/talepler", label: t("nav.talepler"), icon: YICON.req, count: pending }]}
      labels={{ brand: t("brand"), host: t("host"), menu: t("menu"), who: t("who"), signOut: t("signOut"), signOutFailed: t("signOutFailed"), theme: t("theme") }}
    >
      <TaleplerView rows={rows} now={new Date()} labels={labels} initialError={errorCode} action={demoRequestAction} />
    </PanelShell>
  );
}
