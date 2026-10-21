// T-990 (B-97, ALTIN-KURAL "Ekran standardı", kullanıcı kararları 20–21 Ekim): MEKANİK BEKÇİ — kural sessizce geri gelmesin.
// `pnpm verify` (unit) içinde koşar. Yakalananlar:
//  1. `window.confirm` / `alert`: tarayıcı kutusu yok (ortak cam kutu `kalip/cikis.tsx`, onay `KalipOnay`).
//  2. `beforeunload` yalnız ortak çıkış korumasında (`kalip/cikis.tsx`): uygulama içi gezinmede tarayıcı penceresi çıkmaz.
//  3. Kiracı ekranlarında (`app/t/**`) yerel açılır liste `<select>` yok (seçim kutuları / aramalı seçim `kalip/secim.tsx`).
//  4. Perde tek ortak perdedir (`design/perde.css` `.kperde`): elle yazılan CSS'te `backdrop-filter` ve önekli `-webkit-backdrop-filter`
//     yok (önekli yazım küçültücüde standart özelliği siliyordu — Modüller perdesi kök nedeni); bileşende satır içi `backdropFilter` yok;
//     elle yazılan CSS'te yeni tam ekran karartma katmanı (`inset: 0` + karartma belirteci) tanımlanmaz.
//  5. Kiracı ekranlarında elle yazılmış `<dialog>` yok: ortak `KalipPencere` (yalnız tek soruluk onay). İstisnalar aşağıda gerekçeli.
// İstisna eklemek: aşağıdaki listeye dosya + gerekçe (kullanıcı/ADR kararı). Satır içi kapatma yorumu kabul edilmez.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP = path.resolve(import.meta.dirname);
const ROOT = path.resolve(APP, "../../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === "node_modules" || name === ".next") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const rel = (p: string): string => path.relative(APP, p).split(path.sep).join("/");
const SRC = walk(APP).filter((p) => /\.(tsx?|mts)$/.test(p) && !/\.test\.(tsx?|mjs)$/.test(p));
const CSS = walk(path.join(APP, "design")).filter((p) => p.endsWith(".css"));

/** Kaynaktan üretilen (port.mjs) CSS dosyaları: elle düzenlenmez; kaynak tasarımın cam kutuları burada. */
function generatedCss(): Set<string> {
  const port = readFileSync(path.join(ROOT, "scripts/design/port.mjs"), "utf8");
  const names = [...port.matchAll(/\{\s*name:\s*"([a-z-]+)",\s*file:/g)].map((m) => `design/${m[1]}.css`);
  return new Set(names);
}

/** Yorumları at (yorumdaki kural metni ihlal sayılmaz). */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Elle yazılmış `<dialog>` istisnaları (gerekçeli). */
const DIALOG_OK: Record<string, string> = {
  "t/[slug]/kalip/pencere.tsx": "ortak pencere (tek soruluk onay)",
  "t/[slug]/more-sheet.tsx": "eski kabuğun Daha fazla sayfası — B-95 ile kaldırılır (T-979 kolu)",
  "t/[slug]/app-bar.tsx": "eski kabuğun uygulama menüsü — B-95 ile kaldırılır (T-979 kolu)",
};

describe("ALTIN-KURAL mekanik bekçi (T-990)", () => {
  it("tarayıcı kutusu yok: window.confirm / alert", () => {
    const bad = SRC.filter((p) => /\bwindow\.(confirm|alert)\s*\(|(^|[^\w.])alert\s*\(/m.test(code(readFileSync(p, "utf8")))).map(rel);
    expect(bad).toEqual([]);
  });

  it("beforeunload yalnız ortak çıkış korumasında (kalip/cikis.tsx)", () => {
    const bad = SRC.filter((p) => /beforeunload/.test(code(readFileSync(p, "utf8")))).map(rel);
    expect(bad).toEqual(["t/[slug]/kalip/cikis.tsx"]);
  });

  it("kiracı ekranlarında yerel <select> yok", () => {
    const bad = SRC.filter((p) => rel(p).startsWith("t/") && p.endsWith(".tsx") && /<select[\s>]/.test(code(readFileSync(p, "utf8")))).map(rel);
    expect(bad).toEqual([]);
  });

  it("perde tek ortak perde: elle yazılan CSS'te backdrop-filter / önekli yazım / yeni karartma katmanı yok", () => {
    const gen = generatedCss();
    const bad: string[] = [];
    for (const p of CSS) {
      const r = rel(p);
      const css = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      if (/-webkit-backdrop-filter/.test(css)) bad.push(`${r}: -webkit-backdrop-filter`);
      if (gen.has(r) || r === "design/perde.css") continue;
      if (/(^|[^-])backdrop-filter\s*:/m.test(css)) bad.push(`${r}: backdrop-filter`);
      for (const block of css.split("}")) {
        if (/inset:\s*0\s*[;}]?/.test(block) && /background:\s*var\(--color-dz-a-afajan/.test(block)) bad.push(`${r}: karartma katmanı → perde.css`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("bileşende satır içi backdropFilter yok", () => {
    const bad = SRC.filter((p) => /backdropFilter|backdrop-filter/.test(code(readFileSync(p, "utf8")))).map(rel);
    expect(bad).toEqual([]);
  });

  it("kiracı ekranlarında elle yazılmış <dialog> yok (ortak KalipPencere)", () => {
    const bad = SRC.filter((p) => rel(p).startsWith("t/") && p.endsWith(".tsx") && /<dialog[\s>]/.test(code(readFileSync(p, "utf8"))) && DIALOG_OK[rel(p)] === undefined).map(rel);
    expect(bad).toEqual([]);
  });

  it("üretilmiş CSS önekli backdrop-filter yazmaz (küçültücü standart özelliği silmesin)", () => {
    for (const r of generatedCss()) {
      const css = readFileSync(path.join(APP, r), "utf8");
      expect(css.includes("-webkit-backdrop-filter"), r).toBe(false);
    }
  });
});
