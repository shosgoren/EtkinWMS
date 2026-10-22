"use client";
// T-423 (I-18): Pano.dc.html uygulama kabuğu BİREBİR — `.wrap > .appzone > .app`, üst çubuk (`.top`: marka, `.tools`), alt cam çubuk
// (T-958'den beri ortak `KabukBar`: Kabuk.dc.html Geri · Ana ekran · OKUT · Modüller · Etkin), sürüklenebilir yüzen kısayol (`.fab` + `.hback` + `.halo`), Ekip/Hesap menüsü (`.halo.tmenu`).
// T-967 (Destek.dc.html, B-84/85/87): üst çubukta kişi ikonunun solunda yazısız Sorun bildir (`.tb-issue`, mevcut Sorun penceresi) ve Destek
// (`.tb-help`: Destek penceresi / Taleplerim, okunmamış ekip yanıtında rozet + tek seferlik hareket); yüzen kısayol şimşek (`.fabb.zap`).
// Ek sınıflar `design/destek-ek.css` (kap `.dzdx`).
// Sınıf adları, öğe sırası ve ikon yolları kaynaktan (pano-icons.ts); renkler üretilmiş belirteçlerden (pano-tokens.ts).
// Rol içeriği (`.inner` içi) sunucuda çizilir ve `children` olarak gelir.
// Bilinçli farklar (docs/design/DESIGN-PARITY.md, T-423): bildirim zili yalnız yönetici panolarında, sayısı açık uyarılardan (kritik stok +
// sorun; ayrı bildirim kutusu yok, zil uyarılar bölümüne götürür); Etkin (T-424) çizilmez; kaynakta
// uygulama içi tema düğmesi olmadığından tema Hesap menüsünde bir öğedir. "Düzenle" kısayol seçicisi (`.page > .pk > .pp`): yalnız yetkili
// ekranlar listelenir, en çok 6; seçim kişisel kolaylık olarak tarayıcıda hatırlanır (kaynaktaki her öğede liste ikonu yerine öğenin ikonu).
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { dz } from "../../../design/pano-tokens.ts";
import { PICON } from "../../../design/pano-icons.ts";
import { temaYaz } from "../../../design/theme.ts";
import { ProblemSheet } from "../problem-sheet.tsx";
import { HesapDugme, HesapMenu } from "./hesap-menu.tsx";
import { KabukBar } from "../kabuk/kabuk-bar.tsx";
import { KICON } from "../../../design/kabuk-icons.ts";
import { DICON } from "../../../design/destek-icons.ts";
import { HelpIco, IssueIco, SupportList, SupportSheet, useSupport } from "./support-layer.tsx";
import { feedback } from "@wms/ui";

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
  /** Bildirim zili (yalnız yönetici panoları): açık uyarı sayısı (kritik stok + sorun) ve gideceği yer. */
  readonly bell?: { readonly n: number; readonly href: string };
  /** Destek talebine otomatik eklenen uygulama sürümü (sunucu imaj etiketi; yoksa null). */
  readonly appVersion?: string | null;
  readonly children: ReactNode;
}

const FAB_KEY = "etkin-pano-fab";
const MINE_KEY = (slug: string): string => `etkin-pano-kisayol:${slug}`;
const MAX_SHORTCUTS = 6;

function Ico({ d, size, className = "ico", style }: { d: string; size: number; className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={style}>
      <path d={d} />
    </svg>
  );
}

