// T-1042 (kullanıcı onayı 26 Ekim, docs/design/STANDART.md §1): masaüstü standardı ORTAK KABUK bekçisi — üst çubuk her ekranda
// aynı parçaları aynı sırayla taşır (saat, tema, …, Ayarlar, Hesap en sağda), Sorun bildir bayraktır, ortak görünüm en son yüklenir.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const here = path.dirname(new URL(import.meta.url).pathname);
const read = (p: string): string => readFileSync(path.join(here, p), "utf8");
const globals = read("../globals.css");
const css = read("standart.css");
const ekran = read("../t/[slug]/kalip/ekran.tsx");
const pano = read("../t/[slug]/pano/pano-shell.tsx");
const destek = read("../t/[slug]/kalip/destek.tsx");
const issue = read("../t/[slug]/pano/support-layer.tsx");

describe("T-1042 ortak kabuk (STANDART §1)", () => {
  it("standart.css diğer bütün tasarım katmanlarından sonra yüklenir", () => {
    const imports = [...globals.matchAll(/@import "\.\/design\/([a-z-]+)\.css";/g)].map((m) => m[1]);
    expect(imports.at(-1)).toBe("standart");
  });
  it("kalıp kabı: saat → tema → üst düğmeler → Ayarlar → Hesap (en sağda)", () => {
    const order = ["<StSaat />", "<StTema dark={dark} />", 'className="tph"', "<StAyarlar />", "<HesapDugme"].map((s) => ekran.indexOf(s));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("Pano: saat ve tema var; Ayarlar ortak düğme ve Hesap'tan önce", () => {
    expect(pano).toMatch(/<StSaat \/>/);
    expect(pano).toMatch(/<StTema dark=\{dark\}/);
    expect(pano).not.toMatch(/tb-gear/);
    expect(pano.indexOf("<StAyarlar href={settingsHref} />")).toBeGreaterThan(0);
    expect(pano.indexOf("<StAyarlar href={settingsHref} />")).toBeLessThan(pano.indexOf("<HesapDugme"));
  });
  it("Sorun bildir her üst çubukta bayrak (üçgen yok)", () => {
    expect(destek).toMatch(/SICON\.flag/);
    expect(destek).not.toMatch(/LICON\.warn/);
    expect(issue).toMatch(/export function IssueIco[\s\S]*?SICON\.flag/);
  });
  it("üst çubuk düğmeleri zeminsiz; alt çubukta seçili yer hapta (alt çizgi yok); koyu dolgu yok", () => {
    expect(css).toMatch(/\.kalip \.top,\s*\.dzp \.top,\s*\.kalip\.dz-dark \.top,\s*\.dzp\.dz-dark \.top \{\s*background: transparent;/);
    expect(css).toMatch(/\.dzp \.top \.tb \{\s*background: transparent !important;\s*\}/);
    // Odak halkası korunur: gölge kaldırma yalnız :not(:focus-visible).
    expect(css).toMatch(/\.dzp \.top \.tb:not\(:focus-visible\) \{\s*box-shadow: none !important;/);
    expect(css).toMatch(/\.dzk \.dk\.cur::after,\s*\.dzk\.dz-dark \.dk\.cur::after \{\s*display: none;/);
    expect(css).toMatch(/max-width: none;\s*margin-inline: 0;\s*padding-inline: 40px;/);
  });
  it("T-1044: üst çubuk yalnız simge (yazı yok), 48 px; menüde Tema/Ayarlar yalnız telefonda; menü perdesi alt çubuğu da örter", () => {
    expect(css).toMatch(/\.kalip \.top :is\(\.tb, \.stbtn\) > span,\s*\.dzp \.top :is\(\.tb, \.stbtn\) > span \{\s*display: none;/);
    expect(css).toMatch(/\.tmenu \.st-mob \{\s*display: none !important;/);
    // T-1080: perde ve menü sayfa kökünde; perde alt cam çubuğun (z 25) üstünde, menü perdenin üstünde.
    expect(css).toMatch(/\.dzp\.hmenu-kok \.hback \{ position: fixed; inset: 0; z-index: 40; \}/);
    expect(css).toMatch(/\.dzp\.hmenu-kok \.halo\.tmenu \{ position: fixed; z-index: 41; \}/);
    expect(read("../t/[slug]/pano/hesap-menu.tsx")).toMatch(/createPortal\(/);
    expect(read("../t/[slug]/pano/hesap-menu.tsx")).not.toMatch(/k: "switch"/);
  });
  it("modül zemin geçişi görünen tam ekran yüzeyde (.app), açık ve koyu temada", () => {
    expect(css).toMatch(/\.kalip:not\(\.dz-dark\) \.app \{\s*background: linear-gradient\(150deg, color-mix/);
    expect(css).toMatch(/\.kalip\.dz-dark \.app,\s*\.dzp\.dz-dark \.app \{\s*background: linear-gradient/);
    expect(css).toMatch(/\.dzp:not\(\.dz-dark\) \.app \{\s*background: linear-gradient/);
  });
});
