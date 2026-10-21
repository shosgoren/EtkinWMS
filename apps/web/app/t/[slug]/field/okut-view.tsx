"use client";
// T-969 (B-86): OKUT ekranı = KalipSaha.dc.html (a) "Okut" BİREBİR — `.flow` (OKUT etkin), `.cam` (kamera DOĞRUDAN açık: `.camt` ipucu,
// `.vf` vizör + `.sline` tarama çizgisi, `.camb > .sayp` "Okut ya da söyle", `.camx > .cx` NFC'ye dokun / Kodu yaz) ve ortak alt cam çubuk
// (ana işlem OKUT). Kamera, çözücü (yerleşik BarcodeDetector ya da WASM), el terminali klavye kaması ve izin rehberi mevcut tarayıcı
// altyapısıdır (lib/scanner, receive-flow `useScanner`). Okunan kod sunucuda çözülür (`resolveFieldScanAction`); bulunan işe geçilir,
// tanınmayan kod kırmızı sonuç + uyarı sesi/titreşim + "tekrar okut" (kaynak (b) `.vres.bad`).
// Bilinçli farklar (T-969 kartı): "söyle" (sesli komut) Etkin B-62 ile gelir; şimdilik ipucu metnidir. Web NFC yalnız destekleyen
// tarayıcıda (Android Chrome) çalışır; yoksa açık bildirim.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslations } from "next-intl";
import { dz } from "../../../design/kalip-saha-tokens.ts";
import { SICON } from "../../../design/saha-icons.ts";
import { classifyCameraError, createFrameDecoder, DISTANCE_HINT_MS, openCamera, platformOf, startScanLoop, type CameraFailure, type CameraSession, type ScanStats } from "../../../../lib/scanner/camera-source.ts";
import { useScanner } from "./receive/receive-flow.tsx";
import { resolveFieldScanAction, type FieldScanTarget } from "./actions.ts";
import { Ico, MicIco, SahaFrame, SahaSteps, SahaVerdict, tone } from "./saha-shell.tsx";

type Cam = { readonly phase: "starting" } | { readonly phase: "scanning" } | { readonly phase: "paused" } | { readonly phase: "failed"; readonly failure: CameraFailure | "decoder" };
type View =
  | { readonly kind: "idle" }
  | { readonly kind: "checking"; readonly code: string }
  | { readonly kind: "found"; readonly code: string; readonly target: Exclude<FieldScanTarget, { kind: "unknown" }> }
  | { readonly kind: "unknown"; readonly code: string; readonly reason: "not_found" | "ambiguous" | "network"; readonly errorCode?: string };

/** Web NFC (yalnız destekleyen tarayıcı; tipler standart kitaplıkta yok). */
interface NdefRecordLike {
  readonly recordType: string;
  readonly encoding?: string;
  readonly data?: DataView;
}
interface NdefReaderLike {
  scan(): Promise<void>;
  onreading: ((ev: { readonly serialNumber?: string; readonly message: { readonly records: readonly NdefRecordLike[] } }) => void) | null;
}

