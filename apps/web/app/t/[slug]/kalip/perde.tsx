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

/** Delikli perde kırpması (px, görünüm alanı koordinatı). T-1100: birden çok delik (örtüşmeyen; her biri ayrı halka). T-1111: delik köşeleri
 * yuvarlatılmış (`path()`; düz dikdörtgen delik alt çubuğun camından keskin bir kare kesiyordu). Dış çerçeve görünüm alanından büyük sabit. */
export function delikKirp(d: PerdeDelik | readonly PerdeDelik[]): string {
  const halka = (r: PerdeDelik): string => {
    const x1 = Math.max(0, Math.round(r.x));
    const y1 = Math.max(0, Math.round(r.y));
    const x2 = Math.round(r.x + r.w);
    const y2 = Math.round(r.y + r.h);
    const q = Math.max(0, Math.min(18, Math.floor((x2 - x1) / 2), Math.floor((y2 - y1) / 2)));
    return `M${x1 + q} ${y1}H${x2 - q}A${q} ${q} 0 0 1 ${x2} ${y1 + q}V${y2 - q}A${q} ${q} 0 0 1 ${x2 - q} ${y2}H${x1 + q}A${q} ${q} 0 0 1 ${x1} ${y2 - q}V${y1 + q}A${q} ${q} 0 0 1 ${x1 + q} ${y1}Z`;
  };
  const list = "x" in d ? [d] : d;
  return `path(evenodd, "M0 0H100000V100000H0Z ${list.map(halka).join(" ")}")`;
}

/** T-1111: hedefin görünen kutusu, kendi dışına taşan alt öğeleriyle birlikte (alt çubuk ana düğmesinin altındaki "KAYDET" yazısı `.cap`
 * düğme kutusunun dışında; yalnız düğme ölçülünce yazı perdenin altında yarım kalıyordu). */
export function hedefKutusu(el: Element): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
  const rects = [el, ...el.querySelectorAll("*")].map((x) => x.getBoundingClientRect()).filter((x) => x.width > 0 && x.height > 0);
  if (rects.length === 0) rects.push(el.getBoundingClientRect());
  const left = Math.min(...rects.map((x) => x.left));
  const top = Math.min(...rects.map((x) => x.top));
  const right = Math.max(...rects.map((x) => x.right));
  const bottom = Math.max(...rects.map((x) => x.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function KalipPerdeKatman({ onClose, label, delik = null }: { onClose: () => void; label: string; delik?: PerdeDelik | readonly PerdeDelik[] | null }) {
  const style: CSSProperties | undefined = delik === null ? undefined : { clipPath: delikKirp(delik) };
  return <button type="button" className="kperde" aria-label={label} tabIndex={-1} onClick={onClose} style={style} data-testid="kalip-perde" />;
}
