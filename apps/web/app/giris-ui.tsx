"use client";
// T-974 (B-63 grup B, I-18): giriş dışı hesap ekranları (yardım, davet kabulü, parola sıfırlama, çalışma alanı sihirbazı) için Giris.dc.html
// `v.auth` kabuğu ve öğeleri — giriş / MFA / aktivasyon ile AYNI sınıflar (`.lp` kabuk `field/flow.tsx` Shell, `.card`, `.fl > .inp`,
// `.hint`, `.ban`, `.act > .big`, `.lnk`, `.opts > .opt`). Yeni stil yok; renkler `giris-tokens.ts`. Tema çerezi sunucudan (`dark`).
import { type InputHTMLAttributes, type ReactNode } from "react";
import { DzRoot } from "./design/dz-root.tsx";
import { C, dz } from "./design/giris-tokens.ts";
import { GICON } from "./design/giris-icons.ts";
import { Ico, Shell } from "./field/flow.tsx";

export { GICON };

/** Kaynak `v.auth` kabuğu (sol tanıtım paneli + sağda içerik). */
export function GirisKabuk({ dark, testId, children }: { dark: boolean; testId?: string; children: ReactNode }) {
  return (
    <DzRoot dark={dark} scope="dzg" {...(testId === undefined ? {} : { testId })}>
      <Shell fact={false}>{children}</Shell>
    </DzRoot>
  );
}

/** Başlık bloğu: `.kick` (adım / bağlam), `.lh` (h1), `.ls` (açıklama). */
export function GirisBaslik({ kick, title, sub }: { kick?: string; title: string; sub?: string }) {
  return (
    <>
      {kick === undefined ? null : <span className="kick">{kick}</span>}
      <h1 className="lh">{title}</h1>
      {sub === undefined ? null : <p className="ls">{sub}</p>}
    </>
  );
}

export type GirisBantTur = "err" | "info" | "warn" | "ok";

/** Kaynak `.ban` (hata: `.ban.err`). */
export function GirisBant({ kind, title, children, d }: { kind: GirisBantTur; title?: string; children?: ReactNode; d?: string }) {
  const style =
    kind === "err"
      ? { background: C["err-bg"], color: C["err-fg"] }
      : kind === "warn"
        ? { background: dz("F4B400"), color: dz("1A1300") }
        : kind === "ok"
          ? { background: C["ok-bg"], color: C["ok-fg"] }
          : { background: C.chip };
  const icon = d ?? (kind === "ok" ? GICON.check : kind === "info" ? GICON.clock : GICON.warn);
  return (
    <div className={kind === "err" ? "ban err" : "ban"} role={kind === "err" ? "alert" : kind === "info" ? undefined : "status"} style={style}>
      <Ico d={icon} size={22} />
      <span>
        {title === undefined ? null : <b>{title}</b>}
        {children}
      </span>
    </div>
  );
}

/** Kaynak `.card` (yüzey). */
export function GirisKart({ children }: { children: ReactNode }) {
  return (
    <div className="card" style={{ background: C.surface }}>
      {children}
    </div>
  );
}

/** Kaynak `.fl` etiket + `.inp` alan + `.hint` (açıklama / hata). */
export function GirisAlan({ id, label, d, hint, error, ...input }: { id: string; label: string; d?: string; hint?: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const hintId = `${id}-h`;
  const errId = `${id}-e`;
  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errId].filter((x) => x !== null).join(" ") || undefined;
  return (
    <div className="fl">
      <label htmlFor={id}>{label}</label>
      <div className={error === undefined ? "inp" : "inp bad"} style={{ background: C.chip }}>
        {d === undefined ? null : <Ico d={d} size={22} style={{ opacity: 0.6 }} />}
        <input {...input} id={id} aria-invalid={error === undefined ? undefined : true} aria-describedby={describedBy} />
      </div>
      {hint === undefined ? null : (
        <span id={hintId} className="hint">
          {hint}
        </span>
      )}
      {error === undefined ? null : (
        <span id={errId} className="hint bad" role="alert">
          <Ico d={GICON.warn} size={16} />
          {error}
        </span>
      )}
    </div>
  );
}

/** Kaynak `.act > .big` ana düğme (koyu lacivert; `back` verilirse soldaki geri düğmesi). */
export function GirisEylem({ label, busy = false, type = "submit", onClick, back }: { label: string; busy?: boolean; type?: "submit" | "button"; onClick?: () => void; back?: { readonly href: string; readonly label: string } }) {
  return (
    <div className="act" style={{ background: C.bg }}>
      {back === undefined ? null : (
        <a className="big ghost" href={back.href} style={{ background: C.chip, color: C.fg, flex: "0 0 auto", minWidth: "64px", textDecoration: "none" }} aria-label={back.label}>
          <Ico d={GICON.back} size={24} sw={3} />
        </a>
      )}
      <button type={type} className="big" style={{ background: dz("172E42"), color: dz("FFFFFF") }} disabled={busy} aria-busy={busy || undefined} onClick={onClick}>
        {label}
        <Ico d={GICON.next} size={24} sw={3} />
      </button>
    </div>
  );
}

/** Kaynak `.lnk` bağlantı (altı çizili, ≥44px). */
export function GirisBaglanti({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="lnk" href={href} style={{ display: "inline-flex", alignItems: "center", color: "inherit" }}>
      {children}
    </a>
  );
}

export interface GirisSecenekItem {
  readonly key: string;
  readonly title: string;
  readonly sub: string;
  readonly d: string;
}

/** Kaynak `.opts > .opt` seçenek kartları (aktivasyon "örnek veri / boş başla" ile aynı); değer gizli alanla forma gider. */
export function GirisSecenek({ name, label, items, value, onPick }: { name: string; label: string; items: readonly GirisSecenekItem[]; value: string; onPick: (key: string) => void }) {
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <div className="opts" role="radiogroup" aria-label={label}>
        {items.map((it, i) => {
          const sel = it.key === value;
          return (
            <button
              key={it.key}
              type="button"
              role="radio"
              aria-checked={sel ? "true" : "false"}
              className={`opt${sel ? " on" : ""}`}
              style={{ background: C.surface }}
              onClick={() => onPick(it.key)}
            >
              <span className="tick">
                <Ico d={GICON.check} size={16} sw={3.2} />
              </span>
              <span className="oi" style={i === 0 ? { background: dz("FFE7A8"), color: dz("4A3500") } : { background: C.chip, color: C.fg }}>
                <Ico d={it.d} size={24} />
              </span>
              <b>
                <span>{it.title}</span>
              </b>
              <span>
                <span>{it.sub}</span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
