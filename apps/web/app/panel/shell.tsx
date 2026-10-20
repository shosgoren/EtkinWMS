"use client";
// I-18 (DESIGN-PARITY): Yonet.dc.html kabuğu BİREBİR — sol menü (`.side`), üst başlık (`.top`), mobil sekmeler (`.mtabs`), içerik
// (`.scroll > .inner`). Sınıf adları, öğe sırası, ikon yolları ve metinler kaynaktan; CSS `app/design/yonet.css` (üretilmiş).
// Menüde yalnız yapılmış sayfalar vardır (kademeli aktarım, DESIGN-PARITY §8); sayaç gerçek veridir.
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { authPost } from "../../lib/auth-client.ts";
import { DzRoot, useDz } from "../design/dz-root.tsx";
import { C, dz } from "../design/yonet-tokens.ts";
import { YICON } from "../design/yonet-icons.ts";

export interface PanelNavItem {
  readonly key: string;
  readonly href: string;
  readonly label: string;
  readonly icon: string;
  readonly count: number;
}

export interface PanelShellLabels {
  readonly brand: string;
  readonly host: string;
  readonly menu: string;
  readonly who: string;
  readonly signOut: string;
  readonly signOutFailed: string;
  readonly theme: string;
  /** Geri düğmesinin erişilebilir adı (kaynak "Geri"). */
  readonly back?: string;
}

interface Props {
  readonly dark: boolean;
  readonly current: string;
  readonly nav: readonly PanelNavItem[];
  readonly title: string;
  readonly sub: string;
  readonly labels: PanelShellLabels;
  /** Başlıktaki geri düğmesi (kaynak `showBack`, ör. müşteri detayı → Müşteriler). */
  readonly backHref?: string;
  /** Başlıktaki eylem düğmesi (kaynak `head.act`, ör. "Yeni paket"). */
  readonly action?: { readonly label: string; readonly href: string };
  /** Başlıktaki durum çipi (YonetDestek.dc.html talep detayı `.top > .chip`). */
  readonly badge?: { readonly label: string; readonly bg: string; readonly fg: string };
  readonly children: ReactNode;
}

function Ico({ d, size, sw }: { d: string; size: number; sw?: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={sw === undefined ? undefined : { strokeWidth: sw }}>
      <path d={d} />
    </svg>
  );
}

function ThemeButton({ label }: { label: string }) {
  const { toggleTheme } = useDz();
  return (
    <button type="button" className="icb" style={{ background: C.surface }} onClick={toggleTheme} aria-label={label}>
      <Ico d={YICON.theme} size={22} />
    </button>
  );
}

function Inner({ current, nav, title, sub, labels, backHref, action, badge, children }: Omit<Props, "dark">) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  async function signOut(): Promise<void> {
    setFailed(false);
    const res = await authPost<unknown>("/sign-out", {});
    if (res.ok) window.location.assign("/login");
    else setFailed(true);
  }
  return (
    <div className="shell" style={{ background: C.bg, color: C.fg }}>
      <nav className="side" aria-label={labels.menu}>
        <div className="sbrand">
          <svg width="34" height="34" viewBox="0 0 120 120" aria-hidden="true" style={{ flex: "none", display: "block" }}>
            <rect x="4" y="4" width="112" height="112" rx="28" fill={dz("FFFFFF")} />
            <path d={YICON.logo} fill="none" stroke={dz("172E42")} strokeWidth="13" strokeLinecap="round" />
            <circle r="12" fill={dz("F2C53D")} stroke={dz("FFFFFF")} strokeWidth="4">
              <animateMotion dur="3.2s" repeatCount="indefinite" path={YICON.logo} />
            </circle>
          </svg>
          <span className="tx">
            <b>{labels.brand}</b>
            <small>{labels.host}</small>
          </span>
        </div>
        {nav.map((n) => {
          const on = n.key === current;
          return (
            <button key={n.key} type="button" className={`nav${on ? " on" : ""}`} onClick={() => router.push(n.href)} aria-current={on ? "page" : "false"} aria-label={n.label} title={n.label}>
              <Ico d={n.icon} size={22} />
              <span className="tx">{n.label}</span>
              {n.count > 0 ? <span className="cnt">{String(n.count)}</span> : null}
            </button>
          );
        })}
        <div className="sfoot">
          <div className="who">
            <Ico d={YICON.lock} size={20} />
            <span className="tx">{labels.who}</span>
          </div>
          <button type="button" className="nav" onClick={() => void signOut()} aria-label={labels.signOut} title={labels.signOut} aria-describedby={failed ? "panel-signout-error" : undefined}>
            <Ico d={YICON.signOut} size={22} />
            <span className="tx">{labels.signOut}</span>
          </button>
          {failed ? (
            <span id="panel-signout-error" role="alert" className="who">
              {labels.signOutFailed}
            </span>
          ) : null}
        </div>
      </nav>

      <div className="main">
        <header className="top">
          {backHref === undefined ? null : (
            <button type="button" className="icb" style={{ background: C.surface }} onClick={() => router.push(backHref)} aria-label={labels.back}>
              <Ico d={YICON.back} size={22} sw={3} />
            </button>
          )}
          <div className="top-t">
            <h1 className="top-h">{title}</h1>
            <span className="top-s">{sub}</span>
          </div>
          {badge === undefined ? null : (
            <span className="chip" style={{ background: badge.bg, color: badge.fg }} data-testid="panel-badge">
              {badge.label}
            </span>
          )}
          {action === undefined ? null : (
            <button type="button" className="btn" style={{ background: dz("172E42"), color: dz("FFFFFF") }} onClick={() => router.push(action.href)}>
              <Ico d={YICON.plus} size={20} sw={2.8} />
              <span className="tx">{action.label}</span>
            </button>
          )}
          <ThemeButton label={labels.theme} />
        </header>
        <div className="mtabs" role="tablist" aria-label={labels.menu}>
          {nav.map((n) => {
            const on = n.key === current;
            return (
              <button key={n.key} type="button" role="tab" className={`mtab${on ? " on" : ""}`} aria-selected={on} onClick={() => router.push(n.href)}>
                {n.label}
                {n.count > 0 ? ` · ${n.count}` : null}
              </button>
            );
          })}
        </div>
        <div className="scroll">
          <div className="inner">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function PanelShell({ dark, ...rest }: Props) {
  return (
    <DzRoot dark={dark} scope="dzy" testId="panel">
      <Inner {...rest} />
    </DzRoot>
  );
}
