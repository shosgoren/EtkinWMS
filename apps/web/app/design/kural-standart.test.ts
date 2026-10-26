// T-1037 (kullanıcı isteği 25 Ekim: "hepsi bir standart görünüme kavuşsun, yeni bir şey ekleneceği zaman hep aynı standarttan gitmeli"):
// ortak katman kuralları geri gelmesin diye bekçi. Form kabında tek ana işlem, kutu içinde kutu yok, uzun ad kesilmez.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const here = path.dirname(new URL(import.meta.url).pathname);
const kural = readFileSync(path.join(here, "kural.css"), "utf8");
const formEkran = readFileSync(path.join(here, "../t/[slug]/stock/form-ekran.tsx"), "utf8");
const detay = readFileSync(path.join(here, "../t/[slug]/kalip/detay.tsx"), "utf8");

describe("T-1037 ortak ekran standardı", () => {
  it("form kabında formun kendi gönder düğmesi gizli; ana işlem alt çubukta (tek Kaydet)", () => {
    expect(kural).toMatch(/\.kform-tek form\.workflow-form \.workflow-primary \{\s*display: none !important;/);
    expect(formEkran).toMatch(/kind === "form" \? "kform-tek"/);
    expect(formEkran).toMatch(/requestSubmit\(primary/);
  });
  it("form kabında eski çerçeve yok (kutu içinde kutu)", () => {
    expect(kural).toMatch(/\.kform-tek form\.workflow-form \{[^}]*background: transparent !important;[^}]*border: 0 !important;/);
  });
  it("ürün / cari / ekran adı üç noktayla kesilmez", () => {
    expect(kural).toMatch(/\.dzd \.hx b \{[^}]*white-space: normal !important;[^}]*-webkit-line-clamp: 3;/);
    expect(kural).toMatch(/\.dzl \.ut b \{[^}]*white-space: normal !important;[^}]*-webkit-line-clamp: 2;/);
  });
  it("T-1039: masaüstünde form alanının kutusu görünür (beyaz kart üstünde beyaz alan yok)", () => {
    expect(kural).toMatch(/\.dzf:not\(\.dz-dark\) \.fld \{\s*background: var\(--color-kr-bg-a\);\s*\}/);
    // Hatalı alanın kırmızı çerçevesi (`.fld.bad`, kalip-frame.css) gri kenarla ezilmez.
    expect(kural).toMatch(/\.dzf:not\(\.dz-dark\) \.fld:not\(\.bad\) \{\s*box-shadow: inset/);
  });
  it("ekran açan 'Tümü' bağlantısında mikrofon simgesi yok", () => {
    expect(detay).not.toMatch(/MicIco/);
  });
});
