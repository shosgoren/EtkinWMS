"use client";
// T-990 (B-97, kullanıcı kararı 20 Ekim): YEREL AÇILIR LİSTE (`<select>`) YOK. Seçim iki biçimdedir:
//  - En çok 6 seçenek: büyük, renkli, ikonlu seçim kutuları (KalipForm.dc.html `.gpick > .gp`) — `KalipSecimGrubu`, rol radiogroup/radio,
//    ok tuşlarıyla dolaşılır.
//  - Çok seçenek: alttan açılan aramalı seçim sayfası (`KalipSecimSayfasi`, ortak buzlu perde + cam kutu) — arama kutusu, Okut (kamera; el
//    okuyucusu arama kutusuna yazar) ve mikrofon (Etkin, B-62 gelene dek "yakında"); liste rolü listbox/option. Alanı `KalipSecimListe`.
//  - `KalipSecim` seçenek sayısına göre ikisinden birini seçer (ekran ayrıca karar vermez).
// Alan adı (`name`) ortak doğrulamanın (`KalipFormEkran`) hata/odak bağlantısıdır (`data-alan`). Renkler `.dzf` belirteçlerinden.
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { LICON } from "../../../design/kalip-icons.ts";
import { CameraOverlay } from "../field/receive/receive-flow.tsx";
import { Ico, MicIco } from "./ekran.tsx";
import { useModalFocus } from "./odak.ts";
import { useAlanHata, useZorunlu } from "./form-baglam.tsx";
import { KalipPerdeKatman } from "./perde.tsx";
import { kdzOrtak } from "./tokens.ts";
import { feedback, kucukHarf } from "@wms/ui";

const c = (hex: string): string => kdzOrtak(hex);

export interface KalipSecimSecenek {
  readonly id: string;
  readonly label: string;
  /** Liste satırının ikinci satırı (ör. birim adı, depo kodu). */
  readonly sub?: string;
  /** Kutu ikonu (KalipForm kaynağındaki ikon yolları). */
  readonly d?: string;
  /** Seçiliyken kutunun rengi (onaltılık, `#` yok; `.dzf` kaynağında geçen renk). */
  readonly color?: string;
  /** Okutma eşleşmesi ve arama için ek metin (barkod, eski kod…). */
  readonly keys?: readonly string[];
  readonly disabled?: boolean;
}

/** Kutu biçimi için üst sınır (kullanıcı kararı: en çok 6). */
export const SECIM_KUTU_SINIRI = 6;

function Hata({ name }: { name: string | undefined }) {
  const h = useAlanHata(name);
  return h === undefined ? null : (
    <small className="kerr" role="alert" data-testid={`err-${name}`}>
      <Ico d={LICON.warn} size={16} />
      {h}
    </small>
  );
}

