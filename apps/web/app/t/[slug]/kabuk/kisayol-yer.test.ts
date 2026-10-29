// T-1131: şimşek halkası yerleşimi — görünür alan, güvenli kenar, şimşek kutusu ve doğal ölçüden taraf, konum ve en büyük yükseklik.
import { describe, expect, it } from "vitest";
import { ARA, EN_AZ_YUKSEKLIK, HALKA_GENISLIK, KENAR_BOSLUK, KOMPAKT_GENISLIK, halkaOlculeri, halkaYeri, type Kenar, type Kutu } from "./kisayol-yer.ts";

const sifir: Kenar = { top: 0, right: 0, bottom: 0, left: 0 };
const telefon: Kutu = { x: 0, y: 0, w: 390, h: 660 };
const simsek = (cx: number, cy: number): Kutu => ({ x: cx - 24, y: cy - 24, w: 48, h: 48 });
const halka = { w: 220, h: 512 };

/** Halka görünür alanın (kenar boşluğu dahil) içinde mi; şimşekle çakışıyor mu. */
function icinde(y: ReturnType<typeof halkaYeri>, g: Kutu, k: Kenar, dogalH: number): void {
  const h = Math.min(dogalH, y.maxHeight);
  expect(y.left).toBeGreaterThanOrEqual(g.x + k.left + KENAR_BOSLUK);
  expect(y.left + y.width).toBeLessThanOrEqual(g.x + g.w - k.right - KENAR_BOSLUK);
  expect(y.top).toBeGreaterThanOrEqual(g.y + k.top + KENAR_BOSLUK);
  expect(y.top + h).toBeLessThanOrEqual(g.y + g.h - k.bottom - KENAR_BOSLUK);
}
function cakismaz(y: ReturnType<typeof halkaYeri>, s: Kutu, dogalH: number): void {
  const h = Math.min(dogalH, y.maxHeight);
  const ayri = y.left >= s.x + s.w || y.left + y.width <= s.x || y.top >= s.y + s.h || y.top + h <= s.y;
  expect(ayri).toBe(true);
}

