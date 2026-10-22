"use client";
// T-968 (B-63, I-18): LİSTE kalıbı parçaları — KalipListe.dc.html BİREBİR: arama (`.lsearch`: büyüteç, alan, kamera `.sbtn.cam`, mikrofon
// `.sbtn.mic`), süzgeç çipleri (`.fchips > .fch`), bölüm başlığı (`.shd`, ekran.tsx), kart listesi (`.ulist > .uc`: `.uic`, `.ut`, `.qb`;
// sorunlu kart dolu renk `.crit` / `.low`), "+N daha" (`.more.lmore`), aramaya uyan yok (`.nomatch`), kurulum rehberi (`.setup`: `.suh`,
// `.sbar3`, `.steps3 > .st3`). Renkler `.dzl` kabının üretilmiş belirteçlerinden (kalip-liste-tokens.ts).
// Kart ve adım bağlantı (`<a>`) ya da düğme olabilir; görünüm aynı (kalip-frame.css).
import { useTranslations } from "next-intl";
import type { CSSProperties, FormEvent, InputHTMLAttributes, ReactNode, Ref } from "react";
import { LICON } from "../../../design/kalip-icons.ts";
import { Ico, KalipEkran, MicIco } from "./ekran.tsx";
import { kdz } from "./tokens.ts";

const c = (hex: string): string => kdz("dzl", hex);

export interface KalipAraProps {
  /** Ekran okuyucu etiketi (kaynak `.sr`) ve `role=search` adı. */
  readonly label: string;
  readonly placeholder: string;
  readonly name?: string;
  readonly defaultValue?: string;
  readonly value?: string;
  readonly onChange?: (value: string) => void;
  /** Enter / gönder (barkod okuyucunun sonundaki Enter dahil). */
  readonly onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  /** GET formu hedefi (JS yokken de arama çalışır). */
  readonly action?: string;
  readonly busy?: boolean;
  /** Kamera ile okut (`.sbtn.cam`); verilmezse düğme çizilmez. */
  readonly onCamera?: () => void;
  readonly cameraLabel?: string;
  /** Sesle (`.sbtn.mic`); Etkin (B-62) gelene dek "yakında" balonu. */
  readonly onMic?: () => void;
  readonly micLabel?: string;
  readonly micSoon?: boolean;
  readonly inputRef?: Ref<HTMLInputElement>;
  /** Formun içinde, alanın altında (ör. öneri listesi) — `.lsearch` dışında. */
  readonly below?: ReactNode;
  readonly inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "name" | "placeholder" | "value" | "defaultValue" | "onChange">;
}

/** Kaynak `.lsearch` (form + `role=search`). */
export function KalipAra({ label, placeholder, name = "q", defaultValue, value, onChange, onSubmit, action, busy, onCamera, cameraLabel, onMic, micLabel, micSoon, inputRef, below, inputProps }: KalipAraProps) {
  return (
    <form role="search" aria-label={label} aria-busy={busy} method="get" action={action} onSubmit={onSubmit} style={{ margin: 0, flex: "none" }}>
      <label className="lsearch">
        <Ico d={LICON.search} size={22} className="ico lup" />
        <span className="sr">{label}</span>
        <input
          ref={inputRef}
          type="search"
          name={name}
          placeholder={placeholder}
          autoComplete="off"
          maxLength={128}
          {...(value === undefined ? { defaultValue } : { value })}
          onChange={onChange === undefined ? undefined : (e) => onChange(e.target.value)}
          {...inputProps}
        />
        {onCamera === undefined ? null : (
          <button type="button" className="sbtn cam" aria-label={cameraLabel} onClick={onCamera} data-testid="kalip-camera">
            <Ico d={LICON.cam} size={24} />
          </button>
        )}
        {onMic === undefined ? null : (
          <button type="button" className="sbtn mic" aria-label={micLabel} aria-disabled={micSoon === true ? "true" : undefined} onClick={onMic} data-testid="kalip-mic">
            <MicIco size={22} />
          </button>
        )}
      </label>
      {below}
    </form>
  );
}

export interface KalipCip {
  readonly id: string;
  readonly label: string;
  /** Sayı (`em`); verilmezse çizilmez. */
  readonly n?: number | string;
  readonly d: string;
  /** Kaynak renk (onaltılık). */
  readonly color: string;
  readonly on: boolean;
  readonly href?: string;
  readonly onClick?: () => void;
}

/** Kaynak `.fchips > .fch` (süzgeç; seçili `.on`). Bağlantı ya da düğme. */
export function KalipCipler({ label, chips }: { label: string; chips: readonly KalipCip[] }) {
  return (
    <div className="fchips" role="group" aria-label={label}>
      {chips.map((ch) => {
        const inner = (
          <>
            <i style={{ background: c(ch.color) }}>
              <Ico d={ch.d} size={18} />
            </i>
            {ch.label}
            {ch.n === undefined ? null : <em>{ch.n}</em>}
          </>
        );
        return ch.href !== undefined ? (
          <a key={ch.id} className={`fch${ch.on ? " on" : ""}`} href={ch.href} aria-current={ch.on ? "true" : undefined} onClick={ch.onClick} style={{ textDecoration: "none" }} data-chip={ch.id}>
            {inner}
          </a>
        ) : (
          <button key={ch.id} type="button" className={`fch${ch.on ? " on" : ""}`} aria-pressed={ch.on} onClick={ch.onClick} data-chip={ch.id}>
            {inner}
          </button>
        );
      })}
    </div>
  );
}

