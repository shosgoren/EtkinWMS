// T-981b: dışa aktarma miktar biçimi (Türkçe içe aktarmayla geri okunur) ve raf türü ayrıştırma (dışa aktarma etiketleri geri tanınır).
import { describe, expect, it } from "vitest";
import { LOCATION_KIND_LABEL, trQuantity } from "./data-export.ts";
import { parseTrDecimal } from "./import-parse.ts";
import { parseLocationKind } from "./master-import.ts";

describe("T-981b dışa aktarma biçimi", () => {
  it("miktar: ondalık virgül, gruplama yok, sondaki sıfır yok; içe aktarma aynı değeri okur", () => {
    expect(trQuantity("12.000000")).toBe("12");
    expect(trQuantity("1250.500000")).toBe("1250,5");
    expect(trQuantity("1250")).toBe("1250");
    expect(trQuantity("0.125000")).toBe("0,125");
    for (const v of ["1250.5", "1234", "0.000001", "99999999999999.5"]) {
      const r = parseTrDecimal(trQuantity(v));
      expect(r.ok && r.text).toBe(v);
    }
  });

  it("raf türü: dışa aktarma etiketleri ve teknik kodlar geri tanınır; boş null; tanınmayan UNKNOWN", () => {
    for (const [code, label] of Object.entries(LOCATION_KIND_LABEL)) {
      expect(parseLocationKind(label)).toBe(code);
      expect(parseLocationKind(code)).toBe(code);
    }
    expect(parseLocationKind("  ")).toBeNull();
    expect(parseLocationKind(undefined)).toBeNull();
    expect(parseLocationKind("mal kabul")).toBe("RECEIVING");
    expect(parseLocationKind("çöp")).toBe("UNKNOWN");
  });
});
