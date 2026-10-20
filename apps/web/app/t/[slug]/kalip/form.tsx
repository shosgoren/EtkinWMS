"use client";
// T-968 (B-63, I-18): FORM kalıbı parçaları — KalipForm.dc.html BİREBİR: yetkisiz bandı (`.lockb`), iki sütun ızgara (`.sgrid > .scol`),
// ikonlu grup (`.sg > .sgh`), dokununca açılan satır (`.srw > .sr2` + `.sx` düzenleyici: masaüstünde satırın altında, telefonda alt cam
// sayfa + `.sxback` perde), açık/kapalı anahtar satırı (`.sr2 > .act2`), salt okunur satır (`.sr2.lock` + `.pill`), seçenek düğmeleri
// (`.gpick > .gp`), metin alanı (`.fld`), değişiklik rozeti (`.sr2.chg`), kaydedilmemiş iş uyarısı (`.cfback` + `.cfbox`).
// "Yalnız değişince etkin Kaydet" ana işlemi ortak KabukBar'dadır (ekran `main.disabled` verir). Renkler `.dzf` belirteçlerinden.
import { useTranslations } from "next-intl";
import { useEffect, type CSSProperties, type InputHTMLAttributes, type ReactNode } from "react";
import { LICON } from "../../../design/kalip-icons.ts";
import { Ico } from "./ekran.tsx";
import { kdz } from "./tokens.ts";

const c = (hex: string): string => kdz("dzf", hex);

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

/** Kaynak `.sg` ikonlu grup. */
export function KalipGrup({ title, sub, d, color, children, testId }: { title: string; sub?: string; d: string; color: string; children: ReactNode; testId?: string }) {
  return (
    <section className="sg" aria-label={title} data-testid={testId}>
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
      <button type="button" className={cls} style={style} aria-expanded={open} aria-label={`${title}: ${value}`} onClick={onToggle} data-testid={testId} data-changed={changed ? "true" : undefined}>
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

/** Kaynak `.sr2` + `.act2` açık/kapalı anahtar satırı. */
export function KalipAnahtar({ title, sub, d, color, on, changed = false, locked = false, onToggle, aria, testId }: { title: string; sub?: string; d: string; color: string; on: boolean; changed?: boolean; locked?: boolean; onToggle: () => void; aria: string; testId?: string }) {
  const t = useTranslations("kalip");
  return (
    <button type="button" className={`sr2${changed ? " chg" : ""}${locked ? " lock" : ""}`} style={{ "--c": c(color) } as CSSProperties} aria-pressed={on} aria-label={aria} onClick={onToggle} data-testid={testId} data-changed={changed ? "true" : undefined}>
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

/** Kaynak `.gpick > .gp` seçenek düğmeleri (seçili: grubun rengi). */
export function KalipSecenek({ options, value, color, onPick, label }: { options: readonly KalipSecenekItem[]; value: string; color: string; onPick: (id: string) => void; label: string }) {
  return (
    <div className="gpick" role="group" aria-label={label}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button key={o.id} type="button" className={`gp${on ? " on" : ""}`} style={on ? { background: c(color) } : undefined} aria-pressed={on} onClick={() => onPick(o.id)} data-option={o.id}>
            <Ico d={o.d} size={20} />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Kaynak `.fld` (etiketli metin alanı). */
export function KalipAlan({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="fld">
      <span>{label}</span>
      <input {...input} />
    </label>
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

/** Kaynak `.cfback` + `.cfbox` kaydedilmemiş iş uyarısı. Kabın `overlays` yuvasına. */
export function KalipCikisUyarisi({ open, text, saveLabel, onSave, onLeave, onStay }: { open: boolean; text: string; saveLabel?: string; onSave?: () => void; onLeave: () => void; onStay: () => void }) {
  const t = useTranslations("kalip");
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onStay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onStay]);
  if (!open) return null;
  return (
    <>
      <div className="cfback" onClick={onStay} />
      <div className="cfbox" role="alertdialog" aria-modal="true" aria-label={t("unsavedTitle")} data-testid="kalip-unsaved">
        <span className="cfic">
          <Ico d={LICON.warn} size={28} />
        </span>
        <b>{t("unsavedTitle")}</b>
        <p>{text}</p>
        {onSave === undefined ? null : (
          <button type="button" className="cfb save" onClick={onSave} autoFocus>
            <Ico d={LICON.check} size={20} />
            {saveLabel ?? t("saveLeave")}
          </button>
        )}
        <button type="button" className="cfb leave" onClick={onLeave}>
          {t("leave")}
        </button>
        <button type="button" className="cfb stay" onClick={onStay}>
          {t("stay")}
        </button>
      </div>
    </>
  );
}

/** Kaydedilmemiş iş varken sekme kapatma / yenileme uyarısı (tarayıcının kendi kutusu). */
export function useLeaveGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [dirty]);
}
