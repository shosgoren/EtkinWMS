"use client";
// T-969 (B-63 saha / B-86): Saha kalıbı (KalipSaha.dc.html) ortak çerçevesi — üst çubuk (`.top > .brand`: logo + hareketli nokta, sayfa ikonu,
// başlık + alt yazı), içerik (`.inner`), 3 adımlı ilerleme (`.flow`: OKUT · DOĞRULA · MİKTAR) ve ortak alt cam çubuk (Kabuk). Sınıf adları
// ve ikon yolları kaynaktan (saha-icons.ts); renkler üretilmiş belirteçlerden (kalip-saha-tokens.ts); CSS `design/kalip-saha.css` (üretilmiş) +
// `design/saha-frame.css` (uygulama uyarlaması). Ana işlem kaynaktaki gibi çubuğun ortasındadır (OKUT / DEVAM / ONAYLA); liste ve mesaj
// ekranlarında bağlantı düğmesi (`footer`) çubuğun hemen üstünde sabit durur.
// Bilinçli farklar (T-969 kartı): sağ üstteki Sorun/Destek yer tutucuları çizilmez (B-85 ayrı iş; sahte düğme yok, G-07).
import { createContext, useContext, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { dz } from "../../../design/kalip-saha-tokens.ts";
import { SICON } from "../../../design/saha-icons.ts";
import { KabukBar, type KabukMain, type KabukNav } from "../kabuk/kabuk-bar.tsx";
import { KalipIslemRehberiAc } from "../kalip/rehber.tsx";
import { LICON } from "../../../design/kalip-icons.ts";
import { errorKeyOf, type ErrorContext, type ErrorInfo } from "../receipts/receipt-form.tsx";
import { feedback } from "@wms/ui";

const DarkCtx = createContext(false);
/** Tasarım teması (çerez `dz-theme`; field/layout.tsx sunucuda okur). */
export function SahaTheme({ dark, children }: { dark: boolean; children: ReactNode }) {
  return <DarkCtx.Provider value={dark}>{children}</DarkCtx.Provider>;
}
export const useSahaDark = (): boolean => useContext(DarkCtx);

export function Ico({ d, size, className = "ico" }: { d: string | readonly string[]; size: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {(typeof d === "string" ? [d] : d).map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}
/** Mikrofon (kaynak: `rect` + yol). */
export function MicIco({ size }: { size: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d={SICON.micB} />
    </svg>
  );
}

/** Sayfa ikonu rengi (kaynak `.pgic` / `.uic`): kabul yeşil, yerleştirme camgöbeği, ürün kahve. */
export type SahaHue = "green" | "teal" | "orange" | "purple" | "blue";
// T-977: toplama turuncu (Görevlerim PICK), sayım mor (COUNT), sevk mavi — Görevler türü renkleriyle aynı aile.
export const HUE: Record<SahaHue, string> = { green: "2F7D5B", teal: "0E7C7B", orange: "B85A14", purple: "6C4BD8", blue: "2F5DA8" };

/** Kaynaktaki 3 adım (`.flow > .fl`): 1 OKUT · 2 DOĞRULA · 3 MİKTAR; `now` 4 = hepsi tamam. */
export function SahaSteps({ now, label }: { now: 1 | 2 | 3 | 4; label: string }) {
  const t = useTranslations("saha");
  const names = [t("stepScan"), t("stepVerify"), t("stepQty")];
  return (
    <div className="flow" aria-label={label} data-testid="saha-steps" data-now={now}>
      {names.map((n, i) => (
        <span key={n} className={`fl${i + 1 < now ? " done" : i + 1 === now ? " now" : ""}`}>
          <i />
          {n}
        </span>
      ))}
    </div>
  );
}

export interface SahaFrameProps {
  readonly hue: SahaHue;
  /** Sayfa ikonu yolu (kaynak `.pgic`). */
  readonly iconD: string | readonly string[];
  readonly title: string;
  readonly sub?: string;
  readonly back?: KabukNav;
  readonly main?: KabukMain | null;
  /** Ana ekran yuvası (varsayılan: kiracı kökü). */
  readonly homeNav?: KabukNav;
  readonly testId?: string;
  readonly children: ReactNode;
  /** `.app` içinde, içeriğin üstünde (başarı perdesi `.veil`, bildirim). */
  readonly overlay?: ReactNode;
}

/** Kaynak `.wrap > .app > header.top` + ortak alt cam çubuk. İçerik (`main.inner`) çağırandadır. */
export function SahaFrame({ hue, iconD, title, sub, back, main, homeNav, testId, children, overlay }: SahaFrameProps) {
  const dark = useSahaDark();
  const t = useTranslations("saha");
  return (
    <>
      <div className={`dzs${dark ? " dz-dark" : ""}`} data-testid={testId ?? "saha"}>
        <div className="wrap">
          <div className="app">
            <header className="top">
              <div className="brand">
                <span className="logo">
                  <span className="net" aria-label={t("online")}>
                    <i />
                  </span>
                  <svg width="26" height="26" viewBox="0 0 120 120" aria-hidden="true">
                    <path d={SICON.logo} fill="none" stroke={dz("FFFFFF")} strokeWidth="13" strokeLinecap="round" />
                    <circle r="12" fill={dz("F2C53D")} stroke={dz("172E42")} strokeWidth="4">
                      <animateMotion dur="3.2s" repeatCount="indefinite" path={SICON.logo} />
                    </circle>
                  </svg>
                </span>
                <span className="pgic" style={{ background: dz(HUE[hue]) }}>
                  <Ico d={iconD} size={22} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <h1 className="sh1">
                    <b>{title}</b>
                  </h1>
                  {sub === undefined || sub === "" ? null : <small>{sub}</small>}
                </span>
              </div>
            <KalipIslemRehberiAc />
            </header>
            {children}
            {overlay}
          </div>
        </div>
      </div>
      <KabukBar dark={dark} {...(back === undefined ? {} : { back })} {...(main === undefined ? {} : { main })} {...(homeNav === undefined ? {} : { homeNav })} />
    </>
  );
}

export interface SahaShellProps {
  readonly hue: SahaHue;
  readonly iconD: string | readonly string[];
  /** Eski adım numarası (`data-step`, "Adım n / N" ekran okuyucu etiketi); hata/kilit/boş durumda verilmez. */
  readonly step?: number;
  readonly total?: number;
  /** Kaynaktaki 3 adımdan hangisi (verilmezse çubuk çizilmez). */
  readonly phase?: 1 | 2 | 3 | 4;
  readonly title: string;
  readonly instruction?: string;
  readonly backHref?: string;
  readonly onBack?: () => void;
  /** Liste/mesaj ekranlarının bağlantı düğmesi (çubuğun hemen üstünde sabit). */
  readonly footer?: ReactNode;
  /** Ana işlemin hemen üstünde görünen seçim (ör. kabul rafı); içerikte, ana işlemin üstünde. */
  readonly footerExtra?: ReactNode;
  /** Tarama adımı: ScanField yalnızca "Elle gir" ile açılır. */
  readonly scanProxy?: boolean;
  /** Çubuğun ortasındaki ana işlem (OKUT / ONAYLA). Verilmezse OKUT ekranına bağlantı. */
  readonly main?: KabukMain | null;
  /** Geri / Ana ekran yuvalarının test kimlikleri (eski ekran gezinmesinin `screen-back` / `screen-home` sözleşmesini taşıyan ekranlar; T-973). */
  readonly navTestIds?: { readonly back: string; readonly home: string; readonly homeHref: string };
  readonly overlay?: ReactNode;
  readonly children: ReactNode;
}

/**
 * Saha adım çerçevesi (eski FlowShell sözleşmesi + kaynak görünümü): `data-testid="flow-step"`, `data-step`.
 * T-1122: Tailwind işaret sınıfları yerine `sproxy` (tarama adımında ScanField yalnız "Elle gir" ile) ve `.group:has(manual) .sfoot`
 * (elle girişte bağlantı düğmesi gizli) — görünüm `design/standart.css`.
 */
export function SahaShell({ hue, iconD, step, total, phase, title, instruction, backHref, onBack, footer, footerExtra, scanProxy, main, navTestIds, overlay, children }: SahaShellProps) {
  const t = useTranslations("receiving");
  const stepLabel = step === undefined || total === undefined ? null : t("stepOf", { n: step, total });
  const bt = navTestIds === undefined ? {} : { testId: navTestIds.back };
  const back: KabukNav | undefined = backHref !== undefined ? { href: backHref, aria: t("back"), ...bt } : onBack !== undefined ? { onClick: onBack, aria: t("back"), ...bt } : undefined;
  const homeNav: KabukNav | undefined = navTestIds === undefined ? undefined : { href: navTestIds.homeHref, testId: navTestIds.home };
  return (
    <SahaFrame hue={hue} iconD={iconD} title={title} {...(instruction === undefined ? {} : { sub: instruction })} {...(back === undefined ? {} : { back })} {...(main === undefined ? {} : { main })} {...(homeNav === undefined ? {} : { homeNav })} overlay={overlay}>
      <main
        className={`inner sflow group${footer === undefined ? "" : " hasfoot"}${scanProxy === true ? " sproxy" : ""}`}
        data-testid="flow-step"
        data-step={step ?? 0}
      >
        {stepLabel === null ? null : (
          <span className="sr" data-testid="step-label">
            {stepLabel}
          </span>
        )}
        {phase === undefined ? null : <SahaSteps now={phase} label={stepLabel ?? title} />}
        {children}
        {footer === undefined ? footerExtra : null}
        {footer === undefined ? null : (
          <div role="group" aria-label={t("primaryBar")} className="sfoot">
            <div className="sfootin">
              {footerExtra}
              {footer}
            </div>
          </div>
        )}
      </main>
    </SahaFrame>
  );
}

/**
 * Kaynak (c) sayı tuşları (`.kp > .k`): 1–9, TÜMÜ, 0, sil. İlk basış dışarıdan gelen değeri (okutma) değiştirir, sonrakiler sona ekler (en çok 6 hane).
 * `all` verilmezse TÜMÜ tuşu çizilmez (kalan bilinmiyor).
 */
export function SahaKeypad({ value, onChange, all, fresh, onUsed }: { value: number; onChange: (n: number) => void; all: number | null; fresh: boolean; onUsed: () => void }) {
  const t = useTranslations("saha");
  const press = (k: string): void => {
    feedback.minor();
    onUsed();
    if (k === "all") {
      if (all !== null) onChange(all);
      return;
    }
    const cur = fresh || value === 0 ? "" : String(value);
    if (k === "del") {
      onChange(Number(cur.slice(0, -1) || "0"));
      return;
    }
    const next = cur + k;
    if (next.length > 6) return;
    onChange(Number(next));
  };
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "all", "0", "del"];
  return (
    <div className="kp" role="group" aria-label={t("keypad")} data-testid="saha-keypad">
      {keys.map((k) =>
        k === "all" && all === null ? (
          <span key={k} />
        ) : (
          <button
            key={k}
            type="button"
            className={`k${k === "all" ? " all" : k === "del" ? " fn" : ""}`}
            aria-label={k === "all" ? t("allAria", { n: all ?? 0 }) : k === "del" ? t("del") : k}
            onClick={() => press(k)}
            data-key={k}
          >
            {k === "del" ? <Ico d={SICON.del} size={28} /> : k === "all" ? t("all") : k}
          </button>
        ),
      )}
    </div>
  );
}

/** Kaynak başarı perdesi (`.veil > .fb.good`): kısa süre görünür, tıklamayı engellemez. */
export function SahaDoneVeil({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="veil" role="status" aria-live="polite" data-testid="saha-done">
      <span className="fb good">
        <span className="pl" />
        <span className="pl b" />
        <span className="core">
          <Ico d={SICON.check} size={44} />
        </span>
      </span>
      <span className="fbt">{title}</span>
      {sub === "" ? null : <span className="fbs">{sub}</span>}
    </div>
  );
}

/** Kaynak (b) doğrulama sonucu (`.vres.ok` / `.vres.bad`). */
export function SahaVerdict({ ok, title, sound }: { ok: boolean; title: string; sound: string }) {
  return (
    <div className={`vres ${ok ? "ok" : "bad"}`} role={ok ? "status" : "alert"} data-testid="saha-verdict" data-ok={ok ? "true" : "false"}>
      <span className="vic">
        <Ico d={ok ? SICON.check : SICON.close} size={34} />
      </span>
      <span>
        <b>{title}</b>
        <span className="snd">
          <Ico d={ok ? SICON.check : SICON.warn} size={12} />
          {sound}
        </span>
      </span>
    </div>
  );
}

/**
 * T-1122: saha mesaj kartı (kaynak `.job` kartı): kilit gerekçesi (`lock`: turuncu kilit), bilgi (`info`: mavi i) ya da boş durum (`empty`:
 * ekran ikonu). Eski düz paragraf / Tailwind kutuların yerine; metin satır kaydırır (kart kısalmaz). Başlık ekranın `h1`'indedir.
 */
export function SahaMesaj({ tone = "info", title, text, iconD, testId, role }: { tone?: "lock" | "info" | "empty"; title?: string; text: string; iconD?: string | readonly string[]; testId?: string; role?: "alert" | "status" }) {
  const color = tone === "lock" ? "E56A00" : tone === "empty" ? "30475A" : "2F5DA8";
  const d = iconD ?? (tone === "lock" ? LICON.lock : SICON.info);
  return (
    <div className="job smsg" data-tone={tone} {...(role === undefined ? {} : { role })} {...(testId === undefined ? {} : { "data-testid": testId })}>
      <span className="uic" style={{ background: dz(color) }}>
        <Ico d={d} size={22} />
      </span>
      <span style={{ minWidth: 0 }}>
        {title === undefined ? null : <b>{title}</b>}
        {title === undefined ? <b className="smsgt">{text}</b> : <small>{text}</small>}
      </span>
    </div>
  );
}

/** T-1122: Ayrıntı açılır satırı (kaynak şevronu `LICON.chev`, aşağı döner); hata kodu ve istek kimliği yalnız burada (ham hata metni yok). */
export function SahaAyrinti({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="sdet">
      <summary>
        {label}
        <Ico d={LICON.chev} size={18} className="ico sdetc" />
      </summary>
      {children}
    </details>
  );
}

/**
 * T-1122: sunucu hatası kartı (kaynak (b) `.vres.bad`: kırmızı dolu kart, uyarı ikonu, sarsılma). Eski `ErrorNotice` (Banner) sözleşmesi:
 * `error-reason` (neden), sonraki eylem cümlesi, Ayrıntı içinde `error-code`. İleti seçimi ortak `errorKeyOf`'tadır (kural yeniden yazılmaz).
 */
export function SahaHata({ error, context, remaining }: { error: ErrorInfo; context: ErrorContext; remaining?: string }) {
  const t = useTranslations("receiving");
  const key = errorKeyOf(error, context);
  return (
    <div className="vres bad shata" role="alert" data-testid="saha-error">
      <span className="vic">
        <Ico d={SICON.warn} size={30} />
      </span>
      <span className="shatx">
        <b data-testid="error-reason">{t(`errors.${key}`, { remaining: remaining ?? "-" })}</b>
        <span className="shataa">{t(`errors.${key}Action`)}</span>
        <SahaAyrinti label={t("detail")}>
          <span className="mono" data-testid="error-code">
            {t("errorCode", { code: error.detail === undefined ? error.code : `${error.code}/${error.detail}` })}
          </span>
          {error.requestId === undefined ? null : <span className="mono">{error.requestId}</span>}
        </SahaAyrinti>
      </span>
    </div>
  );
}
