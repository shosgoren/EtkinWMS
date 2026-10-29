"use client";
// T-1026: kısa başlangıç + tekrar açılabilir kurulum adımları.
// T-1100 (kullanıcı 27 Ekim: "yazı çıkıyor, işlemi yaptırmıyor"): çalışma kartı T-1095 odaklı rehberle aynı — ortak buzlu perde yapılacak
// yerin çevresini delik bırakıp bütün ekranı örter, kart tek satırdır, İleri/Atla yoktur; iş yapılınca (sunucu verisi) adım kendiliğinden
// ilerler. Perdeye dokununca serbest bırakır, küçük yüzen simge kalır ("Kaldığın yerden").
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { feedback, intlDil } from "@wms/ui";
import { JICON } from "../../../design/yolculuk-icons.ts";
import { dz } from "../../../design/yolculuk-tokens.ts";
import { Ico } from "../kalip/ekran.tsx";
import { useModalFocus } from "../kalip/odak.ts";
import { KalipPerdeKatman, hedefKutusu, type PerdeDelik } from "../kalip/perde.tsx";
import { gorunenler, useKartYeri } from "../kalip/rehber-hedef.ts";
import { sesiDurdur, useSesliOku } from "../kalip/sesli-oku.ts";
import { setOpeningStockAction } from "../integrations/actions.ts";
import { getJourneyAction, setJourneyChoiceAction } from "./actions.ts";
import { YOL_TAZELE_EVENT, setYolDurum, useYolDurum } from "./durum.ts";
import { setYolSpot } from "./spot.ts";
import { JOURNEY_OPEN_EVENT, STEP_KEYS, filterJourney, firstOpen, STEP_UI, isStepKey, ringDash, stepPlan, stopFor, type JourneyData, type StepKey } from "./steps.ts";

import { cikisSor } from "../kalip/cikis.tsx";
import { useKabuk } from "../kabuk/kabuk-bar.tsx";

const ACTIVE_KEY = "etkinwms.yol.active";
/** Kısa başlangıç turunun adımları (yeni kiracıda ilk girişte). */
const SHORT_STEPS: readonly StepKey[] = ["cards", "shelves", "parties", "stock"];
const POLL_MS = 6000;
/** Açılınca deliği tamamen kaplayan iş yüzeyleri (form / menü). */
const FOCUS_SURFACES: readonly string[] = ["warehouse-form", "bulk-form", "team-add-qr", "team-qr-new"];
/** Ekranda açık iş formları (deliğe ayrıca eklenir). */
const FORM_SEL = 'form.workflow-form, [data-testid$="-form"]';

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

/**
 * Pano küçük halkası (kaynak `.ymini`, ikincil): dokununca adım listesi (bitmiş adım da "Tekrar göster" ile yeniden yapılır). Kutlama
 * kapatıldıysa çizilmez. T-1100 (kullanıcı 27 Ekim): adı "Rehber"; `ikon` ile yalnız halka (Pano'da "Merhaba" satırının sağında) ve
 * yalnız bitmemişken.
 */
