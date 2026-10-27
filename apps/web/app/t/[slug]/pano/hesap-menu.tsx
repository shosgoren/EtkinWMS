"use client";
// T-971 (B-92): Pano.dc.html Ekip/Hesap düğmesi (`.tb.tb-team`) ve menüsü (`.hback` + `.halo.tmenu`) — Pano ve kalıp ekranlarının ORTAK
// bileşeni. Sınıflar ve renkler Pano kaynağının üretilmiş CSS'inden (`.dzp` kabı); kalıp ekranı bunları `display: contents` bir `.dzp`
// kabında çizer (yeni stil yok). Menü: kişi başlığı, (ekip bağlantıları), Kullanıcı değiştir, Çalışma alanı değiştir (birden fazla alan; T-979c),
// tema, Çıkış yap. Görünüm geçişi (Genel bakış) ve ekranlar ortak alt çubuğun Modüller sayfasındadır. Çıkış mevcut `/sign-out` uç noktasıyla (Pano'daki ile aynı).
// T-990: bağlantılar istemci içi geçiş; bağlantı, Kullanıcı değiştir, Çalışma alanı ve Çıkış yarım işte önce ortak çıkış kutusuna sorar (`cikisSor`).
import { useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { cikisSor } from "../kalip/cikis.tsx";
import { dz } from "../../../design/pano-tokens.ts";
import { PICON } from "../../../design/pano-icons.ts";
import { ICON } from "../../../design/bakis-icons.ts";
import { authPost } from "../../../../lib/auth-client.ts";
import { DICON } from "../../../design/destek-icons.ts";
import { useSessiz } from "../kalip/sessiz.ts";
import { useModalFocus } from "../kalip/odak.ts";
import { useKabuk } from "../kabuk/kabuk-bar.tsx";

function Ico({ d, size }: { d: string; size: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export interface HesapKisi {
  readonly ini: string;
  readonly name: string;
  readonly group: string;
  /** Pano kaynağı rengi (onaltılık, `#` yok). */
  readonly color: string;
}

export interface HesapBaglanti {
  readonly k: string;
  readonly label: string;
  readonly color: string;
  readonly d: string;
  readonly href?: string;
  readonly n?: number;
}

/** Kaynak `.tb.tb-team` (Ekip / Hesap). */
/** T-1042 (STANDART.md §1): `ini` verilirse ikon yerine kullanıcının baş harfi yuvarlak görselde (çevrimiçi noktalı). */
export function HesapDugme({ team, ini, open, onClick }: { team: boolean; ini?: string; open: boolean; onClick: () => void }) {
  const t = useTranslations("pano");
  return (
    <button
      type="button"
      className={`tb tb-team${open ? " on" : ""}`}
      style={{ "--i": dz("6C4BD8") } as CSSProperties}
      aria-label={team ? t("teamAria") : t("accountAria")}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={onClick}
      data-testid="home-actions"
    >
      {/* T-1050: Ekip menüsünde de kullanıcının baş harfi (menü onun hesabıdır); kişiler simgesi yalnız baş harf yoksa. */}
      {ini !== undefined ? (
        <i className="stav" aria-hidden="true">
          {ini}
        </i>
      ) : (
        <Ico d={PICON.team} size={24} />
      )}
      <span>{team ? t("team") : t("account")}</span>
    </button>
  );
}

/** Kaynak `.hback` + `.halo.tmenu`. Açıkken çizilir; Escape ve perde kapatır. */
export function HesapMenu({ team, me, links = [], dark, onToggleTheme, onClose }: { team: boolean; me: HesapKisi; links?: readonly HesapBaglanti[]; dark: boolean; onToggleTheme: () => void; onClose: () => void }) {
  const t = useTranslations("pano");
  const kabuk = useKabuk();
  const [failed, setFailed] = useState(false);
  const tk = useTranslations("kural");
  // T-436 (ALTIN-KURAL 5): "Sessiz" tercihi cihazda saklanır.
  const [silent, setSilent] = useSessiz();
  // T-436 (ALTIN-KURAL 11): Esc kapatır, odak menüde kalır, kapanınca Hesap düğmesine döner.
  const box = useRef<HTMLDivElement>(null);
  useModalFocus(true, box, { onClose, initial: "first" });
  const signOut = async (next: string): Promise<void> => {
    setFailed(false);
    const res = await authPost<unknown>("/sign-out", {});
    if (res.ok) window.location.assign(next);
    else setFailed(true);
  };
  const label = team ? t("team") : t("account");
  // T-1044: Tema ve Ayarlar üst çubukta (STANDART §1); menüde yalnız telefonda görünür (`st-mob`, design/standart.css).
  const items: Array<{ k: string; label: string; color: string; d: string; out?: boolean; mob?: boolean; go: () => void }> = [
    // T-1044 (kullanıcı 26 Ekim): "Kullanıcı değiştir" kaldırıldı — Çıkış yap ile aynı işti (oturumu kapatıp girişe götürür).
    // T-979c: eski "Tüm ekranlar" penceresi kaldırıldı (görünüm geçişi ve ekranlar Modüller'de, yardım üst çubuktaki Destek'te).
    // Birden fazla çalışma alanı varsa seçim ekranı.
    ...(team || (kabuk?.workspaces ?? 1) < 2 ? [] : [{ k: "workspace", label: t("workspace"), color: "0E7C7B", d: PICON.list, go: () => cikisSor(() => window.location.assign("/workspaces")) }]),
    { k: "theme", label: dark ? t("themeLight") : t("themeDark"), color: "0E7C7B", d: ICON.theme, mob: true, go: onToggleTheme },
    { k: "sound", label: silent ? tk("soundOn") : tk("silent"), color: "6A7F91", d: DICON.speaker, go: () => setSilent(!silent) },
    { k: "out", label: t("signOut"), color: "C62828", d: PICON.signOut, out: true, go: () => cikisSor(() => void signOut("/login")) },
  ];
  // T-1039: Ayarlar her ekranın Hesap menüsünde (yalnız `settings.manage`; kabuk bağlamı sunucuda verir). Pano ana ekranının dişli düğmesi ayrıca kalır.
  const settingsHref = team ? undefined : kabuk?.settingsHref;
  const allLinks: readonly HesapBaglanti[] =
    settingsHref === undefined || links.some((l) => l.href === settingsHref) ? links : [...links, { k: "settings", label: t("settings"), color: "0E7C7B", d: PICON.gear, href: settingsHref }];
  // T-990: menü bağlantıları Next `Link` (istemci içi geçiş); yarım işte ortak çıkış koruması tıklamayı yakalar (tarayıcı penceresi çıkmaz).
  const follow = (e: MouseEvent<HTMLAnchorElement>): void => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    onClose();
  };
  // T-1080 (kullanıcı 27 Ekim: "alt çubuk bulanmıyor, kayboluyor"; Yetki gruplarında yalnız üst çubuk bulanıyordu): perde ve menü
  // sayfanın KÖKÜNE çizilir. Ekranın kendi kabı (`.dzp` z yükseltmesi alt çubuğu örtüyordu) ya da cam efektli üst çubuk (sabit konumlu
  // perdeyi kendi içine hapsediyordu) artık perdeyi sınırlamaz: perde bütün görüntü alanını — alt çubuk dahil — bulanıklaştırır.
  return createPortal(
    <div className={`dzp hmenu-kok${dark ? " dz-dark" : ""}`}>
      <div className="hback" onClick={onClose} />
      <div ref={box} className="halo tmenu" role="menu" aria-label={label}>
        <div className="tmh">
          <span className="av" style={{ background: dz(me.color) }}>
            {me.ini}
          </span>
          <span style={{ minWidth: 0 }}>
            <b>{me.name}</b>
            <small>{me.group}</small>
          </span>
        </div>
        {allLinks.map((l) => (
          <Link key={l.k} href={l.href ?? "#"} prefetch={false} className={l.k === "settings" ? "hb st-mob" : "hb"} role="menuitem" style={{ textDecoration: "none" }} onClick={follow} data-testid={`pano-menu-${l.k}`}>
            <i style={{ background: dz(l.color) }}>
              <Ico d={l.d} size={20} />
            </i>
            <span>{l.label}</span>
            {l.n !== undefined && l.n > 0 ? <em className="hbn">{l.n}</em> : null}
          </Link>
        ))}
        {items.map((m) => (
          <button key={m.k} type="button" className={`hb${m.out === true ? " out" : ""}${m.mob === true ? " st-mob" : ""}`} role="menuitem" onClick={m.go} data-testid={`pano-menu-${m.k}`}>
            <i style={{ background: dz(m.color) }}>
              <Ico d={m.d} size={20} />
            </i>
            <span>{m.label}</span>
          </button>
        ))}
        {failed ? (
          <p role="alert" style={{ margin: 0, padding: "4px 12px", color: dz("F4C542"), fontWeight: 700, fontSize: 13 }}>
            {t("signOutFailed")}
          </p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
