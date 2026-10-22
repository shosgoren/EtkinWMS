"use client";
// T-1006 (I-18): İlk kurulum yolculuğu — Yolculuk.dc.html "YENİ" bölümü BİREBİR (kap `.dzj`; CSS `design/yolculuk.css` üretilmiş, ikonlar
// `design/yolculuk-icons.ts`, renkler `yolculuk-tokens.ts`). Kullanıcı kararı 22 Ekim: asıl deneyim SPOTLIGHT TUR.
//  1. Tur: ekranın geri kalanı ortak buzlu perdeyle (`KalipPerdeKatman`, `.kperde`: karartma + 8px bulanıklık) kaplanır; yalnız `[data-tour]` hedefi
//     delikte net ve parlak, çevresinde nabız halkası (`.yhole`). Hedef alt çubuğun ana işlemiyse (`data-tour="main"`) perde bütündür ve çubuk
//     perdenin üstüne çıkar (KabukBar mevcut `spot` kancası, Kabuk `.touring`). Yanında ipucu balonu (`.ycoach`): ADIM n/N, tek cümle, Sesli
//     anlat, "Söyle: …", Geri / Atla / İleri, Turu kapat. Balon hedefin üstünde ya da altında, ekran dışına taşmadan konumlanır; boyut, kaydırma ve
//     hedef görünürlüğü değişince yeniden ölçülür.
//  2. Adım GERÇEK VERİDEN tamam olur (domain `onboarding/journey.ts`; tıklama saymaz): tamam sesi + balon, tur sıradaki adımın ekranına geçer.
//     Tur ekranlar arası sürer (durum sunucuda `tour_state`; seçilen adım oturumda). Yeni kiracıda (hiç adım tamam değil) ilk girişte kendiliğinden
//     başlar; eski 3 adımlı rehber açıksa o kapanınca.
//  3. İkincil: Pano'da küçük halka (`YolculukKart`) → adım listesi (turu kaldığı yerden ya da istenen adımdan başlat); Destek › Rehberi aç turu açar.
// ALTIN-KURAL: Esc turu kapatır; ←/→ Geri/İleri; balon `role="dialog"` + `aria-live` (ekran okuyucu ipucunu okur); odak tuzağı YOK (hedef perdenin
// deliğinde, klavyeyle de ulaşılmalı); hareket azaltmada nabız durur (üretilmiş CSS); dokunma ≥ 44 px; karanlık tema `.dz-dark`; metinler TR/EN.
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
import { setYolSpot } from "./spot.ts";
import { JOURNEY_OPEN_EVENT, STEP_UI, isStepKey, ringDash, stepPlan, stopFor, type JourneyData, type StepKey } from "./steps.ts";

const ACTIVE_KEY = "etkinwms.yol.active";
const POLL_MS = 6000;
const GAP = 14;
const EDGE = 12;

