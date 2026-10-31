// T-1095: adım adım aktarma rehberi planı — her rehber iki kaynakla (Excel / Paraşüt) uçtan uca gerçek ekran hedefleriyle tanımlı.
import { describe, expect, it } from "vitest";
import { ADIM_KAYNAKLARI, ADIM_REHBERLERI, ADIM_YETKI, adimPlani, isAdimKaynak, isAdimRehber } from "./adim-rehber-plan.ts";

describe("adım adım aktarma rehberi planı (T-1095)", () => {
  it("her rehber ve kaynak: adımlar dolu, hedef ve bitiş tanımlı; yollar /t/<alan> sonrası", () => {
    for (const r of ADIM_REHBERLERI) {
      for (const k of ADIM_KAYNAKLARI) {
        const p = adimPlani(r, k);
        expect(p.length, `${r}/${k}`).toBeGreaterThanOrEqual(3);
        for (const a of p) {
          expect(a.target).not.toBe("");
          expect(a.path.startsWith("/")).toBe(true);
          expect(Object.keys(a.done)).toHaveLength(1);
        }
      }
    }
  });

  it("Excel: Bağlantılar'da alan + İçeri al + ana düğme, sonra Aktar'da dosya → kontrol → bitti", () => {
    const p = adimPlani("cari", "EXCEL");
    expect(p.map((a) => a.key)).toEqual(["alan_cari", "iceri", "ana", "dosya", "kontrol", "uygula"]);
    expect(p[0]?.target).toContain('[data-option="parties"]');
    expect(p[2]?.done).toEqual({ path: "/import" });
    expect(p.at(-1)?.done).toEqual({ sel: '[data-testid="aktar-done"]' });
  });

  it("Paraşüt: bağlan → ilgili akışı aç → eşitle (ürün PRODUCTS, depo WAREHOUSES, cari CONTACTS)", () => {
    // T-1134: delik bütün akış satırında (yön grubu değil).
    expect(adimPlani("urun", "PARASUT")[1]?.target).toBe('[data-testid="flow-PRODUCTS"]');
    expect(adimPlani("depo", "PARASUT")[1]?.target).toBe('[data-testid="flow-WAREHOUSES"]');
    expect(adimPlani("cari", "PARASUT").at(-1)).toMatchObject({ key: "esitle", done: { click: true } });
    // T-1112: akış adımları "Ne çekilsin, gönderilsin" bölümünü açar.
    expect(adimPlani("urun", "PARASUT").slice(1).map((a) => a.query)).toEqual(["bolum=akis", "bolum=akis"]);
  });

  it("yetki kurulum adımıyla aynı; bilinmeyen değerler reddedilir", () => {
    expect(ADIM_YETKI).toEqual({ urun: "cards", depo: "shelves", cari: "parties" });
    expect(isAdimRehber("urun")).toBe(true);
    expect(isAdimRehber("stok")).toBe(false);
    expect(isAdimKaynak("PARASUT")).toBe(true);
    expect(isAdimKaynak("LOGO")).toBe(false);
  });
});
