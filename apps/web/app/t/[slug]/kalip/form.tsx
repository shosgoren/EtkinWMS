"use client";
// T-968 (B-63, I-18): FORM kalıbı parçaları — KalipForm.dc.html BİREBİR: yetkisiz bandı (`.lockb`), iki sütun ızgara (`.sgrid > .scol`),
// ikonlu grup (`.sg > .sgh`), dokununca açılan satır (`.srw > .sr2` + `.sx` düzenleyici: masaüstünde satırın altında, telefonda alt cam
// sayfa + `.sxback` perde), açık/kapalı anahtar satırı (`.sr2 > .act2`), salt okunur satır (`.sr2.lock` + `.pill`), seçenek düğmeleri
// (`.gpick > .gp`), metin alanı (`.fld`), değişiklik rozeti (`.sr2.chg`). Kaydedilmemiş iş uyarısı tek ortak bileşen `cikis.tsx` (T-990).
// "Yalnız değişince etkin Kaydet" ana işlemi ortak KabukBar'dadır (ekran `main.disabled` verir). Renkler `.dzf` belirteçlerinden.
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Children, isValidElement, useEffect, useId, type CSSProperties, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { LICON } from "../../../design/kalip-icons.ts";
import { Ico } from "./ekran.tsx";
import { useAlanHata, useSalla, useZorunlu } from "./form-baglam.tsx";
import { kdzOrtak } from "./tokens.ts";
import { kilitliDokunus } from "./kilitli.tsx";

// T-990: form kabının kaynağında olmayan ama başka kalıp kaynağında geçen renk (ör. Hammadde kahvesi) de kullanılabilir.
const c = (hex: string): string => kdzOrtak(hex);

/** Kaynak `.lockb`: değiştirme yetkisi yok (görebilir). */
export function KalipKilit({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="lockb" role="status" data-testid="kalip-locked">
      <i>
        <Ico d={LICON.lock} size={20} />
      </i>
      <span>
        <b>{title}</b>
        <small>{sub}</small>
      </span>
    </div>
  );
}

/** Kaynak `.sgrid` (masaüstü 2 sütun, telefon 1). */
export function KalipIzgara({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="sgrid">
      <div className="scol">{left}</div>
      <div className="scol">{right}</div>
    </div>
  );
}

/**
 * T-1117 (STANDART §4, kaynak `StandartYeniCari.dc.html`): grup içinde yan yana iki alan (ör. Vergi no · Vergi dairesi). Her alan kendi
 * kutusunda: alanın hata satırı altında kalır. Dar ekranda da iki sütun (kaynak gibi); tek çocukta tam genişlik.
 */
export function KalipAlanSira({ children }: { children: ReactNode }) {
  return (
    <div className="kfsira">
      {Children.toArray(children).map((ch, i) => (
        <div key={isValidElement(ch) && ch.key !== null ? ch.key : i} className="kfsirah">
          {ch}
        </div>
      ))}
    </div>
  );
}

/** Kaynak `.sg` ikonlu grup. */
export function KalipGrup({ title, sub, d, color, children, testId }: { title: string; sub?: string; d: string; color: string; children: ReactNode; testId?: string }) {
  return (
    // T-1052: `--gc` grubun rengi (masaüstünde başlık bölgesi bu tonda).
    <section className="sg" aria-label={title} data-testid={testId} style={{ "--gc": c(color) } as CSSProperties}>
      <div className="sgh">
        <i style={{ background: c(color) }}>
          <Ico d={d} size={24} />
        </i>
        <span>
          <b>{title}</b>
          {sub === undefined ? null : <small>{sub}</small>}
        </span>
      </div>
      {children}
    </section>
  );
}

export interface KalipSatirProps {
  readonly id: string;
  readonly title: string;
  /** Sağdaki değer (`.rv`). */
  readonly value: string;
  readonly d: string;
  readonly color: string;
  readonly open: boolean;
  readonly changed?: boolean;
  readonly locked?: boolean;
  readonly onToggle: () => void;
  readonly onClose: () => void;
  /** Düzenleyici başlığı (telefonda alt sayfa başlığı). */
  readonly editorTitle?: string;
  /** Düzenleyici içeriği (`.sx`). */
  readonly children?: ReactNode;
  readonly testId?: string;
}

