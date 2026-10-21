"use client";
// I-18: Görevlerim üst sağ düğmeleri (kaynak `.hic`) ve `.app` içindeki açılır kutu/pencere. Görünüm kaynakla aynı; işlevler gerçek
// (DESIGN-PARITY §6): bağlantı noktası tarayıcının gerçek çevrimiçi durumu, tema düğmesi kaynaktaki açık/koyu geçişi, sarı ⚠ düğmesi
// kaynaktaki "demo" açılır kutusu (`.demo`/`.dm`) görünümünde Sorun bildir · Nasıl kullanılır? · Menü.
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useDz } from "../../design/dz-root.tsx";
import { C, dz } from "../../design/bakis-tokens.ts";
import { ICON } from "../../design/bakis-icons.ts";
import { openAppMenu } from "./app-menu.tsx";
import { ProblemSheet } from "./problem-sheet.tsx";

const GUIDE_EVENT = "etkinwms:guide-open";
const MENU = "home-actions";
const PROBLEM = "problem";

function Ico({ d, size, sw }: { d: string; size: number; sw?: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={sw === undefined ? undefined : { strokeWidth: sw }}>
      <path d={d} />
    </svg>
  );
}

export function HomeControls() {
  const t = useTranslations("home.gv");
  const { toggleTheme, overlay, setOverlay } = useDz();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = (): void => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  const netLabel = online ? t("online") : t("offline");
  return (
    <div className="hic">
      <button
        type="button"
        className={`icb${online ? "" : " off"}`}
        style={{ background: C.surface, color: online ? C.biten : dz("E56A00") }}
        aria-label={netLabel}
        title={netLabel}
        data-online={online ? "true" : "false"}
      >
        <span className="netdot" />
      </button>
      <button type="button" className="icb" style={{ background: C.surface }} onClick={toggleTheme} aria-label={t("theme")} data-testid="theme-toggle">
        <Ico d={ICON.theme} size={22} />
      </button>
      <button
        type="button"
        className="icb"
        style={{ background: dz("F4B400"), color: dz("1A1300") }}
        onClick={() => setOverlay(overlay === MENU ? null : MENU)}
        aria-label={t("actions")}
        aria-haspopup="menu"
        aria-expanded={overlay === MENU}
        data-testid="home-actions"
      >
        <Ico d={ICON.warn} size={22} />
      </button>
    </div>
  );
}

export function HomeOverlays({ slug, canReport }: { slug: string; canReport: boolean }) {
  const t = useTranslations("home.gv");
  const { overlay, setOverlay } = useDz();
  if (overlay === PROBLEM && canReport) return <ProblemSheet slug={slug} onClose={() => setOverlay(null)} />;
  if (overlay !== MENU) return null;
  const items = [
    { k: "problem", l: t("reportProblem"), d: ICON.warn, bg: dz("C62828"), fg: dz("FFFFFF"), go: () => setOverlay(PROBLEM), testId: "report-problem" },
    { k: "guide", l: t("guide"), d: ICON.bell, bg: dz("E56A00"), fg: dz("FFFFFF"), go: () => {
        setOverlay(null);
        window.dispatchEvent(new Event(GUIDE_EVENT));
      }, testId: "guide-trigger" },
    { k: "menu", l: t("menu"), d: ICON.list, bg: dz("172E42"), fg: dz("F4C542"), go: () => {
        setOverlay(null);
        openAppMenu();
      }, testId: "app-bar-menu" },
  ].filter((dm) => dm.k !== "problem" || canReport);
  return (
    <div className="demo" role="menu" aria-label={t("actions")}>
      {items.map((dm) => (
        <button key={dm.k} type="button" className="dm" role="menuitem" onClick={dm.go} data-testid={dm.testId} aria-haspopup={dm.k === "menu" ? "dialog" : undefined}>
          <span className="dmi" style={{ background: dm.bg, color: dm.fg }}>
            <Ico d={dm.d} size={20} />
          </span>
          {dm.l}
        </button>
      ))}
    </div>
  );
}
