"use client";
// T-972 (B-63 grup 2): yeni belge formlarının (stok girişi/çıkışı/transfer, sevk siparişi, reçete, mal kabul teslimi) FORM kalıbı kabı.
// Alt cam çubuğun ana işlemi ekrandaki formu gönderir (`form.workflow-form` → `requestSubmit`, tarayıcı alan denetimi dahil); formun
// kendi gönder düğmesi ve sunucu eylemi değişmez. Geri: bölüm listesi.
import type { ReactNode } from "react";
import { LICON } from "../../../design/kalip-icons.ts";
import { KalipEkran } from "../kalip/ekran.tsx";
import { feedback } from "@wms/ui";

export function FormEkran({ kind = "form", heading, dark, title, icon, back, mainLabel, mainAria, children, testId }: { kind?: "form" | "detay"; heading?: boolean; dark: boolean; title: string; icon: { readonly d: string; readonly color: string }; back: string; mainLabel: string; mainAria: string; children: ReactNode; testId?: string }) {
  return (
    <KalipEkran
      kind={kind}
      {...(heading === undefined ? {} : { heading })}
      dark={dark}
      title={title}
      icon={icon}
      testId={testId ?? "kalip-form"}
      bar={{
        back: { href: back },
        main: {
          label: mainLabel,
          aria: mainAria,
          d: LICON.check,
          testId: "kalip-form-save",
          onClick: () => {
            const form = document.querySelector<HTMLFormElement>(".kalip form.workflow-form");
            const primary = form?.querySelector<HTMLButtonElement>(".workflow-primary") ?? form?.querySelector<HTMLButtonElement>('button[type="submit"]');
            if (form === null || form === undefined || primary?.disabled === true) {
              feedback.error();
              primary?.scrollIntoView({ block: "center" });
              return;
            }
            feedback.minor();
            form.requestSubmit(primary ?? undefined);
          },
        },
      }}
    >
      {children}
    </KalipEkran>
  );
}
