"use client";
// Saha kabulü (T-313): tara → doğrula → miktar onayla → bitti. Ekran başına tek soru ve tek sabit birincil düğme (N-01); yanlış tarama tam ekran
// uyarıyla durdurulur (N-13); miktar 48 px adım tuşlarıyla (N-02). Yetki, fazla kabul ve durum kuralları domain'dedir (`receiveGoods`);
// bu dosya yalnızca girdi toplar, sunucu hatasını (kod + sonraki eylem) gösterir. Bu dosyadaki ortak saha parçaları `putaway-flow.tsx` ile paylaşılır.
import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, CircleAlert, CircleCheck, ScanField, ScanLine } from "@wms/ui";
import { ScannerService, gateScan, type ScanSource, type ScannerSource } from "../../../../../lib/scanner/scanner-core.ts";
import { createKeystrokeSource } from "../../../../../lib/scanner/keystroke-source.ts";
import { cameraFeedback, classifyCameraError, createFrameDecoder, iosShareLocation, openCamera, platformOf, startScanLoop } from "../../../../../lib/scanner/camera-source.ts";
import type { CameraFailure, CameraSession, FrameDecoder, RejectReason } from "../../../../../lib/scanner/camera-source.ts";
import { intOf } from "../../receipts/receipt-form.tsx";
import { compoundQuantityAction } from "../../receipts/actions.ts";

const FOCUS = "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus";
/** Saha alt gezinme çubuğunun yüksekliği (field/layout.tsx: min-h-14 + py-2 + border-t-2 = 74 px); sabit birincil çubuk hemen üstünde durur. */
const NAV_H = "bottom-[74px]";

export type FlowHue = "green" | "teal";
const SCAN_ICON: Record<FlowHue, string> = { green: "text-cat-green-ink", teal: "text-cat-teal-ink" };
const SCAN_READY_BORDER: Record<FlowHue, string> = { green: "border-cat-green-ink", teal: "border-cat-teal-ink" };
const SCAN_LINK: Record<FlowHue, string> = { green: "text-cat-green-ink", teal: "text-cat-teal-ink" };
/** T-985: Görevlerim tasarımı — adım üst bandı kategori koyu tonunda, yazı yüzey renginde (ikon + metin de taşır). */
const BAND: Record<FlowHue, string> = { green: "bg-cat-green-ink", teal: "bg-cat-teal-ink" };
const SCAN_READY_BG: Record<FlowHue, string> = { green: "bg-cat-green-bg", teal: "bg-cat-teal-bg" };

// ---------------------------------------------------------------------------------------------------------------------
// Ortak saha parçaları
// ---------------------------------------------------------------------------------------------------------------------
export function PrimaryButton({ children, onClick, disabled, loading, type = "button" }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; loading?: boolean; type?: "button" | "submit" }) {
  return (
    <button
      type={type}
      data-variant="primary"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={onClick}
      className={`flow-primary flex min-h-14 w-full min-w-0 items-center justify-center rounded-2xl bg-accent px-4 text-lg font-extrabold tracking-wide text-on-accent disabled:opacity-60 ${FOCUS}`}
    >
      {children}
    </button>
  );
}
export function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} data-variant="primary" className={`flow-primary flex min-h-14 w-full min-w-0 items-center justify-center rounded-2xl bg-accent px-4 text-center text-lg font-extrabold tracking-wide text-on-accent ${FOCUS}`}>
      {children}
    </Link>
  );
}
const PRESSED: Record<FlowHue, string> = {
  green: "aria-pressed:border-cat-green-ink aria-pressed:bg-cat-green-bg aria-pressed:text-cat-green-ink",
  teal: "aria-pressed:border-cat-teal-ink aria-pressed:bg-cat-teal-bg aria-pressed:text-cat-teal-ink",
};
export function SecondaryButton({ children, onClick, disabled, pressed, tone }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean; tone?: FlowHue }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={`flex min-h-12 min-w-12 items-center justify-center rounded-control border-2 border-border-strong bg-surface px-4 text-base font-bold text-ink ${tone === undefined ? "aria-pressed:bg-accent-soft" : PRESSED[tone]} ${FOCUS}`}
    >
      {children}
    </button>
  );
}

const ArrowLeft = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M19 12H5m6-6-6 6 6 6" />
  </svg>
);

export interface FlowShellProps {
  hue: FlowHue;
  icon: React.ReactNode;
  /** Adım numarası/sayısı; hata, kilit ve boş durum ekranlarında verilmez (yanlış sayı gösterilmez). */
  step?: number;
  total?: number;
  title: string;
  instruction?: string;
  /** Geri: ya bağlantı ya işlev; yoksa gösterilmez. */
  backHref?: string;
  onBack?: () => void;
  footer: React.ReactNode;
  /** Sabit çubukta birincil düğmenin hemen ÜSTÜNDE görünen seçim (örn. seçili kabul rafı); içerik kaydırmasına bağlı değildir. */
  footerExtra?: React.ReactNode;
  /** Tarama adımı: ScanField yalnızca "Elle gir" ile açılır (tek yol); elle girişte birincil düğme gizlenir. */
  scanProxy?: boolean;
  children: React.ReactNode;
}

