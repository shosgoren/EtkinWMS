"use client";
// T-1026: kısa başlangıç + tekrar açılabilir kurulum adımları. Çalışma kartı ortak KalipRehberKart; perde yalnız adım seçicisinde.
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { feedback, intlDil } from "@wms/ui";
import { JICON } from "../../../design/yolculuk-icons.ts";
import { dz } from "../../../design/yolculuk-tokens.ts";
import { Ico } from "../kalip/ekran.tsx";
import { useModalFocus } from "../kalip/odak.ts";
import { KalipPerdeKatman, type PerdeDelik } from "../kalip/perde.tsx";
import { setOpeningStockAction } from "../integrations/actions.ts";
import { getJourneyAction, setJourneyChoiceAction } from "./actions.ts";
import { setYolDurum, useYolDurum } from "./durum.ts";
import { setYolSpot } from "./spot.ts";
import { JOURNEY_OPEN_EVENT, STEP_KEYS, filterJourney, firstOpen, STEP_UI, isStepKey, ringDash, stepPlan, stopFor, stripState, type JourneyData, type StepKey } from "./steps.ts";

import { cikisSor } from "../kalip/cikis.tsx";
import { useKabuk } from "../kabuk/kabuk-bar.tsx";
import { KalipRehberKart } from "../kalip/rehber.tsx";

const ACTIVE_KEY = "etkinwms.yol.active";
/** Kısa başlangıç turunun adımları (yeni kiracıda ilk girişte). */
const SHORT_STEPS: readonly StepKey[] = ["cards", "shelves", "parties", "stock"];
const POLL_MS = 6000;
const GAP = 14;
const EDGE = 12;

function readActive(key: string): StepKey | null {
  try {
    const v = sessionStorage.getItem(key);
    return isStepKey(v) ? v : null;
  } catch {
    return null;
  }
}
function writeActive(v: StepKey | null, key: string): void {
  try {
    if (v === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, v);
  } catch {
    /* depolama yoksa yalnız sunucudaki sıra */
  }
}

/** İlerleme halkası (kaynak `.yring`). */
export function YolHalka({ done, total, aria }: { done: number; total: number; aria: string }) {
  return (
    <span className="yring" role="img" aria-label={aria} data-testid="yol-ring">
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle className="ytrack" cx="18" cy="18" r="15" fill="none" strokeWidth="4" />
        <circle className="ydone" cx="18" cy="18" r="15" fill="none" strokeWidth="4" strokeLinecap="round" transform="rotate(-90 18 18)" style={{ strokeDasharray: ringDash(done, total) }} />
      </svg>
      <b>
        {done}
        <small>/{total}</small>
      </b>
    </span>
  );
}

/** Pano küçük halkası (kaynak `.ymini`, ikincil): dokununca adım listesi. Kutlama kapatıldıysa çizilmez. */
export function YolculukKart({ data: original, dark }: { data: JourneyData; dark: boolean }) {
  const ctx = useKabuk();
  const data = filterJourney(original, ctx?.guides?.setup ?? STEP_KEYS);
  const t = useTranslations("yolculuk");
  const locale = useLocale();
  if (data.dismissed) return null;
  return (
    <div className={`dzj${dark ? " dz-dark" : ""}`} style={{ display: "contents" }}>
      <button
        type="button"
        className="ymini"
        aria-label={t("cardAria", { done: data.done, total: data.total })}
        data-testid="yol-card"
        data-done={data.done}
        data-total={data.total}
        onClick={() => {
          feedback.minor();
          window.dispatchEvent(new CustomEvent(JOURNEY_OPEN_EVENT, { cancelable: true, detail: "list" }));
        }}
      >
        <YolHalka done={data.done} total={data.total} aria={t("ringAria", { done: data.done, total: data.total })} />
        <span>
          <b>{data.complete ? t("titleDone") : t("mini")}</b>
          <small>{t("miniSub", { done: data.done, total: data.total }).toLocaleUpperCase(intlDil(locale))}</small>
        </span>
      </button>
    </div>
  );
}

/**
 * T-1054 (kullanıcı 26 Ekim): Ürünler / Depolar ekranında eski 3 adımlı "depo → raf → ürün" kutusunun yerine asıl kurulum yolculuğunun
 * girişi (Pano'daki küçük halka kartı). Dokununca adım listesi açılır ve kaldığın adımdan devam edilir. Kurulum bitti, kutlama kapatıldı ya da
 * rol yolculuğu görmüyorsa çizilmez.
 */
