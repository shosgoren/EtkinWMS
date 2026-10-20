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
import { GICON } from "./design/giris-icons.ts";
import { YICON } from "./design/yonet-icons.ts";
import { PICON } from "./design/pano-icons.ts";
import { AICON } from "./design/aktar-icons.ts";
import { RICON } from "./design/gruplar-icons.ts";
import { EICON } from "./design/ekip-icons.ts";
import { KICON } from "./design/kabuk-icons.ts";
import { LICON } from "./design/kalip-icons.ts";
import { SICON } from "./design/saha-icons.ts";

const repoRoot = join(import.meta.dirname, "../../..");
const source = readFileSync(join(repoRoot, "docs/design/source/Bakis.dc.html"), "utf8");
const giris = readFileSync(join(repoRoot, "docs/design/source/Giris.dc.html"), "utf8");
const yonet = readFileSync(join(repoRoot, "docs/design/source/Yonet.dc.html"), "utf8");
const pano = readFileSync(join(repoRoot, "docs/design/source/Pano.dc.html"), "utf8");
const aktar = readFileSync(join(repoRoot, "docs/design/source/Aktar.dc.html"), "utf8");
const gruplar = readFileSync(join(repoRoot, "docs/design/source/Gruplar.dc.html"), "utf8");
const ekip = readFileSync(join(repoRoot, "docs/design/source/Ekip.dc.html"), "utf8");
const kabuk = readFileSync(join(repoRoot, "docs/design/source/Kabuk.dc.html"), "utf8");
const kalip = ["KalipListe", "KalipForm", "KalipDetay", "KalipSaha"].map((n) => [n, readFileSync(join(repoRoot, `docs/design/source/${n}.dc.html`), "utf8")] as const);

