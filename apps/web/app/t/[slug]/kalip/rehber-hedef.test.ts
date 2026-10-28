// T-1124: rehber kartı deliği (yapılacak yeri) örtmez — köşe seçimi saf işlevdir.
import { describe, expect, it } from "vitest";
import { kartYeri } from "./rehber-hedef.ts";

describe("rehber kartının yeri (T-1124)", () => {
  it("delik yoksa ya da sol alt boşsa varsayılan sol alt (alt çubuğun üstü)", () => {
    expect(kartYeri([], 1280, 800, 360, 180)).toEqual({ left: 12, bottom: 136 });
    expect(kartYeri([{ x: 400, y: 100, w: 400, h: 200 }], 1280, 800, 360, 180)).toEqual({ left: 12, bottom: 136 });
  });

  it("telefonda ortadaki alan altta kartın altında kalacaksa kart üste geçer", () => {
    // 393×727: kart sol altta y 411…591; alan 300…460 → örtüşür; sağ alt da örtüşür (tam genişlik) → sol üst.
    expect(kartYeri([{ x: 10, y: 300, w: 373, h: 160 }], 393, 727, 369, 180)).toEqual({ left: 12, top: 12 });
  });

  it("geniş ekranda sol alttaki alan için sağ alt seçilir; her yer doluysa en az örtüşen", () => {
    expect(kartYeri([{ x: 0, y: 400, w: 500, h: 300 }], 1280, 800, 360, 180)).toEqual({ right: 12, bottom: 136 });
    const yer = kartYeri([{ x: 0, y: 0, w: 1280, h: 700 }], 1280, 800, 360, 180);
    expect(yer).toEqual({ left: 12, bottom: 136 });
  });
});
