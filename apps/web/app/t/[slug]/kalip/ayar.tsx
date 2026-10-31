"use client";
// T-1112 (STANDART.md §5 ayar kalıbı; kaynak `docs/design/source/StandartAyarlarEntegrasyon.dc.html`): birden çok konu barındıran ayar
// sekmesinin ortak parçaları — solda dikey ALT BÖLÜM listesi (simge kutusu + ad, sorun varsa kırmızı sayı rozeti; seçili satır beyaz +
// gölge), sağda yalnız seçili bölümün kartı (başlık simgesi + ad + kısa açıklama), ayar satırı (simge kutusu + ad + sağda denetim) ve
// entegrasyon yönü seçimi (simge üstte, yazı altta büyük seçim düğmeleri; seçili olan kendi renginde dolu). Telefonda (< 700 px) alt bölüm
// listesi kartın üstünde yatay kayan çip satırı olur (sayfa yatay kaymaz). Görünüm `design/standart.css` (`.stab*`, `.stak*`, `.stay*`,
// `.styon*`); renkler ton adıyla (`StTon` → `--color-st-k-*`), satır içi onaltılık renk yok. Bölüm geçişi adres sorgusudur (ekran sunucuda
// okur), küçük işlem olduğu için sessizdir (ALTIN-KURAL 5: `feedback.minor`).
import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { feedback } from "@wms/ui";
import { Ico } from "./ekran.tsx";
import type { StTon } from "./kart.tsx";

export interface KalipAltBolum {
  readonly id: string;
  readonly label: string;
  readonly d: string;
  readonly ton: StTon;
  readonly href: string;
  /** Sorun sayısı (0 ya da yoksa rozet çizilmez). */
  readonly badge?: number;
  /** Rozetin erişilebilir adı (ör. "3 sorun"). */
  readonly badgeAria?: string;
  /** T-1134: bölüm henüz yoksa adın yanında küçük rozet (ör. "YAKINDA"); satır yine açılır, içi boş durum + yönlendirme. */
  readonly soon?: string;
}