export function OkutView({ slug, canPost, tenantName }: { slug: string; canPost: boolean; tenantName: string }) {
  const t = useTranslations("saha.okut");
  const tr = useTranslations("receiving");
  const router = useRouter();
  const base = `/t/${encodeURIComponent(slug)}`;
  const video = useRef<HTMLVideoElement>(null);
  const [cam, setCam] = useState<Cam>({ phase: "starting" });
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<View>({ kind: "idle" });
  const viewRef = useRef<View>({ kind: "idle" });
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const beginRef = useRef<(() => void) | null>(null);
  const sessionRef = useRef<CameraSession | null>(null);
  const vf = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<ScanStats | null>(null);
  // T-450: kamera açıldıktan 1,5 sn sonra hâlâ okuma yoksa "biraz uzaklaştır" ipucu (iPhone ana kamerası ~20 cm'den yakını netleyemez).
  const [farHint, setFarHint] = useState(false);
  const show = useCallback((v: View) => {
    viewRef.current = v;
    setView(v);
  }, []);
  // Akış kapısı: çözüm sürerken ya da sonuç ekrandayken yeni okuma işlenmez (aynı kod iki kez gitmez).
  const blocked = useCallback(() => viewRef.current.kind !== "idle", []);

  const handle = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (code === "" || viewRef.current.kind !== "idle") return;
      show({ kind: "checking", code });
      let res: Awaited<ReturnType<typeof resolveFieldScanAction>>;
      try {
        res = await resolveFieldScanAction({ slug, code });
      } catch {
        tone("err");
        show({ kind: "unknown", code, reason: "network", errorCode: "NETWORK" });
        return;
      }
      if (!res.ok) {
        tone("err");
        show({ kind: "unknown", code, reason: res.error.code === "VALIDATION_FAILED" ? "not_found" : "network", errorCode: res.error.code });
        return;
      }
      const target = res.data;
      if (target.kind === "unknown") {
        tone("err");
        show({ kind: "unknown", code, reason: target.reason });
        return;
      }
      tone("ok");
      show({ kind: "found", code, target });
      router.push(target.href);
    },
    [slug, router, show],
  );
  const { service, camera } = useScanner((v) => void handle(v), true, blocked);

  // Kamera ekran açılınca HEMEN açılır (kaynak (a) "kamera doğrudan açık"); ekrandan çıkınca akış durur.
  useEffect(() => {
    let cancelled = false;
    let stopLoop: (() => void) | null = null;
    let hintTimer: ReturnType<typeof setTimeout> | null = null;
    let session: CameraSession | null = null;
    setCam({ phase: "starting" });
    // T-446: çözücü (WASM indirme + derleme) kamera izni/açılışıyla PARALEL hazırlanır; kamera açılınca ilk kare beklemeden çözülür.
    const decoderP = createFrameDecoder();
    decoderP.catch(() => undefined);
    void (async () => {
      try {
        session = await openCamera();
      } catch (e) {
        if (!cancelled) setCam({ phase: "failed", failure: classifyCameraError(e) });
        return;
      }
      const v = video.current;
      if (cancelled || v === null) {
        session.stop();
        return;
      }
      v.srcObject = session.stream;
      void v.play().catch(() => undefined);
      let decoder: Awaited<ReturnType<typeof createFrameDecoder>>;
      try {
        decoder = await decoderP;
      } catch {
        session.stop();
        if (!cancelled) setCam({ phase: "failed", failure: "decoder" });
        return;
      }
      if (cancelled) {
        session.stop();
        return;
      }
      sessionRef.current = session;
      const begin = (): void => {
        stopLoop?.();
        setCam({ phase: "scanning" });
        setFarHint(false);
        if (hintTimer !== null) clearTimeout(hintTimer);
        hintTimer = setTimeout(() => setFarHint(true), DISTANCE_HINT_MS);
        stopLoop = startScanLoop({
          decoder,
          video: v,
          roiTarget: () => vf.current,
          onStats: setStats,
          onRejected: () => undefined,
          // Tek kabul: döngü kendini durdurur; sonuç ekranından "tekrar okut" yeni döngü başlatır.
          onAccepted: (value) => {
            if (hintTimer !== null) clearTimeout(hintTimer);
            setFarHint(false);
            tone("tap"); // anında "tok" + kısa titreşim; sunucu sonucu ayrıca onay/hata sesi verir
            setCam({ phase: "paused" });
            camera(value);
          },
        });
      };
      beginRef.current = begin;
      begin();
    })();
    return () => {
      cancelled = true;
      if (hintTimer !== null) clearTimeout(hintTimer);
      beginRef.current = null;
      sessionRef.current = null;
      stopLoop?.();
      session?.stop();
    };
  }, [attempt, camera]);

  // Dokun-odakla (T-446): kamera alanına dokununca o noktaya (destek varsa) yeniden odaklanır; düğmeler etkilenmez.
  const focusTap = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const s = sessionRef.current;
    const v = video.current;
    if (s === null || v === null || (e.target as Element).closest("button,form,input,a") !== null) return;
    const r = v.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    void s.focusAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height).then((ok) => {
      if (ok) tone("tap");
    });
  };

  const rescan = (): void => {
    tone("tap");
    show({ kind: "idle" });
    setNote(null);
    if (cam.phase === "failed") setAttempt((n) => n + 1);
    else beginRef.current?.();
  };

  const nfc = async (): Promise<void> => {
    tone("tap");
    const Ctor = (window as unknown as { NDEFReader?: new () => NdefReaderLike }).NDEFReader;
    if (Ctor === undefined) {
      setNote(t("nfcNone"));
      return;
    }
    try {
      const reader = new Ctor();
      await reader.scan();
      reader.onreading = (ev) => {
        for (const rec of ev.message.records) {
          if ((rec.recordType === "text" || rec.recordType === "url") && rec.data !== undefined) {
            void handle(new TextDecoder(rec.encoding ?? "utf-8").decode(rec.data));
            return;
          }
        }
        if (ev.serialNumber !== undefined && ev.serialNumber !== "") void handle(ev.serialNumber);
      };
      setNote(t("nfcReady"));
    } catch {
      setNote(t("nfcFail"));
    }
  };

  const platform = typeof navigator === "undefined" ? "other" : platformOf(navigator.userAgent, navigator.maxTouchPoints);
  const failText = cam.phase !== "failed" ? null : tr(`camera.error.${cam.failure === "denied" ? `denied_${platform}` : cam.failure}`);
  // Okunan kod sunucuda çözülürken vizör ekranda kalır (okundu anı görünür).
  const live = cam.phase === "scanning" || cam.phase === "starting" || (cam.phase === "paused" && view.kind === "checking");

  return (
    <SahaFrame
      hue="green"
      iconD={SICON.scan}
      title={t("title")}
      sub={`${tenantName.toLocaleUpperCase("tr")} · ${t("sub")}`}
      back={{ href: base }}
      main={{ label: t("scanMain"), aria: t("scanAria"), d: SICON.scan, onClick: rescan, testId: "okut-main" }}
      testId="okut"
    >
      <main className="inner" data-testid="okut-screen" data-state={view.kind} data-camera={cam.phase}>
        <SahaSteps now={1} label={tr("stepOf", { n: 1, total: 3 })} />
        {canPost ? null : (
          <div className="job lock" data-testid="okut-locked">
            <span className="uic" style={{ background: dz("E56A00") }}>
              <Ico d={SICON.warn} size={22} />
            </span>
            <span style={{ minWidth: 0 }}>
              <b>{t("lockTitle")}</b>
              <small>{t("lockReason")}</small>
            </span>
          </div>
        )}
        {view.kind === "found" ? (
          <>
            <SahaVerdict ok title={`${t("found")} · ${view.target.name}`} sound={t("soundOk")} />
            <p className="okgo" role="status" data-testid="okut-go">
              {t(`go.${view.target.kind}`)}
            </p>
          </>
        ) : null}
        {view.kind === "unknown" ? (
          <>
            <SahaVerdict ok={false} title={t("unknownTitle")} sound={t("soundBad")} />
            <div className="pcard" data-testid="okut-unknown">
              <div className="cmp">
                <div className="cm bad">
                  <small>{t("codeLabel")}</small>
                  <b className="mono">{view.code}</b>
                  <em>{view.reason === "ambiguous" ? t("ambiguousReason") : view.reason === "network" ? t("network") : t("unknownReason")}</em>
                  {view.errorCode === undefined ? null : <em>{t("errorCode", { code: view.errorCode })}</em>}
                </div>
              </div>
              <button type="button" className="btn n" onClick={rescan} data-testid="okut-rescan">
                <Ico d={SICON.scan} size={22} />
                {t("rescan")}
              </button>
            </div>
          </>
        ) : null}
        <div
          className="cam"
          role="img"
          aria-label={t("camRegion")}
          data-testid="okut-camera"
          data-first-read-ms={stats?.firstReadMs}
          data-decode-avg-ms={stats?.decodeAvgMs}
      data-decode-max-ms={stats?.decodeMaxMs}
      data-scan-frames={stats?.frames}
          onPointerUp={focusTap}
        >
          <video ref={video} muted playsInline aria-hidden="true" style={cam.phase === "failed" ? { visibility: "hidden" } : undefined} />
          <div className="camt">
            {farHint && cam.phase === "scanning" && view.kind === "idle" ? (
              <span role="status" data-testid="okut-distance-hint">
                <Ico d={SICON.info} size={14} />
                {t("distanceHint")}
              </span>
            ) : (
              <span>{view.kind === "checking" ? t("checking") : cam.phase === "starting" ? t("starting") : t("camHint")}</span>
            )}
          </div>
          {live ? (
            <div ref={vf} className="vf" aria-hidden="true">
              <i className="a" />
              <i className="b" />
              <i className="c" />
              <i className="d" />
              <span className="sline" />
            </div>
          ) : null}
          {failText === null ? null : (
            <div className="camerr" role="alert" data-testid="okut-camera-error">
              {failText}
              {cam.phase === "failed" && cam.failure !== "none" && cam.failure !== "insecure" ? (
                <button type="button" className="cx" onClick={() => setAttempt((n) => n + 1)}>
                  {t("retry")}
                </button>
              ) : null}
            </div>
          )}
          <div className="camb">
            {typing ? (
              <form
                className="kodu"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = typed.trim();
                  if (v === "") return;
                  setTyped("");
                  setTyping(false);
                  service?.submitManual(v);
                }}
              >
                <label className="sr" htmlFor="okut-code">
                  {t("codeLabel")}
                </label>
                <input id="okut-code" autoFocus autoComplete="off" enterKeyHint="go" placeholder={t("codePh")} value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="okut-code" />
                <button type="submit" className="cx" data-testid="okut-code-go">
                  <Ico d={SICON.next} size={18} />
                  {t("codeGo")}
                </button>
              </form>
            ) : (
              <div className="sayp">
                <i>
                  <MicIco size={22} />
                </i>
                <span>
                  <b>{t("say")}</b>
                  <small>{note ?? t("saySub")}</small>
                </span>
              </div>
            )}
            <div className="camx">
              <button type="button" className="cx" onClick={() => void nfc()} data-testid="okut-nfc">
                <Ico d={SICON.nfc} size={18} />
                {t("nfc")}
              </button>
              <button
                type="button"
                className="cx"
                aria-pressed={typing}
                onClick={() => {
                  tone("tap");
                  setTyping((v) => !v);
                }}
                data-testid="okut-type"
              >
                <Ico d={SICON.kbd} size={18} />
                {t("kbd")}
              </button>
            </div>
          </div>
        </div>
      </main>
    </SahaFrame>
  );
}
