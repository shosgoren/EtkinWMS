"use client";
// T-968 (B-63, I-18): 4 ekran kalıbının ORTAK kabı — KalipListe / KalipForm / KalipDetay kaynaklarındaki `.wrap > .app` +
// üst çubuk (`.top > .brand`: hareketli logo noktası + çevrimiçi `.net`, renkli ekran ikonu `.pgic`, ad + "FİRMA · ROL"; sağ üst `.tph`
// yuvası) + içerik (`.inner`) + bildirim balonu (`.toast`). Alt cam çubuk kaynak kabın dışında ortak `KabukBar`'dır (`bar`).
// CSS: `design/kalip-{liste,form,detay}.css` (üretilmiş) + `design/kalip-frame.css` (tam ekran, eski kabuk süslemeleri gizli).
// Kök `.kalip` sınıfı taşır: kiracı kabuğunun eski üst çubuğu / Kolay mod / Geri-Ana ekran kutusu / eski alt gezinme bu ekranda çizilmez
// (kalip-frame.css genel kuralı) — yeni ekran yalnız bu kabı kullanarak geçer.
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LICON } from "../../../design/kalip-icons.ts";
import { KabukBar, useKabuk, type KabukBarProps } from "../kabuk/kabuk-bar.tsx";
import { kdz, type KalipScope } from "./tokens.ts";

export type KalipKind = "liste" | "form" | "detay";
const SCOPE: Record<KalipKind, KalipScope> = { liste: "dzl", form: "dzf", detay: "dzd" };

/** Kaynak tone(): dokunuş / onay / hata sesi + titreşim (görsel + sesli geri bildirim, ALTIN KURAL 3). */
export function tone(kind: "tap" | "ok" | "err"): void {
  try {
    const A = window.AudioContext;
    if (A === undefined) return;
    const ac = new A();
    const t0 = ac.currentTime;
    const seq = kind === "ok" ? [660, 990] : kind === "err" ? [330, 220] : [560];
    seq.forEach((f, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      const t = t0 + i * 0.13;
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g);
      g.connect(ac.destination);
      o.start(t);
      o.stop(t + 0.13);
    });
    window.setTimeout(() => void ac.close(), 600);
    if (typeof navigator.vibrate === "function") navigator.vibrate(kind === "err" ? [60, 40, 60] : 30);
  } catch {
    /* ses yoksa sessiz */
  }
}

