"use client";
// Saha kabulü (T-313): tara → doğrula → miktar onayla → bitti. Ekran başına tek soru ve tek sabit birincil düğme (N-01); yanlış tarama tam ekran
// uyarıyla durdurulur (N-13); miktar 48 px adım tuşlarıyla (N-02). Yetki, fazla kabul ve durum kuralları domain'dedir (`receiveGoods`);
// bu dosya yalnızca girdi toplar, sunucu hatasını (kod + sonraki eylem) gösterir. Bu dosyadaki ortak saha parçaları `putaway-flow.tsx` ile paylaşılır.
// T-1122 (B-63, I-18): eski görünüm (Tailwind düzeni, kütüphane simgeleri, eski FlowShell/QtyStepper) kaldırıldı. Birincil/ikincil düğme,
// tam ekran uyarı, kamera katmanı, düşen okuma bildirimi ve okutma paneli Saha kalıbı (KalipSaha.dc.html) dilinde: simgeler kaynaktan
// (`SICON`, şevron `LICON.chev`), görünüm `design/standart.css` (T-1122 bölümü; `.kpri/.ksec/.kalert/.kcam/.kdrop`, ortak `--color-kr-*`
// belirteçleri — katman kalıp kabı dışında da açılır: ürün listesi, seçim sayfası, sevk formu). Davranış, roller ve test kimlikleri aynı.
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useModalFocus } from "../../kalip/odak.ts";
import { useTranslations } from "next-intl";
import { ScanField } from "@wms/ui";
import { ScannerService, gateScan, type ScanSource, type ScannerSource } from "../../../../../lib/scanner/scanner-core.ts";
import { createKeystrokeSource } from "../../../../../lib/scanner/keystroke-source.ts";
import { cameraFeedback, classifyCameraError, createFrameDecoder, iosShareLocation, openCamera, platformOf, startScanLoop } from "../../../../../lib/scanner/camera-source.ts";
import type { CameraFailure, CameraSession, FrameDecoder, RejectReason, ScanStats } from "../../../../../lib/scanner/camera-source.ts";
import { intOf } from "../../receipts/receipt-form.tsx";
import { compoundQuantityAction } from "../../receipts/actions.ts";
import { SICON } from "../../../../design/saha-icons.ts";
import { LICON } from "../../../../design/kalip-icons.ts";
import { feedback } from "@wms/ui";

export type FlowHue = "green" | "teal";

/** Kaynak simgesi (24'lük çizgi; renk `currentColor`). */
function Svg({ d, size, className = "ico" }: { d: string; size: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Ortak saha parçaları
// ---------------------------------------------------------------------------------------------------------------------
/** Birincil düğme (kaynak `.btn.n`, en az 56 px; saha kabında `.dzs .flow-primary`). `data-variant="primary"` tek birincil sözleşmesidir. */
export function PrimaryButton({ children, onClick, disabled, loading, type = "button" }: { children: ReactNode; onClick?: () => void; disabled?: boolean; loading?: boolean; type?: "button" | "submit" }) {
  return (
    <button type={type} data-variant="primary" disabled={disabled || loading} aria-busy={loading || undefined} onClick={onClick} className="flow-primary kpri">
      {children}
    </button>
  );
}
export function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} data-variant="primary" className="flow-primary kpri">
      {children}
    </Link>
  );
}
/** İkincil düğme (kaynak `.more`: kesik çerçeveli, 48 px); `pressed` seçili hâl (`aria-pressed`), `tone` akış rengi. */
export function SecondaryButton({ children, onClick, disabled, pressed, tone }: { children: ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean; tone?: FlowHue }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={pressed} className={`more ksec${tone === undefined ? "" : ` ${tone}`}`}>
      {children}
    </button>
  );
}

