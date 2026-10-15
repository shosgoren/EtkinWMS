// I-18 mekanik bekçisi (docs/design/DESIGN-PARITY.md §3, §7):
// 1. Üretilmiş CSS / belirteçler kaynakla aynı: `scripts/design/port.mjs --check` (kaynak sha256 denetimi dahil).
// 2. Uygulamadaki her tasarım ikon yolu kaynak dosyada birebir geçer (kütüphane ya da elle çizilmiş "benzer" ikon yok).
// 3. SOURCE.md kaydı ile üreteçteki sha256 aynı.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ICON } from "./design/bakis-icons.ts";

const repoRoot = join(import.meta.dirname, "../../..");
const source = readFileSync(join(repoRoot, "docs/design/source/Bakis.dc.html"), "utf8");

describe("I-18 tasarım birebir", () => {
  it("üretilmiş CSS ve belirteçler kaynaktan yeniden üretilenle bayt bayt aynı", () => {
    expect(() => execFileSync(process.execPath, [join(repoRoot, "scripts/design/port.mjs"), "--check"], { stdio: "pipe" })).not.toThrow();
  });

  it.each(Object.entries(ICON))("ikon %s kaynakta birebir geçer", (_k, d) => {
    expect(source.includes(`"${d}"`) || source.includes(`'${d}'`)).toBe(true);
  });

  it("SOURCE.md sha256 kaydı kaynak dosyayla aynı", () => {
    const sum = createHash("sha256").update(source).digest("hex");
    expect(readFileSync(join(repoRoot, "docs/design/source/SOURCE.md"), "utf8")).toContain(sum);
    expect(readFileSync(join(repoRoot, "scripts/design/port.mjs"), "utf8")).toContain(sum);
  });
});
