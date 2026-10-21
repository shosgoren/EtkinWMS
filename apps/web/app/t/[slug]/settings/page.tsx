import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppDb } from "@wms/db";
import { getSampleDataStatus, hasActiveSample, type SampleDataStatus } from "@wms/domain/onboarding/sample-data";
import { getTenantSettings } from "@wms/domain/onboarding/settings-queries";
import { AppError } from "@wms/shared/errors";
import { TIME_ZONES } from "../../../../lib/timezones.ts";
import { temaKoyu, temaTercihi } from "../../../design/theme.ts";
import { SettingsView } from "./settings-view.tsx";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

const SHOWN = ["FORBIDDEN", "UNAUTHENTICATED", "RATE_LIMITED", "VALIDATION_FAILED", "NOT_FOUND", "INTERNAL"];

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const SAMPLE_RESULTS = ["deleted", "archived", "none"] as const;

// Ayarlar (T-122; T-968 form kalıbı): okuma `getTenantSettings` (settings.manage), yazma `saveSettingsFormAction` (ad/dil/saat dilimi +
// görev ayrılığı) ve `clearSampleDataAction`. Yetki yoksa satırlar kilitli + açıklama bandı. Yetki kararı sunucudadır; kilit yalnızca
// gösterimdir (eylemler de aynı izni ister).
export default async function SettingsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const query = await searchParams;
  const { getAuthService } = await import("../../../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect(`/login?next=${encodeURIComponent(`/t/${slug}/settings`)}`);
  const t = await getTranslations("settings");
  const ts = await getTranslations("serverErrors");

  let settings: Awaited<ReturnType<typeof getTenantSettings>> | null = null;
  try {
    settings = await getTenantSettings({ db: getAppDb(), principal, tenantSlug: slug });
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    if (e.code === "NOT_FOUND") notFound();
    if (e.code === "FORBIDDEN" && e.detail === "MFA_REQUIRED") redirect(`/mfa?next=${encodeURIComponent(`/t/${slug}/settings`)}`);
    if (e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(`/t/${slug}/settings`)}`);
    if (e.code !== "FORBIDDEN") throw e;
  }

  const errorCode = SHOWN.find((c) => c === first(query.error))?.toLowerCase();
  const locked = settings === null;
  // Örnek veri durumu (T-996): yalnız ayar yetkisi olana; etkin örnek kayıt yoksa satır çizilmez.
  const sample: SampleDataStatus | null = locked ? null : await getSampleDataStatus({ db: getAppDb(), principal, tenantSlug: slug });
  const sampleResult = SAMPLE_RESULTS.find((r) => r === first(query.sample));
  const sampleNotice = first(query.sample);
  const sodNotice = first(query.sod);
  const jar = await cookies();
  const dark = temaKoyu(jar);
  const theme = temaTercihi(jar);

  // T-968: sonuç bildirimleri kalıbın balonunda (görsel + ses); yeniden giriş ve hata bant olarak kalır.
  const notices: { kind: "ok" | "err" | "info"; text: string }[] = [];
  if (first(query.saved) === "1") notices.push({ kind: "ok", text: t("saved") });
  if (first(query.unchanged) === "1") notices.push({ kind: "info", text: t("unchanged") });
  if (sodNotice === "on" || sodNotice === "off" || sodNotice === "unchanged") notices.push({ kind: "ok", text: t(`sod.${sodNotice}`) });
  if (sampleResult !== undefined) notices.push({ kind: "ok", text: t(`sample.${sampleResult}`) });
  if (sampleNotice === "in_use") notices.push({ kind: "err", text: `${t("sample.inUse")} ${t("sample.inUseAction")}` });
  if (sampleNotice === "confirm") notices.push({ kind: "err", text: t("sample.confirmRequired") });
  const reauthNext = `/login?reauth=1&next=${encodeURIComponent(`/t/${slug}/settings`)}`;
  const reauth =
    sodNotice === "reauth"
      ? { text: t("sod.reauth"), href: reauthNext, link: t("sample.loginLink") }
      : sampleNotice === "reauth"
        ? { text: `${t("sample.reauth")} ${t("sample.reauthAction")}`, href: `/login?next=${encodeURIComponent(`/t/${slug}/settings`)}`, link: t("sample.loginLink") }
        : null;
  const error = errorCode === undefined ? null : { text: `${ts(errorCode)} ${ts(`${errorCode}Action`)}`, code: ts("code", { code: errorCode.toUpperCase() }) };
  const values = { name: settings?.name ?? "", locale: settings?.locale ?? "tr", timeZone: settings?.timeZone ?? "Europe/Istanbul", sod: settings?.separationOfDuties ?? false };

  return (
    <SettingsView
      key={JSON.stringify(values)}
      slug={slug}
      dark={dark}
      theme={theme}
      locked={locked}
      values={values}
      addressSlug={settings?.slug ?? null}
      timeZones={TIME_ZONES}
      sample={sample !== null && hasActiveSample(sample) ? sample.active : null}
      mfaOn={principal.mfaVerified}
      canImport={!locked}
      notices={notices}
      reauth={reauth}
      error={error}
    />
  );
}
