"use client";
// T-968 (B-63, I-18): DETAY kalıbı parçaları — KalipDetay.dc.html BİREBİR: iki sütun (`.dgrid > .dcol`), büyük ikonlu kimlik kartı
// (`.hero`: `.hic`, `.hx` ad + `.hcode` + `.tags`, `.htot` toplam), hızlı işlemler (`.qa > .qab`), başlıklı kart (`.card > .ch`),
// "Nerede?" dağılımı (`.warnb`, `.sbar`, `.whl > .whr` + `.racks > .rk`, `.minl`), zaman çizgisi (`.tline > .ti`).
// Veride olmayan bölüm çağıran tarafından çizilmez (uydurma yok). Renkler `.dzd` belirteçlerinden.
import type { ReactNode } from "react";
import { LICON } from "../../../design/kalip-icons.ts";
import { Ico, MicIco } from "./ekran.tsx";
import { kdz } from "./tokens.ts";

const c = (hex: string): string => kdz("dzd", hex);

/** Kaynak `.dgrid` (masaüstü 1.2fr / 1fr, telefon tek sütun). */
export function KalipDetayIzgara({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="dgrid">
      <div className="dcol">{left}</div>
      <div className="dcol">{right}</div>
    </div>
  );
}

/** Kaynak `.hero`. */
export function KalipHero({ label, name, code, tags, d, color, total, testId }: { label: string; name: string; code: string; tags: readonly string[]; d: string; color: string; total?: { readonly value: string; readonly sub: string; readonly crit: boolean }; testId?: string }) {
  return (
    <section className="hero" aria-label={label} data-testid={testId}>
      <span className="hic" style={{ background: c(color) }}>
        <Ico d={d} size={42} />
      </span>
      <span className="hx">
        <b>{name}</b>
        <span className="hcode">{code}</span>
        {tags.length === 0 ? null : (
          <span className="tags">
            {tags.map((tg) => (
              <span key={tg} className="tag">
                {tg}
              </span>
            ))}
          </span>
        )}
      </span>
      {total === undefined ? null : (
        <span className={`htot${total.crit ? " crit" : ""}`} data-testid="kalip-total">
          <b>{total.value}</b>
          <small>{total.sub}</small>
        </span>
      )}
    </section>
  );
}

export interface KalipHizliIslem {
  readonly key: string;
  readonly label: string;
  readonly d: string;
  readonly color: string;
  readonly href?: string;
  readonly onClick?: () => void;
}

/** Kaynak `.qa > .qab` hızlı işlemler (yalnız yetkili işlemler verilir). */
export function KalipHizli({ label, items }: { label: string; items: readonly KalipHizliIslem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="qa" role="group" aria-label={label}>
      {items.map((q) => {
        const inner = (
          <>
            <i style={{ background: c(q.color) }}>
              <Ico d={q.d} size={26} />
            </i>
            <b>{q.label}</b>
          </>
        );
        return q.href !== undefined ? (
          <a key={q.key} className="qab" href={q.href} aria-label={q.label} onClick={q.onClick} data-quick={q.key}>
            {inner}
          </a>
        ) : (
          <button key={q.key} type="button" className="qab" aria-label={q.label} onClick={q.onClick} data-quick={q.key}>
            {inner}
          </button>
        );
      })}
    </div>
  );
}

/** Kaynak `.card` + `.ch` başlık (ikon, ad, ince alt yazı; sağda isteğe bağlı eylem). */
export function KalipKartBolum({ label, title, sub, d, color, action, children, testId }: { label?: string; title: string; sub?: string; d: string; color: string; action?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="card" aria-label={label ?? title} data-testid={testId}>
      <div className="ch">
        <i style={{ background: c(color) }}>
          <Ico d={d} size={24} />
        </i>
        <span>
          <b>{title}</b>
          {sub === undefined ? null : <small>{sub}</small>}
        </span>
        {action === undefined ? null : <span className="go">{action}</span>}
      </div>
      {children}
    </section>
  );
}

/** Kaynak `.warnb` (kırmızı uyarı bandı). */
export function KalipUyari({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="warnb" role="status" data-testid="kalip-warn">
      <i>
        <Ico d={LICON.warn} size={22} />
      </i>
      <span>
        <b>{title}</b>
        <small>{sub}</small>
      </span>
    </div>
  );
}

export interface KalipYer {
  readonly key: string;
  readonly name: string;
  readonly meta: string;
  /** Biçimlenmiş miktar + birim (`.qty`). */
  readonly qty: string;
  /** Çubuktaki payı (0–1) — çağıran gerçek miktardan hesaplar. */
  readonly share: number;
  readonly color: string;
  readonly racks: readonly { readonly code: string; readonly qty: string; readonly share: number }[];
}

/** Kaynak "Nerede?" gövdesi: dağılım çubuğu (`.sbar`), depo satırları (`.whl > .whr`), raf çipleri (`.racks > .rk`). */
export function KalipNerede({ places }: { places: readonly KalipYer[] }) {
  return (
    <>
      <div className="sbar" aria-hidden="true">
        {places.flatMap((w) => w.racks.map((r, i) => <span key={`${w.key}-${r.code}`} style={{ width: `${(r.share * 100).toFixed(1)}%`, background: c(w.color), opacity: i === 0 ? 1 : 0.7 }} />))}
        <span className="rest" />
      </div>
      <div className="whl">
        {places.map((w) => (
          <div key={w.key} className="whr" data-testid="kalip-place">
            <span className="dot" style={{ background: c(w.color) }} />
            <span style={{ minWidth: 0 }}>
              <b>{w.name}</b>
              <small>{w.meta}</small>
            </span>
            <span className="qty">{w.qty}</span>
            <span className="racks">
              {w.racks.map((r) => (
                <span key={r.code} className="rk">
                  <i style={{ background: c(w.color) }} />
                  {r.code} · {r.qty}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/** Kaynak `.minl` (minimum + durum hapı). */
export function KalipMinimum({ label, state, ok }: { label: string; state: string; ok: boolean }) {
  return (
    <div className="minl">
      <span>{label}</span>
      <span className={`pill ${ok ? "ok" : "warn"}`}>{state}</span>
    </div>
  );
}

export interface KalipOlay {
  readonly key: string;
  readonly title: string;
  readonly meta: string;
  /** Sağdaki miktar (`.tq`, işaretli); boş olabilir. */
  readonly q: string;
  readonly d: string;
  readonly color: string;
  /** Miktar yazı rengi (kaynak `qStyle`). */
  readonly qColor: string;
}

/** Kaynak `.tline > .ti` zaman çizgisi (en yeni üstte). */
export function KalipZaman({ items }: { items: readonly KalipOlay[] }) {
  return (
    <ol className="tline">
      {items.map((m) => (
        <li key={m.key} className="ti" data-testid="kalip-event">
          <span className="tn" style={{ background: c(m.color) }}>
            <Ico d={m.d} size={20} />
          </span>
          <span style={{ minWidth: 0 }}>
            <b>{m.title}</b>
            <small>{m.meta}</small>
          </span>
          <span className="tq" style={{ color: c(m.qColor) }}>
            {m.q}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Kaynak `.more.tmore` (zaman çizgisinin altındaki "Tüm hareketler" satırı). */
export function KalipTumu({ children, href }: { children: ReactNode; href: string }) {
  return (
    <a className="more tmore" href={href}>
      <i>
        <MicIco size={18} />
      </i>
      {children}
    </a>
  );
}
