// T-1141 (kullanıcı kararı 31 Ekim): MEKANİK BEKÇİ — ürün / cari / depo / raf yeri kart ekranları ve eylemleri yazma kararını kart bölümü
// anahtarıyla verir (`cardRights` / `items.*`, `parties.*`, `warehouses.*`, `locations.*`); eski genel `settings.manage` kararı ve sessizce
// gizlenen ana işlem (`main: … ? … : null`) geri gelmesin. Asıl karar domain komutundadır (int: tests/integration/catalog/card-permissions).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.resolve(import.meta.dirname);
const read = (p: string): string =>
  readFileSync(path.join(DIR, p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const PAGES = ["items/page.tsx", "items/[itemId]/page.tsx", "parties/page.tsx", "parties/[partyId]/page.tsx", "warehouses/page.tsx", "warehouses/[warehouseId]/page.tsx"];
const VIEWS = ["items/items-view.tsx", "items/[itemId]/item-detail.tsx", "parties/parties-view.tsx", "parties/[partyId]/party-card.tsx", "warehouses/warehouses-view.tsx", "warehouses/[warehouseId]/location-tree.tsx"];
const ACTIONS = ["items/actions.ts", "parties/actions.ts", "warehouses/actions.ts"];

describe("kart yetkileri (T-1141)", () => {
  it("kart sayfaları gösterim kararını `cardRights` ile verir; `settings.manage` kullanmaz", () => {
    for (const p of PAGES) {
      const src = read(p);
      expect(src, p).toMatch(/cardRights\(current\.roles, current\.grants, "(items|parties|warehouses|locations)"\)/);
      expect(src, p).not.toContain('"settings.manage"');
    }
  });

  it("kart ekranları kilidi ortak kalıpla gösterir (kilitli düğme / kilitli ana işlem + bölüm gerekçesi); ana işlem gizlenmez", () => {
    for (const p of VIEWS) {
      const src = read(p);
      expect(src, p).toContain("useKartKilitGerekce(");
      expect(src, p).not.toMatch(/\bcanManage\b|canEdit\s*\?\s*\{\s*label/);
      expect(src, p).not.toMatch(/main:\s*\w+\s*\?[^:]*:\s*null/);
    }
  });

  it("kart eylemleri ön denetimde kart anahtarını ister; `settings.manage` yok", () => {
    for (const p of ACTIONS) {
      const src = read(p);
      expect(src, p).not.toContain('"settings.manage"');
      expect(src, p).not.toMatch(/writeContext\((input\.)?slug, ctx\)/);
    }
  });
});