export function YolculukKart({ data: original, dark, ikon = false }: { data: JourneyData; dark: boolean; ikon?: boolean }) {
  const ctx = useKabuk();
  const data = filterJourney(original, ctx?.guides?.setup ?? STEP_KEYS);
  const t = useTranslations("yolculuk");
  const locale = useLocale();
  if (data.dismissed || (ikon && (data.complete || data.total === 0))) return null;
  return (
    <div className={`dzj${dark ? " dz-dark" : ""}`} style={{ display: "contents" }}>
      <button
        type="button"
        className={`ymini${ikon ? " yikon" : ""}`}
        title={ikon ? t("mini") : undefined}
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
        {ikon ? null : (
          <span>
            <b>{data.complete ? t("titleDone") : t("mini")}</b>
            <small>{t("miniSub", { done: data.done, total: data.total }).toLocaleUpperCase(intlDil(locale))}</small>
          </span>
        )}
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
  useEffect(() => {
    window.dispatchEvent(new Event(YOL_TAZELE_EVENT));
  }, []);
  if (data === null || data.dismissed) return null;
  // Üyenin görebildiği adımlarla (Pano kartıyla aynı süzgeç; kabuk bağlamı yoksa hiçbiri — kapalı kalır): hepsi tamamsa ya da hiç adım yoksa kart yok.
  const mine = filterJourney(data, ctx?.guides?.setup ?? []);
  if (mine.total === 0 || mine.complete) return null;
  return <YolculukKart data={data} dark={dark} />;
}

/** Kiracı düzeninde (yalnız hesap sahibi / depo yöneticisi): spotlight tur, adım listesi ve kutlama. */
export function YolculukKatman({ slug, userId, dark: initialDark, initial = null }: { slug: string; userId: string; dark: boolean; initial?: JourneyData | null }) {
  const t = useTranslations("yolculuk");
  const locale = useLocale();
  const sesliOku = useSesliOku();
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
  const [hole, setHole] = useState<readonly PerdeDelik[] | null>(null);
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
  // Ürünler / Depolar giriş kartı açılınca (tur kapalı da olsa) ilerleme tazelenir.
  useEffect(() => {
    const tazele = (): void => void load();
    window.addEventListener(YOL_TAZELE_EVENT, tazele);
    return () => window.removeEventListener(YOL_TAZELE_EVENT, tazele);
  }, [load]);
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
  // Ekranda bir iş yüzeyi (form, menü) açıldıysa delik o yüzeyin tamamıdır: kullanıcı formu doldurup KAYDET'e dokunabilsin.
  const focusSel = tourOn && surface !== null && FOCUS_SURFACES.includes(surface) ? `[data-testid="${surface}"]` : targetSel;
  const [katli, setKatli] = useState(false);
  useEffect(() => setKatli(false), [cur]);
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
    if (data === null || !sessionLoaded) return undefined;
    let finished: StepKey | null = null;
    for (const s of data.steps) {
      if (prevDone.current[s.key] === false && s.done) finished = s.key;
      prevDone.current[s.key] = s.done;
    }
    // T-1124: yolculuk duraklatılmış ya da işlem rehberi öndeyken biten adım "görüldü" sayılır; rehber geri gelince eski geçiş çalışmaz.
    if (paused || operationOpen) return undefined;
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
    if (focusSel === null) {
      setYolSpot(null);
      setHole(null);
      return undefined;
    }
    // Çalışma kartı hiçbir alt çubuk yuvasını bulanıklaştırmaz.
    setYolSpot(null);
    const measure = (): void => {
      const pad = 8;
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      // T-1111: delik görünüm alanına kırpılır (uzun form ekranın dışına taşınca soluk dikdörtgen kesik bitiyordu).
      const delik = (r: { left: number; top: number; width: number; height: number }): PerdeDelik | null => {
        if (!(r.width > 0 && r.height > 0 && r.top + r.height > 0 && r.top < vh && r.left + r.width > 0 && r.left < vw)) return null;
        const x = Math.max(0, r.left - pad);
        const y = Math.max(0, r.top - pad);
        return { x, y, w: Math.min(vw, r.left + r.width + pad) - x, h: Math.min(vh, r.top + r.height + pad) - y };
      };
      const next: PerdeDelik[] = [];
      const el = [...document.querySelectorAll(focusSel)].find((x) => x.getBoundingClientRect().width > 0 && getComputedStyle(x).visibility !== "hidden") ?? null;
      if (el !== null) {
        // Hedefin açtığı menü (`data-tour-follow`) de delikte kalır: kullanıcı menüden seçebilsin (ör. Excel › İçeri al).
        const follow = stopTarget === null || focusSel !== targetSel ? [] : [...document.querySelectorAll(`[data-tour-follow="${stopTarget}"]`)];
        const rects = [hedefKutusu(el), ...follow.map((f) => f.getBoundingClientRect()).filter((x) => x.width > 0 && x.height > 0)];
        const r = rects.reduce((acc, x) => {
          const left = Math.min(acc.left, x.left);
          const top = Math.min(acc.top, x.top);
          const right = Math.max(acc.right, x.right);
          const bottom = Math.max(acc.bottom, x.bottom);
          return { left, top, right, bottom, width: right - left, height: bottom - top };
        }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity, width: 0, height: 0 });
        const d = delik(r);
        if (d !== null) next.push(d);
      }
      // Ekranda açık iş formu (ör. stok girişi, reçete) da açık kalır: alanlar doldurulabilsin, KAYDET delikte (ayrı delik).
      const forms = [...document.querySelectorAll(FORM_SEL)].filter((f) => f.getBoundingClientRect().width > 0 && (el === null || (!el.contains(f) && !f.contains(el))));
      for (const f of forms) {
        if (forms.some((o) => o !== f && o.contains(f))) continue;
        const d = delik(f.getBoundingClientRect());
        if (d !== null) next.push(d);
      }
      const ayni = (c: readonly PerdeDelik[] | null): boolean => c !== null && c.length === next.length && c.every((x, i) => Math.abs(x.x - next[i]!.x) < 1 && Math.abs(x.y - next[i]!.y) < 1 && Math.abs(x.w - next[i]!.w) < 1 && Math.abs(x.h - next[i]!.h) < 1);
      setHole((c) => (next.length === 0 ? null : ayni(c) ? c : next));
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
  }, [focusSel, targetSel, barTarget, stopTarget]);

  const closeTour = useCallback((): void => {
    feedback.minor();
    sesiDurdur();
    writeActive(null, sessionKey);
    setOverride(null);
    rememberPaused(true);
    setOkStep(null);
    setReplay(false);
    setShortTour(false);
    setData(d=>d===null?null:{...d,tour:"CLOSED"});
    // T-1124: yolculuk kapandı; katlı işlem rehberi simgesi geri gelir.
    setGuideOwner?.(null);
    void choose({ tour: "close" });
  }, [choose, sessionKey, rememberPaused, setGuideOwner]);

  // T-1124 (kullanıcı 28 Ekim: "rehber tamamen kapanıyor"): işlem/aktarma rehberi açılınca kurulum yolculuğu KAPATILMAZ (eskiden sunucuda
  // "close" yazılıyordu, kurulum turu kayboluyordu); liste kapanır, kart katlanır. Rehber kapanınca yolculuk katlı simgeden sürer.
  useEffect(() => {
    const pause = (): void => { setSheet(false); setKatli(true); };
    window.addEventListener("etkinwms:journey-pause", pause);
    return () => window.removeEventListener("etkinwms:journey-pause", pause);
  }, []);

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
    // T-1124: liste kapandı; katlı işlem rehberi simgesi geri gelir (yolculuk turu sürüyorsa o da görünür kalır).
    setGuideOwner?.(null);
  }, [setGuideOwner]);

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
  // Delik yokken (hedef bu ekranda değil) perde de yoktur: kartın dışına dokunmak rehberi serbest bırakır (yüzen simge), alttaki gerçek
  // düğme (ör. Destek menüsü) kartın altında kalmaz.
  const kartRef = useRef<HTMLElement>(null);
  // T-1130 (kullanıcı 29 Ekim: "rehber ilgili alanın üstünde kalmış"): kart yapılacak yeri örtmez — işlem rehberleriyle ortak yer kancası.
  // Örtülmeyecekler: hedef (ve açtığı menü) ya da açık iş yüzeyi (form) + ekrandaki iş formları; açık yüzeyde alt çubuğun ana işlemi
  // (KAYDET) de. Hepsi sığmazsa (telefonda uzun form) odaktaki alan (yoksa ilk alan, ör. "Depo adı") ve ana işlem.
  const yerHedefleri = (): Element[] => {
    if (focusSel === null) return [];
    const el = gorunenler(focusSel, 1)[0];
    if (el === undefined) return [];
    const follow = stopTarget === null || focusSel !== targetSel ? [] : gorunenler(`[data-tour-follow="${stopTarget}"]`);
    const forms = gorunenler(FORM_SEL).filter((f) => !el.contains(f) && !f.contains(el));
    const ana = focusSel !== targetSel ? gorunenler('[data-tour="main"]', 1) : [];
    return [el, ...follow, ...forms, ...ana];
  };
  const yer = useKartYeri(kartRef, coachOpen && !katli, `${cur ?? ""}:${stopTarget ?? ""}:${surface ?? ""}`, yerHedefleri);
  useEffect(() => {
    if (!coachOpen || katli || hole !== null) return undefined;
    const outside = (e: Event): void => {
      if (e.target instanceof Node && !kartRef.current?.contains(e.target)) setKatli(true);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [coachOpen, katli, hole]);
  // Esc turu kapatır (açık bir pencere yoksa; pencere kendi Esc'ini işler). Dinleyici kart çizilmeden bağlanır (useLayoutEffect): kart
  // görünür görünmez basılan Esc kaçmasın (eski ortak kartla aynı).
  useLayoutEffect(() => {
    if (!coachOpen) return undefined;
    const key = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const modal = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].some((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden");
      if (modal) return;
      e.preventDefault();
      closeTour();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [coachOpen, closeTour]);
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
  const shownStep = okStep ?? cur;
  const nextKey = data?.next ?? null;
  const contextText = surface === "warehouse-form" ? "warehouseForm" : surface === "bulk-form" ? "bulkForm" : surface === "team-add-qr" ? "teamMenu" : surface === "team-qr-new" ? "teamQr" : surface === "aktar-new" ? "importCheck" : surface === "document-state" && cur === "stock" ? "postStock" : null;
  const tipText = contextText !== null ? t(`work.${contextText}`) : okStep !== null ? (nextKey === null ? t("coach.allDone") : t("coach.nextLine", { title: titleOf(nextKey) })) : stop === null ? t("coach.goText") : t(`hint.${stop.hint}.text`);
  const speak = (): void => {
    if (!sesliOku(tipText)) feedback.warn(t("coach.noSpeech"));
  };
  const ilerleme = `${Math.max(activeIdx, 0) + 1}/${active.length}`;
  // E2E/erişilebilirlik: tur kararı verilene dek "loading" (yeni kiracıda kendiliğinden başlatma sunucu yanıtını bekler).
  const pendingStart = !paused && data !== null && data.tour === null && data.done === 0 && !data.dismissed && !data.complete;
  const layerState = !sessionLoaded || data === null || pendingStart ? "loading" : guideOpen ? "wait" : coachOpen ? "on" : "off";

  return (
    <div className={`dzj${dark ? " dz-dark" : ""}`} style={{ display: "contents" }} data-testid="yol-layer" data-state={layerState}>
      {coachOpen && shownStep !== null && plan !== null && data !== null ? (
        <section data-testid="yol-coach" data-step={shownStep} data-state={okStep !== null ? "done" : stop === null ? "go" : "open"} data-folded={katli} style={{ display: "contents" }}>
          {katli ? (
            <section className="ycoach working folded" style={{ zIndex: 42 }} role="region" aria-label={t("coach.aria")} data-testid="yol-kart">
              <button type="button" className="ynb" onClick={() => { feedback.minor(); setKatli(false); }} data-testid="yol-devam">
                {t("coach.resume")} · {ilerleme}
              </button>
              <button type="button" className="cbtn" onClick={closeTour} aria-label={t("coach.close")} data-testid="yol-close">
                <Ico d={JICON.close} size={20} />
              </button>
            </section>
          ) : (
            <>
              {hole !== null && okStep === null ? <KalipPerdeKatman onClose={() => { feedback.minor(); setKatli(true); }} label={t("coach.free")} delik={hole} /> : null}
              <section ref={kartRef} className="ycoach working" style={{ ...yer, zIndex: 42 }} role="region" aria-label={t("coach.aria")} data-testid="yol-kart">
                <div className="cth">
                  <span className="cstep" aria-live="polite">{upper(t("coach.step", { n: Math.max(activeIdx, 0) + 1, total: active.length, title: titleOf(shownStep) }))}</span>
                  <button type="button" className="cbtn" onClick={speak} aria-label={t("coach.speak")}>
                    <Ico d={[JICON.speak, JICON.speakWave]} size={20} />
                  </button>
                  <button type="button" className="cbtn" onClick={closeTour} aria-label={t("coach.close")} data-testid="yol-close">
                    <Ico d={JICON.close} size={20} />
                  </button>
                </div>
                <p className="ctx" data-testid="yol-metin">{tipText}</p>
                {cur === "cards" && data.openingStockWanted === null ? <div className="yq" data-testid="yol-stockq"><b>{t("cards.stockQ")}</b><button type="button" className="ych" onClick={()=>void answerStock(true)} data-testid="yol-stock-yes">{t("yes")}</button><button type="button" className="ych" onClick={()=>void answerStock(false)} data-testid="yol-stock-no">{t("no")}</button></div>:null}
                {cur === "cards" ? <button type="button" className="yalt" onClick={()=>void switchSource()} data-testid="yol-source">{data.cardSource === "PARASUT" ? t("coach.useExcel") : t("coach.useParasut")}</button>:null}
                {stop === null ? <button type="button" className="ynb go" onClick={()=>cikisSor(()=>router.push(plan.href))} data-testid="yol-open">{t("coach.open")}</button> : null}
              </section>
            </>
          )}
        </section>
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
