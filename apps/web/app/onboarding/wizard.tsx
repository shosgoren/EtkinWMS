"use client";
// Sihirbaz adım 2 (T-122): sektör seçimi, şablon önizlemesi ve "Oluştur". İş kuralı sunucuda (`createWorkspaceAction` →
// `createWorkspace`); burada yalnızca seçim, gizli alanlar ve sunucu hatasının (kod + sonraki eylem) gösterimi vardır.
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { C } from "../design/giris-tokens.ts";
import { GICON, GirisBant, GirisEylem, GirisKart, GirisSecenek } from "../giris-ui.tsx";
import { createWorkspaceAction } from "./actions.ts";
import type { OnboardingFormState } from "./actions.ts";

export interface TemplatePreview {
  readonly key: string;
  /** [teknik anahtar, tenant terminolojisi etiketi] (şablon verisi; sunucuda okunur). */
  readonly terminology: readonly (readonly [string, string])[];
}

const KNOWN_ERRORS = ["forbidden", "unauthenticated", "validation_failed", "rate_limited", "not_found", "tenant_suspended", "tenant_closing", "internal"] as const;

export function Wizard({
  name,
  slug,
  templates,
  defaultTemplateKey,
  backHref,
}: {
  name: string;
  slug: string;
  templates: readonly TemplatePreview[];
  defaultTemplateKey: string;
  backHref: string;
}) {
  const t = useTranslations("onboarding");
  const te = useTranslations("serverErrors");
  const [state, formAction, pending] = useActionState<OnboardingFormState, FormData>(createWorkspaceAction, {});
  const [selected, setSelected] = useState(templates.some((x) => x.key === defaultTemplateKey) ? defaultTemplateKey : (templates[0]?.key ?? ""));
  const preview = templates.find((x) => x.key === selected);
  const code = state.errorCode;
  const errKey = code === undefined ? undefined : KNOWN_ERRORS.find((k) => k === code.toLowerCase());

  // T-974 (B-63 grup B): Giris.dc.html öğeleri — ad kartı `.card`, sektör `.opts > .opt` (aktivasyon ile aynı), önizleme `.card`,
  // hata `.ban.err`, alt `.act` (geri + ana düğme). Seçim gizli `templateKey` alanıyla gider (sunucu sözleşmesi aynı).
  return (
    <form action={formAction} style={{ display: "contents" }} aria-busy={pending}>
      <GirisKart>
        <b style={{ font: "800 20px/1.15 var(--font-bricolage), sans-serif", overflowWrap: "anywhere" }}>{name}</b>
        <span className="hint" style={{ wordBreak: "break-all" }}>
          {t("step1.slugPreview", { slug })}
        </span>
        <span className="hint">{t("step1.slugNote")}</span>
      </GirisKart>

      <h2 className="lh" style={{ fontSize: "22px", margin: 0 }}>
        {t("step2.title")}
      </h2>
      <GirisSecenek
        name="templateKey"
        label={t("step2.legend")}
        value={selected}
        onPick={setSelected}
        items={templates.map((tpl, i) => ({ key: tpl.key, title: t(`step2.options.${tpl.key}`), sub: t(`step2.optionHints.${tpl.key}`), d: i === 0 ? GICON.box : GICON.empty }))}
      />

      {preview === undefined ? null : (
        <section aria-labelledby="preview-title" className="card" style={{ background: C.surface }}>
          <h2 id="preview-title" style={{ margin: 0, font: "800 18px/1.15 var(--font-bricolage), sans-serif" }}>
            {t("step2.previewTitle")}
          </h2>
          <span className="hint">{t("step2.previewTerms")}</span>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
            {preview.terminology.map(([key, label]) => (
              <li key={key} style={{ font: "600 15px/1.35 var(--font-instrument), sans-serif", overflowWrap: "anywhere" }}>
                {t("step2.previewTermRow", { key: t(`step2.terms.${key.replace(".", "_")}`), label })}
              </li>
            ))}
          </ul>
          <span className="hint">{t("step2.laterNote")}</span>
        </section>
      )}

      {code === undefined ? null : (
        <GirisBant kind="err" title={errKey === undefined ? te("unknown") : te(errKey)}>
          {errKey === undefined ? te("unknownAction") : te(`${errKey}Action`)} {te("code", { code })}
        </GirisBant>
      )}

      <GirisEylem label={pending ? t("step2.creating") : t("step2.create")} busy={pending} back={{ href: backHref, label: t("step2.back") }} />
    </form>
  );
}