/** ≤6 seçenek: renkli ikonlu kutular (rol radiogroup). */
export function KalipSecimGrubu({
  name,
  label,
  hint,
  value,
  options,
  color,
  onPick,
  disabled = false,
  testId,
}: {
  name?: string;
  label: string;
  hint?: string;
  value: string;
  options: readonly KalipSecimSecenek[];
  /** Seçili kutunun varsayılan rengi (seçeneğin kendi rengi yoksa). */
  color: string;
  onPick: (id: string) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const lid = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const hata = useAlanHata(name);
  const req = useZorunlu(name);
  const cur = Math.max(
    0,
    options.findIndex((o) => o.id === value),
  );
  const move = (e: KeyboardEvent<HTMLButtonElement>, i: number): void => {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    let j = i;
    for (let k = 0; k < options.length; k++) {
      j = (j + delta + options.length) % options.length;
      if (options[j]?.disabled !== true) break;
    }
    const o = options[j];
    if (o === undefined) return;
    refs.current[j]?.focus();
    if (!disabled) {
      feedback.minor();
      onPick(o.id);
    }
  };
  return (
    <div className={`ksecg${hata === undefined ? "" : " bad"}`} data-alan={name} data-testid={testId}>
      <span className="ksecl" id={lid}>
        {req && !label.trimEnd().endsWith("*") ? `${label} *` : label}
      </span>
      <div className="gpick" role="radiogroup" aria-labelledby={lid} aria-invalid={hata === undefined ? undefined : true}>
        {options.map((o, i) => {
          const on = o.id === value;
          const bg = c(o.color ?? color);
          return (
            <button
              key={o.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={i === cur ? 0 : -1}
              className={`gp${on ? " on" : ""}`}
              style={on ? { background: bg } : ({ "--c": bg } as CSSProperties)}
              disabled={disabled || o.disabled === true}
              onClick={() => {
                feedback.minor();
                onPick(o.id);
              }}
              onKeyDown={(e) => move(e, i)}
              data-option={o.id}
            >
              {o.d === undefined ? null : (
                <span className="ksecic" style={on ? undefined : { color: bg }}>
                  <Ico d={o.d} size={20} />
                </span>
              )}
              <span className="ksect">
                <b>{o.label}</b>
                {o.sub === undefined ? null : <small>{o.sub}</small>}
              </span>
            </button>
          );
        })}
      </div>
      {hint === undefined ? null : <small className="khint">{hint}</small>}
      <Hata name={name} />
    </div>
  );
}

/** Aramada kullanıcının dilinde küçük harf + boşluk sadeleştirme (ALTIN-KURAL 16). */
function norm(s: string, locale: string): string {
  return kucukHarf(s, locale).replace(/\s+/g, " ").trim();
}

/** Çok seçenek: alttan açılan aramalı seçim sayfası (rol dialog; liste rolü listbox). */
export function KalipSecimSayfasi({
  open,
  title,
  options,
  value,
  onPick,
  onClose,
  icon,
  scan = true,
  testId,
}: {
  open: boolean;
  title: string;
  options: readonly KalipSecimSecenek[];
  value: string;
  onPick: (id: string) => void;
  onClose: () => void;
  icon?: { readonly d: string; readonly color: string };
  /** Okut düğmesi (kamera). Okutulan kod seçeneğin kimliği, etiketi ya da `keys` değeriyle birebir eşleşirse doğrudan seçilir. */
  scan?: boolean;
  testId?: string;
}) {
  const t = useTranslations("kalip");
  const locale = useLocale(); // T-436 (ALTIN-KURAL 16): kullanıcının dili
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [cam, setCam] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [koyu, setKoyu] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const sheet = useRef<HTMLElement>(null);
  // T-436 (ALTIN-KURAL 11): ortak seçim sayfası — Esc kapatır, odak sayfada kalır, kapanınca açan öğeye döner.
  useModalFocus(open, sheet, { onClose, initial: "none", trap: !cam });
  const lid = useId();
  const list = useMemo(() => {
    const k = norm(q, locale);
    if (k === "") return options;
    return options.filter((o) => norm([o.label, o.sub ?? "", o.id, ...(o.keys ?? [])].join(" "), locale).includes(k));
  }, [q, options]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setNote(null);
    setKoyu(document.querySelector(".dz-dark") !== null);
    const i = options.findIndex((o) => o.id === value);
    setActive(i < 0 ? 0 : i);
    // Telefonda klavye kendiliğinden açılmasın: odak sayfaya; masaüstünde arama kutusuna.
    if (window.matchMedia("(min-width: 700px)").matches) input.current?.focus();
    // Açılışta bir kez.
  }, [open]);

  const pick = (id: string): void => {
    feedback.ok();
    onPick(id);
    onClose();
  };
  const exact = (code: string): KalipSecimSecenek | undefined => {
    const k = norm(code, locale);
    return options.find((o) => o.disabled !== true && [o.id, o.label, ...(o.keys ?? [])].some((x) => norm(x, locale) === k));
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(list.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = exact(q) ?? list[active] ?? (list.length === 1 ? list[0] : undefined);
      if (hit !== undefined && hit.disabled !== true) pick(hit.id);
      else {
        feedback.error();
        setNote(t("secNone"));
      }
    }
  };
  if (!open) return null;
  const ic = icon ?? { d: LICON.search, color: "2F5DA8" };
  const activeId = list[active] === undefined ? undefined : `${lid}-o-${active}`;
  return (
    <div className={`dzf ksecp${koyu ? " dz-dark" : ""}`} data-testid={testId ?? "kalip-secim"}>
      <KalipPerdeKatman onClose={onClose} label={t("close")} />
      <section ref={sheet} className="ksheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sxh">
          <span className="ri" style={{ background: c(ic.color), color: c("FFFFFF") }}>
            <Ico d={ic.d} size={20} />
          </span>
          <b>{title}</b>
          <button type="button" className="x2" aria-label={t("close")} onClick={onClose} data-testid="kalip-secim-close">
            <Ico d={LICON.close} size={20} />
          </button>
        </div>
        <div className="ksrch">
          <Ico d={LICON.search} size={20} />
          <input
            ref={input}
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
              setNote(null);
            }}
            onKeyDown={onKey}
            placeholder={t("secSearch")}
            aria-label={t("secSearchLabel", { title })}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${lid}-list`}
            aria-activedescendant={activeId}
            autoComplete="off"
            enterKeyHint="go"
            data-testid="kalip-secim-search"
          />
          {scan ? (
            <button
              type="button"
              className="ksbtn"
              aria-label={t("secScan")}
              onClick={() => {
                feedback.minor();
                setCam(true);
              }}
              data-testid="kalip-secim-scan"
            >
              <Ico d={LICON.cam} size={20} />
            </button>
          ) : null}
          <button
            type="button"
            className="ksbtn"
            aria-label={t("secMic")}
            aria-disabled="true"
            onClick={() => {
              feedback.minor();
              setNote(t("voiceSoon"));
            }}
            data-testid="kalip-secim-mic"
          >
            <MicIco size={20} />
          </button>
        </div>
        {note === null ? null : (
          <p className="ksnote" role="status">
            {note}
          </p>
        )}
        <ul className="kslist" role="listbox" id={`${lid}-list`} aria-label={title}>
          {list.map((o, i) => {
            const on = o.id === value;
            return (
              <li
                key={o.id}
                id={`${lid}-o-${i}`}
                role="option"
                aria-selected={on}
                aria-disabled={o.disabled === true ? true : undefined}
                className={`ksopt${i === active ? " act" : ""}${on ? " on" : ""}`}
                onClick={() => {
                  if (o.disabled !== true) pick(o.id);
                }}
                onMouseEnter={() => setActive(i)}
                data-option={o.id}
              >
                {o.d === undefined ? null : (
                  <span className="ksoic" style={{ background: c(o.color ?? ic.color) }}>
                    <Ico d={o.d} size={18} />
                  </span>
                )}
                <span className="ksot">
                  <b>{o.label}</b>
                  {o.sub === undefined ? null : <small>{o.sub}</small>}
                </span>
                {on ? <Ico d={LICON.check} size={20} className="ico kschk" /> : null}
              </li>
            );
          })}
          {list.length === 0 ? (
            <li className="ksnone" role="presentation">
              {t("secNone")}
            </li>
          ) : null}
        </ul>
      </section>
      {cam ? (
        <CameraOverlay
          onCode={(code) => {
            const hit = exact(code);
            setCam(false);
            if (hit === undefined) {
              feedback.error();
              setQ(code);
              setNote(t("secScanNone", { code }));
              return true;
            }
            pick(hit.id);
            return true;
          }}
          onClose={() => setCam(false)}
          onManual={() => {
            setCam(false);
            input.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

/** Çok seçenekli alan: dokununca aramalı seçim sayfası açılır. */
export function KalipSecimListe({
  name,
  label,
  hint,
  value,
  options,
  onPick,
  placeholder,
  disabled = false,
  icon,
  scan = true,
  testId,
}: {
  name?: string;
  label: string;
  hint?: string;
  value: string;
  options: readonly KalipSecimSecenek[];
  onPick: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  icon?: { readonly d: string; readonly color: string };
  scan?: boolean;
  testId?: string;
}) {
  const t = useTranslations("kalip");
  const [open, setOpen] = useState(false);
  const hata = useAlanHata(name);
  const req = useZorunlu(name);
  const sel = options.find((o) => o.id === value);
  const shown = sel === undefined ? (placeholder ?? t("secPick")) : sel.sub === undefined ? sel.label : `${sel.label} · ${sel.sub}`;
  return (
    <div className={`ksecw${hata === undefined ? "" : " bad"}`} data-alan={name}>
      <button
        type="button"
        className={`fld ksecb${sel === undefined ? " ph" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${shown}`}
        aria-invalid={hata === undefined ? undefined : true}
        disabled={disabled}
        onClick={() => {
          feedback.minor();
          setOpen(true);
        }}
        data-testid={testId}
        data-value={value}
      >
        <span>{req && !label.trimEnd().endsWith("*") ? `${label} *` : label}</span>
        <em>{shown}</em>
        <Ico d={LICON.chev} size={20} className="ico chev" />
      </button>
      {hint === undefined ? null : <small className="khint">{hint}</small>}
      <Hata name={name} />
      <KalipSecimSayfasi open={open} title={label} options={options} value={value} onPick={onPick} onClose={() => setOpen(false)} icon={icon} scan={scan} />
    </div>
  );
}

/** Seçenek sayısına göre kutu (≤6) ya da aramalı liste. */
export function KalipSecim(props: {
  name?: string;
  label: string;
  hint?: string;
  value: string;
  options: readonly KalipSecimSecenek[];
  onPick: (id: string) => void;
  color: string;
  placeholder?: string;
  disabled?: boolean;
  icon?: { readonly d: string; readonly color: string };
  /** Seçenek az olsa da listeyi zorla (ör. sayısı büyüyecek veri: birimler, depolar). */
  list?: boolean;
  testId?: string;
}) {
  const { list, color, placeholder, icon, ...rest } = props;
  if (list !== true && props.options.length <= SECIM_KUTU_SINIRI) return <KalipSecimGrubu {...rest} color={color} />;
  return <KalipSecimListe {...rest} {...(placeholder === undefined ? {} : { placeholder })} {...(icon === undefined ? {} : { icon })} />;
}

// T-981b (main): ekran içi sekme şeridi + büyük ikonlu seçim kutuları (Ayarlar › Bağlantılar). Renk: ortak belirteç yedeği (`c`).

export interface KalipSekmeItem {
  readonly id: string;
  readonly label: string;
  readonly d: string;
  readonly href: string;
  /** T-1046 (STANDART §5): sekme simgesinin rengi (her sekmede renkli simge). */
  readonly color?: string;
}

/**
 * Ekran içi sekme şeridi: etkin sekme `aria-current="page"`, grubun renginde. `onGo` verilirse gezinme ekrana bırakılır (kaydedilmemiş işte
 * ekranın kendi buzlu uyarı kutusu açılsın; tarayıcının kendi onay kutusu çıkmasın).
 */
export function KalipSekme({ items, current, color, label, onGo }: { items: readonly KalipSekmeItem[]; current: string; color: string; label: string; onGo?: (href: string) => void }) {
  return (
    <nav className="gpick tabs" aria-label={label} data-testid="kalip-sekme">
      {items.map((o) => {
        const on = o.id === current;
        return (
          <Link
            key={o.id}
            href={o.href}
            className={`gp${on ? " on" : ""}`}
            // T-1046 (STANDART §7): seçili sekme koyu dolgu değil, açık mavi zemin + mavi yazı (design/standart.css); simge kendi renginde.
            style={{ "--tc": c(o.color ?? color) } as CSSProperties}
            aria-current={on ? "page" : undefined}
            onClick={(e) => {
              if (onGo !== undefined) {
                e.preventDefault();
                if (!on) onGo(o.href);
                return;
              }
              feedback.minor();
            }}
            data-tab={o.id}
          >
            <Ico d={o.d} size={20} />
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}

export interface KalipSecimItem {
  readonly id: string;
  readonly label: string;
  readonly sub?: string;
  readonly d: string;
  readonly color: string;
  /** Kilitli seçenek: seçilemez, dokununca `onLocked` (gerekçe balonu). */
  readonly locked?: boolean;
}

/** Büyük ikonlu seçim kutuları (tek seçim). */
export function KalipSecimKutulari({ items, value, onPick, onLocked, label, testId }: { items: readonly KalipSecimItem[]; value: string | null; onPick: (id: string) => void; onLocked?: (id: string) => void; label: string; testId?: string }) {
  return (
    <div className="gpick big" role="radiogroup" aria-label={label} data-testid={testId}>
      {items.map((o) => {
        const on = o.id === value;
        const style = (on ? { background: c(o.color) } : { color: c(o.color) }) as CSSProperties;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            className={`gp${on ? " on" : ""}`}
            style={style}
            aria-checked={on}
            aria-disabled={o.locked === true || undefined}
            onClick={() => {
              if (o.locked === true) {
                feedback.error();
                onLocked?.(o.id);
                return;
              }
              feedback.minor();
              onPick(o.id);
            }}
            data-option={o.id}
          >
            <Ico d={o.d} size={34} />
            <span>
              {o.label}
              {o.sub === undefined ? null : <small>{o.sub}</small>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
