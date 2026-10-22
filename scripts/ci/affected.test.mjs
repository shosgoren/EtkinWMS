// T-1022: etkilenen test seçicisi (scripts/ci/affected.mjs). Geçici bir mini depo üzerinde; şüphede tam takım kuralı.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FULL_E2E_MATRIX, FULL_INT_MATRIX, FULL_OUTPUTS, selectTests, specsForSection, toOutputs, webSection } from "./affected.mjs";

let root;
const FILES = {
  "package.json": "{}",
  "packages/domain/package.json": JSON.stringify({ name: "@wms/domain", exports: { "./catalog": "./src/catalog/index.ts" } }),
  "packages/domain/src/catalog/index.ts": 'export * from "./items.ts";\n',
  "packages/domain/src/catalog/items.ts": "export const item = 1;\n",
  "packages/domain/src/catalog/items.test.ts": 'import { item } from "./items.ts";\n',
  "packages/domain/src/stock/orphan.ts": "export const orphan = 1;\n",
  "apps/web/app/layout.tsx": "export default 1;\n",
  "apps/web/app/t/[slug]/items/page.tsx": 'import { item } from "@wms/domain/catalog";\nimport { Card } from "./card.tsx";\n',
  "apps/web/app/t/[slug]/items/card.tsx": "export const Card = 1;\n",
  "apps/web/app/t/[slug]/items/card.test.tsx": 'import { Card } from "./card.tsx";\n',
  "apps/web/app/t/[slug]/kalip/secim.tsx": 'import { Shared } from "../stock/shared.tsx";\n',
  "apps/web/app/t/[slug]/stock/shared.tsx": "export const Shared = 1;\n",
  "apps/web/app/t/[slug]/pano/page.tsx": "export default 1;\n",
  "apps/web/app/api/x/route.ts": "export const GET = 1;\n",
  "apps/worker/src/main.ts": 'import { item } from "@wms/domain/catalog";\n',
  "tests/integration/catalog/items.int.test.ts": 'import { item } from "../../../packages/domain/src/catalog/items.ts";\n',
  "tests/integration/stock/other.int.test.ts": "export {};\n",
  "tests/integration/ac/dyn.int.test.ts": "const m = await import(path.join(WEB, 'x.ts'));\n",
  "tests/e2e/items.spec.ts": 'await page.goto(`/t/demo/items`);\n',
  "tests/e2e/other.spec.ts": 'await page.goto("/t/demo/stock-x");\n',
  "scripts/tool.mjs": "export {};\n",
  ".github/workflows/ci.yml": "name: ci\n",
};

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "affected-"));
  for (const [f, text] of Object.entries(FILES)) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    writeFileSync(path.join(root, f), text);
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const sel = (...changed) => selectTests({ root, changed });

