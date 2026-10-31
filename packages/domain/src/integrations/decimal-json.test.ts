// T-1135 (I-09): ondalık metin JSON'a float aritmetiği olmadan gider; 6 ondalık ve 20 basamaklı değerler birebir korunur.
import { describe, expect, it } from "vitest";
import { canonicalDecimal, jsonDecimal } from "./decimal-json.ts";

describe("canonicalDecimal", () => {
  it.each([
    ["3", "3"],
    ["3.000000", "3"],
    ["0.000001", "0.000001"],
    ["-0.500000", "-0.5"],
    ["0000.10", "0.1"],
    ["-0", "0"],
    ["-0.000000", "0"],
    ["123456789.123456", "123456789.123456"],
    ["99999999999999.999999", "99999999999999.999999"],
    [" 12.5 ", "12.5"],
  ])("%s → %s", (raw, canon) => {
    expect(canonicalDecimal(raw)).toBe(canon);
  });
  it.each(["", "1e5", "1.2345678", "123456789012345", "+1", "--1", "1,5", "abc", "1.", ".5", "NaN"])("reddedilir: %j", (raw) => {
    expect(() => canonicalDecimal(raw)).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED", detail: "QUANTITY_SCALE" }));
  });
});

describe("jsonDecimal", () => {
  it("rawJSON varsa JSON gövdesinde kanonik metin birebir yazılır (20 basamak dahil)", () => {
    expect(typeof (JSON as unknown as { rawJSON?: unknown }).rawJSON).toBe("function");
    const body = JSON.stringify({ q: jsonDecimal("99999999999999.999999"), z: jsonDecimal("3.000000"), m: jsonDecimal("0.000001") });
    expect(body).toBe('{"q":99999999999999.999999,"z":3,"m":0.000001}');
  });
  it("rawJSON yoksa yalnız kayıpsız Number kabul edilir; kayıp olan reddedilir (yuvarlama yok)", () => {
    expect(JSON.stringify({ q: jsonDecimal("123456.654321", null) })).toBe('{"q":123456.654321}');
    expect(jsonDecimal("0.000001", null)).toBe(0.000001);
    expect(jsonDecimal("3.000000", null)).toBe(3);
    expect(() => jsonDecimal("99999999999999.999999", null)).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });
  it("hiçbir yolda metin olarak gitmez", () => {
    for (const v of ["1", "2.5", "0.000001"]) {
      expect(JSON.stringify({ q: jsonDecimal(v) })).not.toContain('"q":"');
      expect(JSON.stringify({ q: jsonDecimal(v, null) })).not.toContain('"q":"');
    }
  });
});