/** Kaynak `.ico` SVG (tek ya da çok yol). */
export function Ico({ d, size, className = "ico" }: { d: string | readonly string[]; size: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {(typeof d === "string" ? [d] : d).map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

/** Kaynak mikrofon ikonu (`rect` + yol). */
export function MicIco({ size }: { size: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d={LICON.micB} />
    </svg>
  );
}

export type ToastKind = "ok" | "err" | "info" | "warn";
// Kaynak TK: renk + ikon.
const TK: Record<ToastKind, readonly [string, string]> = { ok: ["2F7D5B", LICON.check], err: ["C62828", LICON.close], info: ["2F5DA8", LICON.info], warn: ["E56A00", LICON.warn] };

export interface KalipToast {
  readonly say: (kind: ToastKind, text: string) => void;
  readonly node: ReactNode;
}

/** Kaynak `toast()`: 2,6 sn görünen balon (`.toast`, `role=status`). Kabın `toast` yuvasına `node` verilir. */
export function useKalipToast(scope: KalipKind): KalipToast {
  const [toast, setToast] = useState<{ kind: ToastKind; text: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const say = useCallback((kind: ToastKind, text: string) => {
    window.clearTimeout(timer.current);
    setToast({ kind, text });
    timer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const tk = TK[toast?.kind ?? "info"];
  const node =
    toast === null ? null : (
      <div className="toast" role="status" aria-live="polite" data-testid="kalip-toast">
        <i style={{ background: kdz(SCOPE[scope], tk[0]) }}>
          <Ico d={tk[1]} size={18} />
        </i>
        {toast.text}
      </div>
    );
  return { say, node };
}

export interface KalipEkranProps {
  readonly kind: KalipKind;
  readonly dark: boolean;
  /** Ekran adı (üst çubuk `b`). */
  readonly title: string;
  /** Ekran ikonu yolu ve kaynak rengi (`.pgic`, onaltılık, `#` yok). */
  readonly icon: { readonly d: string; readonly color: string };
  /** Alt satır; verilmezse "FİRMA · ROL" (kiracı düzeninin bağlamından). */
  readonly subtitle?: string;
  /** Sağ üst `.tph` yuvası (Sorun / Destek B-84/B-85). Verilmezse Yardım bağlantısı. `null` = boş. */
  readonly actions?: ReactNode | null;
  /** Alt cam çubuk (ortak KabukBar): ekranın ana işlemi, Geri, Ana ekran. `dark` kabdan gelir. */
  readonly bar: Omit<KabukBarProps, "dark" | "home">;
  /** Kabın içinde, `.inner` dışında çizilen katmanlar (kaynak `.sxback`, `.cfback/.cfbox`, `.toast`). */
  readonly overlays?: ReactNode;
  readonly testId?: string;
  /** Üst çubuktaki ad sayfanın birinci düzey başlığı mı (varsayılan evet). Detayda başlık kaydın adıdır (`.hero`). */
  readonly heading?: boolean;
  readonly children: ReactNode;
}

function useOnline(): boolean {
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
  return online;
}

export function KalipEkran({ kind, dark, title, icon, subtitle, actions, bar, overlays, testId, heading = true, children }: KalipEkranProps) {
  const t = useTranslations("kalip");
  const ctx = useKabuk();
  const online = useOnline();
  const scope = SCOPE[kind];
  const c = (hex: string): string => kdz(scope, hex);
  const sub =
    subtitle ??
    [ctx?.tenantName, ctx?.roleLabel]
      .filter((x): x is string => x !== undefined && x !== "")
      .join(" · ")
      .toLocaleUpperCase("tr");
  const slot =
    actions === undefined ? (
      <a className="helpb sup" href="/help" aria-label={t("help")} title={t("help")} data-testid="kalip-help">
        <Ico d={LICON.info} size={22} />
      </a>
    ) : (
      actions
    );
  return (
    <>
      <div className={`${scope} kalip${dark ? " dz-dark" : ""}`} data-testid={testId ?? "kalip"} data-kalip={kind}>
        <div className="wrap">
          <div className="app">
            <header className="top">
              <div className="brand">
                <span className="logo">
                  {online ? (
                    <span className="net" aria-label={t("online")} title={t("online")}>
                      <i />
                    </span>
                  ) : null}
                  <svg width="26" height="26" viewBox="0 0 120 120" aria-hidden="true">
                    <path d={LICON.logo} fill="none" stroke={c("FFFFFF")} strokeWidth="13" strokeLinecap="round" />
                    <circle r="12" fill={c("F2C53D")} stroke={c("172E42")} strokeWidth="4">
                      <animateMotion dur="3.2s" repeatCount="indefinite" path={LICON.logo} />
                    </circle>
                  </svg>
                </span>
                <span className="pgic" style={{ background: c(icon.color) }}>
                  <Ico d={icon.d} size={22} />
                </span>
                <span style={{ minWidth: 0 }}>
                  {/* Kaynakta `b`; erişilebilir ad için ekranın tek birinci düzey başlığı. */}
                  {heading ? (
                    <b role="heading" aria-level={1}>
                      {title}
                    </b>
                  ) : (
                    <b>{title}</b>
                  )}
                  {sub === "" ? null : <small>{sub}</small>}
                </span>
              </div>
              {slot === null ? null : (
                <div className="tph" role="group" aria-label={t("topActions")}>
                  {slot}
                </div>
              )}
            </header>
            <main className="inner" id="kalip-main">
              {children}
            </main>
            {overlays}
          </div>
        </div>
      </div>
      <KabukBar dark={dark} {...bar} />
    </>
  );
}

/** Kaynak `.shd`: bölüm başlığı (sol kalın büyük harf, sağ ince ipucu). */
export function KalipBaslik({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="shd">
      <b>{title}</b>
      {hint === undefined ? null : <span>{hint}</span>}
    </div>
  );
}
