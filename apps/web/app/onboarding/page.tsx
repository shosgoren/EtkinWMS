import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { TEMPLATE_KEYS, getTemplate } from "@wms/domain/onboarding/templates";
import { slugCandidates, workspaceCreationAllowed } from "@wms/domain/onboarding/workspace";
import { saveWorkspaceNameAction } from "./actions.ts";
import { NAME_MAX, readWizardDraft } from "./draft.ts";
import { temaKoyu } from "../design/theme.ts";
import { GICON, GirisAlan, GirisBaglanti, GirisBant, GirisBaslik, GirisEylem, GirisKabuk, GirisKart } from "../giris-ui.tsx";
import { Wizard } from "./wizard.tsx";
import type { TemplatePreview } from "./wizard.tsx";

// Çalışma alanı sihirbazı (T-122). Adım sunucu durumundadır: adım 1 POST eder, ad + `requestId` kısa ömürlü httpOnly çerezde
// (URL'de ad yok); çerez varsa adım 2, yoksa (ya da `?edit=1`) adım 1 çizilir: yenileme/geri kaldığı adımdan devam eder ve
// aynı `requestId`'yi taşır. Slug önizlemesi domain'in `slugCandidates` çıktısından sunucuda hesaplanır (istemcide kural yok).
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("onboarding");
  return { title: t("title") };
}


function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}


export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { getAuthService } = await import("../../lib/auth-service.ts");
  const principal = await getAuthService().getPrincipal(await headers());
  if (principal === null) redirect("/login?next=%2Fonboarding");
  const t = await getTranslations("onboarding");
  // T-974 (B-63 grup B): Giris.dc.html `v.auth` kabuğu (aktivasyon sihirbazıyla aynı öğeler); adım/çerez/sunucu kuralı aynı.
  const dark = temaKoyu(await cookies());

  // A-50 / m11: kayıt kapalıysa (staging/prod) ya da demo kullanıcısıysa sihirbaz açılmaz; sunucu da aynı kararı verir.
  if (!workspaceCreationAllowed(process.env) || principal.isDemo) {
    return (
      <GirisKabuk dark={dark} testId="onboarding">
        <GirisBaslik title={t("closed.title")} />
        <GirisBant kind="info" title={t("closed.body")} d={GICON.lock}>
          {t("closed.action")}
        </GirisBant>
        <GirisBaglanti href="/login">{t("closed.signIn")}</GirisBaglanti>
      </GirisKabuk>
    );
  }

  const query = await searchParams;
  const draft = await readWizardDraft();
  const edit = first(query.edit) === "1";
  const invalid = first(query.invalid) === "1";
  const errorCode = ["FORBIDDEN", "UNAUTHENTICATED", "RATE_LIMITED", "INTERNAL"].find((c) => c === first(query.error))?.toLowerCase();
  const ts = await getTranslations("serverErrors");

  if (draft === null || edit) {
    return (
      <GirisKabuk dark={dark} testId="onboarding">
        <GirisBaslik kick={t("stepOf", { current: 1, total: 2 }).toLocaleUpperCase("tr")} title={t("title")} sub={t("intro")} />
        <form action={saveWorkspaceNameAction} style={{ display: "contents" }}>
          <GirisKart>
            <h2 style={{ margin: 0, font: "800 18px/1.15 var(--font-bricolage), sans-serif" }}>{t("step1.title")}</h2>
            <GirisAlan
              id="ob-name"
              label={t("step1.label")}
              hint={t("step1.hint")}
              d={GICON.company}
              name="name"
              defaultValue={draft?.name ?? ""}
              maxLength={NAME_MAX}
              required
              autoComplete="organization"
              {...(invalid ? { error: `${ts("validation_failed")} ${ts("validation_failedAction")}` } : {})}
            />
          </GirisKart>
          {errorCode === undefined ? null : (
            <GirisBant kind="err" title={ts(errorCode)}>
              {ts(`${errorCode}Action`)}
            </GirisBant>
          )}
          <GirisEylem label={t("step1.next")} />
        </form>
      </GirisKabuk>
    );
  }

  const slug = slugCandidates(draft.name, draft.requestId)[0] ?? "";
  const templates: TemplatePreview[] = [];
  for (const key of TEMPLATE_KEYS) {
    const tpl = getTemplate(key);
    if (tpl !== undefined) templates.push({ key: tpl.key, terminology: Object.entries(tpl.terminology) });
  }

  return (
    <GirisKabuk dark={dark} testId="onboarding">
      <GirisBaslik kick={t("stepOf", { current: 2, total: 2 }).toLocaleUpperCase("tr")} title={t("title")} />
      <Wizard name={draft.name} slug={slug} templates={templates} defaultTemplateKey="PACKAGING_SUPPLIES" backHref="/onboarding?edit=1" />
    </GirisKabuk>
  );
}