describe("selectTests", () => {
  it("yalnız belge: kod yok, hiçbir takım koşmaz", () => {
    const s = sel("docs/x.md", "README.md");
    expect(s.code).toBe(false);
    const o = toOutputs(s);
    expect([o.e2e_run, o.int_run]).toEqual(["false", "false"]);
  });

  it("boş fark: tam takım (fail-safe)", () => {
    expect(sel().full).toBe(true);
  });

  it.each([".github/workflows/ci.yml", "package.json", "pnpm-lock.yaml", "playwright.config.ts", "vitest.int.config.ts", "packages/db/migrations/0002_x.up.sql", "packages/auth/src/a.ts", "apps/web/app/globals.css", "apps/web/app/t/[slug]/layout.tsx", "apps/web/app/t/[slug]/kalip/secim.tsx", "apps/web/app/t/[slug]/kabuk/bar.tsx", "packages/domain/src/identity/access.ts", "scripts/ci/affected.mjs"])(
    "kullanıcı listesindeki ortak dosya → iki takım tam: %s",
    (f) => {
      const s = sel(f);
      expect(s.fullE2e && s.fullInt).toBe(true);
      expect(toOutputs(s).e2e_matrix).toBe(JSON.stringify(FULL_E2E_MATRIX));
      expect(toOutputs(s).int_matrix).toBe(JSON.stringify(FULL_INT_MATRIX));
    },
  );

  it("değişen spec yalnız kendini seçer; int koşmaz", () => {
    const s = sel("tests/e2e/items.spec.ts");
    expect(s).toMatchObject({ fullE2e: false, fullInt: false, e2e: ["tests/e2e/items.spec.ts"], int: [] });
    const o = toOutputs(s);
    expect(o.int_run).toBe("false");
    expect(o.e2e_files).toBe("tests/e2e/items.spec.ts");
    expect(JSON.parse(o.e2e_matrix).include).toEqual([{ group: "desktop", part: 1, of: 1 }, { group: "mobile", part: 1, of: 1 }]);
  });

  it("değişen int testi yalnız kendini seçer", () => {
    const s = sel("tests/integration/stock/other.int.test.ts");
    expect(s).toMatchObject({ fullE2e: false, fullInt: false, e2e: [], int: ["tests/integration/stock/other.int.test.ts"] });
  });

  it("domain kaynağı: onu kullanan int testi + joker int testi; worker kullandığı için e2e tam", () => {
    const s = sel("packages/domain/src/catalog/items.ts");
    expect(s.int).toEqual(["tests/integration/ac/dyn.int.test.ts", "tests/integration/catalog/items.int.test.ts"]);
    expect(s.fullInt).toBe(false);
    expect(s.fullE2e).toBe(true);
  });

  it("rota dosyası: o bölümü anan spec'ler; benzer adlı bölüm (/stock-x) seçilmez", () => {
    const s = sel("apps/web/app/t/[slug]/items/card.tsx");
    expect(s.fullE2e).toBe(false);
    expect(s.e2e).toEqual(["tests/e2e/items.spec.ts"]);
    expect(s.int).toEqual(["tests/integration/ac/dyn.int.test.ts"]);
  });

  it("ortak bileşenin (kalip) içe aktardığı dosya → e2e tam, int grafikle", () => {
    const s = sel("apps/web/app/t/[slug]/stock/shared.tsx");
    expect(s.fullE2e).toBe(true);
    expect(s.fullInt).toBe(false);
  });

  it("hiçbir spec'in anmadığı bölüm → e2e tam", () => {
    expect(sel("apps/web/app/t/[slug]/pano/page.tsx").fullE2e).toBe(true);
  });

  it("api → e2e tam", () => {
    expect(sel("apps/web/app/api/x/route.ts").fullE2e).toBe(true);
  });

  it("eşlemesi olmayan kaynak → iki takım tam", () => {
    expect(sel("packages/domain/src/stock/orphan.ts").full).toBe(true);
    expect(sel("scripts/tool.mjs").full).toBe(true);
    expect(sel("services/other/x.py").full).toBe(true);
  });

  it("silinen kaynak → tam; silinen spec → seçilecek bir şey yok", () => {
    expect(sel("apps/web/app/t/[slug]/items/gone.tsx").full).toBe(true);
    const s = sel("tests/e2e/gone.spec.ts");
    expect(s.full).toBe(false);
    expect(toOutputs(s).e2e_run).toBe("false");
  });

  it("yalnız birim testi (başka dosya içe aktarmıyor) → int/e2e koşmaz", () => {
    const o = toOutputs(sel("packages/domain/src/catalog/items.test.ts", "apps/web/app/t/[slug]/items/card.test.tsx"));
    expect([o.code, o.e2e_run, o.int_run]).toEqual(["true", "false", "false"]);
  });

  it("beklenmeyen karakterli yol → tam", () => {
    expect(sel("apps/web/app/t/[slug]/items/a$(x).tsx").full).toBe(true);
  });

  it("ses servisi int/e2e'yi tetiklemez (voice işi koşar)", () => {
    const o = toOutputs(sel("services/voice/app.py"));
    expect([o.e2e_run, o.int_run]).toEqual(["false", "false"]);
  });
});

describe("yardımcılar", () => {
  it("webSection", () => {
    expect(webSection("apps/web/app/t/[slug]/items/page.tsx")).toBe("items");
    expect(webSection("apps/web/app/t/[slug]/page.tsx")).toBeNull();
    expect(webSection("apps/web/app/t/[slug]/kalip/x.tsx")).toBeNull();
    expect(webSection("apps/web/app/api/x/route.ts")).toBeNull();
    expect(webSection("apps/web/app/field/page.tsx")).toBe("field");
    expect(webSection("apps/web/app/design/x.css")).toBeUndefined();
    expect(webSection("apps/web/lib/x.ts")).toBeUndefined();
  });

  it("specsForSection tam yol parçası ister", () => {
    const texts = new Map([["a", "goto('/t/demo/items?x=1')"], ["b", "goto('/t/demo/items-old')"], ["c", "`${base}/items`"]]);
    expect(specsForSection("items", texts)).toEqual(["a", "c"]);
  });

  it("toOutputs parça sayıları", () => {
    const many = { code: true, full: false, fullE2e: false, fullInt: false, reasons: [], e2e: ["a", "b", "c", "d"], int: Array.from({ length: 20 }, (_, i) => `t${i}`) };
    const o = toOutputs(many);
    expect(JSON.parse(o.e2e_matrix).include).toHaveLength(4);
    expect(JSON.parse(o.int_matrix).include).toEqual([{ shard: 1, of: 2 }, { shard: 2, of: 2 }]);
    expect(FULL_OUTPUTS.e2e_run).toBe("true");
    expect(FULL_OUTPUTS.int_files).toBe("");
  });
});