describe("halkaYeri", () => {
  it("sağ kenardaki şimşek: halka sola açılır, bütün görünür yükseklik kullanılabilir", () => {
    for (const cy of [40, 330, 600]) {
      const s = simsek(367, cy);
      const y = halkaYeri(telefon, sifir, s, halka);
      expect(y.yan).toBe("sol");
      expect(y.left + y.width).toBe(s.x - ARA);
      expect(y.maxHeight).toBe(660 - 2 * KENAR_BOSLUK);
      icinde(y, telefon, sifir, halka.h);
      cakismaz(y, s, halka.h);
    }
  });

  it("sol kenardaki şimşek: halka sağa açılır", () => {
    const s = simsek(24, 300);
    const y = halkaYeri(telefon, sifir, s, halka);
    expect(y.yan).toBe("sag");
    expect(y.left).toBe(s.x + s.w + ARA);
    icinde(y, telefon, sifir, halka.h);
  });

  it("şimşek aşağıdaysa halka şimşeğin alt kenarına hizalanır; yukarıdaysa üst kenarına", () => {
    const alt = halkaYeri({ x: 0, y: 0, w: 390, h: 900 }, sifir, simsek(367, 800), { w: 220, h: 300 });
    expect(alt.top + 300).toBe(824);
    const ust = halkaYeri({ x: 0, y: 0, w: 390, h: 900 }, sifir, simsek(367, 100), { w: 220, h: 300 });
    expect(ust.top).toBe(76);
  });

  it("kullanıcı bildirimi: ortadaki ve alttaki şimşekte halka ekrandan taşmaz (eski: aşağı/yukarı taşıyordu)", () => {
    for (const cy of [330, 560, 620]) {
      const y = halkaYeri(telefon, sifir, simsek(367, cy), halka);
      icinde(y, telefon, sifir, halka.h);
      expect(y.maxHeight).toBeGreaterThanOrEqual(halka.h);
    }
  });

  it("dar ekranın ortasındaki şimşek: yanda yer yok → yeri çok olan dikey tarafa, yatayda ortalı ve sınırlı", () => {
    const s = simsek(195, 200);
    const y = halkaYeri(telefon, sifir, s, halka);
    expect(y.yan).toBe("alt");
    expect(y.top).toBe(s.y + s.h + ARA);
    expect(y.maxHeight).toBe(660 - KENAR_BOSLUK - (224 + ARA));
    expect(y.left).toBe(85);
    icinde(y, telefon, sifir, halka.h);
    cakismaz(y, s, halka.h);
    const s2 = simsek(195, 500);
    const y2 = halkaYeri(telefon, sifir, s2, halka);
    expect(y2.yan).toBe("ust");
    expect(y2.top + Math.min(halka.h, y2.maxHeight)).toBe(s2.y - ARA);
    icinde(y2, telefon, sifir, halka.h);
    cakismaz(y2, s2, halka.h);
  });

  it("çok kısa ve dar ekran: dikeyde de yer yoksa görünür alana sığdırılır", () => {
    const g: Kutu = { x: 0, y: 0, w: 300, h: 330 };
    const y = halkaYeri(g, sifir, simsek(150, 165), halka);
    expect(y.yan).toBe("ust-uste");
    expect(y.maxHeight).toBe(330 - 2 * KENAR_BOSLUK);
    expect(EN_AZ_YUKSEKLIK).toBeGreaterThanOrEqual(152 + 62);
    icinde(y, g, sifir, halka.h);
  });

  it("güvenli kenarlar ve kaydırılmış görünür alan (klavye / yakınlaştırma) hesaba katılır", () => {
    const g: Kutu = { x: 0, y: 120, w: 390, h: 500 };
    const k: Kenar = { top: 47, right: 0, bottom: 34, left: 0 };
    const y = halkaYeri(g, k, simsek(367, 590), halka);
    expect(y.maxHeight).toBe(500 - 47 - 34 - 2 * KENAR_BOSLUK);
    icinde(y, g, k, halka.h);
  });

  it("halka görünür genişlikten genişse daraltılır", () => {
    const y = halkaYeri({ x: 0, y: 0, w: 200, h: 600 }, sifir, simsek(100, 300), halka);
    expect(y.width).toBe(200 - 2 * KENAR_BOSLUK);
    expect(y.left).toBe(KENAR_BOSLUK);
  });

  it("masaüstü: kısa halka şimşeğin yanında, doğal yükseklikte sığar", () => {
    const g: Kutu = { x: 0, y: 0, w: 1280, h: 800 };
    const y = halkaYeri(g, sifir, simsek(1203, 650), halka);
    expect(y.yan).toBe("sol");
    icinde(y, g, sifir, halka.h);
    expect(y.top + halka.h).toBe(674);
  });

  it("doğal ölçüler: 6 kısayol tek sütunda 8 satır, iki sütunda 3 + 1 satır", () => {
    const o = halkaOlculeri({ n: 6, satirH: 54, ara: 8, cerceve: 27, altEk: 9 });
    expect(o.tek).toEqual({ w: HALKA_GENISLIK, h: 27 + 6 * 54 + 5 * 8 + 9 + 2 * 54 + 8 });
    expect(o.iki).toEqual({ w: KOMPAKT_GENISLIK, h: 27 + 3 * 54 + 2 * 8 + 9 + 54 });
    expect(halkaOlculeri({ n: 0, satirH: 54, ara: 8, cerceve: 27, altEk: 9 }).tek.h).toBe(27 + 9 + 2 * 54 + 8);
  });

  it("sıkı düzen: dar telefonun ortasındaki şimşekte iki sütun hepsini kaydırmadan gösterir", () => {
    const o = halkaOlculeri({ n: 6, satirH: 54, ara: 8, cerceve: 27, altEk: 9 });
    const s = simsek(195, 330);
    const y = halkaYeri(telefon, sifir, s, o.tek, o.iki);
    expect(y.kompakt).toBe(true);
    expect(y.maxHeight).toBeGreaterThanOrEqual(o.iki.h);
    expect(y.width).toBe(KOMPAKT_GENISLIK);
    icinde(y, telefon, sifir, o.iki.h);
    cakismaz(y, s, o.iki.h);
  });

  it("sıkı düzen yalnız gerektiğinde: tek sütun yana sığıyorsa seçilmez", () => {
    const o = halkaOlculeri({ n: 6, satirH: 54, ara: 8, cerceve: 27, altEk: 9 });
    for (const cy of [40, 330, 620]) expect(halkaYeri(telefon, sifir, simsek(367, cy), o.tek, o.iki).kompakt).toBe(false);
  });

  it("yatay telefon (844×390): tek sütun sığmaz, iki sütun yanda daha çoğunu gösterir", () => {
    const g: Kutu = { x: 0, y: 0, w: 844, h: 390 };
    const o = halkaOlculeri({ n: 6, satirH: 54, ara: 8, cerceve: 27, altEk: 9 });
    const y = halkaYeri(g, sifir, simsek(793, 300), o.tek, o.iki);
    expect(y.kompakt).toBe(true);
    expect(y.yan).toBe("sol");
    expect(y.maxHeight).toBeGreaterThanOrEqual(o.iki.h);
    icinde(y, g, sifir, o.iki.h);
  });
});
