// T-1124: rehber hedefinin ekrandaki karşılığı — görünen eşleşmeler (delikler), klavye odağı alacak alan ve kartın delikleri örtmeyen yeri.
// İşlem rehberi ile adım adım aktarma rehberi aynı yardımcıları kullanır; DOM okur.
// T-1130: kartın yeri üç rehberde (kurulum yolculuğu dahil) tek ortak kancadan: `useKartYeri` (hesap `kart-yeri.ts`, saf).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { hedefKutusu, type PerdeDelik } from "./perde.tsx";
import { kartYeriHesapla, type KartHedef } from "./kart-yeri.ts";

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

/** Öğe ya da bir atası `position: fixed` mı (alt çubuk, üst çubuk): sayfa kaydırılınca yer değiştirmez. */
function sabitMi(el: Element): boolean {
  for (let e: Element | null = el; e !== null; e = e.parentElement) if (getComputedStyle(e).position === "fixed") return true;
  return false;
}

function kartHedefi(el: Element): KartHedef {
  const r = hedefKutusu(el);
  return { x: r.left, y: r.top, w: r.width, h: r.height, sabit: sabitMi(el) };
}

/** Kaydırılacak kap: hedefin en yakın kaydırılabilir atası, yoksa sayfa. */
function kaydirici(el: Element | null): Element {
  for (let e = el?.parentElement ?? null; e !== null && e !== document.body && e !== document.documentElement; e = e.parentElement) {
    const s = getComputedStyle(e);
    if (/(auto|scroll|overlay)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1) return e;
  }
  return document.scrollingElement ?? document.documentElement;
}

/** Dar küme (bütün hedef sığmıyorsa): hedefteki odaklı alan (yoksa ilk alan) etiketiyle + sabit hedefler (alt çubuğun ana işlemi). */
function darKume(els: readonly Element[]): Element[] {
  const etkin = document.activeElement;
  const odakli = etkin instanceof HTMLElement && etkin !== document.body && els.some((e) => e.contains(etkin)) ? etkin : null;
  const alan = odakli ?? alanlar(els)[0] ?? null;
  return [...(alan === null ? [] : [alan.closest("label") ?? alan]), ...els.filter(sabitMi)];
}

/** Görünen alan (telefon klavyesi açıkken küçülür) ve alt çubuğun bu alandan aldığı pay. */
function gorunurAlan(): { ust: number; yukseklik: number; altCubuk: number } {
  const vv = window.visualViewport;
  const ust = vv?.offsetTop ?? 0;
  const yukseklik = vv?.height ?? window.innerHeight;
  const dock = document.querySelector('[data-testid="kabuk-dock"]');
  let altCubuk = 0;
  if (dock !== null && dock.getClientRects().length > 0) {
    const d = hedefKutusu(dock);
    altCubuk = Math.max(0, Math.min(yukseklik / 2, ust + yukseklik - d.top));
  }
  return { ust, yukseklik, altCubuk };
}

/**
 * T-1130: rehber kartının yeri (üç rehberin ortak kancası). `hedefler` kartın örtmeyeceği öğeleri verir (yapılacak alan/düğme; kurulum
 * yolculuğunda açık form ve ana işlem). Kart ölçülür, `kartYeriHesapla` en uygun yeri seçer; hedef kartla birlikte sığmıyorsa adım başında,
 * görünen alan değişince (klavye açıldı, döndürme) ya da odak hedefteki başka alana geçince sayfa gereken kadar kaydırılır (en çok iki kez;
 * kullanıcının kendi kaydırması geri alınmaz — o sırada kart yalnız yer değiştirir). Kaydırma, boyut, `visualViewport` ve kartın kendi ölçüsü
 * izlenir.
 */
export function useKartYeri(kart: RefObject<HTMLElement | null>, acik: boolean, anahtar: string, hedefler: () => readonly Element[]): CSSProperties {
  const [yer, setYer] = useState<{ readonly left: number; readonly top: number; readonly width: number | null } | null>(null);
  const oku = useRef(hedefler);
  useLayoutEffect(() => {
    oku.current = hedefler;
  });
  useLayoutEffect(() => {
    if (!acik) {
      setYer(null);
      return undefined;
    }
    let sonAnahtar = "";
    let sonOdak: Element | null = null;
    let deneme = 0;
    const olc = (): void => {
      const el = kart.current;
      if (el === null) return;
      const els = oku.current().filter((e) => e.isConnected && e.getClientRects().length > 0);
      const g = gorunurAlan();
      const vw = window.innerWidth;
      const etkin = document.activeElement;
      const yeniAnahtar = `${anahtar}|${vw}x${Math.round(g.yukseklik)}|${els.length}`;
      const yeniOdak = etkin !== sonOdak && etkin !== null && els.some((e) => e.contains(etkin));
      if (yeniAnahtar !== sonAnahtar || yeniOdak) deneme = 0;
      sonAnahtar = yeniAnahtar;
      sonOdak = etkin;
      const izinli = deneme < 2 && els.length > 0;
      const kap = kaydirici(els.find((e) => !sabitMi(e)) ?? null);
      const kaydirma = izinli ? { min: -kap.scrollTop, max: Math.max(0, kap.scrollHeight - kap.clientHeight - kap.scrollTop) } : { min: 0, max: 0 };
      const r = el.getBoundingClientRect();
      const s = kartYeriHesapla({
        vw,
        gorunur: { ust: g.ust, yukseklik: g.yukseklik },
        altCubuk: g.altCubuk,
        hedefler: els.map(kartHedefi),
        dar: darKume(els).map(kartHedefi),
        kart: { w: r.width, h: r.height },
        telefon: vw < 700,
        kaydirma,
      });
      if (izinli) {
        if (s.kaydir !== 0) {
          deneme++;
          kap.scrollBy({ top: s.kaydir, behavior: "instant" });
        } else deneme = 2;
      }
      setYer((o) => (o !== null && o.left === s.left && o.top === s.top && o.width === s.width ? o : { left: s.left, top: s.top, width: s.width }));
    };
    olc();
    const id = window.setInterval(olc, 300);
    const vv = window.visualViewport;
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => olc());
    if (kart.current !== null) ro?.observe(kart.current);
    window.addEventListener("resize", olc);
    window.addEventListener("scroll", olc, true);
    vv?.addEventListener("resize", olc);
    vv?.addEventListener("scroll", olc);
    return () => {
      window.clearInterval(id);
      ro?.disconnect();
      window.removeEventListener("resize", olc);
      window.removeEventListener("scroll", olc, true);
      vv?.removeEventListener("resize", olc);
      vv?.removeEventListener("scroll", olc);
    };
  }, [kart, acik, anahtar]);
  if (yer === null) return { left: 12, bottom: 136 };
  return { left: yer.left, top: yer.top, right: "auto", bottom: "auto", ...(yer.width === null ? {} : { width: yer.width }) };
}
