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

/** Delikli perde kırpması (px, görünüm alanı koordinatı). */
export function delikKirp(d: PerdeDelik): string {
  const x1 = Math.max(0, Math.round(d.x));
  const y1 = Math.max(0, Math.round(d.y));
  const x2 = Math.round(d.x + d.w);
  const y2 = Math.round(d.y + d.h);
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x1}px ${y1}px, ${x2}px ${y1}px, ${x2}px ${y2}px, ${x1}px ${y2}px, ${x1}px ${y1}px)`;
}

export function KalipPerdeKatman({ onClose, label, delik = null }: { onClose: () => void; label: string; delik?: PerdeDelik | null }) {
  const style: CSSProperties | undefined = delik === null ? undefined : { clipPath: delikKirp(delik) };
  return <button type="button" className="kperde" aria-label={label} tabIndex={-1} onClick={onClose} style={style} data-testid="kalip-perde" />;
}
