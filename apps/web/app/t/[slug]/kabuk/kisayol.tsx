"use client";
// T-1102 (kullanıcı 27 Ekim: "yüzen kısayol her ekranda yok, özelleştirmede tüm modüller yok"): Pano.dc.html yüzen kısayolu (`.fab` +
// `.hback` + `.halo`, Düzenle seçici `.page > .pk > .pp`) artık ortak alt cam çubukla (KabukBar) birlikte HER ekranda çizilir; liste ve
// seçici üyenin Modüller sayfasındaki bütün modülleridir (yetkiyle süzülmüş `ctx.modules`; YAKINDA olanlar hariç). Görünüş kaynak sınıflarıyla
// (`.dzp` kapsamında, Hesap menüsü gibi sayfa kökünde `display: contents` kap); konum görüntü alanına göre (design/standart.css
// `.kisayol-kok`). Seçim ve konum kişisel kolaylık olarak tarayıcıda hatırlanır.
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import { feedback } from "@wms/ui";
import { dz } from "../../../design/pano-tokens.ts";
import { dz as kdz } from "../../../design/kabuk-tokens.ts";
import { PICON } from "../../../design/pano-icons.ts";
import { DICON } from "../../../design/destek-icons.ts";
import { useKabuk } from "./kabuk-bar.tsx";
import { OP_GUIDE_EVENT, currentGuide } from "../kalip/rehber-plan.ts";
import { JOURNEY_OPEN_EVENT } from "../yolculuk/steps.ts";
import { halkaOlculeri, halkaYeri, type HalkaYeri } from "./kisayol-yer.ts";

/** Eski genel rehber (Destek › Rehberi aç ile aynı olay). */
const GUIDE_EVENT = "etkinwms:guide-open";

