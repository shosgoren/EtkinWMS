"use client";
// T-974 (B-63 grup B, I-18): kalıp PENCERESİ — KalipForm.dc.html düzenleyicisi (`.sx` + `.sxh` başlık, `.sxback` perde) tek başına.
// Telefonda kaynaktaki alt cam sayfa, masaüstünde aynı kutu ortada (uyarlama kalip-frame.css `.kpen`). Yerel `<dialog>` (showModal):
// üst katman (ortak alt çubuğun üstünde), odak tuzağı ve Esc tarayıcıdan; erişilebilir ad başlıktan (`aria-labelledby`), rol `dialog`.
// Düğmeler kaynağın `.cfb` (save / leave / stay) öğeleri; alanlar `.fld`. Eski Sheet / ConfirmDialog / davet penceresi bunu kullanır.
// Sunucu çağrısı sürerken (`busy`) Esc ve perde kapatmaz (ConfirmDialog sözleşmesi aynı).
import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type FormEvent, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { LICON } from "../../../design/kalip-icons.ts";
import { THEME_COOKIE } from "../../../design/theme.ts";
import { Ico } from "./ekran.tsx";
import { kdz } from "./tokens.ts";

const c = (hex: string): string => kdz("dzf", hex);

/** Açık kalıp ekranının teması (kök `.kalip.dz-dark`); kalıp dışı ekranda tema çerezi. */
function useKalipDark(open: boolean): boolean {
  const [dark, setDark] = useState(false);
  useLayoutEffect(() => {
    if (!open) return;
    const root = document.querySelector(".kalip");
    setDark(root === null ? document.cookie.split(";").some((x) => x.trim() === `${THEME_COOKIE}=koyu`) : root.classList.contains("dz-dark"));
  }, [open]);
  return dark;
}

export interface KalipPencereProps {
  readonly open: boolean;
  readonly title: string;
  /** Başlık kimliği (`aria-labelledby`); verilmezse üretilir. */
  readonly titleId?: string;
  readonly describedBy?: string;
  /** Başlık ikonu ve kaynak rengi (onaltılık, `#` yok). */
  readonly icon?: { readonly d: string; readonly color: string };
  readonly onClose: () => void;
  /** Verilirse gövde + düğmeler tek `<form>`dur. */
  readonly onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  /** Alt düğme satırı (`KalipPencereDugme`). */
  readonly footer?: ReactNode;
  /** Sunucu çağrısı sürüyor: Esc ve perde kapatmaz. */
  readonly busy?: boolean;
  readonly testId?: string;
  readonly children: ReactNode;
}

export function KalipPencere({ open, title, titleId, describedBy, icon, onClose, onSubmit, footer, busy = false, testId, children }: KalipPencereProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const autoId = useId();
  const hid = titleId ?? `${autoId}-title`;
  const dark = useKalipDark(open);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  const ic = icon ?? { d: LICON.pencil, color: "2F5DA8" };
  const style = { "--c": c(ic.color) } as CSSProperties;
  const body = (
    <>
      <div className="sxh">
        <span className="ri" style={{ ...style, background: c(ic.color), color: c("FFFFFF") }}>
          <Ico d={ic.d} size={20} />
        </span>
        <h2 id={hid}>{title}</h2>
      </div>
      <div className="kpb">{children}</div>
      {footer === undefined ? null : <div className="kpf">{footer}</div>}
    </>
  );
  // Kapalıyken hiç çizilmez (kalıp CSS'inin `body:has(.dzf)` kuralı başka ekranlara dokunmasın; ConfirmDialog ile aynı).
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      className={`dzf kpen${dark ? " dz-dark" : ""}`}
      aria-labelledby={hid}
      aria-describedby={describedBy}
      data-testid={testId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busyRef.current) onClose();
      }}
      onClose={(e) => {
        const el = e.currentTarget;
        if (el.open) return;
        // Tarayıcı ikinci kapatma isteğinde iptal edilemez kapatır (close watcher): yükleniyorsa yeniden aç, değilse durumu eşitle.
        if (busyRef.current) el.showModal();
        else onClose();
      }}
    >
      <div
        className="sxback"
        aria-hidden="true"
        onClick={() => {
          if (!busyRef.current) onClose();
        }}
      />
      {onSubmit === undefined ? (
        <div className="sx">{body}</div>
      ) : (
        <form className="sx" onSubmit={onSubmit}>
          {body}
        </form>
      )}
    </dialog>
  );
}

