"use client";
// T-990 (B-97, ALTIN-KURAL "Katman standardı"): TEK ortak buzlu perde. Yeni her alt sayfa / seçim sayfası / kutu bunu kullanır; görünüş
// `design/perde.css` `.kperde` (Pano hesap menüsü perdesiyle aynı değer). Perdeye dokununca katman kapanır; klavye odağı almaz.
// T-1006 (kurulum yolculuğu, ilk kullanım rehberi): `delik` verilirse perde aynı değerle çizilir ama hedefin çevresi açık kalır (kaynak
// Kabuk `.tveil` "hedef net kalmalı"): `clip-path` çift-tek kuralıyla delik; delikteki gerçek düğmeye dokunmak gerçek işlemi yapar.
import type { CSSProperties } from "react";

export interface PerdeDelik {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Delikli perde kırpması (px, görünüm alanı koordinatı). T-1100: birden çok delik (örtüşmeyen; her biri köşeden gidip dönülen ayrı halka). */
export function delikKirp(d: PerdeDelik | readonly PerdeDelik[]): string {
  const halka = (r: PerdeDelik): string => {
    const x1 = Math.max(0, Math.round(r.x));
    const y1 = Math.max(0, Math.round(r.y));
    const x2 = Math.round(r.x + r.w);
    const y2 = Math.round(r.y + r.h);
    return `${x1}px ${y1}px, ${x2}px ${y1}px, ${x2}px ${y2}px, ${x1}px ${y2}px, ${x1}px ${y1}px`;
  };
  const list = "x" in d ? [d] : d;
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${list.map(halka).join(", 0 0, ")})`;
}

export function KalipPerdeKatman({ onClose, label, delik = null }: { onClose: () => void; label: string; delik?: PerdeDelik | readonly PerdeDelik[] | null }) {
  const style: CSSProperties | undefined = delik === null ? undefined : { clipPath: delikKirp(delik) };
  return <button type="button" className="kperde" aria-label={label} tabIndex={-1} onClick={onClose} style={style} data-testid="kalip-perde" />;
}
