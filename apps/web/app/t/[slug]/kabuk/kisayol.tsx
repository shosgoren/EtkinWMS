"use client";
// T-1102 (kullanıcı 27 Ekim: "yüzen kısayol her ekranda yok, özelleştirmede tüm modüller yok"): Pano.dc.html yüzen kısayolu (`.fab` +
// `.hback` + `.halo`, Düzenle seçici `.page > .pk > .pp`) artık ortak alt cam çubukla (KabukBar) birlikte HER ekranda çizilir; liste ve
// seçici üyenin Modüller sayfasındaki bütün modülleridir (yetkiyle süzülmüş `ctx.modules`; YAKINDA olanlar hariç). Görünüş kaynak sınıflarıyla
// (`.dzp` kapsamında, Hesap menüsü gibi sayfa kökünde `display: contents` kap); konum görüntü alanına göre (design/standart.css
// `.kisayol-kok`). Seçim ve konum kişisel kolaylık olarak tarayıcıda hatırlanır.
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { feedback } from "@wms/ui";
import { dz } from "../../../design/pano-tokens.ts";
import { dz as kdz } from "../../../design/kabuk-tokens.ts";
import { PICON } from "../../../design/pano-icons.ts";
import { DICON } from "../../../design/destek-icons.ts";
import { useKabuk } from "./kabuk-bar.tsx";

const FAB_KEY = "etkin-pano-fab";
const MINE_KEY = (slug: string): string => `etkin-kisayol:${slug}`;
const MAX_SHORTCUTS = 6;

function Ico({ d, size }: { d: string; size: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function KabukKisayol({ dark }: { dark: boolean }) {
  const t = useTranslations("pano");
  const tk = useTranslations("kabuk");
  const ctx = useKabuk();
  const slug = ctx?.slug ?? ctx?.base ?? "";
  const mods = (ctx?.modules ?? []).filter((m) => m.href !== null && m.id !== "home" && m.view === undefined);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<readonly string[] | null>(null);
  const [picker, setPicker] = useState<readonly string[] | null>(null);
  const [pos, setPos] = useState<{ fx: number; fy: number }>({ fx: 0.86, fy: 0.66 });
  const drag = useRef<{ moved: boolean; x: number; y: number } | null>(null);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = window.localStorage.getItem(MINE_KEY(slug));
      if (saved !== null) {
        const v = JSON.parse(saved) as unknown;
        if (Array.isArray(v) && v.every((x) => typeof x === "string")) setMine(v as string[]);
      }
      // T-1111: varsayılan yer sağ altta, alt çubuğun hemen üstü (eski 0,66 yükseklik liste/arama alanının üstüne biniyordu).
      setPos({ fx: 0.94, fy: Math.min(0.9, Math.max(0.08, (window.innerHeight - 150) / window.innerHeight)) });
      const raw = window.localStorage.getItem(FAB_KEY);
      if (raw !== null) {
        const v = JSON.parse(raw) as { fx?: unknown; fy?: unknown };
        if (typeof v.fx === "number" && typeof v.fy === "number") setPos({ fx: Math.min(0.94, Math.max(0.06, v.fx)), fy: Math.min(0.9, Math.max(0.08, v.fy)) });
      }
    } catch {
      /* tarayıcı depolaması yoksa varsayılan kısayollar ve konum */
    }
  }, [slug]);

  useEffect(() => {
    if (!open && picker === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      setOpen(false);
      setPicker(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, picker]);

  if (!mounted || mods.length === 0) return null;

  // Kaynak fabDown / fabMove / fabUp: 8 px'ten az oynarsa dokunuş (halka aç/kapa), fazlası sürükleme (görüntü alanına göre).
  const fabDown = (e: PointerEvent<HTMLDivElement>): void => {
    drag.current = { moved: false, x: e.clientX, y: e.clientY };
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
    setPos({ fx: Math.min(0.94, Math.max(0.06, e.clientX / window.innerWidth)), fy: Math.min(0.9, Math.max(0.08, e.clientY / window.innerHeight)) });
    setOpen(false);
  };
  const fabUp = (): void => {
    const d = drag.current;
    drag.current = null;
    if (d === null) return;
    if (!d.moved) {
      feedback.minor();
      setOpen((o) => !o);
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
  const shown = (mine === null ? mods : mine.map((k) => mods.find((m) => m.id === k)).filter((m) => m !== undefined)).slice(0, MAX_SHORTCUTS);
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
    feedback.ok();
    setPicker(null);
  };

  return createPortal(
    <div className={`dzp kisayol-kok${dark ? " dz-dark" : ""}`}>
      <div className="fab" style={fabStyle} onPointerDown={fabDown} onPointerMove={fabMove} onPointerUp={fabUp} onPointerCancel={fabUp}>
        {/* T-967 (B-87, Destek.dc.html öneri 1): Modüller ızgarasıyla karışmasın diye şimşek + mor cam. */}
        <button type="button" className={`fabb zap${open ? " on" : ""}`} aria-label={t("shortcuts")} aria-expanded={open} data-testid="pano-fab">
          <Ico d={DICON.zap} size={20} />
        </button>
      </div>
      {open ? (
        <>
          <div className="hback" onClick={() => setOpen(false)} />
          <div className="halo" style={haloStyle} role="menu" aria-label={t("shortcuts")}>
            {shown.map((m, i) => (
              <Link key={m.id} href={m.href ?? "#"} className="hb" role="menuitem" style={{ animationDelay: `${i * 35}ms`, textDecoration: "none" }} onClick={() => setOpen(false)} data-shortcut={m.id}>
                {/* T-1111: modül rengi kabuk belirteci (`--color-dz-x-*` yalnız `.dzk` kapsamında tanımlı; Pano kökünde boş kalıyordu → simge görünmüyordu). */}
                <i className="dzk" style={{ background: kdz(m.color) }}>
                  <Ico d={m.d} size={20} />
                </i>
                <span>{tk(`mod.${m.id}.name`)}</span>
              </Link>
            ))}
            <button
              type="button"
              className="hb"
              role="menuitem"
              style={{ animationDelay: `${shown.length * 35}ms` }}
              onClick={() => {
                setOpen(false);
                setPicker(shown.map((m) => m.id));
              }}
              data-testid="pano-edit"
            >
              <i style={{ background: dz("6A7F91") }}>
                <Ico d={PICON.plus} size={20} />
              </i>
              <span>{t("edit")}</span>
            </button>
          </div>
        </>
      ) : null}
      {picker !== null ? (
        <div className="page" role="dialog" aria-modal="true" aria-label={t("pickerTitle")} data-testid="pano-picker">
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
              {mods.map((m) => {
                const on = picker.includes(m.id);
                return (
                  <button key={m.id} type="button" className={`pp${on ? " on" : ""}`} aria-pressed={on} onClick={() => togglePick(m.id)} data-shortcut={m.id}>
                    <span className="av dzk" style={{ background: kdz(m.color), borderRadius: 12 }}>
                      <Ico d={m.d} size={20} />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <b>{tk(`mod.${m.id}.name`)}</b>
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
    </div>,
    document.body,
  );
}
