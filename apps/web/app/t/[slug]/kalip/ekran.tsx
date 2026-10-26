"use client";
// T-968 (B-63, I-18): 4 ekran kalıbının ORTAK kabı — KalipListe / KalipForm / KalipDetay kaynaklarındaki `.wrap > .app` +
// üst çubuk (`.top > .brand`: hareketli logo noktası + çevrimiçi `.net`, renkli ekran ikonu `.pgic`, ad + "FİRMA · ROL"; sağ üst `.tph`
// yuvası) + içerik (`.inner`) + bildirim balonu (`.toast`). Alt cam çubuk kaynak kabın dışında ortak `KabukBar`'dır (`bar`).
// CSS: `design/kalip-{liste,form,detay}.css` (üretilmiş) + `design/kalip-frame.css` (tam ekran, eski kabuk süslemeleri gizli).
// Kök `.kalip` sınıfı taşır: kiracı kabuğunun eski üst çubuğu / Kolay mod / Geri-Ana ekran kutusu / eski alt gezinme bu ekranda çizilmez
// (kalip-frame.css genel kuralı) — yeni ekran yalnız bu kabı kullanarak geçer.
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import { LICON } from "../../../design/kalip-icons.ts";
import { KabukBar, useKabuk, type KabukBarProps } from "../kabuk/kabuk-bar.tsx";
import { HesapDugme, HesapMenu } from "../pano/hesap-menu.tsx";
import { temaYaz } from "../../../design/theme.ts";
import { KalipIslemRehberiAc } from "./rehber.tsx";
import { KalipDestek } from "./destek.tsx";
import { useKalipExcel, type KalipExcelProps } from "./excel.tsx";
import { KalipSurumBekcisi } from "./surum.tsx";
import { kdz, kdzOrtak, type KalipScope } from "./tokens.ts";
import { balonGoster, buyukHarf, type BalonTur } from "@wms/ui";
import { useCevrimici } from "./cevrimdisi.ts";
import { StAyarlar, StSaat, StTema } from "./ust-standart.tsx";

export type KalipKind = "liste" | "form" | "detay";
const SCOPE: Record<KalipKind, KalipScope> = { liste: "dzl", form: "dzf", detay: "dzd" };

