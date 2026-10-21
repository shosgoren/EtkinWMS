// T-1001: ALTIN-KURAL 5–17 mekanik bekçileri (birim testi; kaynak taraması).
// 5  — ses ve titreşim TEK kaynaktan: `AudioContext` / `navigator.vibrate` yalnız packages/ui/src/ses.ts'te.
// 5  — balon TEK bileşen: uygulamada `className="toast"` çizen kopya yok (ortak katman `kalip/balon.tsx`, sınıf `.kbl`).
// 16 — sabit dil yok: biçim çağrılarında "tr-TR" / "tr" yazılmaz (ortak `@wms/ui` format yardımcısı; ESLint `wms/no-fixed-locale` aynısı).
// 7  — kiracı alanı ve yönetim paneli hata sınırı ortak hata ekranını kullanır; ham `error.message` gösterilmez.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(?:ts|tsx|mjs)$/.test(p) && !/\.(?:test|spec)\.tsx?$/.test(p) && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const files = [...walk(join(repoRoot, "apps/web")), ...walk(join(repoRoot, "packages/ui/src"))].map((f) => relative(repoRoot, f).split("\\").join("/"));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");
/** Yorum satırlarını atar (açıklamada geçen ad bekçiyi tetiklemesin). */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const SES_KAYNAK = "packages/ui/src/ses.ts";

describe("ALTIN-KURAL 5: tek ses kaynağı", () => {
  it("taranacak dosyalar var", () => {
    expect(files).toContain(SES_KAYNAK);
    expect(files).toContain("apps/web/app/t/[slug]/kalip/balon.tsx");
  });
  it("AudioContext / webkitAudioContext / navigator.vibrate yalnız ses.ts'te", () => {
    const hits = files.filter((f) => f !== SES_KAYNAK && /\b(?:AudioContext|webkitAudioContext)\b|\bnavigator\s*\.\s*vibrate\b|\.vibrate\?\.\(/.test(code(read(f))));
    expect(hits).toEqual([]);
  });
  it("ses.ts gerçekten tek kaynak: Sessiz tercihi ve hareket azaltma orada", () => {
    const s = read(SES_KAYNAK);
    expect(s).toContain("AudioContext");
    expect(s).toContain("sessizMi()");
    expect(s).toContain("hareketAzaltMi()");
  });
  it("eski kopya adları (tone / beep) tanımlanmaz", () => {
    const hits = files.filter((f) => /\bfunction\s+(?:tone|beep)\s*\(/.test(code(read(f))));
    expect(hits).toEqual([]);
  });
  it("küçük işlem sessizdir: feedback.minor ses çalmaz", () => {
    const s = read("packages/ui/src/geri-bildirim.ts");
    const minor = /minor\(\): void \{([\s\S]*?)\n {2}\},/.exec(s)?.[1] ?? "x";
    expect(code(minor).trim()).toBe("");
  });
});

describe("ALTIN-KURAL 5: tek balon bileşeni", () => {
  it('uygulamada `className="toast"` çizen kopya yok', () => {
    const hits = files.filter((f) => /className=["{`]+toast\b/.test(code(read(f))));
    expect(hits).toEqual([]);
  });
  it("ortak katman kök düzende bir kez çizilir ve kalıcı aria-live bölgesidir", () => {
    expect(read("apps/web/app/layout.tsx")).toContain("<KuralKatmani />");
    const b = read("apps/web/app/t/[slug]/kalip/balon.tsx");
    expect(b).toContain('aria-live="polite"');
    expect(b).toContain("BALON_OLAY");
  });
});

describe("ALTIN-KURAL 16: sabit dil yok", () => {
  const FIXED = /["'`]tr-TR["'`]|toLocale(?:Upper|Lower)Case\(\s*["'`]tr["'`]|toLocale(?:Date|Time)?String\(\s*["'`]tr["'`]|Intl\.\w+\(\s*["'`]tr["'`]/;
  it('"tr-TR" ve biçim çağrısında "tr" yalnız ortak yardımcının dil tablosunda', () => {
    const hits = files.filter((f) => f !== "packages/ui/src/format.ts" && FIXED.test(code(read(f))));
    expect(hits).toEqual([]);
  });
});

describe("ALTIN-KURAL 7: hata ekranı", () => {
  it.each(["apps/web/app/t/[slug]/error.tsx", "apps/web/app/panel/error.tsx", "apps/web/app/t/[slug]/not-found.tsx"])("%s ortak HataEkrani kullanır, ham mesaj göstermez", (rel) => {
    const s = code(read(rel));
    expect(s).toContain("<HataEkrani");
    expect(s).not.toMatch(/error\.message|error\.stack/);
  });
  it("kiracı yerleşiminde yükleniyor iskeleti var", () => {
    expect(files).toContain("apps/web/app/t/[slug]/loading.tsx");
  });
});
