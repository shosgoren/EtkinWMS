// T-1124 + T-1130: rehber kartı yapılacak yeri (deliği / alanı) örtmez — yer hesabı saf işlevdir (üç rehberin ortak işlevi).
import { describe, expect, it } from "vitest";
import { KART_ARA, kartYeriHesapla, kayanAtaSirasi, sabitZincir, type KartHedef, type KartYeriGirdi, type Kutu } from "./kart-yeri.ts";

const YOK = { min: 0, max: 0 };

function girdi(p: Partial<KartYeriGirdi> & { readonly hedefler: readonly KartHedef[] }): KartYeriGirdi {
  return { vw: 1280, gorunur: { ust: 0, yukseklik: 800 }, altCubuk: 96, kart: { w: 360, h: 180 }, telefon: false, kaydirma: YOK, ...p };
}

function kesisir(a: Kutu, b: Kutu): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Kartın kutusu ve kaydırmadan sonraki hedef: örtüşmez, hedef görünen alanda (alt çubuğun üstünde). */
function denetle(g: KartYeriGirdi, hedef: Kutu): void {
  const s = kartYeriHesapla(g);
  const kart = { x: s.left, y: s.top, w: s.width ?? g.kart.w, h: g.kart.h };
  const sonra = { ...hedef, y: hedef.y - s.kaydir };
  expect(s.ortusme).toBe(0);
  expect(kesisir(kart, sonra), `kart ${JSON.stringify(kart)} hedef ${JSON.stringify(sonra)}`).toBe(false);
  expect(sonra.y).toBeGreaterThanOrEqual(g.gorunur.ust);
  expect(sonra.y + sonra.h).toBeLessThanOrEqual(g.gorunur.ust + g.gorunur.yukseklik - g.altCubuk);
  expect(kart.y).toBeGreaterThanOrEqual(g.gorunur.ust);
  expect(kart.y + kart.h).toBeLessThanOrEqual(g.gorunur.ust + g.gorunur.yukseklik - g.altCubuk);
}

describe("rehber kartının yeri — masaüstü (T-1124 köşe sırası)", () => {
  it("delik yoksa ya da sol alt boşsa sol alt (alt çubuğun üstü)", () => {
    expect(kartYeriHesapla(girdi({ hedefler: [] }))).toMatchObject({ left: 12, top: 800 - 96 - 12 - 180, width: null, kaydir: 0 });
    expect(kartYeriHesapla(girdi({ hedefler: [{ x: 400, y: 100, w: 400, h: 200 }] }))).toMatchObject({ left: 12, kaydir: 0 });
  });

  it("sol alttaki alan için sağ alt; her köşe doluysa kaydırmayla örtmeyen yer", () => {
    expect(kartYeriHesapla(girdi({ hedefler: [{ x: 0, y: 400, w: 500, h: 300 }] }))).toMatchObject({ left: 1280 - 12 - 360, kaydir: 0 });
    const genis = { x: 0, y: 250, w: 1280, h: 200 };
    denetle(girdi({ hedefler: [genis], kaydirma: { min: -250, max: 600 } }), genis);
  });
});

const tel = (p: Partial<KartYeriGirdi> & { readonly hedefler: readonly KartHedef[] }): KartYeriGirdi =>
  girdi({ vw: 390, gorunur: { ust: 0, yukseklik: 844 }, altCubuk: 100, kart: { w: 366, h: 120 }, telefon: true, ...p });

describe("rehber kartının yeri — telefon (T-1130)", () => {

  it("kart tam genişlik; üstteki alan (\"Depo adı\") için kart altta, alt çubuğun üstünde", () => {
    const alan = { x: 16, y: 150, w: 358, h: 72 };
    const s = kartYeriHesapla(tel({ hedefler: [alan] }));
    expect(s).toMatchObject({ left: 12, width: 366, kaydir: 0, top: 844 - 100 - 12 - 120 });
    denetle(tel({ hedefler: [alan] }), alan);
  });

  it("alttaki alan için kart üstte; boşluk eşitse hedefe göre daha geniş taraf", () => {
    const alan = { x: 16, y: 600, w: 358, h: 72 };
    expect(kartYeriHesapla(tel({ hedefler: [alan] }))).toMatchObject({ top: 12, kaydir: 0 });
  });

  it("ortadaki alan iki tarafa da sığmıyorsa en az kaydırmayla kart ve alan birlikte görünür (390×660, kısa Safari)", () => {
    const g = { ust: 0, yukseklik: 660 };
    const alan = { x: 16, y: 120, w: 358, h: 330 };
    const s = kartYeriHesapla(tel({ gorunur: g, hedefler: [alan], kaydirma: { min: -400, max: 400 } }));
    expect(s.kaydir).not.toBe(0);
    denetle(tel({ gorunur: g, hedefler: [alan], kaydirma: { min: -400, max: 400 } }), alan);
    // Kaydırma yasaksa (kullanıcı kendi kaydırıyor) örtüşme en aza iner ama sayfa oynamaz.
    expect(kartYeriHesapla(tel({ gorunur: g, hedefler: [alan] })).kaydir).toBe(0);
  });

  it("klavye açık: görünen alan küçülür (alt çubuk klavyenin altında), kart odaktaki alanı örtmez", () => {
    const g = { ust: 0, yukseklik: 380 };
    const alan = { x: 16, y: 230, w: 358, h: 72 };
    const girdiK = tel({ gorunur: g, altCubuk: 0, hedefler: [alan], kaydirma: { min: -230, max: 300 } });
    const s = kartYeriHesapla(girdiK);
    expect(s.top + 120).toBeLessThanOrEqual(380);
    denetle(girdiK, alan);
  });

  it("görünen alan kaymışsa (iOS visualViewport.offsetTop) kart o alanın içinde kalır", () => {
    const g = { ust: 200, yukseklik: 380 };
    const alan = { x: 16, y: 230, w: 358, h: 72 };
    const girdiK = tel({ gorunur: g, altCubuk: 0, hedefler: [alan] });
    const s = kartYeriHesapla(girdiK);
    expect(s.top).toBeGreaterThanOrEqual(200);
    denetle(girdiK, alan);
  });

  it("uzun form deliği sığmaz: dar küme (odaktaki alan + KAYDET) örtülmez; KAYDET (alt çubuk, sabit) hiç örtülmez", () => {
    const form = { x: 0, y: 60, w: 390, h: 1100 };
    const ad = { x: 16, y: 140, w: 358, h: 74 };
    const kaydet = { x: 150, y: 760, w: 90, h: 84, sabit: true };
    const g = tel({ hedefler: [form, kaydet], dar: [ad, kaydet], kaydirma: { min: 0, max: 600 } });
    const s = kartYeriHesapla(g);
    denetle({ ...g, hedefler: [ad] }, ad);
    expect(kesisir({ x: s.left, y: s.top, w: 366, h: 120 }, kaydet)).toBe(false);
    expect(s.ortusme).toBe(0);
  });

  it("üst çubuktaki sabit hedef (ör. Ayarlar) için kart altta", () => {
    const ayar = { x: 330, y: 8, w: 44, h: 44, sabit: true };
    expect(kartYeriHesapla(tel({ hedefler: [ayar] })).top).toBeGreaterThan(400);
  });

  it("kart ile hedef arasında en az boşluk kalır", () => {
    const alan = { x: 16, y: 500, w: 358, h: 60 };
    const g = tel({ gorunur: { ust: 0, yukseklik: 660 }, hedefler: [alan], kaydirma: { min: -500, max: 500 } });
    const s = kartYeriHesapla(g);
    const sonra = alan.y - s.kaydir;
    const ara = s.top >= sonra + alan.h ? s.top - (sonra + alan.h) : sonra - (s.top + 120);
    expect(ara).toBeGreaterThanOrEqual(KART_ARA);
  });
});