/** Kaynak `.ico` SVG (tek ya da çok yol). */
export function Ico({ d, size, className = "ico" }: { d: string | readonly string[]; size: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {(typeof d === "string" ? [d] : d).map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

/** Kaynak mikrofon ikonu (`rect` + yol). */
export function MicIco({ size }: { size: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d={LICON.micB} />
    </svg>
  );
}

export type ToastKind = BalonTur;

export interface KalipToast {
  readonly say: (kind: ToastKind, text: string) => void;
  /** T-436: balon artık kök düzendeki ORTAK katmanda çizilir (`BalonKatmani`); yuva boş kalır (eski çağıranlar için). */
  readonly node: ReactNode;
}

/** Kaynak `toast()`: ortak balon (T-436, ALTIN-KURAL 5). Balon kendi sesini çalar; `scope` yalnız eski imza içindir. */
export function useKalipToast(scope?: KalipKind): KalipToast {
  void scope;
  const say = useCallback((kind: ToastKind, text: string) => balonGoster({ tur: kind, metin: text, ses: kind !== "info" }), []);
  return { say, node: null };
}

export interface KalipEkranProps {
  readonly kind: KalipKind;
  readonly dark: boolean;
  /** Ekran adı (üst çubuk `b`). */
  readonly title: string;
  /** Ekran ikonu yolu ve kaynak rengi (`.pgic`, onaltılık, `#` yok). */
  readonly icon: { readonly d: string; readonly color: string };
  /** Alt satır; verilmezse "FİRMA · ROL" (kiracı düzeninin bağlamından). */
  readonly subtitle?: string;
  /** Sağ üst `.tph` yuvası. Verilmezse Sorun bildir + Destek (T-967, kiracı bağlamı varsa; yoksa Yardım bağlantısı). `null` = boş. */
  readonly actions?: ReactNode | null;
  /** T-981b: üst çubukta Excel düğmesi (İçeri al / Güncelle / Dışarı aktar); yalnız aktarım yetkisi olana çizilir (kiracı bağlamı). */
  readonly excel?: KalipExcelProps;
  /** Alt cam çubuk (ortak KabukBar): ekranın ana işlemi, Geri, Ana ekran. `dark` kabdan gelir. */
  readonly bar: Omit<KabukBarProps, "dark">;
  /** Kabın içinde, `.inner` dışında çizilen katmanlar (kaynak `.sxback`, `.cfback/.cfbox`, `.toast`). */
  readonly overlays?: ReactNode;
  readonly testId?: string;
  /** Üst çubuktaki ad sayfanın birinci düzey başlığı mı (varsayılan evet). Detayda başlık kaydın adıdır (`.hero`). */
  readonly heading?: boolean;
  readonly children: ReactNode;
}

export function KalipEkran({ kind, dark, title, icon, subtitle, actions, excel, bar, overlays, testId, heading = true, children }: KalipEkranProps) {
  const t = useTranslations("kalip");
  const locale = useLocale(); // T-436 (ALTIN-KURAL 16): kullanıcının dili
  const ctx = useKabuk();
  const online = useCevrimici();
  const router = useRouter();
  const [hesap, setHesap] = useState(false);
  const closeHesap = useCallback(() => setHesap(false), []);
  const xls = useKalipExcel(kind, ctx?.slug, excel, ctx?.excel, dark, closeHesap);
  // Tema cihaz tercihidir (çerez, Pano ve Ayarlar ile aynı); sayfa sunucuda çerezi okuyarak yeniden çizilir.
  const toggleTheme = useCallback(() => {
    temaYaz(dark ? "acik" : "koyu");
    setHesap(false);
    router.refresh();
  }, [dark, router]);
  const userName = ctx?.userName ?? "";
  const me = { ini: buyukHarf(userName.trim()[0] ?? "?", locale), name: userName, group: buyukHarf(ctx?.roleLabel ?? "", locale), color: "6C4BD8" };
  // Pano kaynağının sınıfları (`.tb`, `.halo.tmenu`) `.dzp` kabında tanımlıdır; kutu üretmeyen kap (yeni stil yok).
  const panoScope = `dzp${dark ? " dz-dark" : ""}`;
  const scope = SCOPE[kind];
  // T-990: ekran ikonu rengi (ör. tam ekran ürün formunda kart türü rengi) önce kabın, yoksa diğer kalıp kaynaklarının belirteci.
  const c = (hex: string): string => {
    try {
      return kdz(scope, hex);
    } catch {
      return kdzOrtak(hex);
    }
  };
  const sub =
    subtitle ??
    buyukHarf(
      [ctx?.tenantName, ctx?.roleLabel].filter((x): x is string => x !== undefined && x !== "").join(" · "),
      locale,
    );
  const slot =
    actions === undefined && ctx?.slug !== undefined ? (
      <><KalipIslemRehberiAc /><KalipDestek slug={ctx.slug} dark={dark} canReport={ctx.canReport === true} /></>
    ) : actions === undefined ? (
      <Link className="helpb sup" href="/help" aria-label={t("help")} title={t("help")} data-testid="kalip-help">
        <Ico d={LICON.info} size={22} />
      </Link>
    ) : (
      actions
    );
  return (
    <>
      <div
        className={`${scope} kalip${dark ? " dz-dark" : ""}`}
        style={{ "--st-mod": c(icon.color) } as CSSProperties}
        data-testid={testId ?? "kalip"}
        data-kalip={kind}
      >
        <div className="wrap">
          <div className="app">
            <header className="top">
              <div className="brand">
                <span className="logo">
                  {online ? (
                    <span className="net" aria-label={t("online")} title={t("online")}>
                      <i />
                    </span>
                  ) : null}
                  <svg width="26" height="26" viewBox="0 0 120 120" aria-hidden="true">
                    <path d={LICON.logo} fill="none" stroke={c("FFFFFF")} strokeWidth="13" strokeLinecap="round" />
                    <circle r="12" fill={c("F2C53D")} stroke={c("172E42")} strokeWidth="4">
                      <animateMotion dur="3.2s" repeatCount="indefinite" path={LICON.logo} />
                    </circle>
                  </svg>
                </span>
                <span className="pgic" style={{ background: c(icon.color) }}>
                  <Ico d={icon.d} size={22} />
                </span>
                <span style={{ minWidth: 0 }}>
                  {/* Kaynakta `b`; erişilebilir ad için ekranın tek birinci düzey başlığı. */}
                  {heading ? (
                    <b role="heading" aria-level={1}>
                      {title}
                    </b>
                  ) : (
                    <b>{title}</b>
                  )}
                  {sub === "" ? null : <small>{sub}</small>}
                </span>
              </div>
              {/* T-1042 (STANDART.md §1): ortada canlı saat; sağda tema → Excel/Sorun/Destek → Ayarlar → Hesap (en sağda). */}
              <StSaat />
              <StTema dark={dark} />
              {slot === null && xls.button === null ? null : (
                <div className="tph" role="group" aria-label={t("topActions")}>
                  {xls.button}
                  {slot}
                </div>
              )}
              <StAyarlar />
              {/* T-971 (B-92): Pano'nun Hesap düğmesi — `actions` yuvasından ayrı öğe (Sorun/Destek o yuvada). */}
              <span className={panoScope} style={{ display: "contents" }} data-testid="kalip-account">
                <HesapDugme
                  team={false}
                  ini={me.ini}
                  open={hesap}
                  onClick={() => {
                    xls.close();
                    setHesap((o) => !o);
                  }}
                />
              </span>
            </header>
            <main className="inner" id="kalip-main">
              {children}
            </main>
            {overlays}
            {/* T-990: yayından sonra açık kalan sayfa eski eylem kimliğiyle çağırırsa "Uygulama güncellendi — Yenile". */}
            <KalipSurumBekcisi />
            {xls.layer}
            {hesap ? (
              <div className={panoScope} style={{ display: "contents" }}>
                <HesapMenu team={false} me={me} dark={dark} onToggleTheme={toggleTheme} onClose={closeHesap} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <KabukBar dark={dark} {...bar} />
    </>
  );
}

/** Kaynak `.shd`: bölüm başlığı (sol kalın büyük harf, sağ ince ipucu). */
export function KalipBaslik({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="shd">
      <b>{title}</b>
      {hint === undefined ? null : <span>{hint}</span>}
    </div>
  );
}
