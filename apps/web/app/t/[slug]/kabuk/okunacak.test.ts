import { describe, expect, it } from "vitest";
import { okunacak } from "./okunacak.ts";

describe("okunacak (T-1109)", () => {
  it("ayraç noktası virgül, tırnaklar düşer, boşluk sadeleşir", () => {
    expect(okunacak("Raf A-3 · 2 ürün")).toBe("Raf A-3, 2 ürün");
    expect(okunacak("Anladım. ‘ONAYLA’ DE · ‘DÜZELT’ DE")).toBe("Anladım. ONAYLA DE, DÜZELT DE");
    expect(okunacak("  Anlayamadım: “beş  koli”  ")).toBe("Anlayamadım: beş koli");
  });
});