/** Adım çerçevesi: tek satır üst bilgi (geri + kategori ikonu + adım + başlık), altta tek sabit birincil eylem (alt gezinme çubuğunun hemen üstünde). */
export function FlowShell({ hue, icon, step, total, title, instruction, backHref, onBack, footer, footerExtra, scanProxy, children }: FlowShellProps) {
  const t = useTranslations("receiving");
  const back = "flow-band-back flex size-12 shrink-0 items-center justify-center rounded-2xl text-surface " + FOCUS;
  return (
    <main
      className={`group flex min-h-[calc(100dvh-8.25rem)] w-full min-w-0 flex-col gap-3 px-4 pt-3 ${footerExtra === undefined ? "pb-24" : "pb-44"} ${scanProxy === true ? "[&_[data-mode=scan]]:hidden" : ""}`}
      data-testid="flow-step"
      data-step={step ?? 0}
    >
      <header className={`flow-band -mx-4 -mt-3 flex min-w-0 items-center gap-3 rounded-b-3xl px-4 py-1.5 text-surface ${BAND[hue]}`}>
        {backHref !== undefined ? (
          <Link href={backHref} aria-label={t("back")} className={back}>
            <ArrowLeft />
          </Link>
        ) : onBack !== undefined ? (
          <button type="button" aria-label={t("back")} onClick={onBack} className={back}>
            <ArrowLeft />
          </button>
        ) : null}
        <span aria-hidden="true" className="flow-band-icon flex size-10 shrink-0 items-center justify-center rounded-xl">
          {icon}
        </span>
        <div className="flex min-w-0 flex-col">
          {step === undefined || total === undefined ? null : (
            <p className="text-xs font-extrabold uppercase tracking-wider" data-testid="step-label">
              {t("stepOf", { n: step, total })}
            </p>
          )}
          <h1 className="break-words text-xl font-extrabold leading-tight">{title}</h1>
        </div>
      </header>
      {instruction === undefined ? null : <p className="break-words text-base text-ink [@media(max-height:700px)]:hidden">{instruction}</p>}
      {children}
      <div role="group" aria-label={t("primaryBar")} className={`fixed inset-x-0 ${NAV_H} z-10 border-t border-border bg-surface px-4 py-2 group-has-[[data-mode=manual]]:hidden`}>
        <div className="mx-auto flex w-full max-w-md flex-col gap-2">
          {footerExtra}
          {footer}
        </div>
      </div>
    </main>
  );
}

/** Yanlış tarama / engelleyici hata: tam ekran, sebep + sonraki eylem, tek "tekrar okut" düğmesi (N-13). */
export function ScanAlert({ title, reason, action, code, onClose }: { title: string; reason: string; action: string; code?: string; onClose: () => void }) {
  const t = useTranslations("receiving");
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    btn.current?.focus();
    // Yalnızca titreşim (iOS Safari desteklemeyebilir; yoksa görsel uyarı yeterlidir, N-13).
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate([200, 80, 200]);
  }, []);
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="scan-alert-title" aria-describedby="scan-alert-body" data-testid="scan-alert" className="fixed inset-0 z-50 flex flex-col justify-between gap-4 bg-danger-bg px-6 pb-6 pt-10 text-danger-ink">
      <div className="flex min-w-0 flex-col items-center gap-4 text-center">
        <CircleAlert aria-hidden="true" className="size-20 text-danger" strokeWidth={2} />
        <h2 id="scan-alert-title" className="break-words text-3xl font-extrabold">
          {title}
        </h2>
        <p id="scan-alert-body" className="break-words text-xl font-semibold">
          {reason} {action}
        </p>
        {code === undefined ? null : (
          <details className="group/d text-base">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-center gap-2 font-bold">
              {t("detail")}
              <ChevronDown aria-hidden="true" className="size-5 shrink-0 transition-transform group-open/d:rotate-180" />
            </summary>
            <p data-testid="error-code">{t("errorCode", { code })}</p>
          </details>
        )}
      </div>
      <button ref={btn} type="button" onClick={onClose} className={`flex min-h-14 w-full items-center justify-center rounded-control bg-danger px-4 text-lg font-bold text-on-accent ${FOCUS}`}>
        {t("scanAgain")}
      </button>
    </div>
  );
}