function readActive(): StepKey | null {
  try {
    const v = sessionStorage.getItem(ACTIVE_KEY);
    return isStepKey(v) ? v : null;
  } catch {
    return null;
  }
}
function writeActive(v: StepKey | null): void {
  try {
    if (v === null) sessionStorage.removeItem(ACTIVE_KEY);
    else sessionStorage.setItem(ACTIVE_KEY, v);
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
export function YolculukKart({ data, dark }: { data: JourneyData; dark: boolean }) {
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
export function YolculukKatman({ slug, dark: initialDark, initial = null }: { slug: string; dark: boolean; initial?: JourneyData | null }) {
  const t = useTranslations("yolculuk");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const base = `/t/${encodeURIComponent(slug)}`;

  const [data, setData] = useState<JourneyData | null>(initial);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dark, setDark] = useState(initialDark);
  const [hole, setHole] = useState<PerdeDelik | null>(null);
  const [vp, setVp] = useState({ w: 1280, h: 800 });
  const [speaking, setSpeaking] = useState(false);
  const [override, setOverride] = useState<StepKey | null>(null);
  const [okStep, setOkStep] = useState<StepKey | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const coachRef = useRef<HTMLElement>(null);
  const prevDone = useRef<Partial<Record<StepKey, boolean>>>({});
  const autoStarted = useRef(false);
  const celebrated = useRef(false);

  const load = useCallback(async (): Promise<JourneyData | null> => {
    const r = await getJourneyAction({ slug });
    if (!r.ok) return null;
    setData(r.data);
    return r.data;
  }, [slug]);

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
      return r.data;
    },
    [slug, t],
  );

  // İlk durum düzenden (sunucu). Ekran değişince yalnız tur sürerken (ya da ilk durum okunamadıysa) yeniden okunur: eylem hız sınırı
  // kovası her gezinmede tüketilmesin.
  const needRead = useRef(true);
  needRead.current = data === null || data.tour === "ACTIVE";
  useEffect(() => {
    setOverride(readActive());
    syncDark();
    if (needRead.current) void load();
  }, [pathname, load, syncDark]);
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

  const tourOn = data !== null && data.tour === "ACTIVE" && !data.complete && !sheet && !guideOpen;

  // Yeni kiracı: hiç adım tamam değilken tur ilk girişte kendiliğinden başlar (verisi olan kiracıda başlamaz).
  useEffect(() => {
    if (data === null || autoStarted.current || guideOpen) return;
    if (data.tour === null && data.done === 0 && !data.dismissed && !data.complete) {
      autoStarted.current = true;
      void choose({ tour: "start" });
    }
  }, [data, guideOpen, choose]);

  // Tur ya da liste açıkken yolculuk düzenli okunur (görünür sekmede): adım verisi oluşunca kendiliğinden tamam.
  const tourActive = data?.tour === "ACTIVE";
  useEffect(() => {
    if (!tourActive && !sheet) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [tourActive, sheet, load]);

  const steps = useMemo(() => data?.steps ?? [], [data]);
  const visible = useMemo(() => steps.filter((s) => !s.skipped), [steps]);
  const cur: StepKey | null = useMemo(() => {
    if (data === null) return null;
    const o = override === null ? undefined : steps.find((s) => s.key === override);
    if (o !== undefined && !o.done && !o.skipped) return o.key;
    return data.next;
  }, [data, override, steps]);
  const plan = useMemo(() => (cur === null || data === null ? null : stepPlan(base, cur, data)), [cur, data, base]);
  const stop = plan === null ? null : stopFor(plan, pathname);
  const targetSel = tourOn && stop !== null && stop.target !== null ? `[data-tour="${stop.target}"]` : null;
  const barTarget = stop?.target === "main";
  const stopTarget = stop?.target ?? null;

  const titleOf = useCallback((k: StepKey): string => t(`steps.${k}.title`), [t]);

  const go = useCallback(
    (k: StepKey, d: JourneyData): void => {
      writeActive(k);
      setOverride(k);
      router.push(stepPlan(base, k, d).href);
    },
    [base, router],
  );

  // Tamam geçişi: tur sürerken adım verisi oluştu → ses + balon; kısa süre sonra sıradaki adımın ekranı.
  useEffect(() => {
    if (data === null) return undefined;
    let finished: StepKey | null = null;
    for (const s of data.steps) {
      if (prevDone.current[s.key] === false && s.done) finished = s.key;
      prevDone.current[s.key] = s.done;
    }
    if (finished !== null && data.tour === "ACTIVE" && !data.complete) {
      feedback.ok(t("toast.stepDone", { title: titleOf(finished) }));
      writeActive(null);
      setOverride(null);
      setOkStep(finished);
      const nx = data.next;
      const id = window.setTimeout(() => {
        setOkStep(null);
        if (nx !== null) router.push(stepPlan(base, nx, data).href);
      }, 1500);
      return () => window.clearTimeout(id);
    }
    if (data.complete && !data.dismissed && !celebrated.current && data.tour === "ACTIVE") {
      celebrated.current = true;
      feedback.ok(t("cele.toast"));
      setSheet(true);
    }
    return undefined;
  }, [data, base, router, t, titleOf]);

  // Hedefi ölç: `[data-tour]` öğesi; boyut, kaydırma ve görünürlük değişince yeniden. Görünmezse delik yok, balon ortada.
  useEffect(() => {
    if (targetSel === null) {
      setYolSpot(null);
      setHole(null);
      return undefined;
    }
    if (barTarget) setYolSpot("center");
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
    setSpeaking(false);
    writeActive(null);
    setOverride(null);
    void choose({ tour: "close" });
  }, [choose]);

  const startTour = useCallback(
    async (k: StepKey | null): Promise<void> => {
      const d = data !== null && data.tour === "ACTIVE" ? data : await choose({ tour: "start" });
      if (d === null) return;
      setSheet(false);
      const step = k ?? d.next;
      if (step !== null) go(step, d);
    },
    [data, choose, go],
  );

  // Pano halkası → adım listesi; Destek › Rehberi aç → tur (olay iptal edilir: eski rehber açılmaz).
  useEffect(() => {
    const onOpen = (e: Event): void => {
      e.preventDefault();
      syncDark();
      const list = e instanceof CustomEvent && e.detail === "list";
      void load().then((d) => {
        if (d === null) return;
        if (list) setSheet(true);
        else void startTour(null);
      });
    };
    window.addEventListener(JOURNEY_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(JOURNEY_OPEN_EVENT, onOpen);
  }, [load, syncDark, startTour]);

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
        feedback.warn(dir === 1 ? t("coach.noNext") : t("coach.noPrev"));
        return;
      }
      feedback.minor();
      go(n.key, data);
    },
    [data, cur, visible, go, t],
  );

  const skip = useCallback(
    async (k: StepKey): Promise<void> => {
      if (busy) return;
      const d = await choose({ skip: k });
      if (d === null) return;
      feedback.undo(t("toast.skipped", { title: titleOf(k) }), t("unskip"), async () => {
        await choose({ unskip: k });
      });
      writeActive(null);
      setOverride(null);
      if (d.tour === "ACTIVE" && d.next !== null && !sheet) router.push(stepPlan(base, d.next, d).href);
    },
    [busy, choose, t, titleOf, router, base, sheet],
  );

  const coachOpen = tourOn && cur !== null && plan !== null;
  // Klavye: ←/→ Geri/İleri (yazı alanında değilken); Esc turu kapatır (useModalFocus).
  useEffect(() => {
    if (!coachOpen) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      const a = document.activeElement;
      if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || (a instanceof HTMLElement && a.isContentEditable)) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        move(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        move(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [coachOpen, move]);
  useModalFocus(sheet, sheetRef, { onClose: closeSheet, busy, initial: "container" });
  useModalFocus(coachOpen, coachRef, { onClose: closeTour, initial: "none", trap: false });

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
    const next = data.cardSource === "PARASUT" ? "EXCEL" : "PARASUT";
    const d = await choose({ cardSource: next });
    if (d === null) return;
    feedback.minor();
    router.push(stepPlan(base, "cards", d, next).href);
  };

  const speak = (title: string, text: string): void => {
    try {
      const synth = window.speechSynthesis;
      if (synth === undefined) throw new Error("no speech");
      synth.cancel();
      if (speaking) {
        setSpeaking(false);
        return;
      }
      const u = new SpeechSynthesisUtterance(`${title}. ${text}`);
      u.lang = intlDil(locale);
      u.onend = () => setSpeaking(false);
      setSpeaking(true);
      synth.speak(u);
    } catch {
      feedback.warn(t("coach.noSpeech"));
    }
  };

  const upper = (v: string): string => v.toLocaleUpperCase(intlDil(locale));
  const countSub = (k: StepKey, n: number): string => (n > 0 && t.has(`steps.${k}.count`) ? t(`steps.${k}.count`, { n }) : t(`steps.${k}.sub`));
  const idx = cur === null ? -1 : visible.findIndex((s) => s.key === cur);
  const pos = tipPosition(targetSel === null ? null : hole, vp.w, vp.h);
  const shownStep = okStep ?? cur;
  const nextKey = data?.next ?? null;
  const tipTitle = okStep !== null ? t("coach.doneTitle", { title: titleOf(okStep) }) : stop === null ? (cur === null ? "" : titleOf(cur)) : t(`hint.${stop.hint}.title`);
  const tipText = okStep !== null ? (nextKey === null ? t("coach.allDone") : t("coach.nextLine", { title: titleOf(nextKey) })) : stop === null ? t("coach.goText") : t(`hint.${stop.hint}.text`);
  // E2E/erişilebilirlik: tur kararı verilene dek "loading" (yeni kiracıda kendiliğinden başlatma sunucu yanıtını bekler).
  const pendingStart = data !== null && data.tour === null && data.done === 0 && !data.dismissed && !data.complete;
  const layerState = data === null || pendingStart ? "loading" : guideOpen ? "wait" : coachOpen ? "on" : "off";

  return (
    <div className={`dzj${dark ? " dz-dark" : ""}`} style={{ display: "contents" }} data-testid="yol-layer" data-state={layerState}>
      {coachOpen && shownStep !== null && plan !== null && data !== null ? (
        <>
          <KalipPerdeKatman onClose={closeTour} label={t("coach.close")} delik={barTarget || targetSel === null ? null : hole} />
          {hole !== null && targetSel !== null ? <span className="yhole" aria-hidden="true" style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }} data-testid="yol-hole" /> : null}
          <section
            ref={coachRef}
            className={`ycoach${pos.cls === "" ? "" : ` ${pos.cls}`}${okStep !== null ? " ok" : ""}`}
            style={pos.style}
            role="dialog"
            aria-label={t("coach.aria")}
            aria-live="polite"
            data-testid="yol-coach"
            data-step={shownStep}
            data-state={okStep !== null ? "done" : stop === null ? "go" : "open"}
          >
            <div className="cth">
              <span className="cstep" data-testid="yol-step-no">
                {okStep !== null ? upper(t("coach.stepDone", { n: idx + 1, total: visible.length })) : upper(t("coach.step", { n: Math.max(idx, 0) + 1, total: visible.length, title: titleOf(shownStep) }))}
              </span>
              <button type="button" className={`cbtn${speaking ? " on" : ""}`} aria-label={t("coach.speak")} aria-pressed={speaking} onClick={() => speak(tipTitle, tipText)}>
                <Ico d={[JICON.speak, JICON.speakWave]} size={18} />
              </button>
              <button type="button" className="cbtn" aria-label={t("coach.close")} onClick={closeTour} data-testid="yol-close">
                <Ico d={JICON.close} size={18} />
              </button>
            </div>
            <b className="ctt">{tipTitle}</b>
            <p className="ctx">{tipText}</p>
            {okStep === null && cur === "cards" && data.openingStockWanted === null ? (
              <div className="yq" role="group" aria-label={t("cards.stockQ")} data-testid="yol-stockq">
                <b>{t("cards.stockQ")}</b>
                <button type="button" className="ych" aria-pressed={false} onClick={() => void answerStock(true)} data-testid="yol-stock-yes">
                  {t("yes")}
                </button>
                <button type="button" className="ych" aria-pressed={false} onClick={() => void answerStock(false)} data-testid="yol-stock-no">
                  {t("no")}
                </button>
              </div>
            ) : null}
            {okStep === null ? (
              <span className="ysay" data-testid="yol-say">
                <i>
                  <Ico d={JICON.mic} size={16} />
                </i>
                {t("coach.say", { phrase: t(`voice.${shownStep}`) })}
              </span>
            ) : null}
            {okStep === null && cur === "cards" ? (
              <button type="button" className="yalt" onClick={() => void switchSource()} data-testid="yol-source">
                {data.cardSource === "PARASUT" ? t("coach.useExcel") : t("coach.useParasut")}
              </button>
            ) : null}
            {okStep === null ? (
              <div className="ynav">
                <button type="button" className="ynb" aria-label={t("coach.prev")} aria-disabled={idx <= 0} onClick={() => move(-1)} data-testid="yol-prev">
                  <Ico d={JICON.back} size={20} />
                </button>
                <button type="button" className="yskip" onClick={() => cur !== null && void skip(cur)} data-testid="yol-skip">
                  {t("coach.skip")}
                </button>
                {stop === null ? (
                  <button
                    type="button"
                    className="ynb go"
                    onClick={() => {
                      feedback.minor();
                      router.push(plan.href);
                    }}
                    data-testid="yol-open"
                  >
                    {t("coach.open")}
                    <Ico d={JICON.next} size={18} />
                  </button>
                ) : (
                  <button type="button" className="ynb go" onClick={() => move(1)} data-testid="yol-next">
                    {t("coach.forward")}
                    <Ico d={JICON.next} size={18} />
                  </button>
                )}
              </div>
            ) : null}
            {pos.arrow !== null ? <span className="yarr" aria-hidden="true" style={{ left: pos.arrow }} /> : null}
          </section>
        </>
      ) : null}

      {sheet && data !== null ? (
        <>
          <KalipPerdeKatman onClose={closeSheet} label={t("close")} />
          <section ref={sheetRef} className="ysheet" role="dialog" aria-modal="true" aria-label={t("title")} data-testid="yol-sheet" data-view={data.complete ? "done" : "list"}>
            {data.complete ? (
              <div className="ycele" data-testid="yol-cele">
                <span className="ycf" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <span className="yburst">
                  <Ico d={JICON.flag} size={42} />
                </span>
                <b>{t("cele.title")}</b>
                <p>{t("cele.text")}</p>
                <button
                  type="button"
                  className="ygo"
                  data-testid="yol-cele-done"
                  onClick={() => {
                    void choose({ dismiss: true }).then((d) => {
                      if (d === null) return;
                      setSheet(false);
                      writeActive(null);
                      router.push(base);
                    });
                  }}
                >
                  {t("cele.button")}
                </button>
              </div>
            ) : (
              <>
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
                          <span className="ybadge" role="img" aria-label={t("doneAria")}>
                            <Ico d={JICON.check} size={16} />
                          </span>
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