/** Kaynak `.srw`: dokununca açılan satır + düzenleyici. */
export function KalipSatir({ id, title, value, d, color, open, changed = false, locked = false, onToggle, onClose, editorTitle, children, testId }: KalipSatirProps) {
  const t = useTranslations("kalip");
  const style = { "--c": c(color) } as CSSProperties;
  const cls = `sr2${open ? " open" : ""}${changed ? " chg" : ""}${locked ? " lock" : ""}`;
  const head = editorTitle ?? title;
  return (
    <div className="srw" data-row={id}>
      <button type="button" className={cls} style={style} aria-expanded={open} aria-label={`${title}: ${value}`} aria-disabled={locked ? "true" : undefined} data-kilitli={locked ? "true" : undefined} onClick={locked ? () => kilitliDokunus() : onToggle} data-testid={testId} data-changed={changed ? "true" : undefined}>
        <span className="ri">
          <Ico d={d} size={20} />
        </span>
        <span className="rt">
          <b>{title}</b>
        </span>
        <span className="rv">{value}</span>
        <Ico d={LICON.chev} size={20} className="ico chev" />
      </button>
      {open && children !== undefined ? (
        <div className="sx" role="dialog" aria-label={head} data-testid={testId === undefined ? undefined : `${testId}-editor`}>
          <div className="sxh">
            <span className="ri" style={{ ...style, background: c("EEF1F4") }}>
              <Ico d={d} size={20} />
            </span>
            <b>{head}</b>
            <button type="button" className="x2" aria-label={t("close")} onClick={onClose}>
              <Ico d={LICON.close} size={20} />
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** T-1046 (STANDART §5): başka ekrana götüren ayar satırı (simge + ad + kısa değer + ok); satır görünümü `KalipSatir` ile aynı. */
export function KalipBaglanti({ title, value, d, color, href, testId }: { title: string; value: string; d: string; color: string; href: string; testId?: string }) {
  return (
    <div className="srw">
      <Link className="sr2" href={href} prefetch={false} style={{ "--c": c(color), textDecoration: "none" } as CSSProperties} aria-label={`${title}: ${value}`} data-testid={testId}>
        <span className="ri">
          <Ico d={d} size={20} />
        </span>
        <span className="rt">
          <b>{title}</b>
        </span>
        <span className="rv">{value}</span>
        <Ico d={LICON.chev} size={20} className="ico chev" />
      </Link>
    </div>
  );
}

/** Kaynak `.sr2` + `.act2` açık/kapalı anahtar satırı. */
export function KalipAnahtar({ title, sub, d, color, on, changed = false, locked = false, lockedReason, onToggle, aria, testId }: { title: string; sub?: string; d: string; color: string; on: boolean; changed?: boolean; locked?: boolean; /** Kilitliyken balondaki özel gerekçe (yoksa ortak "yetkin yok" cümlesi). */ lockedReason?: string | undefined; onToggle: () => void; aria: string; testId?: string }) {
  const t = useTranslations("kalip");
  return (
    <button type="button" className={`sr2${changed ? " chg" : ""}${locked ? " lock" : ""}`} style={{ "--c": c(color) } as CSSProperties} aria-pressed={on} aria-label={aria} aria-disabled={locked ? "true" : undefined} data-kilitli={locked ? "true" : undefined} onClick={locked ? () => kilitliDokunus(lockedReason) : onToggle} data-testid={testId} data-changed={changed ? "true" : undefined}>
      <span className="ri">
        <Ico d={d} size={20} />
      </span>
      <span className="rt">
        <b>{title}</b>
        {sub === undefined ? null : <small>{sub}</small>}
      </span>
      <span className={`act2${on ? " on" : ""}`}>
        <span className="tg">
          <i />
        </span>
        <em>{on ? t("on") : t("off")}</em>
      </span>
    </button>
  );
}

/** Kaynak `.sr2.lock` salt okunur satır + durum hapı (`.pill.ok` / `.pill.warn`). */
export function KalipSabit({ title, d, color, pill, aria, testId }: { title: string; d: string; color: string; pill: { readonly label: string; readonly ok: boolean }; aria: string; testId?: string }) {
  return (
    <div className="sr2 lock" style={{ "--c": c(color) } as CSSProperties} aria-label={aria} role="group" data-testid={testId}>
      <span className="ri">
        <Ico d={d} size={20} />
      </span>
      <span className="rt">
        <b>{title}</b>
      </span>
      <span className={`pill ${pill.ok ? "ok" : "warn"}`}>
        <Ico d={pill.ok ? LICON.check : LICON.warn} size={14} />
        {pill.label}
      </span>
      <Ico d={LICON.lock} size={18} className="ico chev" />
    </div>
  );
}

export interface KalipSecenekItem {
  readonly id: string;
  readonly label: string;
  readonly d: string;
}

/** Kaynak `.gpick > .gp` seçenek düğmeleri (seçili: grubun rengi). T-990: rol radiogroup/radio (`KalipSecimGrubu` ile aynı sözleşme). */
export function KalipSecenek({ options, value, color, onPick, label }: { options: readonly KalipSecenekItem[]; value: string; color: string; onPick: (id: string) => void; label: string }) {
  return (
    <div className="gpick" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button key={o.id} type="button" role="radio" className={`gp${on ? " on" : ""}`} style={on ? { background: c(color) } : undefined} aria-checked={on} onClick={() => onPick(o.id)} data-option={o.id}>
            <Ico d={o.d} size={20} />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Kaynak `.fld` (etiketli metin alanı). T-990: ortak form bağlamında (`KalipFormEkran`) `name` ile alan hatası taşır — kırmızı çerçeve,
 * kısa sarsılma, altında tek satır neden (`aria-invalid` + `aria-describedby`); `hint` alanın altında kısa açıklama.
 */
export function KalipAlan({ label, hint, error, multiline = false, ikon, ...input }: { label: string; hint?: string | undefined; error?: string | undefined; multiline?: boolean; /** T-1117 (STANDART §4): etiketin başında küçük renkli simge. */ ikon?: { readonly d: string; readonly color: string } | undefined } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const ctxErr = useAlanHata(typeof input.name === "string" ? input.name : undefined);
  const salla = useSalla();
  const req = useZorunlu(typeof input.name === "string" ? input.name : undefined);
  const err = error ?? ctxErr;
  const shown = req && !label.trimEnd().endsWith("*") ? `${label} *` : label;
  const hid = `${id}-h`;
  const eid = `${id}-e`;
  const desc = [hint === undefined ? null : hid, err === undefined ? null : eid].filter((x) => x !== null).join(" ") || undefined;
  return (
    <>
      <label key={err === undefined ? "ok" : `bad-${salla}`} className={`fld${err === undefined ? "" : " bad"}`} data-alan={input.name}>
        {ikon === undefined ? (
          <span>{shown}</span>
        ) : (
          <span className="kflds">
            <i className="kfldi" style={{ background: c(ikon.color) }}>
              <Ico d={ikon.d} size={12} />
            </i>
            {shown}
          </span>
        )}
        {multiline ? (
          <textarea {...(input as unknown as TextareaHTMLAttributes<HTMLTextAreaElement>)} aria-invalid={err === undefined ? undefined : true} aria-describedby={desc} />
        ) : (
          <input {...input} aria-invalid={err === undefined ? undefined : true} aria-describedby={desc} />
        )}
      </label>
      {hint === undefined ? null : (
        <small id={hid} className="khint">
          {hint}
        </small>
      )}
      {err === undefined ? null : (
        <small id={eid} className="kerr" role="alert" data-testid={typeof input.name === "string" ? `err-${input.name}` : undefined}>
          <Ico d={LICON.warn} size={16} />
          {err}
        </small>
      )}
    </>
  );
}

/** Kaynak `.sxback`: telefonda açık düzenleyicinin perdesi (masaüstünde CSS ile gizli). Kabın `overlays` yuvasına. */
export function KalipPerde({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("kalip");
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return open ? <button type="button" className="sxback" aria-label={t("close")} tabIndex={-1} onClick={onClose} /> : null;
}

/** Kaydedilmemiş iş uyarısı TEK ortak bileşendir (T-990): `cikis.tsx`. Eski içe aktarmalar için yeniden dışa aktarılır. */
export { KalipCikisUyarisi, useCikisKorumasi } from "./cikis.tsx";
