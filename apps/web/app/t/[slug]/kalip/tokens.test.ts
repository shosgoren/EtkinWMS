import { describe, expect, it } from "vitest";
import { CARD_VISUAL } from "../items/card-visual.ts";
import { kdz, kdzOrtak } from "./tokens.ts";

describe("ortak kalıp renkleri", () => {
  it("formda bulunmayan Hammadde kahvesini kaynak rengiyle görünür tutar", () => {
    const color = CARD_VISUAL.HM.color;
    expect(() => kdz("dzf", color)).toThrow("kaynakta olmayan renk");
    expect(kdzOrtak(color)).toBe("var(--color-dz-x-ikfkbc, #8A5A12)");
  });

  it("mevcut tema belirtecini yedeğin önünde korur", () => {
    expect(kdzOrtak(CARD_VISUAL.YM.color)).toBe("var(--color-dz-x-gmelni, #6C4BD8)");
    expect(kdz("dzf", CARD_VISUAL.YM.color)).toBe("var(--color-dz-x-gmelni)");
  });

  it("saydam kaynak renklerinde geçerli rgba yedeği üretir", () => {
    expect(kdzOrtak("255,255,255,.14")).toBe("var(--color-dz-a-pppppp-be, rgba(255,255,255,.14))");
  });

  it("T-1117: kalıp kaynaklarında olmayan standart tuval rengi standart belirtecinden gelir", () => {
    expect(() => kdz("dzf", "C2702A")).toThrow("kaynakta olmayan renk");
    expect(kdzOrtak("C2702A")).toBe("var(--color-st-k-turuncu)");
  });

  it("kaynakta olmayan veya CSS içeren değerleri kabul etmez", () => {
    expect(() => kdzOrtak("123456")).toThrow("kaynakta olmayan renk");
    expect(() => kdzOrtak("FFFFFF); color: red")).toThrow("kaynakta olmayan renk");
  });
});
