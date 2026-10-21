"use client";
// T-973 (B-63, I-18): paket etiketleri LİSTE kalıbı kabında (KalipListe.dc.html; `KalipEkran`): kalıp üst çubuğu + ortak alt cam çubuk
// (Geri, Ana ekran, ana işlem YAZDIR = önizlemenin kendi "Yazdır / PDF" düğmesi; ölçü geçersiz ya da QR hazır değilse hata sesi).
// Önizleme, ölçü denetimi ve QR üretimi değişmez (package-label-preview.tsx). Baskıda üst ve alt çubuk basılmaz (labels/print.css).
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { LICON } from "../../../../../design/kalip-icons.ts";
import { KalipEkran } from "../../../kalip/ekran.tsx";
import { feedback } from "@wms/ui";

export function PackageLabelEkran({ dark, back, children }: { dark: boolean; back: string; children: ReactNode }) {
  const t = useTranslations("packageReceiving.k");
  return (
    <KalipEkran
      kind="liste"
      dark={dark}
      title={t("labelsTitle")}
      icon={{ d: LICON.printer, color: "172E42" }}
      testId="package-labels"
      bar={{
        back: { href: back },
        main: {
          label: t("printShort"),
          aria: t("printAria"),
          d: LICON.printer,
          testId: "package-labels-print",
          onClick: () => {
            const print = document.querySelector<HTMLButtonElement>('[data-testid="package-label-print"]');
            if (print === null || print.disabled) {
              feedback.error();
              print?.scrollIntoView({ block: "center" });
              return;
            }
            feedback.minor();
            print.click();
          },
        },
      }}
    >
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </KalipEkran>
  );
}