/** Miktar: 48 px (burada 56 px) eksi/artı + sayı alanı; `inputmode="numeric"` yalnızca bu alanda; tam sayı; sınır sunucudan gelen kalan miktardır. */
export function QtyStepper({ label, value, min, max, onChange, scan }: { label: string; value: number; min: number; max: number | null; onChange: (n: number) => void; scan?: { label: string; onClick: () => void } }) {
  const inputId = useId();
  const clamp = (n: number): number => Math.min(max ?? 999_999_999, Math.max(min, n));
  const btn = `flex size-12 shrink-0 items-center justify-center rounded-control border-2 border-border-strong bg-surface text-3xl font-bold text-ink disabled:opacity-40 ${FOCUS}`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label className="text-base font-semibold text-ink" htmlFor={inputId}>
        {label}
      </label>
      <div className="flex min-w-0 items-center gap-2">
        <button type="button" aria-label={`${label} −`} disabled={value <= min} onClick={() => onChange(clamp(value - 1))} className={btn}>
          <span aria-hidden="true">−</span>
        </button>
        <input
          id={inputId}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          value={String(value)}
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, "").slice(0, 9);
            onChange(clamp(d === "" ? min : Number(d)));
          }}
          className={`min-h-12 w-full min-w-0 flex-1 rounded-card border-2 border-border-strong bg-surface px-2 text-center text-2xl font-extrabold text-ink ${FOCUS}`}
        />
        <button type="button" aria-label={`${label} +`} disabled={max !== null && value >= max} onClick={() => onChange(clamp(value + 1))} className={btn}>
          <span aria-hidden="true">+</span>
        </button>
        {scan === undefined ? null : (
          <button type="button" aria-label={scan.label} title={scan.label} data-testid="scan-more" onClick={scan.onClick} className={`flex size-12 shrink-0 items-center justify-center rounded-control border-2 border-border-strong bg-surface text-ink ${FOCUS}`}>
            <ScanLine aria-hidden="true" className="size-6" strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Durum değeri + eşzamanlı okunabilir ref: yazım ref'e HEMEN, görüntüye yeniden çizimle düşer (aynı tikteki ardışık okumalar eski kapanıştan okumaz). */
export function useStateRef<T>(initial: T): readonly [T, (v: T) => void, { readonly current: T }] {
  const [value, setValue] = useState(initial);
  const ref = useRef(initial);
  const set = useCallback((v: T): void => {
    ref.current = v;
    setValue(v);
  }, []);
  return [value, set, ref];
}

/**
 * Tarama kaynakları: klavye kaması (DataWedge) ve kamera servis arkasındadır (ADR-010); etkin ekran tek dinleyicidir. `enabled=false` iken tarama iletilmez.
 * `blocked`, akışın KAPISIDIR ve ref'lerden eşzamanlı okunur (işlem sürüyor, uyarı açık, bitti; yeniden çizim beklemez): hem servis kapısı hem `camera()` aynı işlevi kullanır,
 * böylece kapının atacağı bir okumaya kamera "kabul" demez. Aynı tikte gelen ikinci okuma çözülmez, bildirilir.
 * `camera(code)` kamera okumasını aynı servis yoluyla (`source: "camera"`) iletir ve İLETİLİP İLETİLMEDİĞİNİ döndürür (düşürülen okuma `false`).
 */
export function useScanner(
  handler: (value: string, source: ScanSource) => void,
  enabled: boolean,
  blocked?: () => boolean,
): { service: ScannerService | null; camera: (code: string) => boolean; dropped: boolean; clearDropped: () => void } {
  const [service, setService] = useState<ScannerService | null>(null);
  const [dropped, setDropped] = useState(false);
  const enabledRef = useRef(enabled);
  const ref = useRef(handler);
  // Atamalar render sırasında değil, yerleşimde (commit) yapılır: iptal edilen/yarım çizimler ref'i kirletmez (T-286 delta SR MINOR-3).
  useLayoutEffect(() => {
    enabledRef.current = enabled;
    ref.current = handler;
  });
  const cameraEmit = useRef<((v: string) => void) | null>(null);
  useEffect(() => {
    const s = new ScannerService();
    s.registerSource(createKeystrokeSource());
    const cam: ScannerSource = {
      id: "camera",
      start(emit) {
        cameraEmit.current = emit;
        return () => {
          cameraEmit.current = null;
        };
      },
    };
    s.registerSource(cam);
    setService(s);
  }, []);
  // Abonelik `enabled`'a BAĞLI DEĞİL: servis hazır olunca bir kez kurulur, söküm/yeniden takma penceresi yoktur (T-286 düşme yarışı).
  // `enabled` her taramada `enabledRef` ile (render sırasında güncel) kapıda denetlenir; kapalıyken gelen okuma (klavye kaması dahil) SESSİZCE düşmez: bildirilir.
  useEffect(() => {
    if (service === null) return undefined;
    return service.onScan(
      gateScan(
        () => enabledRef.current && blocked?.() !== true,
        (v, src) => ref.current(v, src),
        () => setDropped(true),
      ),
    );
  }, [service, blocked]);
  // Okuma kapalıyken (işlem sürüyor ya da uyarı açık) gelen kamera kodu SESSİZCE düşmez: kullanıcıya bildirilir (T-313 güvenlik MINOR) ve çağırana `false` döner.
  const camera = useCallback(
    (code: string): boolean => {
      const emit = cameraEmit.current;
      if (!enabledRef.current || blocked?.() === true || emit === null) {
        setDropped(true);
        return false;
      }
      emit(code);
      return true;
    },
    [blocked],
  );
  const clearDropped = useCallback(() => setDropped(false), []);
  return { service, camera, dropped, clearDropped };
}

type CamPhase =
  | { readonly phase: "starting" }
  | { readonly phase: "scanning" }
  | { readonly phase: "rejected"; readonly reason: RejectReason }
  | { readonly phase: "accepted"; readonly value: string }
  /** Okuma akışa iletilmedi (kod İŞLENMEDİ); kamera açık, döngü durdu: yalnız kullanıcının "Yeniden okut" eylemi yeni okuma başlatır. */
  | { readonly phase: "dropped" }
  | { readonly phase: "failed"; readonly failure: CameraFailure | "decoder" };

/** Kamera yolu kurulabilir mi: `getUserMedia` var ya da güvenli olmayan bağlam (o durumda katman HTTPS rehberini gösterir). Yoksa donanım tetiği (el terminali). */
const cameraPossible = (): boolean => typeof window !== "undefined" && typeof navigator !== "undefined" && (navigator.mediaDevices?.getUserMedia !== undefined || !window.isSecureContext);

/** Okumadan sonra katmanın açık kalma süreleri (ms): çözüm sürerken üst sınır, çözüldükten sonra, hiçbir şey olmuyorsa. */
const ACCEPT_MAX_MS = 10_000;
const ACCEPT_IDLE_MS = 1500;
const ACCEPT_AFTER_RESOLVE_MS = 700;

/**
 * Kamera katmanı (T-286): arka kamera + çözücü (yerleşik API ya da uygulama içi WASM, `camera-source.ts`). Yanlış okuma SATIR İÇİ gösterilir, katman ve kamera açık kalır;
 * doğru okuma yeşil onay + okunan kod (çözülmüşse ürün adı) + kısa bip + titreşimle bildirilir. Hata mesajı neden + sonraki eylemi söyler; "Elle gir" her durumda görünür
 * (kamera yoksa/izin yoksa birincil). Klavye kaması (el terminali) katman açıkken de çalışır: katman klavye kaynağını engellemez.
 */
export function CameraOverlay({ onCode, onClose, onManual, resolvedName }: { onCode: (code: string) => boolean; onClose: () => void; onManual: () => void; resolvedName?: string | undefined }) {
  const t = useTranslations("receiving");
  const video = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  useLayoutEffect(() => {
    onCodeRef.current = onCode;
  });
  const session = useRef<CameraSession | null>(null);
  const beginRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<CamPhase>({ phase: "starting" });
  const [attempt, setAttempt] = useState(0);
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean; failed: boolean }>({ supported: false, on: false, failed: false });
  const [decoderKind, setDecoderKind] = useState<"native" | "wasm" | "">("");
  useEffect(() => {
    let cancelled = false;
    let stopLoop: (() => void) | null = null;
    let cam: CameraSession | null = null;
    setState({ phase: "starting" });
    setTorch({ supported: false, on: false, failed: false });
    void (async () => {
      try {
        cam = await openCamera();
      } catch (e) {
        if (!cancelled) setState({ phase: "failed", failure: classifyCameraError(e) });
        return;
      }
      if (cancelled) {
        cam.stop();
        return;
      }
      session.current = cam;
      const v = video.current;
      if (v === null) {
        // Katman yokken akış açık KALMAZ (MINOR-4): kamera hemen durdurulur.
        cam.stop();
        session.current = null;
        setState({ phase: "failed", failure: "failed" });
        return;
      }
      v.srcObject = cam.stream;
      void v.play().catch(() => undefined);
      setTorch({ supported: cam.torchSupported, on: false, failed: false });
      let decoder: FrameDecoder;
      try {
        decoder = await createFrameDecoder(); // WASM yolunda çözücü burada tembel yüklenir (yalnızca tarama ekranında)
      } catch {
        cam.stop();
        if (!cancelled) setState({ phase: "failed", failure: "decoder" });
        return;
      }
      if (cancelled) {
        cam.stop();
        return;
      }
      setDecoderKind(decoder.kind);
      setState({ phase: "scanning" });
      const opened = cam;
      const begin = (): void => {
        stopLoop?.(); // eski döngü durdurulmadan yenisi kurulmaz ("Yeniden okut"a iki basış iki döngü açmaz)
        stopLoop = startScanLoop({
          decoder,
          video: v,
          onRejected: (reason) => {
            cameraFeedback("bad");
            setState({ phase: "rejected", reason });
          },
          onAccepted: (value) => {
            // Okuma akışa İLETİLMEDİYSE (işlem sürüyor/uyarı açık) kabul edilmiş sayılmaz: "Okundu" ekranı ve olumlu bip yok. Düşen kod HİÇBİR yolla işlenmez ve
            // kamera kendiliğinden yeniden okumaz (aynı kod kullanıcı onayı olmadan sayılırdı); döngü durur, yalnız "Yeniden okut" eylemi yeni okuma başlatır.
            if (!onCodeRef.current(value)) {
              setState({ phase: "dropped" });
              return;
            }
            // Tek kabul: döngü kendini durdurdu; akış da hemen kapanır (aynı kod ikinci kez gönderilemez). Katmanı kapatma kararı üsttedir (ürün çözülünce).
            v.pause(); // son kare pencerede kalır (okunan barkod görünür)
            opened.stop();
            cameraFeedback("ok");
            setState({ phase: "accepted", value });
          },
        });
      };
      beginRef.current = () => {
        setState({ phase: "scanning" });
        begin();
      };
      begin();
    })();
    return () => {
      cancelled = true;
      beginRef.current = null;
      if (stopLoop !== null) stopLoop();
      cam?.stop();
      session.current = null;
    };
  }, [attempt]);

  const toggleTorch = (): void => {
    const s = session.current;
    if (s === null) return;
    const next = !torch.on;
    void s.setTorch(next).then((ok) => setTorch((p) => ({ ...p, on: ok ? next : p.on, failed: !ok })));
  };
  const failed = state.phase === "failed";
  const live = state.phase === "starting" || state.phase === "scanning" || state.phase === "rejected" || state.phase === "dropped";
  const platform = typeof navigator === "undefined" ? "other" : platformOf(navigator.userAgent, navigator.maxTouchPoints);
  const failureKey = state.phase !== "failed" ? "" : state.failure === "denied" ? `denied_${platform}` : state.failure;
  const message = ((): { key: string; role: "status" | "alert"; tone: "plain" | "bad" | "good" } => {
    switch (state.phase) {
      case "starting":
        return { key: "camera.hint", role: "status", tone: "plain" };
      case "scanning":
        return { key: torch.failed ? "camera.torchFailed" : "camera.hint", role: torch.failed ? "alert" : "status", tone: "plain" };
      case "rejected":
        return { key: `camera.rejected.${state.reason}`, role: "alert", tone: "bad" };
      case "accepted":
        return { key: "camera.accepted", role: "status", tone: "good" };
      case "dropped":
        return { key: "camera.notTaken", role: "alert", tone: "bad" };
      case "failed":
        return { key: `camera.error.${failureKey}`, role: "alert", tone: "bad" };
    }
  })();
  const TONE = { plain: "text-on-accent", bad: "rounded-card bg-danger-bg px-3 py-2 text-danger-ink", good: "rounded-card bg-success-bg px-3 py-2 text-success-ink" } as const;
  const text = (
    <p role={message.role} data-testid="camera-status" data-tone={message.tone} className={`flex min-w-0 items-start gap-2 break-words text-lg font-bold ${TONE[message.tone]}`}>
      {message.tone === "bad" ? <CircleAlert aria-hidden="true" className="mt-0.5 size-6 shrink-0" strokeWidth={2.25} /> : null}
      {message.tone === "good" ? <CircleCheck aria-hidden="true" className="mt-0.5 size-6 shrink-0" strokeWidth={2.25} /> : null}
      <span className="min-w-0 flex-1">
        {t(message.key)}
        {state.phase === "accepted" ? (
          <span data-testid="camera-accepted-value" className="block truncate">
            {resolvedName ?? state.value}
          </span>
        ) : null}
      </span>
    </p>
  );
  const btn = `flex min-h-12 min-w-12 flex-1 items-center justify-center whitespace-nowrap rounded-control border-2 border-on-accent bg-transparent px-3 text-base font-bold text-on-accent ${FOCUS}`;
  // İzin/kamera yokken "Elle gir" birincil (dolu), "Tekrar dene" ikincil (çerçeveli).
  const primaryBtn = `flex min-h-12 min-w-12 basis-full items-center justify-center whitespace-nowrap rounded-control border-2 border-on-accent bg-on-accent px-3 text-base font-bold text-ink landscape:basis-auto ${FOCUS}`;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("camera.title")}
      data-testid="camera-overlay"
      data-phase={state.phase}
      data-decoder={decoderKind}
      className="fixed inset-0 z-40 grid grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-hidden bg-ink p-3 text-on-accent landscape:grid-cols-[minmax(0,1fr)_20rem] landscape:grid-rows-[minmax(0,1fr)_auto]"
    >
      <div className="row-start-1 landscape:col-start-2 landscape:self-center">{text}</div>
      <div data-testid="camera-viewport" className="relative row-start-2 min-h-0 min-w-0 overflow-hidden rounded-card bg-ink landscape:col-start-1 landscape:row-span-2 landscape:row-start-1">
        <video ref={video} muted playsInline data-testid="camera-video" className={`size-full object-cover ${failed ? "invisible" : ""}`} />
        {live ? <div aria-hidden="true" data-testid="camera-reticle" className="pointer-events-none absolute inset-x-[10%] inset-y-[25%] rounded-card border-4 border-success" /> : null}
        {state.phase === "starting" ? (
          <p role="status" data-testid="camera-opening" className="absolute inset-x-0 top-1/2 mx-auto w-fit max-w-[90%] -translate-y-1/2 rounded-control bg-ink px-4 py-2 text-center text-lg font-bold text-on-accent">
            {t("camera.starting")}
          </p>
        ) : null}
        {failed ? (
          <div data-testid="camera-off" className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-2 text-center text-on-accent">
            <ScanLine aria-hidden="true" className="size-14 text-border-strong" strokeWidth={1.75} />
            <p className="text-lg font-bold">{t("camera.off")}</p>
          </div>
        ) : null}
      </div>
      <div className="row-start-3 flex min-w-0 flex-wrap gap-2 landscape:col-start-2 landscape:row-start-2 landscape:flex-col landscape:flex-nowrap">
        {failed ? (
          <button type="button" onClick={onManual} className={primaryBtn}>
            {t("flow.manual")}
          </button>
        ) : null}
        {failed && state.failure !== "none" && state.failure !== "insecure" ? (
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className={btn}>
            {t("camera.retry")}
          </button>
        ) : null}
        {state.phase === "dropped" ? (
          <button type="button" onClick={() => beginRef.current?.()} className={primaryBtn}>
            {t("camera.rescan")}
          </button>
        ) : null}
        {torch.supported && !failed && state.phase !== "accepted" ? (
          <button type="button" aria-pressed={torch.on} onClick={toggleTorch} className={btn}>
            {torch.on ? t("camera.torchOff") : t("camera.torchOn")}
          </button>
        ) : null}
        {failed ? null : (
          <button type="button" onClick={onManual} className={btn}>
            {t("flow.manual")}
          </button>
        )}
        <button type="button" onClick={onClose} className={btn}>
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}