export interface KalipKartProps {
  readonly name: string;
  /** Kod satırı (`small.mono`). */
  readonly code: string;
  /** Ek satır (`.um`, telefonda gizli). */
  readonly meta?: string;
  readonly d: string;
  readonly color: string;
  /** Sağdaki rozet (`.qb`): büyük değer + küçük alt yazı. Verilmezse çizilmez. */
  readonly badge?: { readonly value: string; readonly sub: string };
  /** Trafik ışığı: yalnız sorunlu kart dolu renk. */
  readonly tone?: "ok" | "crit" | "low";
  readonly href?: string;
  readonly onClick?: () => void;
  readonly aria: string;
  /** Eylemi ayrı düğmede olan kartın bilgi alanı; boş bir düğme oluşturmaz. */
  readonly passive?: boolean;
  readonly index?: number;
  readonly testId?: string;
  /** Erişilebilir rol (varsayılan listitem; canlı öneri listesinde option; `null` = rol yok — kart eylem satırıyla birlikte `listitem` sarmalayıcı içindeyse). */
  readonly role?: "listitem" | "option" | null;
  readonly children?: ReactNode;
}

/** Kaynak `.uc` kart (listitem). */
export function KalipKart({ name, code, meta, d, color, badge, tone = "ok", href, onClick, aria, passive = false, index = 0, testId, role = "listitem", children }: KalipKartProps) {
  const cls = `uc${tone === "ok" ? "" : ` ${tone}`}`;
  const style: CSSProperties = { animationDelay: `${index * 30}ms` };
  const inner = (
    <>
      <span className="uic" style={{ background: c(color) }}>
        <Ico d={d} size={26} />
      </span>
      <span className="ut">
        <b>{name}</b>
        <small className="mono">{code}</small>
        {meta === undefined ? null : <small className="um">{meta}</small>}
        {children}
      </span>
      {badge === undefined ? null : (
        <span className="qb">
          <b>{badge.value}</b>
          <small>{badge.sub}</small>
        </span>
      )}
    </>
  );
  return passive ? (
    <div className={cls} style={style} role={role ?? undefined} aria-label={aria} data-testid={testId}>
      {inner}
    </div>
  ) : href !== undefined ? (
    <a className={cls} style={style} role={role ?? undefined} aria-label={aria} href={href} onClick={onClick} data-testid={testId}>
      {inner}
    </a>
  ) : (
    <button type="button" className={cls} style={style} role={role ?? undefined} aria-label={aria} onClick={onClick} data-testid={testId}>
      {inner}
    </button>
  );
}

/** Kaynak `.ulist` (role=list; canlı öneri listesinde listbox). */
export function KalipKartListe({ label, children, role = "list", id }: { label: string; children: ReactNode; role?: "list" | "listbox"; id?: string }) {
  return (
    <div className="ulist" role={role} aria-label={label} id={id}>
      {children}
    </div>
  );
}

/** Kaynak `.more` satırı (ör. "+N daha · ara ya da söyle", "Excel'den toplu aktar"). */
export function KalipDaha({ children, href, onClick, iconD, iconColor, mic, className = "more", testId }: { children: ReactNode; href?: string; onClick?: () => void; iconD?: string; iconColor?: string; mic?: boolean; className?: string; testId?: string }) {
  const icon = (
    <i style={iconColor === undefined ? undefined : { color: c(iconColor) }}>
      {mic === true ? <MicIco size={18} /> : iconD === undefined ? null : <Ico d={iconD} size={20} />}
    </i>
  );
  return href !== undefined ? (
    <a className={className} href={href} onClick={onClick} data-testid={testId}>
      {icon}
      {children}
    </a>
  ) : (
    <button type="button" className={className} onClick={onClick} data-testid={testId}>
      {icon}
      {children}
    </button>
  );
}

/**
 * Kaynak `.nomatch` (aramaya uyan yok / boş liste): ikon, tek cümle, ipucu ve SIRADAKİ ADIM düğmesi (T-436, ALTIN-KURAL 8).
 * `action.kind`: `clear` (aramayı temizle, ✕ — varsayılan), `add` (yeni kayıt, +), `go` (başka ekrana, →).
 * Arama sonucu yoksa başlık ortak cümledir: "Bulunamadı · ara ya da söyle" (`kural.notFoundSearch`).
 */
