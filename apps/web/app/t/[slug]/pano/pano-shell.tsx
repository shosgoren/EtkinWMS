"use client";
// T-423 (I-18): Pano.dc.html uygulama kabuğu BİREBİR — `.wrap > .appzone > .app`, üst çubuk (`.top`: marka, `.tools`), alt cam çubuk
// (`.dock > .dockin`: Sorun · OKUT · Etkin), sürüklenebilir yüzen kısayol (`.fab` + `.hback` + `.halo`), Ekip/Hesap menüsü (`.halo.tmenu`).
// Sınıf adları, öğe sırası ve ikon yolları kaynaktan (pano-icons.ts); renkler üretilmiş belirteçlerden (pano-tokens.ts).
// Rol içeriği (`.inner` içi) sunucuda çizilir ve `children` olarak gelir.
// İlk teslimdeki bilinçli eksikler (docs/design/DESIGN-PARITY.md, T-423): bildirim zili (bildirim altyapısı yok), Etkin (T-424) ve
// "Düzenle" kısayol seçici çizilmez; kaynakta uygulama içi tema düğmesi olmadığından tema Hesap menüsünde bir öğedir.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { dz } from "../../../design/pano-tokens.ts";
import { PICON } from "../../../design/pano-icons.ts";
import { ICON } from "../../../design/bakis-icons.ts";
import { THEME_COOKIE } from "../../../design/theme.ts";
import { authPost } from "../../../../lib/auth-client.ts";
import { ProblemSheet } from "../problem-sheet.tsx";
import { openAppMenu } from "../app-bar.tsx";

export interface PanoLink {
  readonly k: string;
  readonly label: string;
  /** Kaynak renk (onaltılık, `#` yok). */
  readonly color: string;
  readonly d: string;
  /** Bağlantı; yoksa `action` çalışır. */
  readonly href?: string;
  readonly action?: "problem";
  /** Menüde sayı rozeti (kaynak `.hbn`). */
  readonly n?: number;
}

export interface PanoShellProps {
  readonly slug: string;
  readonly dark: boolean;
  readonly brandSub: string;
  readonly team: boolean;
  readonly me: { readonly ini: string; readonly name: string; readonly group: string; readonly color: string };
  readonly halo: readonly PanoLink[];
  /** Ekip menüsü bağlantıları (yalnız yönetici rolleri; kaynak menuItems team). */
  readonly teamLinks?: readonly PanoLink[];
  readonly settingsHref?: string;
  readonly scanHref: string;
  readonly canReport: boolean;
  readonly children: ReactNode;
}

const FAB_KEY = "etkin-pano-fab";

function Ico({ d, size, className = "ico", style }: { d: string; size: number; className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={style}>
      <path d={d} />
    </svg>
  );
}