export function YolculukGiris({ dark }: { dark: boolean }) {
  const data = useYolDurum();
  const ctx = useKabuk();
  if (data === null || data.dismissed) return null;
  // Üyenin görebildiği adımlarla (Pano kartıyla aynı süzgeç): hepsi tamamsa ya da hiç adım yoksa kart yok.
  const mine = filterJourney(data, ctx?.guides?.setup ?? STEP_KEYS);
  if (mine.total === 0 || mine.complete) return null;
  return <YolculukKart data={data} dark={dark} />;
}

interface TipPos {
  readonly style: CSSProperties;
  readonly cls: "above" | "below" | "";
  readonly arrow: number | null;
}

/** Balon konumu: hedefin altında (üst yarıda) ya da üstünde; yatayda ekran içinde; hedef yoksa alt çubuğun üstünde ortada. */
function tipPosition(hole: PerdeDelik | null, vw: number, vh: number): TipPos {
  const w = Math.min(360, vw - EDGE * 2);
  if (hole === null) return { style: { left: (vw - w) / 2, bottom: 136, width: w }, cls: "", arrow: null };
  const cx = hole.x + hole.w / 2;
  const left = Math.min(Math.max(cx - w / 2, EDGE), vw - w - EDGE);
  const arrow = Math.min(Math.max(cx - left, 22), w - 22);
  const below = hole.y + hole.h / 2 < vh / 2;
  return below
    ? { style: { left, top: Math.min(hole.y + hole.h + GAP, vh - 160), width: w }, cls: "below", arrow }
    : { style: { left, bottom: Math.min(vh - hole.y + GAP, vh - 160), width: w }, cls: "above", arrow };
}

