"use client";
// T-979 (B-95): çok adımlı formun düzenlenebilir grup şeridi (eski `screen-shell.tsx` FormSteps). Kalıp kabında kalıp yazı diliyle çizilir
// (`ol.workflow-steps`, design/kalip-frame.css). Numara yalnız grubu adlandırır; bitmemiş işi "tamam" göstermez.
import { useTranslations } from "next-intl";

export function KalipAdimlar({ labels }: { labels: readonly string[] }) {
  const t = useTranslations("shell.screen");
  return (
    <ol className="workflow-steps" aria-label={t("steps")}>
      {labels.map((label, index) => (
        <li key={label}>
          <span aria-hidden="true">{index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}
