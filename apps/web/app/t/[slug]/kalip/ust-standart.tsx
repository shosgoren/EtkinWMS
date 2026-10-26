"use client";
// T-1042 (STANDART.md §1, kullanıcı onayı 26 Ekim): masaüstü standardı üst çubuk ORTAK parçaları — canlı saat, tema seçici, Ayarlar
// düğmesi. Kalıp kabı (KalipEkran) ve Pano üst çubuğu aynı bileşenleri kullanır; görünüm `design/standart.css` (`.st*`).
// Telefonda sığmayan parçalar CSS ile gizlenir (tema Hesap menüsünde zaten var; saat yalnız saate kısalır).
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { intlDil } from "@wms/ui";
import { SICON } from "../../../design/standart-icons.ts";
import { temaYaz } from "../../../design/theme.ts";
import { useKabuk } from "../kabuk/kabuk-bar.tsx";

function Ico({ d, size }: { d: string; size: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** Canlı saat ve tarih (yeşil noktalı saat simgesi). Sunucu çiziminde boş kalır (saat dilimi farkı hidrasyon hatası vermesin). */
export function StSaat() {
  const t = useTranslations("kalip.st");
  const locale = intlDil(useLocale());
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  const time = now === null ? "" : new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(now);
  const date = now === null ? "" : new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", weekday: "long" }).format(now);
  return (
    <span className="stsaat" role="timer" aria-label={now === null ? t("clock") : t("clockAria", { time, date })} data-testid="st-saat">
      <i className="stsi" aria-hidden="true">
        <Ico d={SICON.clock} size={15} />
        <em />
      </i>
      <b>{time}</b>
      <small>{date}</small>
    </span>
  );
}

/** Tema seçici (güneş / ay); cihaz tercihi çerezi (Hesap menüsündeki geçişle aynı). `onToggle` verilirse (Pano yerel durumu) o çağrılır. */
export function StTema({ dark, onToggle }: { dark: boolean; onToggle?: () => void }) {
  const t = useTranslations("kalip.st");
  const router = useRouter();
  const set = (koyu: boolean): void => {
    if (koyu === dark) return;
    if (onToggle !== undefined) {
      onToggle();
      return;
    }
    temaYaz(koyu ? "koyu" : "acik");
    router.refresh();
  };
  return (
    <span className="sttema" role="radiogroup" aria-label={t("theme")} data-testid="st-tema">
      <button type="button" role="radio" aria-checked={!dark} aria-label={t("light")} className={dark ? undefined : "on"} onClick={() => set(false)}>
        <Ico d={SICON.sun} size={20} />
      </button>
      <button type="button" role="radio" aria-checked={dark} aria-label={t("dark")} className={dark ? "on" : undefined} onClick={() => set(true)}>
        <Ico d={SICON.moon} size={20} />
      </button>
    </span>
  );
}

/** Ayarlar düğmesi (dişli + "AYARLAR"); yalnız `settings.manage` sahibine (kabuk bağlamı `settingsHref`). Hesap'ın hemen önünde. */
export function StAyarlar({ href }: { href?: string | undefined }) {
  const t = useTranslations("kalip.st");
  const ctx = useKabuk();
  const to = href ?? ctx?.settingsHref;
  if (to === undefined) return null;
  return (
    <Link href={to} prefetch={false} className="stbtn stayar" aria-label={t("settings")} data-testid="st-ayarlar">
      <Ico d={SICON.gear} size={22} />
      <span>{t("settingsShort")}</span>
    </Link>
  );
}