/** Kaynak `.cfb`: `ok` = birincil (save), `danger` = yıkıcı (leave), `cancel` = vazgeç (stay). */
export function KalipPencereDugme({ kind = "ok", loading = false, disabled, children, type = "button", ...rest }: { kind?: "ok" | "danger" | "cancel"; loading?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = kind === "ok" ? "save" : kind === "danger" ? "leave" : "stay";
  return (
    <button {...rest} type={type} className={`cfb ${cls}`} disabled={disabled === true || loading} aria-busy={loading || undefined}>
      {loading ? <span className="kpspin" aria-hidden="true" /> : kind === "ok" ? <Ico d={LICON.check} size={20} /> : kind === "danger" ? <Ico d={LICON.warn} size={20} /> : null}
      {children}
    </button>
  );
}

/** Kaynak `.fld` metin alanı + açıklama (alanın dışında: erişilebilir ad yalnız etiket). */
export function KalipPencereAlan({ label, hint, error, ...input }: { label: string; hint?: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const hintId = `${id}-h`;
  const errId = `${id}-e`;
  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errId].filter((x) => x !== null).join(" ") || undefined;
  return (
    <div className="kpq">
      <label className="fld" htmlFor={id}>
        <span>{label}</span>
        <input {...input} id={id} aria-invalid={error === undefined ? undefined : true} aria-describedby={describedBy} />
      </label>
      {hint === undefined ? null : (
        <small id={hintId} className="kph">
          {hint}
        </small>
      )}
      {error === undefined ? null : (
        <small id={errId} className="kph bad" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

/** Kaynak `.fld` seçim kutusu (+ isteğe bağlı açıklama, alanın dışında). */
export function KalipPencereSecim({ label, hint, note, children, ...select }: { label: string; hint?: string; note?: ReactNode; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId();
  const id = select.id ?? auto;
  const hintId = `${id}-h`;
  return (
    <div className="kpq">
      <label className="fld" htmlFor={id}>
        <span>{label}</span>
        <select {...select} id={id} aria-describedby={hint === undefined ? undefined : hintId}>
          {children}
        </select>
      </label>
      {hint === undefined ? null : (
        <small id={hintId} className="kph">
          {hint}
        </small>
      )}
      {note}
    </div>
  );
}

/** Kaynak `.sg` benzeri katlanır bölüm (`<details>`; "Gelişmiş ayarlar"). */
export function KalipPencereBolum({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="kpdet">
      <summary>
        <Ico d={LICON.gear} size={20} />
        {summary}
        <Ico d={LICON.chev} size={20} className="ico chev" />
      </summary>
      <div className="kpb2">{children}</div>
    </details>
  );
}

/** Pencere içi açıklama metni (`.kpt`; `strong` = kalın satır). */
export function KalipPencereMetin({ children, strong = false, testId, live = false, mono = false }: { children: ReactNode; strong?: boolean; testId?: string; live?: boolean; mono?: boolean }) {
  return (
    <p className={`kpt${strong ? " b" : ""}${mono ? " m" : ""}`} data-testid={testId} aria-live={live ? "polite" : undefined}>
      {children}
    </p>
  );
}

export interface KalipOnayProps {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly loading?: boolean;
  /** Yıkıcı değilse birincil düğme; varsayılan tehlikeli (ConfirmDialog ile aynı). */
  readonly variant?: "primary" | "danger";
}

/** Onay penceresi: `@wms/ui` ConfirmDialog ile aynı sözleşme, kalıp penceresinde. */
export function KalipOnay({ open, title, description, confirmLabel, cancelLabel, onConfirm, onCancel, loading = false, variant = "danger" }: KalipOnayProps) {
  const id = useId();
  return (
    <KalipPencere
      open={open}
      title={title}
      describedBy={`${id}-d`}
      icon={variant === "danger" ? { d: LICON.warn, color: "C62828" } : { d: LICON.info, color: "2F5DA8" }}
      onClose={onCancel}
      busy={loading}
      footer={
        <>
          <KalipPencereDugme kind="cancel" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </KalipPencereDugme>
          <KalipPencereDugme kind={variant === "danger" ? "danger" : "ok"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </KalipPencereDugme>
        </>
      }
    >
      <p id={`${id}-d`} className="kpt">
        {description}
      </p>
    </KalipPencere>
  );
}
