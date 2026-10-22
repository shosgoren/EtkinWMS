"use client";
// T-436 (ALTIN-KURAL 7, 14): hata ve "bulunamadı" ekranı — tasarım dilinde (ikon, tek cümle, Tekrar dene / Ana ekran, destek kodu),
// hata sesiyle. Ham hata metni ve yığın HİÇ gösterilmez; yalnız Next'in `digest` kimliği destek kodu olarak. Tema tercihi (otomatik
// dahil) izlenir. Kiracı alanı, yönetim paneli ve 404 aynı bileşeni kullanır.
import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { feedback } from "@wms/ui";
import { LICON } from "../../../design/kalip-icons.ts";
import { KICON } from "../../../design/kabuk-icons.ts";
import { belgeCerezleri, temaKoyu } from "../../../design/theme.ts";

export interface HataEkraniProps {
  readonly tur: "hata" | "bulunamadi";
  /** Next hata kimliği (destek kodu). */
  readonly kod?: string;
  /** Tekrar dene (hata sınırı `retry`). Verilmezse düğme yok. */
  readonly onRetry?: () => void;
  /** Ana ekran adresi. */
  readonly home: string;
  /** Sunucu biliyorsa tema; yoksa istemcide çerezden. */
  readonly dark?: boolean;
}

function Ico({ d, size }: { d: string | readonly string[]; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {(typeof d === "string" ? [d] : d).map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

export function HataEkrani({ tur, kod, onRetry, home, dark }: HataEkraniProps) {
  const t = useTranslations("kural");
  const [koyu, setKoyu] = useState(dark ?? false);
  const btn = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
  useLayoutEffect(() => {
    if (dark === undefined) setKoyu(temaKoyu(belgeCerezleri()));
  }, [dark]);
  useEffect(() => {
    if (tur === "hata") feedback.error();
    else feedback.warn();
    btn.current?.focus();
  }, [tur]);
  const hata = tur === "hata";
  return (
    <main className={`khe${koyu ? " dk" : ""}`} data-testid={hata ? "hata-ekrani" : "bulunamadi-ekrani"}>
      <div className="khe-k" role={hata ? "alert" : undefined}>
        <span className={`khe-ic ${hata ? "err" : "nf"}`}>
          <Ico d={hata ? LICON.warn : LICON.search} size={38} />
        </span>
        <h1>{hata ? t("errorTitle") : t("notFoundTitle")}</h1>
        <p>{hata ? t("errorText") : t("notFoundText")}</p>
        <div className="khe-d">
          {onRetry === undefined ? null : (
            <button ref={(e) => void (btn.current = e)} type="button" className="ana" onClick={() => onRetry()} data-testid="hata-tekrar">
              <Ico d={LICON.transfer} size={20} />
              {t("retry")}
            </button>
          )}
          <a ref={onRetry === undefined ? (e) => void (btn.current = e) : undefined} href={home} className={onRetry === undefined ? "ana" : "ikinci"} data-testid="hata-ana">
            <Ico d={[KICON.homeA, KICON.homeB, KICON.homeC]} size={20} />
            {t("home")}
          </a>
        </div>
        {kod === undefined || kod === "" ? null : (
          <p>
            {t("supportCode")} <code data-testid="hata-kod">{kod}</code>
          </p>
        )}
      </div>
    </main>
  );
}
