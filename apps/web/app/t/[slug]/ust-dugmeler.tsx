"use client";
// T-986b (ALTIN-KURAL üst çubuk): kalıp ekranlarının sağ üst ORTAK düğmeleri — Sorun bildir + Destek (`kalip/destek.tsx`, KalipListe
// `.helpb`) ve Hesap (`pano/hesap-menu.tsx`, Pano `.tb.tb-team` + menü) — kalıp kabı (KalipEkran) kullanmayan tam kaynak ekranlarda
// (Ekip, Gruplar, Aktar) aynı yerde. Bileşenler yeniden kullanılır; yalnız kutu üretmeyen kaplar (`design/ust-frame.css`) eklenir.
// Davranış KalipEkran ile aynı: tema cihaz çerezi, menü kişi başlığı kiracı bağlamından (useKabuk).
import { useLocale, useTranslations } from "next-intl";
import { intlDil } from "@wms/ui";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { THEME_COOKIE } from "../../design/theme.ts";
import { KalipDestek } from "./kalip/destek.tsx";
import { KalipIslemRehberiAc } from "./kalip/rehber.tsx";
import { useKabuk } from "./kabuk/kabuk-bar.tsx";
import { HesapDugme, HesapMenu } from "./pano/hesap-menu.tsx";
import { StAyarlar, StSonIslemler, StTema } from "./kalip/ust-standart.tsx";

/** Üst çubuğun sağ ucu: Sorun bildir · Destek · Hesap. `.top` içinde, marka bloğundan sonra çizilir. */
export function UstDugmeler({ dark }: { dark: boolean }) {
  const t = useTranslations("kalip");
  const locale = useLocale(); // T-436 (ALTIN-KURAL 16): kullanıcının dili
  const ctx = useKabuk();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const toggleTheme = useCallback(() => {
    document.cookie = `${THEME_COOKIE}=${dark ? "acik" : "koyu"}; path=/; max-age=31536000; samesite=lax`;
    setOpen(false);
    router.refresh();
  }, [dark, router]);
  const userName = ctx?.userName ?? "";
  const me = { ini: (userName.trim()[0] ?? "?").toLocaleUpperCase(intlDil(locale)), name: userName, group: (ctx?.roleLabel ?? "").toLocaleUpperCase(intlDil(locale)), color: "6C4BD8" };
  const d = dark ? " dz-dark" : "";
  return (
    <>
      {/* T-1044 (STANDART §1): tema ve Ayarlar üst çubukta (Hesap menüsünde masaüstünde yoklar); KalipEkran ile aynı sıra. */}
      <StSonIslemler />
      <StTema dark={dark} />
      {ctx?.slug !== undefined ? (
        <span className={`dzl ust-dz${d}`}>
          <span className="tph" role="group" aria-label={t("topActions")} data-testid="ust-actions">
            {/* T-1120: KalipEkran ile aynı — ekranın rehberi varsa "?" (Excel'den aktar'da adım adım aktarma rehberi). */}
            <KalipIslemRehberiAc />
            <KalipDestek slug={ctx.slug} dark={dark} canReport={ctx.canReport === true} />
          </span>
        </span>
      ) : null}
      <StAyarlar />
      <span className={`dzp ust-dz${d}`} data-testid="kalip-account">
        <HesapDugme team={false} ini={me.ini} open={open} onClick={() => setOpen((o) => !o)} />
      </span>
      {open ? (
        <span className={`dzp ust-dz${d}`}>
          <HesapMenu team={false} me={me} dark={dark} onToggleTheme={toggleTheme} onClose={close} />
        </span>
      ) : null}
    </>
  );
}
