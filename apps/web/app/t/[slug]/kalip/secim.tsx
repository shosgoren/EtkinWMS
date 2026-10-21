"use client";
// T-981b: kalıp ORTAK seçim parçaları (Ayarlar › Bağlantılar ve sonraki ekranlar) — KalipForm.dc.html `.gpick > .gp` seçenek düğmeleri:
// (1) `KalipSekme`: ekran içi sekme şeridi (bağlantı; etkin sekme grubun rengi), (2) `KalipSecimKutulari`: büyük ikonlu seçim kutuları
// (`.gpick.big`; ikon üstte, ad + alt yazı; kilitli seçenek `aria-disabled` + gerekçe balonu). Uyarlama CSS'i `design/kalip-frame.css`
// (tuvalde kaynağı yok, DESIGN-PARITY T-981b). Dokunuşta ses (`tone`), seçili kutu dolu renk.
import type { CSSProperties } from "react";
import { Ico, tone } from "./ekran.tsx";
import { kdz } from "./tokens.ts";

const c = (hex: string): string => kdz("dzf", hex);

export interface KalipSekmeItem {
  readonly id: string;
  readonly label: string;
  readonly d: string;
  readonly href: string;
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
          <a
            key={o.id}
            href={o.href}
            className={`gp${on ? " on" : ""}`}
            style={on ? { background: c(color) } : undefined}
            aria-current={on ? "page" : undefined}
            onClick={(e) => {
              if (onGo !== undefined) {
                e.preventDefault();
                if (!on) onGo(o.href);
                return;
              }
              tone("tap");
            }}
            data-tab={o.id}
          >
            <Ico d={o.d} size={20} />
            {o.label}
          </a>
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
                tone("err");
                onLocked?.(o.id);
                return;
              }
              tone("tap");
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
