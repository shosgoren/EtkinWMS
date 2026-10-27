"use client";
// T-423 (I-18): Pano.dc.html uygulama kabuğu BİREBİR — `.wrap > .appzone > .app`, üst çubuk (`.top`: marka, `.tools`), alt cam çubuk
// (T-958'den beri ortak `KabukBar`: Kabuk.dc.html Geri · Ana ekran · OKUT · Modüller · Etkin), Ekip/Hesap menüsü (`.halo.tmenu`). T-1102: yüzen kısayol (`.fab` + `.halo`, Düzenle seçici) ortak `KabukKisayol`a taşındı (her ekranda).
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
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { dz } from "../../../design/pano-tokens.ts";
import { PICON } from "../../../design/pano-icons.ts";
import { temaYaz } from "../../../design/theme.ts";
import { ProblemSheet } from "../problem-sheet.tsx";
import { HesapDugme, HesapMenu } from "./hesap-menu.tsx";
import { StAyarlar, StSaat, StSonIslemler, StTema } from "../kalip/ust-standart.tsx";
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
  /** T-1050 (STANDART §1): üst çubukta "Merhaba <ad>" (tuval); telefonda yer yok → yalnız logo, selam içerikte başlık. */
  readonly greet: string;
  readonly team: boolean;
  readonly me: { readonly ini: string; readonly name: string; readonly group: string; readonly color: string };
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


export function PanoShell({ slug, dark: initialDark, brandSub, greet, team, me, teamLinks = [], settingsHref, scanHref, canReport, bell, appVersion = null, children }: PanoShellProps) {
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
  const [problem, setProblem] = useState(false);
  const [online, setOnline] = useState(true);
  useEffect(() => {
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
    if (!menu) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  const toggleTheme = useCallback(() => {
    setDark((d) => {
      const n = !d;
      temaYaz(n ? "koyu" : "acik");
      return n;
    });
  }, []);

  const closeMenu = useCallback(() => setMenu(false), []);


  const closeHelp = useCallback(() => {
    setHelp(null);
    setSentCode(null);
  }, []);
  const openForm = useCallback(() => {
    feedback.minor();
    setSentCode(null);
    setHelp("form");
  }, []);

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
                  {/* Selamın erişilebilir adı sayfanın h1'i (`.hello`); burası görsel tekrar. */}
                  <span className="stselam" style={{ minWidth: 0 }} aria-hidden="true">
                    <b>{greet}</b>
                    <small>{brandSub}</small>
                  </span>
                </div>
                {/* T-1042 (STANDART.md §1): kalıp ekranlarıyla aynı üst çubuk — ortada saat, sağda tema → … → Ayarlar → Hesap. */}
                <StSaat />
                <nav className="tools" aria-label={t("tools")}>
                  <StSonIslemler slug={slug} />
                  <StTema dark={dark} onToggle={toggleTheme} />
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
                  <StAyarlar href={settingsHref} />
                  <HesapDugme
                    team={team}
                    ini={me.ini}
                    open={menu}
                    onClick={() => {
                      setMenu((m) => !m);
                    }}
                  />
                </nav>
              </header>

              <main className="inner">{children}</main>

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