const INSTALL_HINT_KEY = "wms.installHint.dismissed";

/**
 * iPhone'da (tüm tarayıcılar WebKit) uygulama henüz ana ekrana eklenmemişse tek satır rehber: "Paylaş > Ana Ekrana Ekle". Kapatılınca (Tamam) bir daha gösterilmez.
 * Android'de tarayıcı kendi "Ana ekrana ekle" yolunu sunar (manifest, `app/manifest.ts`); rehber yalnızca iPhone içindir.
 */
function useInstallHint(): { show: boolean; where: "bottom" | "address"; dismiss: () => void } {
  const [show, setShow] = useState(false);
  const [where, setWhere] = useState<"bottom" | "address">("bottom");
  useEffect(() => {
    if (platformOf(navigator.userAgent, navigator.maxTouchPoints) !== "ios") return;
    const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(INSTALL_HINT_KEY) === "1";
    } catch {
      dismissed = false; // depolama kapalı (gizli sekme): rehber her açılışta görünür, hata değildir
    }
    setWhere(iosShareLocation(navigator.userAgent));
    setShow(!standalone && !dismissed);
  }, []);
  const dismiss = useCallback(() => {
    setShow(false);
    try {
      window.localStorage.setItem(INSTALL_HINT_KEY, "1");
    } catch {
      // depolama kapalı: bu oturumda gizlenir
    }
  }, []);
  return { show, where, dismiss };
}

