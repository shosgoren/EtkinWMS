// T-1116 (STANDART §3 "Stok ve yer", kaynak `docs/design/source/StandartUrunKartiStok.dc.html`): katlanır pivotun SAF gruplama
// yardımcısı. Her girdi bir yol (ör. Depo › Raf yeri › Lot › Palet › Koli) ve o yolun sonundaki miktardır; aynı yol adımı (tür + kimlik)
// tek düğümde birleşir, her düğüm altındakilerin toplamını taşır. Miktarlar decimal DİZGİDİR (I-09): `sumDecimal` ile kayan noktasız
// toplanır. Kendi miktarı da çocukları da olan düğüme (ör. raf yerinde paketsiz stok + paketler) "gevşek" bir çocuk eklenir; böylece
// her seviyenin toplamı çocuklarının toplamına eşit kalır. Görünüm `pivot.tsx`.
import { sumDecimal } from "./format.ts";

export interface PivotAdim {
  /** Seviye türü (ör. `depo`, `raf`, `lot`, `palet`, `koli`); simge/renk ve sayım bu ada göre. */
  readonly tur: string;
  /** Kaydın kimliği (aynı tür içinde tekil). */
  readonly id: string;
  readonly etiket: string;
  /** Satır altı küçük yazı (ör. "üretim 12.10.2026"); verilmezse çocuk sayısından türetilmez, boş kalır. */
  readonly meta?: string;
  /** Son kullanma tarihi (SKT) gösterimi; yalnız lot seviyesinde. */
  readonly skt?: string | null;
}

export interface PivotGirdi {
  readonly yol: readonly PivotAdim[];
  readonly miktar: string;
  readonly ayrilmis?: string;
  /** Yaprağın durumu (ör. `AVAILABLE`); aynı düğümde birden çok durum olabilir. */
  readonly durum?: string;
}

export interface PivotDugum {
  /** Kökten bu düğüme yol anahtarı (aç/kapat durumu için tekil). */
  readonly anahtar: string;
  readonly tur: string;
  readonly id: string;
  readonly etiket: string;
  readonly meta: string | null;
  readonly skt: string | null;
  readonly derinlik: number;
  readonly miktar: string;
  readonly ayrilmis: string;
  readonly durumlar: readonly string[];
  readonly cocuklar: readonly PivotDugum[];
}

interface Yapim {
  anahtar: string;
  adim: PivotAdim;
  derinlik: number;
  kendi: string[];
  ayrilmis: string[];
  durumlar: Set<string>;
  cocuklar: Map<string, Yapim>;
}

const ZERO = "0.000000";
const sifirMi = (v: string): boolean => /^-?0*(\.0*)?$/.test(v.trim());

function bitir(y: Yapim, gevsek: (ust: PivotAdim) => PivotAdim): PivotDugum {
  const cocuklar = [...y.cocuklar.values()].map((c) => bitir(c, gevsek));
  const kendi = sumDecimal(y.kendi);
  const kendiAyrilmis = sumDecimal(y.ayrilmis);
  const durumlar = [...y.durumlar].sort();
  if (cocuklar.length > 0 && (!sifirMi(kendi) || !sifirMi(kendiAyrilmis))) {
    const a = gevsek(y.adim);
    cocuklar.push({
      anahtar: `${y.anahtar}/${a.tur}:${a.id}`,
      tur: a.tur,
      id: a.id,
      etiket: a.etiket,
      meta: a.meta ?? null,
      skt: a.skt ?? null,
      derinlik: y.derinlik + 1,
      miktar: kendi,
      ayrilmis: kendiAyrilmis,
      durumlar,
      cocuklar: [],
    });
  }
  return {
    anahtar: y.anahtar,
    tur: y.adim.tur,
    id: y.adim.id,
    etiket: y.adim.etiket,
    meta: y.adim.meta ?? null,
    skt: y.adim.skt ?? null,
    derinlik: y.derinlik,
    miktar: cocuklar.length === 0 ? kendi : sumDecimal(cocuklar.map((c) => c.miktar)),
    ayrilmis: cocuklar.length === 0 ? kendiAyrilmis : sumDecimal(cocuklar.map((c) => c.ayrilmis)),
    durumlar: cocuklar.length === 0 ? durumlar : [],
    cocuklar,
  };
}

/**
 * Girdileri ağaca çevirir; sıra girdilerin geliş sırasıdır (sunucu sıralar). `gevsek(ust)` kendi miktarı olan ara düğüme eklenecek
 * çocuğun adımını verir (ör. raf yerinde "paketsiz"). Boş yollu girdi yok sayılır.
 */
export function pivotAgaci(girdiler: readonly PivotGirdi[], gevsek: (ust: PivotAdim) => PivotAdim): PivotDugum[] {
  const kok = new Map<string, Yapim>();
  for (const g of girdiler) {
    if (g.yol.length === 0) continue;
    let duzey = kok;
    let ust = "";
    let son: Yapim | undefined;
    g.yol.forEach((adim, i) => {
      const k = `${adim.tur}:${adim.id}`;
      const anahtar = ust === "" ? k : `${ust}/${k}`;
      let y = duzey.get(k);
      if (y === undefined) {
        y = { anahtar, adim, derinlik: i, kendi: [], ayrilmis: [], durumlar: new Set(), cocuklar: new Map() };
        duzey.set(k, y);
      }
      son = y;
      ust = anahtar;
      duzey = y.cocuklar;
    });
    const yaprak = son as Yapim | undefined;
    if (yaprak === undefined) continue;
    yaprak.kendi.push(g.miktar);
    yaprak.ayrilmis.push(g.ayrilmis ?? ZERO);
    if (g.durum !== undefined) yaprak.durumlar.add(g.durum);
  }
  return [...kok.values()].map((y) => bitir(y, gevsek));
}

/** Tür başına farklı kayıt sayısı (alt toplam şeridi: "2 depo · 5 raf yeri · 2 lot …"). */
export function pivotSayilari(kokler: readonly PivotDugum[]): ReadonlyMap<string, number> {
  const goruldu = new Map<string, Set<string>>();
  const gez = (d: PivotDugum): void => {
    const s = goruldu.get(d.tur) ?? new Set<string>();
    s.add(d.id);
    goruldu.set(d.tur, s);
    d.cocuklar.forEach(gez);
  };
  kokler.forEach(gez);
  return new Map([...goruldu.entries()].map(([t, s]) => [t, s.size]));
}

/** Bir düğümün altındaki tür başına farklı kayıt sayısı (satır altı yazı: "4 raf yeri · 2 lot"). */
export function altSayilari(d: PivotDugum): ReadonlyMap<string, number> {
  return pivotSayilari(d.cocuklar);
}

/** Çocuğu olan bütün düğümlerin anahtarları ("Hepsini aç"). */
export function acilabilirler(kokler: readonly PivotDugum[]): string[] {
  const out: string[] = [];
  const gez = (d: PivotDugum): void => {
    if (d.cocuklar.length > 0) out.push(d.anahtar);
    d.cocuklar.forEach(gez);
  };
  kokler.forEach(gez);
  return out;
}

/** Görünür satırlar: kapalı düğümün altı atlanır (derinlik sırasıyla düz liste). */
export function gorunurSatirlar(kokler: readonly PivotDugum[], acik: ReadonlySet<string>): PivotDugum[] {
  const out: PivotDugum[] = [];
  const gez = (d: PivotDugum): void => {
    out.push(d);
    if (acik.has(d.anahtar)) d.cocuklar.forEach(gez);
  };
  kokler.forEach(gez);
  return out;
}
