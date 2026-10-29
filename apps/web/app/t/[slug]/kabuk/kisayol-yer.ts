// T-1131 (kullanıcı 29 Ekim: "yüzen simge tıklandığında ekrana sığmayan yerler var, düzenle kısmı sığmıyor"): şimşek halkasının yeri ve
// en büyük yüksekliği GÖRÜNÜR alandan (`visualViewport`, güvenli kenarlar) hesaplanır. Saf işlev; DOM okumaz (kisayol.tsx ölçer, burada karar).
//
// Kural: halka önce şimşeğin YANINA (sağ/sol, hangisinde yer çoksa) açılır; yanda yer yoksa ALTINA/ÜSTÜNE (hangisinde yer çoksa). Yükseklik
// kullanılabilir alanla sınırlanır; taşan kısayollar halkanın içinde kayar, Rehber + Düzenle alt şeritte hep görünür (kisayol.tsx).
// Tek sütun sığmıyorsa (dar telefonun ortasındaki şimşek, yatay telefon) iki sütunlu sıkı düzen daha çoğunu gösteriyorsa o seçilir.

export type Kutu = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
export type Kenar = { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
export type Olcu = { readonly w: number; readonly h: number };
export type HalkaYeri = {
  /** Halkanın açıldığı taraf (şimşeğe göre). `ust-uste`: hiçbir yanda yer yok, görünür alana sığdırıldı (şimşeğin üstüne binebilir). */
  readonly yan: "sag" | "sol" | "alt" | "ust" | "ust-uste";
  readonly left: number;
  readonly top: number;
  readonly width: number;
  /** Halkanın en büyük yüksekliği (doğal yükseklik daha büyükse liste içeride kayar). */
  readonly maxHeight: number;
  /** İki sütunlu sıkı düzen (kısayollar ve alt şerit ikişer yan yana). */
  readonly kompakt: boolean;
};

/** Görünür alan kenarından bırakılan boşluk (px). */
export const KENAR_BOSLUK = 8;
/** Şimşek ile halka arası (px). */
export const ARA = 10;
/**
 * Alttan/üstten açılırken bu yükseklikten az yer varsa (alt şerit + bir kısayol satırı sığmaz) halka görünür alana sığdırılır.
 * Alt şerit iki 54 px satır + aralık + çizgi + halkanın iç boşluğu ≈ 152; bir kısayol satırı daha ≈ 62.
 */
export const EN_AZ_YUKSEKLIK = 216;
/** Kaynak halka genişliği (pano.css `.halo` width). */
export const HALKA_GENISLIK = 220;
/** İki sütunlu sıkı düzenin genişliği (görünür alana göre daraltılır). */
export const KOMPAKT_GENISLIK = 360;

/**
 * Halkanın tek sütun ve iki sütun doğal ölçüsü, ölçülen parçalardan (düzenden bağımsız; açıkken düzen değişse de aynı sonuç).
 * @param n kısayol sayısı · `satirH` bir satırın yüksekliği · `ara` satır arası · `cerceve` halkanın iç boşluğu + kenar + liste/şerit arası ·
 *   `altEk` alt şeridin üst boşluğu + çizgisi. Alt şeritte iki öğe (Rehber, Düzenle).
 */
export function halkaOlculeri(p: { n: number; satirH: number; ara: number; cerceve: number; altEk: number }): { tek: Olcu; iki: Olcu } {
  const blok = (satir: number): number => (satir <= 0 ? 0 : satir * p.satirH + (satir - 1) * p.ara);
  return {
    tek: { w: HALKA_GENISLIK, h: p.cerceve + blok(p.n) + p.altEk + blok(2) },
    iki: { w: KOMPAKT_GENISLIK, h: p.cerceve + blok(Math.ceil(p.n / 2)) + p.altEk + blok(1) },
  };
}

const sinirla = (v: number, alt: number, ust: number): number => (ust < alt ? alt : Math.min(ust, Math.max(alt, v)));

/**
 * @param kompakt iki sütunlu düzenin doğal ölçüsü; verilirse ve tek sütun sığmıyorsa, daha büyük bölümünü gösteren düzen seçilir.
 */
export function halkaYeri(gorunur: Kutu, guvenli: Kenar, simsek: Kutu, dogal: Olcu, kompakt?: Olcu): HalkaYeri {
  const tek = yerlestir(gorunur, guvenli, simsek, dogal);
  if (kompakt === undefined || tek.maxHeight >= dogal.h) return { ...tek, kompakt: false };
  const iki = yerlestir(gorunur, guvenli, simsek, kompakt);
  const gorunen = (y: Omit<HalkaYeri, "kompakt">, o: Olcu): number => Math.min(1, y.maxHeight / o.h);
  return gorunen(iki, kompakt) > gorunen(tek, dogal) ? { ...iki, kompakt: true } : { ...tek, kompakt: false };
}

/**
 * @param gorunur görünür alan (`visualViewport`: offsetLeft/offsetTop/width/height; yoksa pencere iç ölçüsü)
 * @param guvenli güvenli kenarlar (çentik, ana ekran çubuğu)
 * @param simsek şimşek düğmesinin kutusu (`getBoundingClientRect`)
 * @param dogal halkanın kısıtsız (doğal) genişlik ve yüksekliği
 */
function yerlestir(gorunur: Kutu, guvenli: Kenar, simsek: Kutu, dogal: Olcu): Omit<HalkaYeri, "kompakt"> {
  const L = gorunur.x + guvenli.left + KENAR_BOSLUK;
  const R = gorunur.x + gorunur.w - guvenli.right - KENAR_BOSLUK;
  const T = gorunur.y + guvenli.top + KENAR_BOSLUK;
  const B = gorunur.y + gorunur.h - guvenli.bottom - KENAR_BOSLUK;
  const width = Math.max(0, Math.min(dogal.w, R - L));
  const tumYukseklik = Math.max(0, B - T);
  const s = { l: simsek.x, r: simsek.x + simsek.w, t: simsek.y, b: simsek.y + simsek.h, cy: simsek.y + simsek.h / 2 };

  // 1) Yana: dikeyde bütün görünür yükseklik kullanılabilir (halka şimşeğin yanında, üstüne binmez).
  const sagYer = R - (s.r + ARA);
  const solYer = s.l - ARA - L;
  if (Math.max(sagYer, solYer) >= width) {
    const sag = sagYer >= width && (sagYer >= solYer || solYer < width);
    const maxHeight = tumYukseklik;
    const h = Math.min(dogal.h, maxHeight);
    // Kaynaktaki gibi şimşeğin kenarına hizalı, ekranın yarısına göre yer çok olan yöne uzar; sonra görünür alana sıkıştırılır.
    const ortaAlti = s.cy > (T + B) / 2;
    const istenen = ortaAlti ? s.b - h : s.t;
    return { yan: sag ? "sag" : "sol", left: sag ? s.r + ARA : s.l - ARA - width, top: sinirla(istenen, T, B - h), width, maxHeight };
  }

  // 2) Alta / üste (dar ekranda şimşek ortadaysa): yer çok olan dikey taraf.
  const altYer = B - (s.b + ARA);
  const ustYer = s.t - ARA - T;
  const alta = altYer >= ustYer;
  const yer = alta ? altYer : ustYer;
  const left = sinirla(simsek.x + simsek.w / 2 - width / 2, L, R - width);
  if (yer >= Math.min(dogal.h, EN_AZ_YUKSEKLIK)) {
    const h = Math.min(dogal.h, yer);
    return { yan: alta ? "alt" : "ust", left, top: alta ? s.b + ARA : s.t - ARA - h, width, maxHeight: yer };
  }

  // 3) Hiçbir yanda yer yok (çok kısa ekran): görünür alana sığdır, şimşeğin dikey ortasına yakın.
  const h = Math.min(dogal.h, tumYukseklik);
  return { yan: "ust-uste", left, top: sinirla(s.cy - h / 2, T, B - h), width, maxHeight: tumYukseklik };
}