export function KalipBos({ title, hint, action, testId, iconD = LICON.search }: { title: string; hint?: string; action?: { readonly label: string; readonly href?: string; readonly onClick?: () => void; readonly kind?: "clear" | "add" | "go" }; testId?: string; iconD?: string }) {
  const aIco = action?.kind === "add" ? LICON.plus : action?.kind === "go" ? LICON.arrow : LICON.close;
  return (
    <div className="nomatch" data-testid={testId ?? "kalip-empty"}>
      <span className="nic">
        <Ico d={iconD} size={30} />
      </span>
      <b>{title}</b>
      {hint === undefined ? null : <small>{hint}</small>}
      {action === undefined ? null : action.href !== undefined ? (
        <a className="btn n" href={action.href} onClick={action.onClick} data-testid="kalip-empty-action">
          <Ico d={aIco} size={18} />
          {action.label}
        </a>
      ) : (
        <button type="button" className="btn n" onClick={action.onClick} data-testid="kalip-empty-action">
          <Ico d={aIco} size={18} />
          {action.label}
        </button>
      )}
    </div>
  );
}

export interface KalipAdim {
  readonly key: string;
  readonly title: string;
  readonly sub: string;
  readonly d: string;
  readonly color: string;
  readonly state: "done" | "now" | "locked";
  /** Şimdiki adımın düğme metni (`.btn.y`). */
  readonly cta?: string;
  readonly href?: string;
  readonly onClick?: () => void;
}

/** Kaynak `.setup` kurulum rehberi (3 adım; şimdiki adım dolu renk + sarı halka, sıradakiler kesik çerçeve + "SIRADA"). */
export function KalipKurulum({ title, sub, steps, testId }: { title: string; sub: string; steps: readonly KalipAdim[]; testId?: string }) {
  const t = useTranslations("kalip");
  return (
    <section className="setup" aria-label={title} data-testid={testId ?? "setup-steps"}>
      <div className="suh">
        <span className="gi">
          <Ico d={LICON.clip} size={24} />
        </span>
        <span style={{ minWidth: 0 }}>
          <b>{title}</b>
          <small>{sub}</small>
        </span>
      </div>
      <div className="sbar3" aria-hidden="true">
        {steps.map((s) => (
          <i key={s.key} className={s.state === "locked" ? undefined : "on"} />
        ))}
      </div>
      <ol className="steps3" style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {steps.map((s, i) => {
          const now = s.state === "now";
          const aria = t("stepAria", { n: i + 1, total: steps.length, title: s.title }) + (s.state === "locked" ? t("stepLocked") : s.state === "done" ? t("stepDone") : "");
          const inner = (
            <>
              <span className="sic">
                <Ico d={s.state === "done" ? LICON.check : s.d} size={40} />
              </span>
              <span className="stx">
                <b>{s.title}</b>
                <small>{s.sub}</small>
                {s.state === "locked" ? (
                  <span className="lk">
                    <Ico d={LICON.lock} size={12} />
                    {t("queued")}
                  </span>
                ) : null}
              </span>
              <span className="sno">{i + 1}</span>
              {now && s.cta !== undefined ? (
                <span className="btn y">
                  <Ico d={LICON.plus} size={18} />
                  {s.cta}
                </span>
              ) : null}
            </>
          );
          const cls = `st3${now ? " now" : ""}`;
          const style = { "--c": c(s.color) } as CSSProperties;
          return (
            <li key={s.key} style={{ display: "contents" }} data-done={s.state === "done"}>
              {s.href !== undefined && s.state !== "locked" ? (
                <a className={cls} style={style} aria-label={aria} href={s.href} onClick={s.onClick} data-step={s.key}>
                  {inner}
                </a>
              ) : (
                <button type="button" className={cls} style={style} aria-label={aria} onClick={s.onClick} aria-disabled={s.state === "locked" ? "true" : undefined} data-step={s.key}>
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Yetkisiz (okuma izni yok) tam ekran: liste kalıbının boş durum kutusu kilit ikonuyla; Geri / Ana ekran ortak çubukta. */
export function KalipKilitliEkran({ title, icon, text, hint, dark, home }: { title: string; icon: { readonly d: string; readonly color: string }; text: string; hint: string; dark: boolean; home: string }) {
  return (
    <KalipEkran kind="liste" dark={dark} title={title} icon={icon} bar={{ back: { href: home }, main: { label: "", d: LICON.lock, disabled: true } }} testId="kalip-locked-screen">
      <KalipBos title={text} hint={hint} iconD={LICON.lock} testId="kalip-locked" />
    </KalipEkran>
  );
}

/** T-973: yükleme hatası tam ekranı — liste kalıbının boş durum kutusu uyarı ikonuyla (`role=alert`); Geri / Ana ekran ortak çubukta. */
export function KalipHataEkran({ title, icon, text, hint, dark, back }: { title: string; icon: { readonly d: string; readonly color: string }; text: string; hint?: string; dark: boolean; back: string }) {
  return (
    <KalipEkran kind="liste" dark={dark} title={title} icon={icon} bar={{ back: { href: back }, main: { label: "", d: LICON.warn, disabled: true } }} testId="kalip-error-screen">
      <div role="alert">
        <KalipBos title={text} {...(hint === undefined ? {} : { hint })} iconD={LICON.warn} testId="kalip-error" />
      </div>
    </KalipEkran>
  );
}
