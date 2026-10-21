"use client";
// T-971 (B-92): Pano.dc.html Ekip/Hesap düğmesi (`.tb.tb-team`) ve menüsü (`.hback` + `.halo.tmenu`) — Pano ve kalıp ekranlarının ORTAK
// bileşeni. Sınıflar ve renkler Pano kaynağının üretilmiş CSS'inden (`.dzp` kabı); kalıp ekranı bunları `display: contents` bir `.dzp`
// kabında çizer (yeni stil yok). Menü: kişi başlığı, (ekip bağlantıları), Kullanıcı değiştir, Tüm ekranlar (uygulama menüsü: Akış/Genel
// bakış anahtarı ve yetkili ekranlar), tema, Çıkış yap. Çıkış mevcut `/sign-out` uç noktasıyla (Pano'daki ile aynı). T-990: bağlantılar
// istemci içi geçiş; bağlantı, Kullanıcı değiştir ve Çıkış yarım işte önce ortak çıkış kutusuna sorar (`cikisSor`).
import { useEffect, useState, type CSSProperties, type MouseEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { cikisSor } from "../kalip/cikis.tsx";
import { dz } from "../../../design/pano-tokens.ts";
import { PICON } from "../../../design/pano-icons.ts";
import { ICON } from "../../../design/bakis-icons.ts";
import { authPost } from "../../../../lib/auth-client.ts";
import { openAppMenu } from "../app-bar.tsx";

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
export function HesapDugme({ team, open, onClick }: { team: boolean; open: boolean; onClick: () => void }) {
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
      <Ico d={PICON.team} size={24} />
      <span>{team ? t("team") : t("account")}</span>
    </button>
  );
}

/** Kaynak `.hback` + `.halo.tmenu`. Açıkken çizilir; Escape ve perde kapatır. */
export function HesapMenu({ team, me, links = [], dark, onToggleTheme, onClose }: { team: boolean; me: HesapKisi; links?: readonly HesapBaglanti[]; dark: boolean; onToggleTheme: () => void; onClose: () => void }) {
  const t = useTranslations("pano");
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const signOut = async (next: string): Promise<void> => {
    setFailed(false);
    const res = await authPost<unknown>("/sign-out", {});
    if (res.ok) window.location.assign(next);
    else setFailed(true);
  };
  const label = team ? t("team") : t("account");
  const items: Array<{ k: string; label: string; color: string; d: string; out?: boolean; go: () => void }> = [
    ...(team ? [] : [{ k: "switch", label: t("switchUser"), color: "6C4BD8", d: PICON.switchUser, go: () => cikisSor(() => void signOut("/login")) }]),
    // Uygulama menüsü (tüm ekranlar): Akış / Genel bakış anahtarı ve yetkili ekranlar; eski ana ekrandaki "Menü" ile aynı pencere.
    {
      k: "menu",
      label: t("allScreens"),
      color: "172E42",
      d: PICON.list,
      go: () => {
        onClose();
        openAppMenu();
      },
    },
    { k: "theme", label: dark ? t("themeLight") : t("themeDark"), color: "0E7C7B", d: ICON.theme, go: onToggleTheme },
    { k: "out", label: t("signOut"), color: "C62828", d: PICON.signOut, out: true, go: () => cikisSor(() => void signOut("/login")) },
  ];
  // T-990: menü bağlantıları istemci içi geçiştir ve yarım işte önce uygulamanın çıkış kutusuna sorar (tarayıcı penceresi çıkmaz).
  const follow = (e: MouseEvent<HTMLAnchorElement>, href: string | undefined): void => {
    if (href === undefined || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onClose();
    cikisSor(() => router.push(href));
  };
  return (
    <>
      <div className="hback" onClick={onClose} />
      <div className="halo tmenu" role="menu" aria-label={label}>
        <div className="tmh">
          <span className="av" style={{ background: dz(me.color) }}>
            {me.ini}
          </span>
          <span style={{ minWidth: 0 }}>
            <b>{me.name}</b>
            <small>{me.group}</small>
          </span>
        </div>
        {links.map((l) => (
          <a key={l.k} href={l.href} className="hb" role="menuitem" style={{ textDecoration: "none" }} onClick={(e) => follow(e, l.href)} data-testid={`pano-menu-${l.k}`}>
            <i style={{ background: dz(l.color) }}>
              <Ico d={l.d} size={20} />
            </i>
            <span>{l.label}</span>
            {l.n !== undefined && l.n > 0 ? <em className="hbn">{l.n}</em> : null}
          </a>
        ))}
        {items.map((m) => (
          <button key={m.k} type="button" className={`hb${m.out === true ? " out" : ""}`} role="menuitem" onClick={m.go} data-testid={m.k === "menu" ? "app-bar-menu" : `pano-menu-${m.k}`} aria-haspopup={m.k === "menu" ? "dialog" : undefined}>
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
    </>
  );
}