export function PanoShell({ slug, dark: initialDark, brandSub, team, me, halo, teamLinks = [], settingsHref, scanHref, canReport, children }: PanoShellProps) {
  const t = useTranslations("pano");
  const [dark, setDark] = useState(initialDark);
  const [menu, setMenu] = useState(false);
  const [haloOpen, setHaloOpen] = useState(false);
  const [problem, setProblem] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const [online, setOnline] = useState(true);
  // Kaynak başlangıç konumu (fx .86, fy .66); kişisel kolaylık olarak tarayıcıda hatırlanır.
  const [pos, setPos] = useState<{ fx: number; fy: number }>({ fx: 0.86, fy: 0.66 });
  const drag = useRef<{ r: DOMRect; moved: boolean; x: number; y: number } | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FAB_KEY);
      if (raw !== null) {
        const v = JSON.parse(raw) as { fx?: unknown; fy?: unknown };
        if (typeof v.fx === "number" && typeof v.fy === "number") setPos({ fx: Math.min(0.94, Math.max(0.06, v.fx)), fy: Math.min(0.9, Math.max(0.08, v.fy)) });
      }
    } catch {
      /* tarayıcı depolaması yoksa varsayılan konum */
    }
    const sync = (): void => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    if (!menu && !haloOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setMenu(false);
        setHaloOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, haloOpen]);

  const toggleTheme = useCallback(() => {
    setDark((d) => {
      const n = !d;
      document.cookie = `${THEME_COOKIE}=${n ? "koyu" : "acik"}; path=/; max-age=31536000; samesite=lax`;
      return n;
    });
  }, []);

  const signOut = async (next: string): Promise<void> => {
    setSignOutFailed(false);
    const res = await authPost<unknown>("/sign-out", {});
    if (res.ok) window.location.assign(next);
    else setSignOutFailed(true);
  };

  // Kaynak fabDown / fabMove / fabUp: 8 px'ten az oynarsa dokunuş (halka aç/kapa), fazlası sürükleme.
  const fabDown = (e: PointerEvent<HTMLDivElement>): void => {
    const app = e.currentTarget.closest(".app");
    if (app === null) return;
    drag.current = { r: app.getBoundingClientRect(), moved: false, x: e.clientX, y: e.clientY };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* yakalama desteklenmiyor */
    }
  };
  const fabMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d === null) return;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 8) d.moved = true;
    if (!d.moved) return;
    const fx = Math.min(0.94, Math.max(0.06, (e.clientX - d.r.left) / d.r.width));
    const fy = Math.min(0.9, Math.max(0.08, (e.clientY - d.r.top) / d.r.height));
    setPos({ fx, fy });
    setHaloOpen(false);
  };
  const fabUp = (): void => {
    const d = drag.current;
    drag.current = null;
    if (d === null) return;
    if (!d.moved) {
      setHaloOpen((o) => !o);
      setMenu(false);
      return;
    }
    try {
      window.localStorage.setItem(FAB_KEY, JSON.stringify(pos));
    } catch {
      /* hatırlanamaz; konum bu oturumda kalır */
    }
  };

  const { fx, fy } = pos;
  const fabStyle: CSSProperties = { left: `${(fx * 100).toFixed(1)}%`, top: `${(fy * 100).toFixed(1)}%` };
  const haloStyle: CSSProperties = {
    ...(fx > 0.5 ? { right: `calc(${(100 - fx * 100).toFixed(1)}% + 34px)` } : { left: `calc(${(fx * 100).toFixed(1)}% + 34px)` }),
    ...(fy > 0.5 ? { bottom: `calc(${(100 - fy * 100).toFixed(1)}% - 24px)` } : { top: `calc(${(fy * 100).toFixed(1)}% - 24px)` }),
  };

  const teamLbl = team ? t("team") : t("account");
  const menuItems: Array<{ k: string; label: string; color: string; d: string; out?: boolean; go: () => void }> = [
    ...(team ? [] : [{ k: "switch", label: t("switchUser"), color: "6C4BD8", d: PICON.switchUser, go: () => void signOut("/login") }]),
    // Uygulama menüsü (tüm ekranlar): eski ana ekrandaki "Menü" ile aynı pencere; saha kişisi diğer ekranlara buradan ulaşır.
    { k: "menu", label: t("allScreens"), color: "172E42", d: PICON.list, go: () => {
        setMenu(false);
        openAppMenu();
      } },
    { k: "theme", label: dark ? t("themeLight") : t("themeDark"), color: "0E7C7B", d: ICON.theme, go: toggleTheme },
    { k: "out", label: t("signOut"), color: "C62828", d: PICON.signOut, out: true, go: () => void signOut("/login") },
  ];

  const pick = (h: PanoLink): void => {
    setHaloOpen(false);
    if (h.action === "problem") setProblem(true);
  };

  return (
    <>
      <div className={`dzp${dark ? " dz-dark" : ""}`} data-testid="pano">
        <div className="wrap">
          <div className="appzone">
            <div className="app">
              <header className="top">
                <div className="brand">
                  <span className="logo">
                    <span className={`net${online ? "" : " off"}`} title={online ? t("online") : t("offline")} aria-label={online ? t("online") : t("offline")} data-online={online ? "true" : "false"}>
                      <i />
                    </span>
                    <svg width="26" height="26" viewBox="0 0 120 120" aria-hidden="true">
                      <path d={PICON.logo} fill="none" stroke={dz("FFFFFF")} strokeWidth="13" strokeLinecap="round" />
                      <circle r="12" fill={dz("F2C53D")} stroke={dz("172E42")} strokeWidth="4">
                        <animateMotion dur="3.2s" repeatCount="indefinite" path={PICON.logo} />
                      </circle>
                    </svg>
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <b>Etkin WMS</b>
                    <small>{brandSub}</small>
                  </span>
                </div>
                <nav className="tools" aria-label={t("tools")}>
                  <button
                    type="button"
                    className={`tb tb-team${menu ? " on" : ""}`}
                    style={{ "--i": dz("6C4BD8") } as CSSProperties}
                    aria-label={team ? t("teamAria") : t("accountAria")}
                    aria-haspopup="menu"
                    aria-expanded={menu}
                    onClick={() => {
                      setMenu((m) => !m);
                      setHaloOpen(false);
                    }}
                    data-testid="home-actions"
                  >
                    <Ico d={PICON.team} size={24} />
                    <span>{teamLbl}</span>
                  </button>
                  {settingsHref === undefined ? null : (
                    <a href={settingsHref} className="tb tb-gear" style={{ textDecoration: "none", "--i": dz("0E7C7B") } as CSSProperties} aria-label={t("settings")}>
                      <Ico d={PICON.gear} size={24} />
                      <span>{t("settingsShort")}</span>
                    </a>
                  )}
                </nav>
              </header>

              <main className="inner">{children}</main>

              <nav className="dock" aria-label={t("dock")}>
                <div className="dockin">
                  {canReport ? (
                    <button type="button" className="dk problem" aria-label={t("report")} onClick={() => setProblem(true)} data-testid="pano-problem">
                      <svg className="ico" width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="12" cy="12" r="9.5" />
                        <path d={PICON.qmark} />
                        <path d={PICON.qdot} />
                      </svg>
                      <span>{t("reportShort")}</span>
                    </button>
                  ) : (
                    <span aria-hidden="true" />
                  )}
                  <a href={scanHref} className="dk scan big" aria-label={t("scan")} style={{ textDecoration: "none" }} data-testid="pano-scan">
                    <svg className="ico" width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
                      <path d={PICON.scanFrame} />
                      <path d={PICON.scanLine} />
                    </svg>
                    <span>{t("scanShort")}</span>
                  </a>
                  <span aria-hidden="true" />
                </div>
              </nav>

              {halo.length > 0 ? (
                <div className="fab" style={fabStyle} onPointerDown={fabDown} onPointerMove={fabMove} onPointerUp={fabUp} onPointerCancel={fabUp}>
                  <button type="button" className={`fabb${haloOpen ? " on" : ""}`} aria-label={t("shortcuts")} aria-expanded={haloOpen} data-testid="pano-fab">
                    <svg className="ico" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="4" y="4" width="6.5" height="6.5" rx="1.8" />
                      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8" />
                      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8" />
                      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8" />
                    </svg>
                  </button>
                </div>
              ) : null}
              {haloOpen ? (
                <>
                  <div className="hback" onClick={() => setHaloOpen(false)} />
                  <div className="halo" style={haloStyle} role="menu" aria-label={t("shortcuts")}>
                    {halo.map((h, i) => {
                      const inner = (
                        <>
                          <i style={{ background: dz(h.color) }}>
                            <Ico d={h.d} size={20} />
                          </i>
                          <span>{h.label}</span>
                        </>
                      );
                      const style: CSSProperties = { animationDelay: `${i * 35}ms`, textDecoration: "none" };
                      return h.href === undefined ? (
                        <button key={h.k} type="button" className="hb" role="menuitem" style={style} onClick={() => pick(h)}>
                          {inner}
                        </button>
                      ) : (
                        <a key={h.k} href={h.href} className="hb" role="menuitem" style={style}>
                          {inner}
                        </a>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {menu ? (
                <>
                  <div className="hback" onClick={() => setMenu(false)} />
                  <div className="halo tmenu" role="menu" aria-label={teamLbl}>
                    <div className="tmh">
                      <span className="av" style={{ background: dz(me.color) }}>
                        {me.ini}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <b>{me.name}</b>
                        <small>{me.group}</small>
                      </span>
                    </div>
                    {teamLinks.map((l) => (
                      <a key={l.k} href={l.href} className="hb" role="menuitem" style={{ textDecoration: "none" }} data-testid={`pano-menu-${l.k}`}>
                        <i style={{ background: dz(l.color) }}>
                          <Ico d={l.d} size={20} />
                        </i>
                        <span>{l.label}</span>
                        {l.n !== undefined && l.n > 0 ? <em className="hbn">{l.n}</em> : null}
                      </a>
                    ))}
                    {menuItems.map((m) => (
                      <button key={m.k} type="button" className={`hb${m.out === true ? " out" : ""}`} role="menuitem" onClick={m.go} data-testid={m.k === "menu" ? "app-bar-menu" : `pano-menu-${m.k}`} aria-haspopup={m.k === "menu" ? "dialog" : undefined}>
                        <i style={{ background: dz(m.color) }}>
                          <Ico d={m.d} size={20} />
                        </i>
                        <span>{m.label}</span>
                      </button>
                    ))}
                    {signOutFailed ? (
                      <p role="alert" style={{ margin: 0, padding: "4px 12px", color: dz("F4C542"), fontWeight: 700, fontSize: 13 }}>
                        {t("signOutFailed")}
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {problem && canReport ? (
        <div className={`dz dzp-pop${dark ? " dz-dark" : ""}`}>
          <ProblemSheet slug={slug} onClose={() => setProblem(false)} />
        </div>
      ) : null}
    </>
  );
}