describe("I-18 tasarım birebir", () => {
  it("üretilmiş CSS ve belirteçler kaynaktan yeniden üretilenle bayt bayt aynı", () => {
    expect(() => execFileSync(process.execPath, [join(repoRoot, "scripts/design/port.mjs"), "--check"], { stdio: "pipe" })).not.toThrow();
  });

  it.each(Object.entries(ICON))("ikon %s kaynakta birebir geçer", (_k, d) => {
    expect(source.includes(`"${d}"`) || source.includes(`'${d}'`)).toBe(true);
  });

  it.each(Object.entries(GICON))("Giriş ikonu %s kaynakta birebir geçer", (_k, d) => {
    expect(giris.includes(`"${d}"`) || giris.includes(`'${d}'`)).toBe(true);
  });

  it.each(Object.entries(YICON))("Yönetim ikonu %s kaynakta birebir geçer", (_k, d) => {
    expect(yonet.includes(`"${d}"`) || yonet.includes(`'${d}'`)).toBe(true);
  });

  it.each(Object.entries(PICON))("Pano ikonu %s kaynakta birebir geçer", (_k, d) => {
    expect(pano.includes(`"${d}"`) || pano.includes(`'${d}'`)).toBe(true);
  });

  it.each(Object.entries(AICON))("Aktar ikonu %s kaynakta birebir geçer", (_k, d) => {
    expect(aktar.includes(`"${d}"`) || aktar.includes(`'${d}'`)).toBe(true);
  });

  it.each(Object.entries(RICON))("Gruplar ikonu %s kaynakta birebir geçer", (_k, d) => {
    expect(gruplar.includes(`"${d}"`) || gruplar.includes(`'${d}'`)).toBe(true);
  });

  it.each(Object.entries(EICON))("Ekip ikonu %s kaynakta birebir geçer", (_k, d) => {
    expect(ekip.includes(`"${d}"`) || ekip.includes(`'${d}'`)).toBe(true);
  });

  it.each(Object.entries(KICON))("Kabuk ikonu %s kaynakta birebir geçer", (_k, d) => {
    expect(kabuk.includes(`"${d}"`) || kabuk.includes(`'${d}'`)).toBe(true);
  });

  it.each(Object.entries(LICON))("Kalıp ikonu %s kalıp kaynaklarından birinde birebir geçer", (_k, d) => {
    expect(kalip.some(([, src]) => src.includes(`"${d}"`) || src.includes(`'${d}'`))).toBe(true);
  });

  it.each(Object.entries(SICON))("Saha ikonu %s KalipSaha kaynağında birebir geçer", (_k, d) => {
    const saha = kalip.find(([n]) => n === "KalipSaha")![1];
    expect(saha.includes(`"${d}"`) || saha.includes(`'${d}'`)).toBe(true);
  });

  it.each(kalip)("%s kaynağı: SOURCE.md ve üreteç sha256 kaydı dosyayla aynı", (_n, src) => {
    const sum = createHash("sha256").update(src).digest("hex");
    expect(readFileSync(join(repoRoot, "docs/design/source/SOURCE.md"), "utf8")).toContain(sum);
    expect(readFileSync(join(repoRoot, "scripts/design/port.mjs"), "utf8")).toContain(sum);
  });

  it("Kabuk kaynağı: SOURCE.md ve üreteç sha256 kaydı dosyayla aynı", () => {
    const sum = createHash("sha256").update(kabuk).digest("hex");
    expect(readFileSync(join(repoRoot, "docs/design/source/SOURCE.md"), "utf8")).toContain(sum);
    expect(readFileSync(join(repoRoot, "scripts/design/port.mjs"), "utf8")).toContain(sum);
  });

  it("Ekip kaynağı: SOURCE.md ve üreteç sha256 kaydı dosyayla aynı", () => {
    const sum = createHash("sha256").update(ekip).digest("hex");
    expect(readFileSync(join(repoRoot, "docs/design/source/SOURCE.md"), "utf8")).toContain(sum);
    expect(readFileSync(join(repoRoot, "scripts/design/port.mjs"), "utf8")).toContain(sum);
  });

  it("Gruplar kaynağı: SOURCE.md ve üreteç sha256 kaydı dosyayla aynı", () => {
    const sum = createHash("sha256").update(gruplar).digest("hex");
    expect(readFileSync(join(repoRoot, "docs/design/source/SOURCE.md"), "utf8")).toContain(sum);
    expect(readFileSync(join(repoRoot, "scripts/design/port.mjs"), "utf8")).toContain(sum);
  });

  it("Aktar kaynağı: SOURCE.md ve üreteç sha256 kaydı dosyayla aynı", () => {
    const sum = createHash("sha256").update(aktar).digest("hex");
    expect(readFileSync(join(repoRoot, "docs/design/source/SOURCE.md"), "utf8")).toContain(sum);
    expect(readFileSync(join(repoRoot, "scripts/design/port.mjs"), "utf8")).toContain(sum);
  });

  it("Pano kaynağı: SOURCE.md ve üreteç sha256 kaydı dosyayla aynı", () => {
    const sum = createHash("sha256").update(pano).digest("hex");
    expect(readFileSync(join(repoRoot, "docs/design/source/SOURCE.md"), "utf8")).toContain(sum);
    expect(readFileSync(join(repoRoot, "scripts/design/port.mjs"), "utf8")).toContain(sum);
  });

  it("Yönetim kaynağı: SOURCE.md ve üreteç sha256 kaydı dosyayla aynı", () => {
    const sum = createHash("sha256").update(yonet).digest("hex");
    expect(readFileSync(join(repoRoot, "docs/design/source/SOURCE.md"), "utf8")).toContain(sum);
    expect(readFileSync(join(repoRoot, "scripts/design/port.mjs"), "utf8")).toContain(sum);
  });

  it("Giriş kaynağı: SOURCE.md ve üreteç sha256 kaydı dosyayla aynı", () => {
    const sum = createHash("sha256").update(giris).digest("hex");
    expect(readFileSync(join(repoRoot, "docs/design/source/SOURCE.md"), "utf8")).toContain(sum);
    expect(readFileSync(join(repoRoot, "scripts/design/port.mjs"), "utf8")).toContain(sum);
  });

  it("SOURCE.md sha256 kaydı kaynak dosyayla aynı", () => {
    const sum = createHash("sha256").update(source).digest("hex");
    expect(readFileSync(join(repoRoot, "docs/design/source/SOURCE.md"), "utf8")).toContain(sum);
    expect(readFileSync(join(repoRoot, "scripts/design/port.mjs"), "utf8")).toContain(sum);
  });
});
