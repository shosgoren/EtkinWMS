import { describe, expect, it } from "vitest";
import { printCss, validPrintSettings } from "./print-settings.ts";
describe("configurable label printing", () => {
  it("packs labels on A4 without a forced page per label", () => {
    const css = printCss({ width: 80, height: 40, gap: 3, mode: "a4" });
    expect(css).toContain("size:A4 portrait");expect(css).toContain("flex-wrap:wrap");expect(css).not.toContain("break-after:page;");
  });
  it("uses the requested thermal media dimensions", () => {
    const css = printCss({ width: 100, height: 50, gap: 0, mode: "label" });
    expect(css).toContain("size:100mm 50mm");expect(css).toContain("break-after:page");
  });
  it("rejects nonfinite, out-of-range and A4 overflow sizes", () => {
    for (const width of [NaN, Infinity, -1, 0, 201]) expect(validPrintSettings({ width, height: 50, gap: 2, mode: "a4" })).toBe(false);
    expect(() => printCss({ width: 200, height: 50, gap: 2, mode: "a4" })).toThrow(RangeError);
    expect(validPrintSettings({ width: 100, height: 281, gap: 2, mode: "label" })).toBe(false);
  });
});