/**
 * Tarama paneli (tek yol): büyük okut ikonu + tek cümle; alt birincil düğme "Barkodu okut". ScanField (T-303) yalnızca "Elle gir" bağlantısıyla açılır
 * (ikincil); okuma hazır olduğunda `ready` vurgusu görünür.
 */
export function ScanPanel({ service, prompt, last, lastName, ready, hue }: { service: ScannerService | null; prompt: string; last: string; lastName?: string; ready: boolean; hue: FlowHue }) {
  const t = useTranslations("receiving");
  const wrap = useRef<HTMLDivElement>(null);
  const install = useInstallHint();
  return (
    <section
      data-testid="scan-panel"
      data-ready={ready ? "true" : "false"}
      aria-live="polite"
      className={`flex min-w-0 flex-none flex-col items-center gap-2 rounded-3xl border-2 p-4 text-center ${ready ? `${SCAN_READY_BORDER[hue]} ${SCAN_READY_BG[hue]}` : "border-dashed border-border-strong bg-surface"}`}
    >
      <ScanLine aria-hidden="true" className={`size-16 ${SCAN_ICON[hue]}`} strokeWidth={1.75} />
      <p className="break-words text-lg font-bold text-ink">{ready ? t("flow.readerReady") : prompt}</p>
      {last === "" ? null : (
        <p className="break-words text-sm text-ink-muted" data-testid="last-scan">
          {lastName === undefined ? null : <span className="font-bold text-ink">{t("flow.lastScan", { name: lastName })} </span>}
          <span className="break-all text-xs" data-testid="last-scan-code">{t("flow.lastCode", { code: last })}</span>
        </p>
      )}
      <div ref={wrap} className="w-full min-w-0">
        <ScanField
          label={t("flow.scanLabel")}
          value={last}
          manualLabel={t("flow.manual")}
          confirmLabel={t("flow.manualConfirm")}
          cancelLabel={t("cancel")}
          placeholder={t("flow.scanPlaceholder")}
          onManualSubmit={(v) => service?.submitManual(v)}
        />
      </div>
      <button
        type="button"
        onClick={() => wrap.current?.querySelector<HTMLButtonElement>('[data-mode="scan"] > button')?.click()}
        className={`flex min-h-12 min-w-12 items-center justify-center rounded-control px-4 text-base font-bold ${SCAN_LINK[hue]} underline group-has-[[data-mode=manual]]:hidden ${FOCUS}`}
      >
        {t("flow.manual")}
      </button>
      {install.show ? (
        <div data-testid="install-hint" className="flex w-full min-w-0 items-center gap-2 border-t-2 border-border pt-2 text-left">
          <p className="min-w-0 flex-1 break-words text-base font-semibold text-ink">{t(install.where === "address" ? "camera.installHintChrome" : "camera.installHintSafari")}</p>
          <button type="button" onClick={install.dismiss} className={`flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-control border-2 border-border-strong px-3 text-base font-bold text-ink ${FOCUS}`}>
            {t("camera.ok")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** Okuma sonucu (üst akıştan): kamera katmanı okunan kod çözülene kadar açık kalır ve ürün/lokasyon adını gösterir. */
export interface ScanOutcome {
  readonly busy: boolean;
  readonly name: string | undefined;
  /** `name`in ait olduğu okuma (son okunan kod): kamera katmanı adı yalnız KENDİ okumasının kodu bununla eşleşirse gösterir. */
  readonly code: string;
  readonly alerting: boolean;
}

/**
 * Tarama adımının birincil düğmesi: kamera yolu kurulabiliyorsa kamera katmanını açar (telefon; T-286); kurulamıyorsa okuyucuyu (el terminali tetiği) hazırlar.
 * El terminali (klavye kaması) kamera katmanı açıkken de açıkken de çalışır: kaynak servistedir, katmana bağlı değildir.
 */
export function useScanPrimary(camera: (code: string) => boolean, outcome: ScanOutcome): { ready: boolean; press: () => void; overlay: React.ReactNode } {
  const [cam, setCam] = useState(false);
  const [ready, setReady] = useState(false);
  // Katmanın kabul ettiği okuma (kod); yalnız akışa İLETİLEN okuma kabul sayılır (düşürülen okuma "Okundu" göstermez).
  const [accepted, setAccepted] = useState<string | null>(null);
  const wantManual = useRef(false);
  const onCode = useCallback(
    (code: string): boolean => {
      const forwarded = camera(code);
      if (forwarded) setAccepted(code);
      return forwarded;
    },
    [camera],
  );
  const close = useCallback(() => {
    setCam(false);
    setAccepted(null);
  }, []);
  const onManual = useCallback(() => {
    wantManual.current = true;
    close();
  }, [close]);
  // Okuma kabul edildi: çözüm sürerken (busy) katman açık kalır (üst sınır ACCEPT_MAX_MS); çözülünce (ad geldi ya da hata uyarısı açıldı) kısa süre sonra,
  // hiçbir şey olmuyorsa (okuma kapalı vb.) ACCEPT_IDLE_MS sonra kapanır.
  // Ad yalnız katmanın KENDİ okumasına bağlıdır (başka kaynaktan gelen önceki/sonraki okumanın adı sayılmaz).
  const ownName = accepted !== null && outcome.code === accepted ? outcome.name : undefined;
  useEffect(() => {
    if (accepted === null) return undefined;
    const resolved = ownName !== undefined || outcome.alerting;
    const ms = outcome.busy ? ACCEPT_MAX_MS : resolved ? ACCEPT_AFTER_RESOLVE_MS : ACCEPT_IDLE_MS;
    const timer = setTimeout(close, ms);
    return () => clearTimeout(timer);
  }, [accepted, outcome.busy, ownName, outcome.alerting, close]);
  // "Elle gir": katman kapanınca tarama panelindeki ScanField elle giriş kipine geçer (aynı bileşen, ikinci bir giriş yolu yok).
  useEffect(() => {
    if (cam || !wantManual.current) return;
    wantManual.current = false;
    document.querySelector<HTMLButtonElement>('[data-testid="scan-panel"] [data-mode="scan"] > button')?.click();
  }, [cam]);
  const press = (): void => {
    if (cameraPossible()) setCam(true);
    else {
      setReady(true);
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(30);
    }
  };
  return { ready, press, overlay: cam ? <CameraOverlay onCode={onCode} onClose={close} onManual={onManual} resolvedName={ownName} /> : null };
}

/** Okuma kapalıyken gelen kod bildirimi (kaynaktan bağımsız: kamera ya da klavye kaması). Uyarı açıkken de görünür: altta (`bottom-40`, `z-[60]`); dikey ekranda tam ekran uyarının başlığını ve Geri düğmesini örtmez (yatay: T-292b). */
export function DroppedNotice({ show, alerting, onClose }: { show: boolean; alerting: boolean; onClose: () => void }) {
  const t = useTranslations("receiving");
  if (!show) return null;
  // Alta yakın (`bottom-40`: birincil çubuğun üstü; üstteki başlığı ve Geri düğmesini örtmez); tam ekran uyarı açıkken ikinci onay düğmesi YOKTUR: uyarı kapanınca bildirim kendiliğinden kalkar.
  // Metin davranışla tutarlıdır: düşen kod işlenmez ve adet eklenmez; yeni okutma yalnız kullanıcının açık eylemiyle olur.
  return (
    <div role="alert" data-testid="camera-dropped" className="fixed inset-x-4 bottom-40 z-[60] mx-auto flex max-w-md items-center gap-3 rounded-card border-2 border-warning bg-warning-bg px-4 py-3 text-warning-ink shadow-card">
      <p className="min-w-0 flex-1 break-words text-base font-bold">{t("camera.dropped")}</p>
      {alerting ? null : (
        <button type="button" onClick={onClose} className={`flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-control border-2 border-warning-ink px-3 text-base font-bold ${FOCUS}`}>
          {t("camera.ok")}
        </button>
      )}
    </div>
  );
}

/** Okuma çözümünün adet alanları (`resolveItemScanAction` çıktısı; sunucuda `resolveBarcode`'dan gelir, burada yeniden hesaplanmaz). */
export interface ScanQty {
  readonly unitId: string;
  readonly quantity: string;
  readonly baseQuantity: string;
  readonly baseUnitId: string;
}
const sameId = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const wholeOf = (s: string): number | null => {
  const n = intOf(s);
  return n === null || n < 1 ? null : n;
};

/** Okutmanın adımı: `step` (tam sayı) ya da açık ret nedeni (`fractional`: tam sayı değil, `unit`: sayılan birimle bağı yok). */
export type ScanStep = { readonly ok: true; readonly step: number } | { readonly ok: false; readonly reason: "fractional" | "unit" };

/**
 * Bir okutmanın, saydığımız birimde (`countUnitId`) kaç adım artıracağı (K-1/K-3; yuvarlama yok, kesirli koli yok).
 * Sayılan birim temel birimse artış `baseQuantity`'dir (koli okutunca koli içi adet); sayılan birim barkodun kendi birimiyse okutma başına miktar (koli = 1).
 * İkisi de değilse (ör. koli satırında tekli barkod) birimler arası katsayı istemcide yoktur: adım UYDURULMAZ, `unit` reddi döner ve miktar değişmez (A-287c-1).
 * Tam sayı olmayan sonuç `fractional` reddidir (ekran uyarır, sessizce 1 yapmaz).
 */
export function scanStepOf(scan: ScanQty, countUnitId: string): ScanStep {
  const pick = (s: string): ScanStep => {
    const n = wholeOf(s);
    return n === null ? { ok: false, reason: "fractional" } : { ok: true, step: n };
  };
  if (sameId(countUnitId, scan.baseUnitId)) return pick(scan.baseQuantity);
  if (sameId(countUnitId, scan.unitId)) return pick(scan.quantity);
  return { ok: false, reason: "unit" };
}
export const isBaseUnit = (unitId: string, baseUnitId: string): boolean => sameId(unitId, baseUnitId);

/** Temel birim miktarının bileşik gösterimi ("2 koli + 3 adet") + toplam; metin sunucuda `formatCompound` ile üretilir (yalnız görüntü). Ürünün koli dönüşümü yoksa görünmez. */
export function CompoundLine({ slug, itemId, baseQty }: { slug: string; itemId: string; baseQty: number }) {
  const t = useTranslations("receiving");
  const key = `${itemId}|${baseQty}`;
  const [view, setView] = useState<{ key: string; text: string; total: number; unit: string } | { key: string; failed: true } | null>(null);
  useEffect(() => {
    let live = true;
    // Adım tuşlarına art arda basış her basışta sunucuya gitmesin: kısa gecikmeyle son değer sorulur.
    const timer = setTimeout(() => {
      compoundQuantityAction({ slug, itemId, baseQuantity: String(baseQty) })
        .then((r) => {
          if (!live) return;
          if (!r.ok) setView({ key, failed: true });
          else setView(r.data.packed ? { key, text: r.data.text, total: baseQty, unit: r.data.baseName } : null);
        })
        .catch(() => {
          if (live) setView({ key, failed: true });
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [slug, itemId, baseQty, key]);
  if (view === null || view.key !== key) return null;
  if ("failed" in view) {
    return (
      <p role="status" data-testid="compound-qty" data-state="failed" className="break-words text-base font-semibold text-ink-muted">
        {t("flow.compoundFailed")}
      </p>
    );
  }
  return (
    <p data-testid="compound-qty" data-state="ok" className="break-words text-base font-bold text-ink [@media(max-height:700px)]:text-sm">
      {t("flow.compound", { text: view.text, total: view.total, unit: view.unit })}
    </p>
  );
}

export interface AlertState {
  readonly titleKey: string;
  readonly reasonKey: string;
  readonly params?: Record<string, string>;
  readonly code?: string;
}

// T-969: kabul akışı `receive-view.tsx`'e (Saha kalıbı) taşındı; bu dosyada ortak saha parçaları kalır (paket akışları, yerleştirme, OKUT).