describe("kalıp form ekranı: sabit kabuk içinde kayan içerik (T-1130, Codex P2)", () => {
  // Zincir öğeden köke: alan → label → form → .inner (overflow-y auto) → .app → .dzf (fixed) → body → html.
  const formAlani = [
    { konum: "static", tasma: "visible" },
    { konum: "relative", tasma: "visible" },
    { konum: "static", tasma: "visible" },
    { konum: "static", tasma: "auto" },
    { konum: "relative", tasma: "hidden" },
    { konum: "fixed", tasma: "visible" },
    { konum: "static", tasma: "visible" },
    { konum: "static", tasma: "visible" },
  ];
  const anaIslem = [
    { konum: "relative", tasma: "visible" },
    { konum: "static", tasma: "visible" },
    { konum: "fixed", tasma: "visible" },
    { konum: "static", tasma: "visible" },
  ];

  it("kayan .inner içindeki alan sabit değildir; alt çubuğun ana işlemi sabittir", () => {
    expect(sabitZincir(formAlani)).toBe(false);
    expect(sabitZincir(anaIslem)).toBe(true);
    expect(sabitZincir([{ konum: "static", tasma: "visible" }])).toBe(false);
    // Öğenin kendi taşması (kendi içinde kayan liste) onu sabit kabuktan ayırmaz.
    expect(sabitZincir([{ konum: "static", tasma: "auto" }, { konum: "fixed", tasma: "visible" }])).toBe(true);
  });

  it("kaydırılacak kap en yakın gerçekten taşan atadır (.inner); taşmayan kap atlanır", () => {
    const atalar = formAlani.slice(1).map((h, i) => ({ ...h, tasabilir: i === 2 }));
    expect(kayanAtaSirasi(atalar)).toBe(2);
    expect(kayanAtaSirasi(atalar.map((h) => ({ ...h, tasabilir: false })))).toBeNull();
  });

  it("klavye açık (görünen 390×380), form görünenden uzun, alan .inner'ın altında: kap kaydırılır, kart alanı örtmez", () => {
    const g = { ust: 0, yukseklik: 380 };
    const kap = { ust: 70, alt: 380 };
    const form = { x: 16, y: 80, w: 358, h: 900 };
    const alan = { x: 16, y: 600, w: 358, h: 74 };
    const girdiK = tel({ gorunur: g, altCubuk: 0, kap, hedefler: [form], dar: [alan], kaydirma: { min: 0, max: 500 } });
    const s = kartYeriHesapla(girdiK);
    expect(s.ortusme).toBe(0);
    expect(s.kaydir).toBeGreaterThan(0);
    const sonra = { ...alan, y: alan.y - s.kaydir };
    expect(kesisir({ x: s.left, y: s.top, w: 366, h: 120 }, sonra)).toBe(false);
    expect(sonra.y).toBeGreaterThanOrEqual(kap.ust);
    expect(sonra.y + sonra.h).toBeLessThanOrEqual(kap.alt);
    // Eski sınıflandırma (alan sabit kabuğun içinde diye sabit sayılırdı): kaydırma hesaplanmaz, alan klavyenin altında kalır.
    const eski = kartYeriHesapla({ ...girdiK, hedefler: [{ ...form, sabit: true }], dar: [{ ...alan, sabit: true }, { ...form, sabit: true }] });
    expect(eski.kaydir).toBe(0);
    expect(alan.y + alan.h).toBeGreaterThan(g.yukseklik);
  });
});
