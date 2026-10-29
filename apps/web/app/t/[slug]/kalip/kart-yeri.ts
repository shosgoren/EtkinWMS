// T-1130 (kullanıcı 29 Ekim: "rehber yine ilgili alanın üstünde kalmış; başka yerlerde varsa hepsini düzelt"): rehber kartının yeri — üç
// rehberin (kurulum yolculuğu, işlem rehberi, adım adım aktarma rehberi) ortak, saf işlevi. Kart, kullanıcıya yaptırdığı yeri (alan, düğme)
// hiçbir görünümde örtmez: telefonda kart tam genişliktir, seçim üst ya da alttır (alt çubuğun üstü); masaüstünde dört köşe. Hiçbir yer boş
// değilse hedef kaydırılır (gereken en az kaydırma), kart ile hedef görünen alana birlikte sığar. Telefon klavyesi açılınca görünen alan
// (`visualViewport`) küçülür; hesap o alana göredir. DOM okumaz (birim testli); ölçüm ve kaydırma `rehber-hedef.ts` `useKartYeri`.

export interface Kutu {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Kartın örtmemesi gereken yer. `sabit`: sayfa kaydırılınca yer değiştirmez (alt çubuğun ana işlemi, üst çubuk düğmesi). */
export interface KartHedef extends Kutu {
  readonly sabit?: boolean;
}

export interface KartYeriGirdi {
  /** Görünüm genişliği. */
  readonly vw: number;
  /** Görünen alan (yerleşim koordinatlarında; klavye açıkken küçülür). */
  readonly gorunur: { readonly ust: number; readonly yukseklik: number };
  /** Görünen alanın altından ayrılan pay (alt çubuk; klavyenin altında kaldıysa 0). */
  readonly altCubuk: number;
  /** Örtülmeyecek yerler (öncelikli: hepsi). */
  readonly hedefler: readonly KartHedef[];
  /** Hepsi sığmıyorsa örtülmeyecek dar küme (ör. odaktaki alan + ana işlem); boşsa `hedefler` kullanılır. */
  readonly dar?: readonly KartHedef[];
  readonly kart: { readonly w: number; readonly h: number };
  /** Telefon (< 700 px): kart tam genişlik, yalnız üst/alt. */
  readonly telefon: boolean;
  /** İzin verilen kaydırma aralığı (px, artı = sayfa aşağı kayar, içerik yukarı çıkar). Kaydırma istenmiyorsa { min: 0, max: 0 }. */
  readonly kaydirma: { readonly min: number; readonly max: number };
}

export interface KartYeriSonuc {
  readonly left: number;
  readonly top: number;
  /** Telefonda kart genişliği; masaüstünde kartın kendi genişliği kalır (null). */
  readonly width: number | null;
  /** Hedefin görünür ve örtülmemiş olması için gereken kaydırma (0: gerekmez). */
  readonly kaydir: number;
  /** Kaydırmadan sonra bile kalan örtüşme alanı (0 beklenir). */
  readonly ortusme: number;
}

export const KART_KENAR = 12;
/** Kart ile hedef arasındaki en az boşluk. */
export const KART_ARA = 10;

interface Aralik {
  readonly a: number;
  readonly b: number;
}

function kesis(x: readonly Aralik[], y: Aralik): Aralik[] {
  return x.map((r) => ({ a: Math.max(r.a, y.a), b: Math.min(r.b, y.b) })).filter((r) => r.a <= r.b);
}

/** Aralıklarda sıfıra en yakın değer; aralık yoksa null. */
function sifiraYakin(x: readonly Aralik[]): number | null {
  let iyi: number | null = null;
  for (const r of x) {
    const v = Math.min(Math.max(0, r.a), r.b);
    if (iyi === null || Math.abs(v) < Math.abs(iyi)) iyi = v;
  }
  return iyi;
}

function ortusmeAlani(a: Kutu, b: Kutu): number {
  return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
}

function birlesim(k: readonly Kutu[]): Kutu | null {
  if (k.length === 0) return null;
  const x = Math.min(...k.map((r) => r.x));
  const y = Math.min(...k.map((r) => r.y));
  const r = Math.max(...k.map((q) => q.x + q.w));
  const b = Math.max(...k.map((q) => q.y + q.h));
  return { x, y, w: r - x, h: b - y };
}

interface Aday {
  readonly kutu: Kutu;
  readonly sira: number;
}

interface Puan {
  readonly aday: Aday;
  /** 0: tam (örtmez, hedef görünür) · 1: örtmez ama hedef tam görünmez · 2: örtüşme kaçınılmaz. */
  readonly kat: number;
  readonly sabitOrtusme: number;
  readonly ortusme: number;
  readonly kaydir: number;
  readonly pay: number;
}

function puanla(aday: Aday, hedefler: readonly KartHedef[], g: KartYeriGirdi): Puan {
  const c = aday.kutu;
  const sabit = hedefler.filter((h) => h.sabit === true);
  const kayan = hedefler.filter((h) => h.sabit !== true);
  const sabitOrtusme = sabit.reduce((t, h) => t + ortusmeAlani(c, h), 0);
  const u = birlesim(kayan);
  if (u === null) return { aday, kat: 0, sabitOrtusme, ortusme: 0, kaydir: 0, pay: Infinity };
  const vTop = g.gorunur.ust;
  const vBot = g.gorunur.ust + g.gorunur.yukseklik - g.altCubuk;
  const izin: Aralik = { a: Math.min(0, g.kaydirma.min), b: Math.max(0, g.kaydirma.max) };
  // Kart ile yatayda kesişiyorsa hedef kartın altında ya da üstünde kalmalı.
  const yatay = Math.min(c.x + c.w, u.x + u.w) - Math.max(c.x, u.x) > 0;
  const ortmez: Aralik[] = yatay
    ? [
        { a: -Infinity, b: u.y - c.y - c.h - KART_ARA },
        { a: u.y + u.h - c.y + KART_ARA, b: Infinity },
      ]
    : [{ a: -Infinity, b: Infinity }];
  const gorunurAralik: Aralik = { a: u.y + u.h - vBot, b: u.y - vTop };
  const tam = sifiraYakin(kesis(kesis(ortmez, izin), gorunurAralik));
  // Hedefin ne kadar boş yeri kaldığı (eşitlikte daha geniş taraf seçilir).
  const payOf = (dy: number): number => (yatay ? Math.max(c.y - (u.y + u.h - dy), u.y - dy - (c.y + c.h)) : Infinity);
  if (tam !== null) return { aday, kat: 0, sabitOrtusme, ortusme: 0, kaydir: tam, pay: payOf(tam) };
  const ortmeyen = sifiraYakin(kesis(ortmez, izin));
  if (ortmeyen !== null) return { aday, kat: 1, sabitOrtusme, ortusme: 0, kaydir: ortmeyen, pay: payOf(ortmeyen) };
  // Örtüşme kaçınılmaz: hedefi görünür alana getiren en az kaydırma, kalan örtüşme ölçülür.
  const dy = sifiraYakin(kesis([izin], gorunurAralik)) ?? 0;
  return { aday, kat: 2, sabitOrtusme, ortusme: ortusmeAlani(c, { ...u, y: u.y - dy }), kaydir: dy, pay: -Infinity };
}

function daha(a: Puan, b: Puan, telefon: boolean): boolean {
  if (a.sabitOrtusme > 0 !== b.sabitOrtusme > 0) return a.sabitOrtusme === 0;
  if (a.kat !== b.kat) return a.kat < b.kat;
  if (a.ortusme !== b.ortusme) return a.ortusme < b.ortusme;
  if (a.sabitOrtusme !== b.sabitOrtusme) return a.sabitOrtusme < b.sabitOrtusme;
  if (Math.abs(a.kaydir) !== Math.abs(b.kaydir)) return Math.abs(a.kaydir) < Math.abs(b.kaydir);
  // Telefonda (yalnız üst/alt) hedefe göre daha geniş boşluk kalan taraf; masaüstünde köşe sırası (sol alt önce) korunur.
  if (telefon && a.pay !== b.pay) return a.pay > b.pay;
  return a.aday.sira < b.aday.sira;
}

function adaylar(g: KartYeriGirdi): { liste: Aday[]; width: number | null } {
  const genislik = g.telefon ? Math.max(0, g.vw - KART_KENAR * 2) : Math.min(g.kart.w, Math.max(0, g.vw - KART_KENAR * 2));
  const h = g.kart.h;
  const ust = g.gorunur.ust + KART_KENAR;
  const alt = Math.max(ust, g.gorunur.ust + g.gorunur.yukseklik - g.altCubuk - KART_KENAR - h);
  const sag = g.vw - KART_KENAR - genislik;
  const k = (x: number, y: number, sira: number): Aday => ({ kutu: { x, y, w: genislik, h }, sira });
  if (g.telefon) return { liste: [k(KART_KENAR, alt, 0), k(KART_KENAR, ust, 1)], width: genislik };
  return { liste: [k(KART_KENAR, alt, 0), k(sag, alt, 1), k(KART_KENAR, ust, 2), k(sag, ust, 3)], width: null };
}

function sec(g: KartYeriGirdi, hedefler: readonly KartHedef[]): Puan {
  const { liste } = adaylar(g);
  let iyi: Puan | null = null;
  for (const a of liste) {
    const p = puanla(a, hedefler, g);
    if (iyi === null || daha(p, iyi, g.telefon)) iyi = p;
  }
  return iyi!;
}

/**
 * Kartın yeri: önce bütün hedefler için örtmeyen (gerekirse kaydırmalı) yer aranır; olmazsa dar küme (odaktaki alan + ana işlem) için.
 * Sonuç `position: fixed` için `left`/`top` (yerleşim koordinatları) ve uygulanacak kaydırmadır.
 */
export function kartYeriHesapla(g: KartYeriGirdi): KartYeriSonuc {
  const { width } = adaylar(g);
  let p = sec(g, g.hedefler);
  if ((p.kat > 0 || p.sabitOrtusme > 0) && g.dar !== undefined && g.dar.length > 0) {
    const d = sec(g, g.dar);
    if (d.kat < p.kat || (d.kat === p.kat && d.ortusme + d.sabitOrtusme < p.ortusme + p.sabitOrtusme)) p = d;
  }
  return { left: p.aday.kutu.x, top: p.aday.kutu.y, width, kaydir: Math.round(p.kaydir), ortusme: p.ortusme + p.sabitOrtusme };
}