/** Kiracı düzeninde (yalnız hesap sahibi / depo yöneticisi): spotlight tur, adım listesi ve kutlama. */
export function YolculukKatman({ slug, userId, dark: initialDark, initial = null }: { slug: string; userId: string; dark: boolean; initial?: JourneyData | null }) {
  const t = useTranslations("yolculuk");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const base = `/t/${encodeURIComponent(slug)}`;
  const sessionKey = `${ACTIVE_KEY}:${userId}:${slug}`;

  const ctx = useKabuk();
  const allowed = ctx?.guides?.setup ?? STEP_KEYS;
  const operationOpen = ctx?.guideOwner === "operation";
  const setGuideOwner = ctx?.setGuideOwner;
  const [rawData, setData] = useState<JourneyData | null>(initial);
  const data = useMemo(() => rawData === null ? null : filterJourney(rawData, allowed), [rawData, allowed]);
  // T-1054: ekranlardaki giriş kartı aynı veriyi okur (ayrı sunucu çağrısı yok).
  useEffect(() => {
    setYolDurum(rawData);
  }, [rawData]);
  useEffect(() => () => setYolDurum(null), []);
  const [replay, setReplay] = useState(false);
  const [shortTour, setShortTour] = useState(false);
  const [paused, setPaused] = useState(false);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const rememberPaused = useCallback((next: boolean): void => {
    setPaused(next);
    try { sessionStorage.setItem(`${sessionKey}.paused`, String(next)); } catch { /* isteğe bağlı */ }
  }, [sessionKey]);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dark, setDark] = useState(initialDark);
  const [surface, setSurface] = useState<string | null>(null);
  useEffect(() => {
    const check = (): void => { const selectors = ["warehouse-form", "bulk-form", "team-add-qr", "team-qr-new", "aktar-new", "document-state"]; setSurface(selectors.find(k => { const e=document.querySelector(`[data-testid="${k}"]`);return e!==null&&e.getBoundingClientRect().width>0; })??null); };
    check();const id=window.setInterval(check,300);return()=>window.clearInterval(id);
  }, [pathname]);
  const [hole, setHole] = useState<PerdeDelik | null>(null);
  const [vp, setVp] = useState({ w: 1280, h: 800 });
  const [override, setOverride] = useState<StepKey | null>(null);
  const [okStep, setOkStep] = useState<StepKey | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const prevDone = useRef<Partial<Record<StepKey, boolean>>>({});
  const autoStarted = useRef(false);
  const celebrated = useRef(false);

  const load = useCallback(async (): Promise<JourneyData | null> => {
    const r = await getJourneyAction({ slug });
    if (!r.ok) return null;
    setData(r.data);
    return filterJourney(r.data, allowed);
  }, [slug, allowed]);

  const syncDark = useCallback(() => {
    const root = document.querySelector(".kalip, .dzp, .dzk");
    setDark(root === null ? initialDark : root.classList.contains("dz-dark"));
  }, [initialDark]);

  const choose = useCallback(
    async (choice: Record<string, unknown>): Promise<JourneyData | null> => {
      setBusy(true);
      const r = await setJourneyChoiceAction({ slug, ...choice });
      setBusy(false);
      if (!r.ok) {
        feedback.error(t("toast.failed"));
        return null;
      }
      setData(r.data);
      return filterJourney(r.data, allowed);
    },
    [slug, t, allowed],
  );

  // İlk durum düzenden (sunucu). Ekran değişince yalnız tur sürerken (ya da ilk durum okunamadıysa) yeniden okunur: eylem hız sınırı
  // kovası her gezinmede tüketilmesin.
  const needRead = useRef(true);
  needRead.current = data === null || data.tour === "ACTIVE";
  useEffect(() => {
    setOverride(readActive(sessionKey));
    syncDark();
    if (needRead.current) void load();
  }, [pathname, load, syncDark, sessionKey]);
  useEffect(() => {
    try {
      setShortTour(sessionStorage.getItem(`${sessionKey}.short`) === "true");
      setReplay(sessionStorage.getItem(`${sessionKey}.replay`) === "true");
      setPaused(sessionStorage.getItem(`${sessionKey}.paused`) === "true");
    } catch { /* isteğe bağlı */ }
    setSessionLoaded(true);
  }, [sessionKey]);
  useEffect(() => {
    if (!sessionLoaded) return;
    try {
      sessionStorage.setItem(`${sessionKey}.short`, String(shortTour));
      sessionStorage.setItem(`${sessionKey}.replay`, String(replay));
      sessionStorage.setItem(`${sessionKey}.paused`, String(paused));
    } catch { /* isteğe bağlı */ }
  }, [shortTour, replay, paused, sessionLoaded, sessionKey]);
  // Görünüm alanı (balon konumu hedefsiz de ekran içinde kalsın).
  useEffect(() => {
    const size = (): void => setVp((c) => (c.w === window.innerWidth && c.h === window.innerHeight ? c : { w: window.innerWidth, h: window.innerHeight }));
    size();
    window.addEventListener("resize", size);
    return () => window.removeEventListener("resize", size);
  }, []);
  useEffect(() => {
    const check = (): void => setGuideOpen(document.querySelector(".guide-dialog[open]") !== null);
    check();
    const id = window.setInterval(check, 500);
    return () => window.clearInterval(id);
  }, []);

  const tourOn = data !== null && data.tour === "ACTIVE" && (!data.complete || replay) && !sheet && !guideOpen && !paused && sessionLoaded && !operationOpen;

  // Yeni kiracı: hiç adım tamam değilken tur ilk girişte kendiliğinden başlar (verisi olan kiracıda başlamaz).
  useEffect(() => {
    if (data === null || autoStarted.current || guideOpen || paused || !sessionLoaded || operationOpen) return;
    if (data.tour === null && data.done === 0 && !data.dismissed && !data.complete) {
      autoStarted.current = true;
      setShortTour(true);
      void choose({ tour: "start" });
    }
  }, [data, guideOpen, choose, paused, sessionLoaded, operationOpen]);

  // Tur ya da liste açıkken yolculuk düzenli okunur (görünür sekmede): adım verisi oluşunca kendiliğinden tamam.
  const tourActive = data?.tour === "ACTIVE" && !paused;
  useEffect(() => {
    if (!tourActive && !sheet) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [tourActive, sheet, load]);

  const steps = useMemo(() => data?.steps ?? [], [data]);
  const visible = useMemo(() => steps.filter((s) => !s.skipped && (!shortTour || SHORT_STEPS.includes(s.key))), [steps, shortTour]);
  const cur: StepKey | null = useMemo(() => {
    if (data === null) return null;
    const o = override === null ? undefined : steps.find((s) => s.key === override);
    if (o !== undefined && (replay || !o.done) && !o.skipped) return o.key;
    return visible.find(s => !s.done)?.key ?? null;
  }, [data, override, steps, replay, visible]);
  const plan = useMemo(() => (cur === null || data === null ? null : stepPlan(base, cur, data)), [cur, data, base]);
  const stop = plan === null ? null : stopFor(plan, pathname);
  const targetSel = tourOn && stop !== null && stop.target !== null ? `[data-tour="${stop.target}"]` : null;
  const barTarget = stop?.target === "main";
  const stopTarget = stop?.target ?? null;

  const titleOf = useCallback((k: StepKey): string => t(`steps.${k}.title`), [t]);

  const go = useCallback(
    (k: StepKey, d: JourneyData): void => {
      cikisSor(() => { writeActive(k, sessionKey);
      setOverride(k);
      router.push(stepPlan(base, k, d).href); });
    },
    [base, router, sessionKey],
  );

  // Tamam geçişi: tur sürerken adım verisi oluştu → ses + balon; kısa süre sonra sıradaki adımın ekranı.
  useEffect(() => {
    if (data === null || paused || !sessionLoaded || operationOpen) return undefined;
    let finished: StepKey | null = null;
    for (const s of data.steps) {
      if (prevDone.current[s.key] === false && s.done) finished = s.key;
      prevDone.current[s.key] = s.done;
    }
    if (finished !== null && data.tour === "ACTIVE" && !data.complete && !replay) {
      // T-1036: sıradaki = geride kalan ilk açık adım (İleri ile atlanan "Kartlarını getir" önce gelir). Kısa tur yalnız üç adımı da
      // bitince kapanır (eskiden stok bitince, kartlar yapılmamış olsa bile kapanıyordu).
      const nx = shortTour ? firstOpen(data.steps, SHORT_STEPS) : firstOpen(data.steps);
      if (shortTour && nx === null) { void choose({ tour: "close" }); setShortTour(false); return; }
      feedback.ok(t("toast.stepDone", { title: titleOf(finished) }));
      writeActive(null, sessionKey);
      setOverride(null);
      setOkStep(finished);
      const id = window.setTimeout(() => {
        setOkStep(null);
        if (nx !== null) cikisSor(() => router.push(stepPlan(base, nx, data).href));
      }, 1500);
      return () => window.clearTimeout(id);
    }
    if (data.complete && !replay && !data.dismissed && !celebrated.current && data.tour === "ACTIVE") {
      celebrated.current = true;
      feedback.ok(t("cele.toast"));
      setSheet(true);
    }
    return undefined;
  }, [data, base, router, t, titleOf, replay, shortTour, choose, sessionKey, paused, sessionLoaded, operationOpen]);

  // Hedefi ölç: `[data-tour]` öğesi; boyut, kaydırma ve görünürlük değişince yeniden. Görünmezse delik yok, balon ortada.
  useEffect(() => {
    if (targetSel === null) {
      setYolSpot(null);
      setHole(null);
      return undefined;
    }
    // Çalışma kartı hiçbir alt çubuk yuvasını bulanıklaştırmaz.
    setYolSpot(null);
    const measure = (): void => {
      setVp((c) => (c.w === window.innerWidth && c.h === window.innerHeight ? c : { w: window.innerWidth, h: window.innerHeight }));
      const el = document.querySelector(targetSel);
      if (el === null) {
        setHole(null);
        return;
      }
      // Hedefin açtığı menü (`data-tour-follow`) de delikte kalır: kullanıcı menüden seçebilsin (ör. Excel › İçeri al).
      const follow = stopTarget === null ? [] : [...document.querySelectorAll(`[data-tour-follow="${stopTarget}"]`)];
      const rects = [el.getBoundingClientRect(), ...follow.map((f) => f.getBoundingClientRect()).filter((x) => x.width > 0 && x.height > 0)];
      const r = rects.reduce((a, x) => {
        const left = Math.min(a.left, x.left);
        const top = Math.min(a.top, x.top);
        const right = Math.max(a.right, x.right);
        const bottom = Math.max(a.bottom, x.bottom);
        return { left, top, right, bottom, width: right - left, height: bottom - top };
      }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity, width: 0, height: 0 });
      const shown = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth && getComputedStyle(el).visibility !== "hidden";
      if (!shown) {
        setHole(null);
        return;
      }
      const pad = 8;
      const next = { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
      setHole((c) => (c !== null && Math.abs(c.x - next.x) < 1 && Math.abs(c.y - next.y) < 1 && Math.abs(c.w - next.w) < 1 && Math.abs(c.h - next.h) < 1 ? c : next));
    };
    measure();
    const id = window.setInterval(measure, 300);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      setYolSpot(null);
    };
  }, [targetSel, barTarget, stopTarget]);

  const closeTour = useCallback((): void => {
    feedback.minor();
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ses yok */
    }
    writeActive(null, sessionKey);
    setOverride(null);
    rememberPaused(true);
    setOkStep(null);
    setReplay(false);
    setShortTour(false);
    setData(d=>d===null?null:{...d,tour:"CLOSED"});
    void choose({ tour: "close" });
  }, [choose, sessionKey, rememberPaused]);

  useEffect(() => {
    const pause = (): void => { setSheet(false); rememberPaused(true); if (data?.tour === "ACTIVE") closeTour(); };
    window.addEventListener("etkinwms:journey-pause", pause);
    return () => window.removeEventListener("etkinwms:journey-pause", pause);
  }, [data?.tour, closeTour, rememberPaused]);

  const startTour = useCallback(
    async (k: StepKey | null): Promise<void> => {
      const d = await choose({ tour: "start" });
      if (d === null) return;
      setSheet(false);
      setShortTour(false);
      setGuideOwner?.("setup");
      rememberPaused(false);
      setReplay(k !== null && d.steps.some(s => s.key === k && s.done));
      const step = k ?? d.next;
      if (step !== null) go(step, d);
    },
    [choose, go, rememberPaused, setGuideOwner],
  );

  // Pano halkası → adım listesi; Destek › Rehberi aç → tur (olay iptal edilir: eski rehber açılmaz).
  useEffect(() => {
    const onOpen = (e: Event): void => {
      if (e.defaultPrevented) return;
      // Destek'in genel açma olayını işlem motoru alır; kurulum yalnız açık liste isteği veya işlem rehberi olmayan rolde açılır.
      if (!(e instanceof CustomEvent && e.detail === "list") && (ctx?.guides?.operations.length ?? 0) > 0) return;
      e.preventDefault();
      syncDark();
      const list = e instanceof CustomEvent && e.detail === "list";
      setGuideOwner?.("setup");
      void load().then((d) => {
        if (d === null) return;
        if (list) setSheet(true);
        else void startTour(null);
      });
    };
    window.addEventListener(JOURNEY_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(JOURNEY_OPEN_EVENT, onOpen);
  }, [load, syncDark, startTour, setGuideOwner, ctx?.guides?.operations.length]);

  const closeSheet = useCallback((): void => {
    feedback.minor();
    setSheet(false);
  }, []);

  const move = useCallback(
    (dir: 1 | -1): void => {
      if (data === null || cur === null) return;
      const i = visible.findIndex((s) => s.key === cur);
      const n = visible[i + dir];
      if (n === undefined) {
        // T-1036: sonda geride açık adım kaldıysa ona dön (ör. ürün kartları getirilmeden sona gelindi).
        const open = dir === 1 ? firstOpen(visible) : null;
        if (open !== null && open !== cur) { feedback.minor(); go(open, data); return; }
        if (dir === 1 && shortTour) { closeTour(); return; }
        feedback.warn(dir === 1 ? t("coach.noNext") : t("coach.noPrev"));
        return;
      }
      feedback.minor();
      go(n.key, data);
    },
    [data, cur, visible, go, t, shortTour, closeTour],
  );

  const skip = useCallback(
    async (k: StepKey): Promise<void> => {
      if (busy) return;
      cikisSor(() => { void (async () => {
      const d = await choose({ skip: k });
      if (d === null) return;
      feedback.undo(t("toast.skipped", { title: titleOf(k) }), t("unskip"), async () => {
        await choose({ unskip: k });
      });
      writeActive(null, sessionKey);
      setOverride(null);
      if (d.tour === "ACTIVE" && d.next !== null && !sheet) router.push(stepPlan(base, d.next, d).href);
      })(); });
    },
    [busy, choose, t, titleOf, router, base, sheet, sessionKey],
  );

  const coachOpen = tourOn && cur !== null && plan !== null;
  useModalFocus(sheet && !operationOpen, sheetRef, { onClose: closeSheet, busy, initial: "container" });

  const answerStock = async (want: boolean): Promise<void> => {
    if (data === null) return;
    const source = data.cardSource ?? "EXCEL";
    const d = await choose({ openingStockWanted: want, cardSource: source });
    if (d === null) return;
    feedback.minor();
    if (source === "PARASUT" && d.hints.parasut.connected && d.hints.parasut.openingTakenAt === null) {
      const r = await setOpeningStockAction({ slug, provider: "PARASUT", enabled: want, via: "journey" });
      if (!r.ok || !r.data.ok) feedback.warn(t("toast.openingNotSet"));
    }
  };
  const switchSource = async (): Promise<void> => {
    if (data === null) return;
    cikisSor(() => { void (async () => {
    const next = data.cardSource === "PARASUT" ? "EXCEL" : "PARASUT";
    const d = await choose({ cardSource: next });
    if (d === null) return;
    feedback.minor();
    router.push(stepPlan(base, "cards", d, next).href);
    })(); });
  };

  const upper = (v: string): string => v.toLocaleUpperCase(intlDil(locale));
  const countSub = (k: StepKey, n: number): string => (n > 0 && t.has(`steps.${k}.count`) ? t(`steps.${k}.count`, { n }) : t(`steps.${k}.sub`));
  // T-1036: kartta bütün adımlar görünür (kısa turda da): sayı ve şerit aynı listeden — atlananlar paydada yok.
  const active = steps.filter((s) => !s.skipped);
  const activeIdx = cur === null ? -1 : active.findIndex((s) => s.key === cur);
  const pos = tipPosition(targetSel === null ? null : hole, vp.w, vp.h);
  const shownStep = okStep ?? cur;
  const nextKey = data?.next ?? null;
  const tipTitle = okStep !== null ? t("coach.doneTitle", { title: titleOf(okStep) }) : stop === null ? (cur === null ? "" : titleOf(cur)) : t(`hint.${stop.hint}.title`);
  const contextText = surface === "warehouse-form" ? "warehouseForm" : surface === "bulk-form" ? "bulkForm" : surface === "team-add-qr" ? "teamMenu" : surface === "team-qr-new" ? "teamQr" : surface === "aktar-new" ? "importCheck" : surface === "document-state" && cur === "stock" ? "postStock" : null;
  const workTarget = surface === "warehouse-form" ? '[data-testid="warehouse-form"] input[name="name"]' : surface === "bulk-form" ? '[data-testid="bulk-form"]' : surface === "team-add-qr" ? '[data-testid="team-add-qr"]' : surface === "team-qr-new" ? '[data-testid="team-qr-new"]' : targetSel;
  const tipText = contextText !== null ? t(`work.${contextText}`) : okStep !== null ? (nextKey === null ? t("coach.allDone") : t("coach.nextLine", { title: titleOf(nextKey) })) : stop === null ? t("coach.goText") : t(`hint.${stop.hint}.text`);
  // E2E/erişilebilirlik: tur kararı verilene dek "loading" (yeni kiracıda kendiliğinden başlatma sunucu yanıtını bekler).
  const pendingStart = !paused && data !== null && data.tour === null && data.done === 0 && !data.dismissed && !data.complete;
  const layerState = !sessionLoaded || data === null || pendingStart ? "loading" : guideOpen ? "wait" : coachOpen ? "on" : "off";

  return (
    <div className={`dzj${dark ? " dz-dark" : ""}`} style={{ display: "contents" }} data-testid="yol-layer" data-state={layerState}>
      {coachOpen && shownStep !== null && plan !== null && data !== null ? (
        <>
          <section data-testid="yol-coach" data-step={shownStep} data-state={okStep !== null ? "done" : stop === null ? "go" : "open"} style={{display:"contents"}}>
          <KalipRehberKart title={tipTitle} text={tipText} progress={upper(t("coach.step", { n: Math.max(activeIdx,0)+1, total: active.length, title:titleOf(shownStep) }))} target={workTarget} style={pos.style}
            head={<ol className="ysteps" aria-label={t("coach.steps")} data-testid="yol-strip">{steps.map((s, i) => { const st = stripState(s, cur); const label = `${titleOf(s.key)}: ${t(`coach.strip.${st}`)}`; return <li key={s.key} className={st === "todo" ? undefined : st} title={label} aria-label={label} data-step={s.key} data-state={st}>{st === "done" ? <Ico d={JICON.check} size={16} /> : i + 1}</li>; })}</ol>}
            onClose={closeTour} onPrev={()=>move(-1)} onNext={()=>stop===null ? cikisSor(()=>router.push(plan.href)) : move(1)} onSkip={()=>cur!==null&&void skip(cur)} closeTestId="yol-close">
            {cur === "cards" && data.openingStockWanted === null ? <div className="yq" data-testid="yol-stockq"><b>{t("cards.stockQ")}</b><button type="button" className="ych" onClick={()=>void answerStock(true)} data-testid="yol-stock-yes">{t("yes")}</button><button type="button" className="ych" onClick={()=>void answerStock(false)} data-testid="yol-stock-no">{t("no")}</button></div>:null}
            {cur === "cards" ? <button type="button" className="yalt" onClick={()=>void switchSource()} data-testid="yol-source">{data.cardSource === "PARASUT" ? t("coach.useExcel") : t("coach.useParasut")}</button>:null}
            {stop===null?<button type="button" className="yalt" onClick={()=>cikisSor(()=>router.push(plan.href))} data-testid="yol-open">{t("coach.open")}</button>:null}
          </KalipRehberKart>
          </section>
        </>
      ) : null}

      {sheet && !operationOpen && data !== null ? (
        <>
          <KalipPerdeKatman onClose={closeSheet} label={t("close")} />
          <section ref={sheetRef} className="ysheet" role="dialog" aria-modal="true" aria-label={t("title")} data-testid="yol-sheet" data-view={data.complete ? "done" : "list"}>
            {(              <>
                <div className="ysh">
                  <YolHalka done={data.done} total={data.total} aria={t("ringAria", { done: data.done, total: data.total })} />
                  <span className="yt">
                    <b>{t("title")}</b>
                    <small>{upper(t("sheetSub"))}</small>
                  </span>
                  <button type="button" className="ycls" aria-label={t("close")} onClick={closeSheet} data-testid="yol-sheet-close">
                    <Ico d={JICON.close} size={20} />
                  </button>
                </div>
                <ol className="ylist">
                  {data.steps.map((s) => {
                    const ui = STEP_UI[s.key];
                    const now = !s.done && !s.skipped && s.key === data.next;
                    return [
                      s.key === "bom" && data.makesProduction === null ? (
                        <li key="prod" className="yprod" role="group" aria-label={t("prodQ")} data-testid="yol-prod">
                          <b>{t("prodQ")}</b>
                          <button type="button" className="ych" aria-pressed={false} onClick={() => void choose({ makesProduction: true }).then((d) => d && feedback.ok(t("toast.prodYes")))} data-testid="yol-prod-yes">
                            {t("yes")}
                          </button>
                          <button type="button" className="ych" aria-pressed={false} onClick={() => void choose({ makesProduction: false }).then((d) => d && feedback.ok(t("toast.prodNo")))} data-testid="yol-prod-no">
                            {t("no")}
                          </button>
                        </li>
                      ) : null,
                      <li key={s.key} className={`yst${s.done ? " done" : ""}${now ? " now" : ""}${s.skipped && !s.done ? " skip" : ""}`} data-testid={`yol-step-${s.key}`} data-state={s.done ? "done" : s.skipped ? "skipped" : now ? "now" : "todo"}>
                        <i style={{ background: dz(ui.color) }}>
                          <Ico d={ui.d} size={22} />
                        </i>
                        <span className="yt">
                          <b>{titleOf(s.key)}</b>
                          <small>{upper(s.skipped && !s.done ? t("skippedSub") : countSub(s.key, s.count))}</small>
                          {!s.done && !s.skipped ? (
                            <button type="button" className="yskip" onClick={() => void skip(s.key)} data-testid={`yol-skip-${s.key}`}>
                              {t("skip")}
                            </button>
                          ) : null}
                        </span>
                        {s.done ? (
                          <button type="button" className="yact" onClick={()=>void startTour(s.key)} data-testid={`yol-start-${s.key}`}>{t("replay")} <Ico d={JICON.check} size={16} /></button>
                        ) : s.skipped ? (
                          <button type="button" className="yskip" onClick={() => void choose({ unskip: s.key })} data-testid={`yol-unskip-${s.key}`}>
                            {t("unskip")}
                          </button>
                        ) : (
                          <button type="button" className="yact" onClick={() => void startTour(s.key)} data-testid={`yol-start-${s.key}`}>
                            {t("start")}
                            <Ico d={JICON.next} size={18} />
                          </button>
                        )}
                      </li>,
                    ];
                  })}
                </ol>
              </>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
