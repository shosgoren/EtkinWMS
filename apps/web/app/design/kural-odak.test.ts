// T-1033 (ALTIN-KURAL 11, kullanıcı kararı 25 Ekim): tek, şık odak işareti. Eski "4 px sarı + iç koyu halka" geri gelmesin.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const kural = readFileSync(join(here, "kural.css"), "utf8");
const globals = readFileSync(join(here, "..", "globals.css"), "utf8");
const rule = (selector: string): string => {
  const start = kural.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`kural.css: ${selector} kuralı yok`);
  return kural.slice(start, kural.indexOf("}", start));
};

describe("odak işareti (ALTIN-KURAL 11)", () => {
  it("ortak kural köşeyi izleyen halkadır; dış çizgi kapalı", () => {
    const r = rule(":focus-visible");
    expect(r).toContain("outline: none !important");
    expect(r).toContain("var(--color-kr-focus)");
    expect(kural).not.toMatch(/outline:\s*4px solid var\(--color-kr-warn\)/);
  });

  it("yazı alanında halka alan kutusunda yanar, iç yazı alanında çizilmez", () => {
    expect(kural).toMatch(/:is\(\.inp,[^)]*\.fld[^)]*\):has\(:is\(input, textarea, select\):focus-visible\) \{\n\s*box-shadow: 0 0 0 2px var\(--color-kr-focus-gap\)/);
    expect(kural).toMatch(/:is\(\.inp,[^)]*\) :is\(input, textarea, select\):focus-visible \{\n\s*box-shadow: none !important/);
  });

  it("açık temada lacivert, koyu temada sarı belirteç", () => {
    expect(globals).toMatch(/--color-kr-focus: #172e42;/);
    expect(globals).toMatch(/html\[data-tema="koyu"\],\n\.dz-dark \{\n\s*--color-kr-focus: #f4c542;/);
  });
});
