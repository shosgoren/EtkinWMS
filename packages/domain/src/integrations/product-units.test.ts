import { describe, expect, it } from "vitest";
import { productQuantityScale, unitCodeFor } from "./apply.ts";

describe("Paraşüt ürün birimi", () => {
  it.each([["Kg", "KG"], ["KGM", "KG"], ["m²", "M2"], ["m³", "M3"], ["PCS", "ADET"], ["Ad.", "ADET"]])("%s doğru boyutu korur", (raw, expected) => {
    expect(unitCodeFor(raw)).toBe(expected);
  });
  it.each([null, "", "Varil", "bilinmiyor"])("%s için birim uydurmaz", (raw) => {
    expect(unitCodeFor(raw)).toBeNull();
  });
  it.each(["KG", "GR", "MT", "CM", "LT", "M2", "M3"])("%s küsuratı korur", (code) => {
    expect(productQuantityScale(code)).toBe(6);
  });
  it.each(["ADET", "KOLI", "PALET"])("%s tam sayıdır", (code) => {
    expect(productQuantityScale(code)).toBe(0);
  });
});