/** Yanlış tarama / engelleyici hata: tam ekran, sebep + sonraki eylem, tek "tekrar okut" düğmesi (N-13). Kaynak (b) `.vres.bad` dili: kırmızı dolu. */
export function ScanAlert({ title, reason, action, code, onClose }: { title: string; reason: string; action: string; code?: string; onClose: () => void }) {
  const t = useTranslations("receiving");
  const btn = useRef<HTMLButtonElement>(null);
  // T-436 (ALTIN-KURAL 11): Esc kapatır, odak perdede kalır, kapanınca açan düğmeye döner.
  const alertRef = useRef<HTMLDivElement>(null);
  useModalFocus(true, alertRef, { onClose, initial: "none" });
  useEffect(() => {
    btn.current?.focus();
    // Kötü okutma sesi + titreşim (T-436: tek kaynak; iOS titreşimi desteklemeyebilir, görsel uyarı yeterlidir, N-13).
    feedback.scan(false);
  }, []);
  return (
    <div ref={alertRef} role="alertdialog" aria-modal="true" aria-labelledby="scan-alert-title" aria-describedby="scan-alert-body" data-testid="scan-alert" className="kalert">
      <div className="kalertin">
        <span className="kalertic">
          <Svg d={SICON.warn} size={56} />
        </span>
        <h2 id="scan-alert-title" className="kalertt">
          {title}
        </h2>
        <p id="scan-alert-body" className="kalertb">
          {reason} {action}
        </p>
        {code === undefined ? null : (
          <details className="sdet">
            <summary>
              {t("detail")}
              <Svg d={LICON.chev} size={18} className="ico sdetc" />
            </summary>
            <p data-testid="error-code">{t("errorCode", { code })}</p>
          </details>
        )}
      </div>
      <button ref={btn} type="button" onClick={onClose} className="kalertbtn">
        <Svg d={SICON.scan} size={22} />
        {t("scanAgain")}
      </button>
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
  // T-436 (ALTIN-KURAL 11): Esc kapatır, odak perdede kalır, kapanınca açan düğmeye döner.
  const overlayRef = useRef<HTMLDivElement>(null);
  useModalFocus(true, overlayRef, { onClose, initial: "none" });
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
  const reticle = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<ScanStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    let stopLoop: (() => void) | null = null;
    let cam: CameraSession | null = null;
    setState({ phase: "starting" });
    setTorch({ supported: false, on: false, failed: false });
    // T-446: çözücü (WASM indirme + derleme) kamera izni/açılışıyla PARALEL hazırlanır (yalnızca tarama ekranında).
    const decoderP = createFrameDecoder();
    decoderP.catch(() => undefined);
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
        decoder = await decoderP;
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
          roiTarget: () => reticle.current,
          onStats: setStats,
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

  // Dokun-odakla (T-446): görüntüye dokununca o noktaya (destek varsa) yeniden odaklanır.
  const focusTap = (e: ReactPointerEvent<HTMLVideoElement>): void => {
    const s = session.current;
    const r = e.currentTarget.getBoundingClientRect();
    if (s === null || r.width === 0 || r.height === 0) return;
    void s.focusAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };
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
  const text = (
    <p role={message.role} data-testid="camera-status" data-tone={message.tone} className={`kcams ${message.tone}`}>
      {message.tone === "bad" ? <Svg d={SICON.warn} size={24} /> : null}
      {message.tone === "good" ? <Svg d={SICON.check} size={24} /> : null}
      <span className="kcamst">
        {t(message.key)}
        {state.phase === "accepted" ? (
          <span data-testid="camera-accepted-value" className="kcamv">
            {resolvedName ?? state.value}
          </span>
        ) : null}
      </span>
    </p>
  );
  // İzin/kamera yokken "Elle gir" birincil (dolu), "Tekrar dene" ikincil (çerçeveli).
  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("camera.title")}
      data-testid="camera-overlay"
      data-phase={state.phase}
      data-decoder={decoderKind}
      data-first-read-ms={stats?.firstReadMs}
      data-decode-avg-ms={stats?.decodeAvgMs}
      data-decode-max-ms={stats?.decodeMaxMs}
      data-scan-frames={stats?.frames}
      className="kcam"
    >
      <div className="kcamh">{text}</div>
      <div data-testid="camera-viewport" className="kcamvp">
        <video ref={video} muted playsInline data-testid="camera-video" onPointerUp={focusTap} className={failed ? "off" : undefined} />
        {live ? <div ref={reticle} aria-hidden="true" data-testid="camera-reticle" className="kcamret" /> : null}
        {state.phase === "starting" ? (
          <p role="status" data-testid="camera-opening" className="kcamop">
            {t("camera.starting")}
          </p>
        ) : null}
        {failed ? (
          <div data-testid="camera-off" className="kcamoff">
            <Svg d={SICON.scan} size={56} />
            <p>{t("camera.off")}</p>
          </div>
        ) : null}
      </div>
      <div className="kcamb">
        {failed ? (
          <button type="button" onClick={onManual} className="kcbtn pri">
            {t("flow.manual")}
          </button>
        ) : null}
        {failed && state.failure !== "none" && state.failure !== "insecure" ? (
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="kcbtn">
            {t("camera.retry")}
          </button>
        ) : null}
        {state.phase === "dropped" ? (
          <button type="button" onClick={() => beginRef.current?.()} className="kcbtn pri">
            {t("camera.rescan")}
          </button>
        ) : null}
        {torch.supported && !failed && state.phase !== "accepted" ? (
          <button type="button" aria-pressed={torch.on} onClick={toggleTorch} className="kcbtn">
            {torch.on ? t("camera.torchOff") : t("camera.torchOn")}
          </button>
        ) : null}
        {failed ? null : (
          <button type="button" onClick={onManual} className="kcbtn">
            {t("flow.manual")}
          </button>
        )}
        <button type="button" onClick={onClose} className="kcbtn">
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
 * T-978: ekran kalıbı görünümü (`.kscanp`, design/kalip-frame.css; Saha/Form kabının belirteçleri, koyu tema kabın `dz-dark` sınıfından;
 * ikonlar saha kaynağından). T-1122: eski (Tailwind) görünüm kaldırıldı; `variant` yalnız eski çağıranlar için kabul edilir, görünüm her zaman kalıp.
 */
export function ScanPanel({ service, prompt, last, lastName, ready, hue }: { service: ScannerService | null; prompt: string; last: string; lastName?: string; ready: boolean; hue: FlowHue; variant?: "default" | "kalip" }) {
  const t = useTranslations("receiving");
  const wrap = useRef<HTMLDivElement>(null);
  const install = useInstallHint();
  const openManual = (): void => wrap.current?.querySelector<HTMLButtonElement>('[data-mode="scan"] > button')?.click();
  return (
    <section data-testid="scan-panel" data-ready={ready ? "true" : "false"} aria-live="polite" className={`kscanp ${hue}${ready ? " on" : ""}`}>
      <span className="kscanic">
        <Svg d={SICON.scan} size={40} />
      </span>
      <p className="kscant">{ready ? t("flow.readerReady") : prompt}</p>
      {last === "" ? null : (
        <p className="kscanlast" data-testid="last-scan">
          {lastName === undefined ? null : <b>{t("flow.lastScan", { name: lastName })} </b>}
          <span className="mono" data-testid="last-scan-code">
            {t("flow.lastCode", { code: last })}
          </span>
        </p>
      )}
      <div ref={wrap} className="kscanw">
        <ScanField
          variant="kalip"
          manualIcon={<Svg d={SICON.kbd} size={20} />}
          label={t("flow.scanLabel")}
          value={last}
          manualLabel={t("flow.manual")}
          confirmLabel={t("flow.manualConfirm")}
          cancelLabel={t("cancel")}
          placeholder={t("flow.scanPlaceholder")}
          onManualSubmit={(v) => service?.submitManual(v)}
        />
      </div>
      <button type="button" onClick={openManual} className="kscanlink">
        <Svg d={SICON.kbd} size={18} />
        {t("flow.manual")}
      </button>
      {install.show ? (
        <div data-testid="install-hint" className="kscanhint">
          <p>{t(install.where === "address" ? "camera.installHintChrome" : "camera.installHintSafari")}</p>
          <button type="button" onClick={install.dismiss} className="btn kscan2">
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
      // Küçük işlem (okuyucu hazır): sessiz (T-436, kullanıcı kararı 21 Ekim).
      feedback.minor();
    }
  };
  return { ready, press, overlay: cam ? <CameraOverlay onCode={onCode} onClose={close} onManual={onManual} resolvedName={ownName} /> : null };
}

/** Okuma kapalıyken gelen kod bildirimi (kaynaktan bağımsız: kamera ya da klavye kaması). Uyarı açıkken de görünür: altta, en üst katmanda; dikey ekranda tam ekran uyarının başlığını ve Geri düğmesini örtmez (yatay: T-292b). */
export function DroppedNotice({ show, alerting, onClose }: { show: boolean; alerting: boolean; onClose: () => void }) {
  const t = useTranslations("receiving");
  if (!show) return null;
  // Alta yakın (birincil çubuğun üstü; üstteki başlığı ve Geri düğmesini örtmez); tam ekran uyarı açıkken ikinci onay düğmesi YOKTUR: uyarı kapanınca bildirim kendiliğinden kalkar.
  // Metin davranışla tutarlıdır: düşen kod işlenmez ve adet eklenmez; yeni okutma yalnız kullanıcının açık eylemiyle olur.
  return (
    <div role="alert" data-testid="camera-dropped" className="kdrop">
      <Svg d={SICON.warn} size={24} />
      <p>{t("camera.dropped")}</p>
      {alerting ? null : (
        <button type="button" onClick={onClose} className="kdropb">
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
      <p role="status" data-testid="compound-qty" data-state="failed" className="kcomp off">
        {t("flow.compoundFailed")}
      </p>
    );
  }
  return (
    <p data-testid="compound-qty" data-state="ok" className="kcomp">
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
