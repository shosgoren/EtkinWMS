// T-1124: rehber hedefinin ekrandaki karşılığı — görünen eşleşmeler (delikler), klavye odağı alacak alan ve kartın delikleri örtmeyen yeri.
// İşlem rehberi ile adım adım aktarma rehberi aynı yardımcıları kullanır. `kartYeri` saftır (birim testli); diğerleri DOM okur.
import { useEffect, useRef, useState } from "react";
import { hedefKutusu, type PerdeDelik } from "./perde.tsx";

const ODAK = 'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [role="option"], [tabindex]:not([tabindex="-1"])';
const KONTROL = 'input, textarea, select, button, a[href], [role="option"], [contenteditable="true"]';
const YAZI = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly])';

function gorunur(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

/** Seçicinin görünen eşleşmeleri (birbirinin içindekiler tek sayılır), en çok `sinir` tane. */
export function gorunenler(sel: string | null, sinir = 4): HTMLElement[] {
  if (sel === null || typeof document === "undefined") return [];
  const hepsi = [...document.querySelectorAll<HTMLElement>(sel)].filter(gorunur);
  return hepsi.filter((e) => !hepsi.some((o) => o !== e && o.contains(e))).slice(0, sinir);
}

export function gorunurMu(sel: string): boolean {
  return gorunenler(sel, 1).length > 0;
}

/** Her hedefin çevresinde delik (görünüm alanına kırpılır; ekran dışındaki hedef delik açmaz). */
export function delikler(els: readonly Element[], pad = 6): PerdeDelik[] {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const out: PerdeDelik[] = [];
  for (const el of els) {
    const r = hedefKutusu(el);
    const x = Math.max(0, Math.round(r.left - pad));
    const y = Math.max(0, Math.round(r.top - pad));
    const x2 = Math.min(vw, Math.round(r.right + pad));
    const y2 = Math.min(vh, Math.round(r.bottom + pad));
    if (x2 - x > 0 && y2 - y > 0) out.push({ x, y, w: x2 - x, h: y2 - y });
  }
  return out;
}

export function ayniDelikler(a: readonly PerdeDelik[] | null, b: readonly PerdeDelik[]): boolean {
  return a !== null && a.length === b.length && a.every((x, i) => x.x === b[i]!.x && x.y === b[i]!.y && x.w === b[i]!.w && x.h === b[i]!.h);
}

/** Hedeflerdeki doldurulacak alanlar (sırayla): yazı alanları ve seçim sayfası açan düğmeler (`aria-haspopup`). */
export function alanlar(els: readonly Element[]): HTMLElement[] {
  const sec = `${YAZI}, button[aria-haspopup]:not([disabled])`;
  const out: HTMLElement[] = [];
  for (const el of els) {
    const adaylar = el.matches(sec) ? [el as HTMLElement] : [...el.querySelectorAll<HTMLElement>(sec)];
    for (const a of adaylar) if (gorunur(a)) out.push(a);
  }
  return out;
}

/** Boş mu? Yazı alanında değer yok; seçim düğmesi her zaman aday (seçimi ekran kendi işaretler). */
export function bosMu(el: HTMLElement): boolean {
  return !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || el.value === "";
}

/**
 * Odak alacak öğe: ilk boş alan; yoksa kendisi odaklanabilen hedef (ör. alt çubuğun ana işlemi); yoksa hedefin içindeki ilk odaklanabilir
 * öğe.
 */
export function odakAdayi(els: readonly Element[]): HTMLElement | null {
  const bos = alanlar(els).find(bosMu);
  if (bos !== undefined) return bos;
  for (const el of els) if (el.matches(ODAK)) return el as HTMLElement;
  for (const el of els) {
    const ic = [...el.querySelectorAll<HTMLElement>(ODAK)].find(gorunur);
    if (ic !== undefined) return ic;
  }
  return null;
}

/**
 * T-1124: odak hedefteki serbest yazı alanında mı (miktar, açıklama)? O sırada adım ilerlemez; kullanıcı alandan çıkınca (Tab, dokunma)
 * ilerler. Arama/seçim alanı (`role="searchbox"`, `aria-autocomplete`) sayılmaz: orada iş seçenek seçmektir, seçilince ilerlenir.
 */
export function yaziyor(target: string | null): boolean {
  if (typeof document === "undefined") return false;
  const etkin = document.activeElement;
  if (!(etkin instanceof HTMLInputElement || etkin instanceof HTMLTextAreaElement) || !etkin.matches(YAZI)) return false;
  if (etkin.getAttribute("role") === "searchbox" || etkin.getAttribute("role") === "combobox" || etkin.hasAttribute("aria-autocomplete")) return false;
  return gorunenler(target).some((el) => el.contains(etkin));
}

/** Açık bir pencere (seçim sayfası, onay kutusu) varsa rehber odağı çalmaz. */
export function pencereAcik(): boolean {
  return [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].some((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden");
}

/** Hedefi görünür alana getirir ve odaklar (yazı alanında telefon klavyesi açılır; hedef zaten görünüyorsa kaydırmaz). */
export function odakla(el: HTMLElement, kaydir: Element | null): void {
  const k = kaydir ?? el;
  const r = k.getBoundingClientRect();
  if (r.top < 64 || r.bottom > window.innerHeight - 140) k.scrollIntoView({ block: "center", inline: "nearest" });
  el.focus({ preventScroll: true });
}

export interface KartYeri {
  readonly left?: number;
  readonly right?: number;
  readonly top?: number;
  readonly bottom?: number;
}

/**
 * Kart delikleri örtmesin (saf): sırayla sol alt (varsayılan; alt çubuğun üstü), sağ alt, sol üst, sağ üst; hiçbiri boş değilse en az
 * örtüşen yer. `w`/`h` kartın ölçüsü.
 */
export function kartYeri(holes: readonly PerdeDelik[], vw: number, vh: number, w: number, h: number): KartYeri {
  const kenar = 12;
  const alt = 136;
  const ust = 12;
  const adaylar: { yer: KartYeri; x: number; y: number }[] = [
    { yer: { left: kenar, bottom: alt }, x: kenar, y: vh - alt - h },
    { yer: { right: kenar, bottom: alt }, x: vw - kenar - w, y: vh - alt - h },
    { yer: { left: kenar, top: ust }, x: kenar, y: ust },
    { yer: { right: kenar, top: ust }, x: vw - kenar - w, y: ust },
  ];
  const ortusme = (x: number, y: number): number =>
    holes.reduce((t, d) => t + Math.max(0, Math.min(x + w, d.x + d.w) - Math.max(x, d.x)) * Math.max(0, Math.min(y + h, d.y + d.h) - Math.max(y, d.y)), 0);
  let iyi = adaylar[0]!;
  let enAz = Infinity;
  for (const a of adaylar) {
    const o = ortusme(a.x, a.y);
    if (o === 0) return a.yer;
    if (o < enAz) {
      enAz = o;
      iyi = a;
    }
  }
  return iyi.yer;
}

/** Hedef bu kadar yoklamada (300 ms) bulunamazsa "Ekranı aç" gösterilir (gezinme sonrası geç çizilen ekran beklenir). */
const BEKLE = 5;

/**
 * T-1124: rehber adımının hedefini izler — delikleri ölçer, adım başında hedefi görünür alana getirip klavye odağını ilk boş alana verir;
 * adım sürerken hedefte YENİ bir alan belirirse (ör. depo seçilince raf alanı) odak ona geçer (kullanıcının yazdığı alandan çalınmaz:
 * yalnız odak hedefin içindeyken ya da boştayken). Açık bir pencere (seçim sayfası) varken odak değişmez. `yok`: hedef beklenen sürede
 * çıkmadı. `adim` değişince (sonraki adım) baştan başlar.
 */
export function useRehberHedef(target: string | null, acik: boolean, adim: string): { readonly delik: readonly PerdeDelik[] | null; readonly yok: boolean } {
  const [delik, setDelik] = useState<readonly PerdeDelik[] | null>(null);
  const [yok, setYok] = useState(false);
  const odakli = useRef<HTMLElement | null>(null);
  const bilinen = useRef<Set<HTMLElement>>(new Set());
  useEffect(() => {
    odakli.current = null;
    bilinen.current = new Set();
    setYok(false);
    if (!acik || target === null) {
      setDelik(null);
      return undefined;
    }
    let eksik = 0;
    const olc = (): void => {
      const els = gorunenler(target);
      if (els.length === 0) {
        eksik++;
        if (eksik >= BEKLE) setYok(true);
        setDelik((o) => (o === null ? o : null));
        return;
      }
      eksik = 0;
      setYok(false);
      const d = delikler(els);
      setDelik((o) => (ayniDelikler(o, d) ? o : d));
      if (pencereAcik()) return;
      const hepsi = alanlar(els);
      if (odakli.current === null || !odakli.current.isConnected) {
        const a = odakAdayi(els);
        bilinen.current = new Set(hepsi);
        if (a !== null) {
          odakla(a, els[0] ?? null);
          odakli.current = a;
        }
        return;
      }
      const yeni = hepsi.find((a) => !bilinen.current.has(a) && bosMu(a));
      for (const a of hepsi) bilinen.current.add(a);
      const etkin = document.activeElement;
      // Odak hedefte, sayfada ya da bir kapta (seçim sayfası kapanınca odak kaba düşebilir): yeni alana geçilir. Kullanıcı başka bir
      // denetimdeyse (alan, düğme, bağlantı) odak çalınmaz.
      const bizde = etkin === null || etkin === document.body || els.some((e) => e.contains(etkin)) || !etkin.matches(KONTROL);
      if (yeni !== undefined && bizde) {
        odakla(yeni, yeni);
        odakli.current = yeni;
      }
    };
    olc();
    const id = window.setInterval(olc, 300);
    const yeniden = (): void => olc();
    window.addEventListener("resize", yeniden);
    window.addEventListener("scroll", yeniden, true);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", yeniden);
      window.removeEventListener("scroll", yeniden, true);
    };
  }, [target, acik, adim]);
  return { delik, yok };
}