export function PanoShell({ slug, dark: initialDark, brandSub, team, me, halo, teamLinks = [], settingsHref, scanHref, canReport, bell, appVersion = null, children }: PanoShellProps) {
  const t = useTranslations("pano");
  const td = useTranslations("destek");
  // T-967: Destek penceresi (C) ve Taleplerim (D); okunmamış ekip yanıtı rozeti açılışta bir kez okunur.
  const support = useSupport(slug);
  const [help, setHelp] = useState<"form" | "list" | null>(null);
  const [sentCode, setSentCode] = useState<string | null>(null);
  const [iconPx, setIconPx] = useState(24);
  const hasTickets = (support.tickets?.length ?? 0) > 0;
  const [dark, setDark] = useState(initialDark);
  const [menu, setMenu] = useState(false);
  const [haloOpen, setHaloOpen] = useState(false);
  // "Düzenle": kişinin seçtiği kısayollar (null = varsayılan: yetkili ilk 6) ve seçici sayfası taslağı.
  const [mine, setMine] = useState<readonly string[] | null>(null);
  const [picker, setPicker] = useState<readonly string[] | null>(null);
  const [problem, setProblem] = useState(false);
  const [online, setOnline] = useState(true);
  // Kaynak başlangıç konumu (fx .86, fy .66); kişisel kolaylık olarak tarayıcıda hatırlanır.
  const [pos, setPos] = useState<{ fx: number; fy: number }>({ fx: 0.86, fy: 0.66 });
  const drag = useRef<{ r: DOMRect; moved: boolean; x: number; y: number } | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(MINE_KEY(slug));
      if (saved !== null) {
        const v = JSON.parse(saved) as unknown;
        if (Array.isArray(v) && v.every((x) => typeof x === "string")) setMine(v as string[]);
      }
    } catch {
      /* tarayıcı depolaması yoksa varsayılan kısayollar */
    }
  }, [slug]);

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
    // Kaynak: telefonda 24 px, tablet/masaüstü üst çubuğunda 26 px ikon (Destek.dc.html).
    try {
      setIconPx(window.matchMedia("(max-width: 699.98px)").matches ? 24 : 26);
    } catch {
      /* matchMedia yok */
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
      temaYaz(n ? "koyu" : "acik");
      return n;
    });
  }, []);

  const closeMenu = useCallback(() => setMenu(false), []);


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


  const closeHelp = useCallback(() => {
    setHelp(null);
    setSentCode(null);
  }, []);
  const openForm = useCallback(() => {
    feedback.minor();
    setSentCode(null);
    setHelp("form");
  }, []);

  const pick = (h: PanoLink): void => {
    setHaloOpen(false);
    if (h.action === "problem") setProblem(true);
  };
  const shown = (mine === null ? halo : halo.filter((h) => mine.includes(h.k))).slice(0, MAX_SHORTCUTS);
  const openPicker = (): void => {
    setHaloOpen(false);
    setPicker(shown.map((h) => h.k));
  };
  const togglePick = (k: string): void =>
    setPicker((p) => (p === null ? p : p.includes(k) ? p.filter((x) => x !== k) : p.length >= MAX_SHORTCUTS ? p : [...p, k]));
  const savePicker = (): void => {
    if (picker === null) return;
    setMine(picker);
    try {
      window.localStorage.setItem(MINE_KEY(slug), JSON.stringify(picker));
    } catch {
      /* hatırlanamaz; seçim bu oturumda kalır */
    }
    setPicker(null);
  };

  return (
    <>
      <div className={`dzp dzdx${dark ? " dz-dark" : ""}`} data-testid="pano">
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
                  {bell !== undefined ? (
                    <Link href={bell.href} className="tb tb-bell" style={{ background: dz("E56A00"), textDecoration: "none" }} aria-label={t("bellAria", { n: bell.n })} data-testid="pano-bell">
                      <svg className="ico" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                        <path d={PICON.bell} />
                        <path d={PICON.bellFoot} />
                      </svg>
                      <span>{t("bell")}</span>
                      {bell.n > 0 ? (
                        <em className="tbadge" style={{ fontStyle: "normal" }}>
                          {bell.n > 99 ? "99+" : bell.n}
                        </em>
                      ) : null}
                    </Link>
                  ) : null}
                  {canReport ? (
                    <button
                      type="button"
                      className={`tb tb-issue${problem ? " on" : ""}`}
                      aria-label={td("issue")}
                      title={td("issueTitle")}
                      aria-haspopup="dialog"
                      aria-expanded={problem}
                      onClick={() => {
                        feedback.minor();
                        setMenu(false);
                        setHaloOpen(false);
                        setProblem(true);
                      }}
                      data-testid="pano-problem"
                    >
                      <IssueIco size={iconPx} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={`tb tb-help${help !== null ? " on" : ""}${support.unread > 0 ? " unr" : ""}`}
                    aria-label={support.unread > 0 ? td("helpUnread", { n: support.unread }) : td("help")}
                    title={td("helpTitle")}
                    aria-haspopup="dialog"
                    aria-expanded={help !== null}
                    onClick={() => {
                      feedback.minor();
                      setMenu(false);
                      setHaloOpen(false);
                      setSentCode(null);
                      setHelp(hasTickets ? "list" : "form");
                    }}
                    data-testid="pano-help"
                  >
                    <HelpIco size={iconPx} cup />
                    {support.unread > 0 ? (
                      <em className="tbadge" style={{ fontStyle: "normal", background: dz("0E7C7B") }}>
                        {support.unread > 99 ? "99+" : support.unread}
                      </em>
                    ) : null}
                  </button>
                  <HesapDugme
                    team={team}
                    open={menu}
                    onClick={() => {
                      setMenu((m) => !m);
                      setHaloOpen(false);
                    }}
                  />
                  {settingsHref === undefined ? null : (
                    <Link href={settingsHref} className="tb tb-gear" style={{ textDecoration: "none", "--i": dz("0E7C7B") } as CSSProperties} aria-label={t("settings")}>
                      <Ico d={PICON.gear} size={24} />
                      <span>{t("settingsShort")}</span>
                    </Link>
                  )}
                </nav>
              </header>

              <main className="inner">{children}</main>

              {halo.length > 0 ? (
                <div className="fab" style={fabStyle} onPointerDown={fabDown} onPointerMove={fabMove} onPointerUp={fabUp} onPointerCancel={fabUp}>
                  {/* T-967 (B-87, Destek.dc.html öneri 1): Modüller ızgarasıyla karışmasın diye şimşek + mor cam. */}
                  <button type="button" className={`fabb zap${haloOpen ? " on" : ""}`} aria-label={t("shortcuts")} aria-expanded={haloOpen} data-testid="pano-fab">
                    <svg className="ico" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                      <path d={DICON.zap} />
                    </svg>
                  </button>
                </div>
              ) : null}
              {haloOpen ? (
                <>
                  <div className="hback" onClick={() => setHaloOpen(false)} />
                  <div className="halo" style={haloStyle} role="menu" aria-label={t("shortcuts")}>
                    {shown.map((h, i) => {
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
                        <Link key={h.k} href={h.href} className="hb" role="menuitem" style={style}>
                          {inner}
                        </Link>
                      );
                    })}
                    <button type="button" className="hb" role="menuitem" style={{ animationDelay: `${shown.length * 35}ms` }} onClick={openPicker} data-testid="pano-edit">
                      <i style={{ background: dz("6A7F91") }}>
                        <Ico d={PICON.plus} size={20} />
                      </i>
                      <span>{t("edit")}</span>
                    </button>
                  </div>
                </>
              ) : null}

              {picker !== null ? (
                <div className="page" style={{ zIndex: 22 }} role="dialog" aria-label={t("pickerTitle")} data-testid="pano-picker">
                  <header className="top">
                    <span className="brand">
                      <span className="alic" style={{ background: dz("172E42"), width: 44, height: 44, borderRadius: 14 }}>
                        <svg className="ico" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                          <rect x="4" y="4" width="6.5" height="6.5" rx="1.8" />
                          <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8" />
                          <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8" />
                          <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8" />
                        </svg>
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <b>{t("pickerTitle")}</b>
                        <small>{t("pickerSub", { n: MAX_SHORTCUTS })}</small>
                      </span>
                    </span>
                  </header>
                  <div className="inner" style={{ gap: 10 }}>
                    <div className="pk">
                      {halo.map((h) => {
                        const on = picker.includes(h.k);
                        return (
                          <button key={h.k} type="button" className={`pp${on ? " on" : ""}`} aria-pressed={on} onClick={() => togglePick(h.k)} data-shortcut={h.k}>
                            <span className="av" style={{ background: dz(h.color), borderRadius: 12 }}>
                              <Ico d={h.d} size={20} />
                            </span>
                            <span style={{ minWidth: 0 }}>
                              <b>{h.label}</b>
                            </span>
                            <span className="chk">
                              <Ico d={PICON.check} size={16} />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="mono" style={{ margin: 0, fontSize: 11, color: dz("4E6476") }}>
                      {t("pickerNote")}
                    </p>
                  </div>
                  <nav className="dock subdock" aria-label={t("dock")}>
                    <div className="dockin">
                      <button type="button" className="dk" aria-label={t("back")} onClick={() => setPicker(null)}>
                        <Ico d={PICON.back} size={26} />
                        <span>{t("backShort")}</span>
                      </button>
                      <button type="button" className="dk big scan" aria-label={t("save")} onClick={savePicker} data-testid="pano-picker-save">
                        <Ico d={PICON.check} size={26} />
                        <span>{t("saveShort")}</span>
                      </button>
                      <span />
                    </div>
                  </nav>
                </div>
              ) : null}

              {menu ? <HesapMenu team={team} me={me} links={teamLinks} dark={dark} onToggleTheme={toggleTheme} onClose={closeMenu} /> : null}
            </div>
          </div>
        </div>
      </div>
      {/* T-958: alt cam çubuk Kabuk.dc.html ortak bileşeni (Geri pasif · Ana ekran · OKUT · Modüller · Etkin). T-967: Taleplerim açıkken
          Geri / Ana ekran sayfayı kapatır, ana işlem YENİ TALEP (Destek.dc.html D). */}
      <KabukBar
        dark={dark}
        home={help !== "list"}
        back={help === "list" ? { onClick: closeHelp } : undefined}
        homeNav={help === "list" ? { onClick: closeHelp } : undefined}
        main={
          help === "list"
            ? { label: td("newShort"), aria: td("newTicket"), d: DICON.plus, onClick: () => openForm(), testId: "support-new" }
            : { label: t("scanShort"), aria: t("scan"), d: KICON.scan, href: scanHref, testId: "pano-scan" }
        }
      />
      {help === "list" ? (
        <SupportList
          slug={slug}
          dark={dark}
          state={support}
          sentCode={sentCode}
          canReport={canReport}
          team={team}
          onIssue={() => {
            feedback.minor();
            setProblem(true);
          }}
          onNew={openForm}
          onTeam={() => {
            closeHelp();
            setMenu(true);
          }}
          onClose={closeHelp}
        />
      ) : null}
      {help === "form" ? (
        <SupportSheet
          slug={slug}
          dark={dark}
          appVersion={appVersion}
          onClose={closeHelp}
          onSent={(code) => {
            setSentCode(code);
            setHelp("list");
            void support.reload();
          }}
        />
      ) : null}
      {problem && canReport ? (
        <div className={`dz dzp-pop${dark ? " dz-dark" : ""}`}>
          <ProblemSheet slug={slug} onClose={() => setProblem(false)} />
        </div>
      ) : null}
    </>
  );
}
