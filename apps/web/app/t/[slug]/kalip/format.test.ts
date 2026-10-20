import { describe, expect, it } from "vitest";
import { fmtQty, stockTone, sumDecimal } from "./format.ts";

describe("fmtQty (decimal dizgi, kayan nokta yok)", () => {
  it("sondaki sıfırları atar, binlik ayırır", () => {
    expect(fmtQty("1240.000000")).toBe("1.240");
    expect(fmtQty("1240.500000")).toBe("1.240,5");
    expect(fmtQty("1240.5", "en")).toBe("1,240.5");
    expect(fmtQty("0.000000")).toBe("0");
    expect(fmtQty("-80.000000")).toBe("−80");
    expect(fmtQty("12345678901234.123456")).toBe("12.345.678.901.234,123456");
  });
});

describe("stockTone", () => {
  it("minimum yoksa sakin, %35 altı kritik, minimum altı azaldı", () => {
    expect(stockTone("10", null)).toBe("ok");
    expect(stockTone("100", "500")).toBe("crit");
    expect(stockTone("300", "500")).toBe("low");
    expect(stockTone("500", "500")).toBe("ok");
  });
});

describe("sumDecimal", () => {
  it("kayan noktasız toplar", () => {
    expect(sumDecimal(["0.1", "0.2"])).toBe("0.300000");
    expect(sumDecimal(["520.000000", "340.000000", "-80.5"])).toBe("779.500000");
    expect(sumDecimal([])).toBe("0.000000");
  });
});
