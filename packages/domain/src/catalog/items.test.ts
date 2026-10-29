// T-911: kart türü ve tür önekli ürün kodu (saf kurallar; DB'siz).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AppError } from "@wms/shared/errors";
import { CODE_SUGGEST_DEFAULTS, formatSuggestedCode, parsePrefix, suggestedCodePrefix } from "./code-suggest.ts";
import { DEFAULT_CARD_TYPE, ITEM_CARD_TYPES, ITEM_FIXED_USAGES, parseCardType } from "./items.ts";
import { STANDARD_UNITS } from "./units.ts";

describe("kart türü (T-911)", () => {
  it("dört standart tür, varsayılan TM; sıra ekrandaki sıra", () => {
    expect([...ITEM_CARD_TYPES]).toEqual(["HM", "YM", "MM", "TM"]);
    expect(DEFAULT_CARD_TYPE).toBe("TM");
    for (const t of ITEM_CARD_TYPES) expect(parseCardType(t)).toBe(t);
  });
  it("bilinmeyen/küçük harf/boş tür VALIDATION_FAILED", () => {
    for (const bad of ["hm", "AM", "", null, undefined, 1, "HM "]) {
      expect(() => parseCardType(bad)).toThrow(AppError);
    }
  });
});

describe("tür önekli ürün kodu (T-911)", () => {
  it("ürün kodu 6 haneli; önek kart türü (HM-000001), varsayılan tür TM", () => {
    expect(CODE_SUGGEST_DEFAULTS.item).toEqual({ prefix: "TM", width: 6 });
    expect(formatSuggestedCode("HM", 1, 6)).toBe("HM-000001");
    expect(formatSuggestedCode("MM", 123456, 6)).toBe("MM-123456");
    expect(formatSuggestedCode("YM", 1234567, 6)).toBe("YM-1234567"); // taşma: dolgu kısaltmaz
    expect(parsePrefix("item", "hm")).toBe("HM");
    expect(parsePrefix("item", undefined)).toBe("TM");
  });
  it("önerilen biçim tanınır; eski 4 haneli biçim artık önerilen sayılmaz (sessiz yeniden deneme yok)", () => {
    expect(suggestedCodePrefix("item", "HM-000001")).toBe("HM");
    expect(suggestedCodePrefix("item", "URN-0001")).toBeNull();
    expect(suggestedCodePrefix("item", "HM-1")).toBeNull();
  });
});

describe("standart birimler (T-911)", () => {
  it("on birim, kodlar benzersiz ve büyük harf, ADET ilk sırada", () => {
    const codes = STANDARD_UNITS.map((u) => u.code);
    expect(codes).toEqual(["ADET", "KG", "GR", "MT", "CM", "LT", "M2", "M3", "KOLI", "PALET"]);
    expect(new Set(codes).size).toBe(codes.length);
    for (const u of STANDARD_UNITS) {
      expect(u.code).toBe(u.code.toUpperCase());
      expect(u.name.trim()).not.toBe("");
    }
  });
});

describe("sabit alan kullanım kodları (T-1129)", () => {
  it("domain listesi 0065 `item_fixed_usage` fonksiyonunun döndürdüğü kodlarla birebir (kayma yok)", () => {
    const up = readFileSync(new URL("../../../db/migrations/0065_item_fixed_fields.up.sql", import.meta.url), "utf8");
    const fn = up.slice(up.indexOf("CREATE FUNCTION public.item_fixed_usage"), up.indexOf("REVOKE ALL ON FUNCTION public.item_fixed_usage"));
    const codes = [...fn.matchAll(/RETURN '([A-Z]+)'/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(0);
    expect([...new Set(codes)].sort()).toEqual([...ITEM_FIXED_USAGES].sort());
  });
});