/** Sol alt bölüm listesi + sağda seçili bölüm (`children`). */
export function KalipAltBolumler({ label, items, current, children, testId }: { label: string; items: readonly KalipAltBolum[]; current: string; children: ReactNode; testId?: string }) {
  // Telefonda çip satırı yatay kayar: seçili bölüm görünür alana getirilir (yalnız satırın içinde; sayfa kaydırılmaz).
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const on = nav?.querySelector<HTMLElement>(".stab-i.on");
    if (nav === null || nav === undefined || on === null || on === undefined || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = Math.max(0, on.offsetLeft - nav.offsetLeft - 12);
  }, [current]);
  return (
    <div className="stab" data-testid={testId ?? "kalip-alt-bolumler"}>
      <nav className="stab-nav" aria-label={label} ref={navRef}>
        {items.map((o) => {
          const on = o.id === current;
          const badge = o.badge ?? 0;
          return (
            <Link
              key={o.id}
              href={o.href}
              scroll={false}
              className={`stab-i stt-${o.ton}${on ? " on" : ""}`}
              aria-current={on ? "page" : undefined}
              onClick={() => feedback.minor()}
              data-bolum={o.id}
            >
              <span className="stab-ic">
                <Ico d={o.d} size={16} />
              </span>
              <span className="stab-ad">{o.label}</span>
              {o.soon === undefined ? null : (
                <span className="stab-soon" data-testid={`alt-bolum-${o.id}-soon`}>
                  {o.soon}
                </span>
              )}
              {badge > 0 ? (
                <span className="stab-say" aria-label={o.badgeAria} data-testid={`alt-bolum-${o.id}-badge`}>
                  {badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="stab-g">{children}</div>
    </div>
  );
}

/** Seçili bölümün kartı: başlık (renkli simge kutusu + ad + alt satır), sağda isteğe bağlı işlem, altında içerik. */
export function KalipAyarKart({ title, sub, d, ton, actions, children, testId }: { title: string; sub?: string; d: string; ton: StTon; actions?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className={`stak stt-${ton}`} aria-label={title} data-testid={testId}>
      <div className="stak-h">
        <span className="stak-gi">
          <Ico d={d} size={22} />
        </span>
        <span className="stak-t">
          <b>{title}</b>
          {sub === undefined ? null : <small>{sub}</small>}
        </span>
        {actions === undefined ? null : <span className="stak-act">{actions}</span>}
      </div>
      <div className="stak-g">{children}</div>
    </section>
  );
}

/** T-1136: satırın altında tam genişlik tek cümle (ör. seçili yönün sonucu): seçimin renginde simge + düz yazı, değişince duyurulur. */
export interface KalipAyarNot {
  readonly text: string;
  readonly ton: StTon;
  /** Simge yolu; `etkin` ise Etkin WMS işareti ("e" kutusu). */
  readonly d?: string;
  readonly etkin?: boolean;
  readonly testId?: string;
}

/** Ayar satırı: renkli simge kutusu + ad (+ kısa satır) solda, denetim sağda (`children`); isteğe bağlı alt not (`note`). `data` satırın durum öznitelikleri. */
export function KalipAyarSatir({ title, sub, d, ton, children, testId, data, note }: { title: string; sub?: ReactNode; d: string; ton: StTon; children?: ReactNode; testId?: string; data?: Readonly<Record<`data-${string}`, string>>; note?: KalipAyarNot }) {
  return (
    <div className={`stay stt-${ton}`} data-testid={testId} {...data}>
      <span className="stay-ic">
        <Ico d={d} size={20} />
      </span>
      <span className="stay-t">
        <b>{title}</b>
        {sub === undefined ? null : <small>{sub}</small>}
      </span>
      {children === undefined ? null : <span className="stay-r">{children}</span>}
      {note === undefined ? null : (
        <p className={`stay-n stt-${note.ton}`} aria-live="polite" data-testid={note.testId}>
          {note.etkin === true ? (
            <b className="styon-e" aria-hidden="true">
              e
            </b>
          ) : note.d === undefined ? null : (
            <Ico d={note.d} size={16} />
          )}
          <span>{note.text}</span>
        </p>
      )}
    </div>
  );
}

export interface KalipYon {
  readonly id: string;
  readonly label: string;
  /** Simge yolu; `etkin` ise yerine Etkin WMS işareti ("e" kutusu) çizilir. */
  readonly d?: string;
  readonly etkin?: boolean;
  /** Seçiliyken dolgu rengi. */
  readonly ton: StTon;
}

/**
 * STANDART §5 entegrasyon yönü: "← <Sistem>'den al · → <Sistem>'e gönder · ⇄ İki yönlü · [e] Yalnız Etkin WMS" büyük seçim düğmeleri
 * (radiogroup). Mümkün olmayan yön seçenek listesine hiç verilmez. `busy` iken dokunuş yok sayılır (aynı işlem iki kez gönderilmez).
 */
export function KalipYonSecimi({ label, options, value, onPick, busy = false, testId }: { label: string; options: readonly KalipYon[]; value: string; onPick: (id: string) => void; busy?: boolean; testId?: string }) {
  return (
    <span className="styon" role="radiogroup" aria-label={label} aria-busy={busy || undefined} data-testid={testId}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button key={o.id} type="button" role="radio" aria-checked={on} className={`stt-${o.ton}${on ? " on" : ""}`} onClick={() => onPick(o.id)} data-option={o.id}>
            {o.etkin === true ? (
              <b className="styon-e" aria-hidden="true">
                e
              </b>
            ) : o.d === undefined ? null : (
              <Ico d={o.d} size={18} />
            )}
            {o.label}
          </button>
        );
      })}
    </span>
  );
}