const FAB_KEY = "etkin-pano-fab";
const MINE_KEY = (slug: string): string => `etkin-kisayol:${slug}`;
const MAX_SHORTCUTS = 6;
const FAB_YARICAP = 24;

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
  const path = usePathname();
  const query = useSearchParams();
  const slug = ctx?.slug ?? ctx?.base ?? "";
  const mods = (ctx?.modules ?? []).filter((m) => m.href !== null && m.id !== "home" && m.view === undefined);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<readonly string[] | null>(null);
  const [picker, setPicker] = useState<readonly string[] | null>(null);
  const [pos, setPos] = useState<{ fx: number; fy: number }>({ fx: 0.86, fy: 0.66 });
  const drag = useRef<{ moved: boolean; x: number; y: number } | null>(null);
  // T-1131: halkanın görünür alana göre yeri; `tasar` = listede aşağıda görünmeyen kısayol var (alt kenar solar).
  const [yer, setYer] = useState<HalkaYeri | null>(null);
  const [tasar, setTasar] = useState(false);
  const fabRef = useRef<HTMLDivElement | null>(null);
  const fabBtnRef = useRef<HTMLButtonElement | null>(null);
  const haloRef = useRef<HTMLDivElement | null>(null);
  const listeRef = useRef<HTMLDivElement | null>(null);
  const altRef = useRef<HTMLDivElement | null>(null);
  const perdeRef = useRef<HTMLDivElement | null>(null);
  const klavyeIle = useRef(false);

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
      // T-1131: halka Esc ile kapanınca odak şimşeğe döner (ALTIN-KURAL madde 11).
      if (open) fabBtnRef.current?.focus();
      setOpen(false);
      setPicker(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, picker]);

  // T-1131: halka açılınca (ve görünür alan değişince: döndürme, Safari çubukları, klavye, yakınlaştırma) yeri ve en büyük yüksekliği
  // görünür alandan yeniden hesaplanır; boyamadan önce (useLayoutEffect) yerleşir, ekranda taşmış hali hiç görünmez.
  useLayoutEffect(() => {
    if (!open) {
      setYer(null);
      return;
    }
    const yerlestir = (): void => {
      const halo = haloRef.current;
      const liste = listeRef.current;
      const fab = fabRef.current;
      const alt = altRef.current;
      const satir = alt?.querySelector<HTMLElement>(".hb");
      if (halo === null || liste === null || fab === null || alt === null || satir === null || satir === undefined) return;
      const vv = window.visualViewport;
      const gorunur = vv ? { x: vv.offsetLeft, y: vv.offsetTop, w: vv.width, h: vv.height } : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
      const p = perdeRef.current ? window.getComputedStyle(perdeRef.current) : null;
      const px = (v: string | undefined): number => Number.parseFloat(v ?? "") || 0;
      const guvenli = { top: px(p?.paddingTop), right: px(p?.paddingRight), bottom: px(p?.paddingBottom), left: px(p?.paddingLeft) };
      // Şimşek kabı 0×0 ve düğmenin merkezinde (açıkken düğme 45° döner; döndürülmüş kutu ölçülmez).
      const c = fab.getBoundingClientRect();
      const simsek = { x: c.left - FAB_YARICAP, y: c.top - FAB_YARICAP, w: 2 * FAB_YARICAP, h: 2 * FAB_YARICAP };
      // Doğal ölçü ölçülen parçalardan (satır, aralık, çerçeve) hesaplanır; o an hangi düzende çizildiğinden bağımsız.
      const as = window.getComputedStyle(alt);
      const olcu = halkaOlculeri({
        n: liste.querySelectorAll('[role="menuitem"]').length,
        satirH: satir.offsetHeight,
        ara: px(window.getComputedStyle(liste).rowGap),
        cerceve: halo.offsetHeight - liste.offsetHeight - alt.offsetHeight,
        altEk: px(as.paddingTop) + px(as.borderTopWidth),
      });
      setYer(halkaYeri(gorunur, guvenli, simsek, olcu.tek, olcu.iki));
    };
    yerlestir();
    const vv = window.visualViewport;
    window.addEventListener("resize", yerlestir);
    window.addEventListener("orientationchange", yerlestir);
    vv?.addEventListener("resize", yerlestir);
    vv?.addEventListener("scroll", yerlestir);
    return () => {
      window.removeEventListener("resize", yerlestir);
      window.removeEventListener("orientationchange", yerlestir);
      vv?.removeEventListener("resize", yerlestir);
      vv?.removeEventListener("scroll", yerlestir);
    };
  }, [open]);

  // Yerleşince: listede aşağıda kalan kısayol var mı (alt kenar solar; satırların giriş kayması taşma sayılmasın diye animasyon bitince
  // yeniden bakılır) ve klavyeyle açıldıysa odak ilk kısayola.
  useLayoutEffect(() => {
    if (yer === null) return;
    const liste = listeRef.current;
    if (liste !== null) setTasar(liste.scrollTop + liste.clientHeight < liste.scrollHeight - 2);
    if (klavyeIle.current) {
      klavyeIle.current = false;
      haloRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }
  }, [yer]);

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

  // T-1131: klavyeyle (Enter/Boşluk) gelen tıklamada işaretçi olayı yoktur; halka burada açılır. Dokunuş/fare tıklaması (detail > 0)
  // fabUp'ta işlendi (T-1123: dokunuşun ardından gelen tıklama yok sayılır).
  const fabClick = (e: MouseEvent<HTMLButtonElement>): void => {
    if (e.detail !== 0) return;
    feedback.minor();
    klavyeIle.current = !open;
    setOpen((o) => !o);
  };
  // Halkada yukarı/aşağı ok, Home/End: kısayollar arasında gezinme (liste kayar, alt şerit dahil).
  const haloKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const ogeler = [...(haloRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (ogeler.length === 0) return;
    e.preventDefault();
    const i = ogeler.indexOf(document.activeElement as HTMLElement);
    const n = e.key === "Home" ? 0 : e.key === "End" ? ogeler.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + ogeler.length) % ogeler.length;
    ogeler[n]?.focus();
  };
  const listeKaydi = (): void => {
    const liste = listeRef.current;
    if (liste !== null) setTasar(liste.scrollTop + liste.clientHeight < liste.scrollHeight - 2);
  };

  const { fx, fy } = pos;
  const fabStyle: CSSProperties = { left: `${(fx * 100).toFixed(1)}%`, top: `${(fy * 100).toFixed(1)}%` };
  // Yerleşmeden önceki ilk çizim (ölçüm) görünmez; useLayoutEffect boyamadan önce yerleştirir.
  const haloStyle: CSSProperties =
    yer === null ? { left: 0, top: 0, visibility: "hidden" } : { left: yer.left, top: yer.top, maxHeight: yer.maxHeight, width: yer.width };
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
      <div className="fab" ref={fabRef} style={fabStyle} onPointerDown={fabDown} onPointerMove={fabMove} onPointerUp={fabUp} onPointerCancel={fabUp}>
        {/* T-967 (B-87, Destek.dc.html öneri 1): Modüller ızgarasıyla karışmasın diye şimşek + mor cam. */}
        <button
          ref={fabBtnRef}
          type="button"
          className={`fabb zap${open ? " on" : ""}`}
          aria-label={t("shortcuts")}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={fabClick}
          data-testid="pano-fab"
        >
          <Ico d={DICON.zap} size={20} />
        </button>
      </div>
      {open ? (
        <>
          <div className="hback" ref={perdeRef} onClick={() => setOpen(false)} />
          <div className={`halo${yer?.kompakt ? " kompakt" : ""}`} ref={haloRef} style={haloStyle} role="menu" aria-label={t("shortcuts")} data-yan={yer?.yan} onKeyDown={haloKey}>
            <div className={`kys-liste${tasar ? " tasar" : ""}`} ref={listeRef} role="none" onScroll={listeKaydi} onAnimationEnd={listeKaydi} data-testid="pano-fab-list">
              {shown.map((m, i) => (
                <Link key={m.id} href={m.href ?? "#"} className="hb" role="menuitem" style={{ animationDelay: `${i * 35}ms`, textDecoration: "none" }} onClick={() => setOpen(false)} data-shortcut={m.id}>
                  {/* T-1111: modül rengi kabuk belirteci (`--color-dz-x-*` yalnız `.dzk` kapsamında tanımlı; Pano kökünde boş kalıyordu → simge görünmüyordu). */}
                  <i className="dzk" style={{ background: kdz(m.color) }}>
                    <Ico d={m.d} size={20} />
                  </i>
                  <span>{tk(`mod.${m.id}.name`)}</span>
                </Link>
              ))}
            </div>
            {/* T-1131: Rehber + Düzenle alt şeritte sabit; liste ne kadar uzun olursa olsun kaydırmadan görünür. */}
            <div className="kys-alt" ref={altRef} role="none">
              {/* T-1120 (kullanıcı 28 Ekim: "rehber her yerde gözükmeli, yüzen şimşek gibi"): şimşek her ekranda; halkadaki "Rehber" bu ekranın
                  rehberini başlatır, ekranın rehberi yoksa seçiciyi açar; işlem rehberi yetkisi yoksa kurulum yolculuğu ya da eski rehber
                  (Destek › Rehberi aç ile aynı sıra). */}
              <button
                type="button"
                className="hb"
                role="menuitem"
                style={{ animationDelay: `${shown.length * 35}ms` }}
                onClick={() => {
                  feedback.minor();
                  setOpen(false);
                  const ekran = currentGuide(path, query.toString());
                  const islem = !window.dispatchEvent(new CustomEvent(OP_GUIDE_EVENT, { detail: ekran ?? "pick", cancelable: true }));
                  if (islem) return;
                  const yolculuk = !window.dispatchEvent(new Event(JOURNEY_OPEN_EVENT, { cancelable: true }));
                  if (!yolculuk) window.dispatchEvent(new Event(GUIDE_EVENT));
                }}
                data-testid="pano-guide"
              >
                <i style={{ background: dz("0E7C7B") }}>
                  <svg className="ico" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="9.5" />
                    <path d={DICON.guideQ} />
                    <path d={DICON.guideDot} />
                  </svg>
                </i>
                <span>{t("guideOpen")}</span>
              </button>
              <button
                type="button"
                className="hb"
                role="menuitem"
                style={{ animationDelay: `${(shown.length + 1) * 35}ms` }}
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
