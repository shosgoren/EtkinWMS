// T-1201 (kullanıcı kararı 1 Kasım): MEKANİK BEKÇİ — "Paraşüt'ten al" kaynak kilidi ürün / cari / depo ekranlarında ortak kalıpla
// gösterilir (sayfa `getSourceLock` okur, ekran `useKaynakKilit` kullanır) ve cari formunun kilitli alan kümesi domain'deki Paraşüt alan
// listesiyle aynıdır. Asıl karar domain komutundadır (int: tests/integration/integrations/source-guard).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SOURCE_OWNED_FIELDS, type SourceLockScreen } from "@wms/domain/integrations";
import type { KartKaynak } from "./kalip/kaynak-kilit.tsx";

// İstemci tipi (`kalip/kaynak-kilit.tsx`) domain ekran okumasıyla birebir (ayrışırsa typecheck kırılır).
type Ayni<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _kaynak: Ayni<KartKaynak, SourceLockScreen> = true;
void _kaynak;

const DIR = path.resolve(import.meta.dirname);
const read = (p: string): string =>
  readFileSync(path.join(DIR, p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const PAGES: readonly [string, string][] = [
  ["items/page.tsx", "ITEM"],
  ["items/[itemId]/page.tsx", "ITEM"],
  ["parties/page.tsx", "PARTY"],
  ["parties/[partyId]/page.tsx", "PARTY"],
  ["warehouses/page.tsx", "WAREHOUSE"],
];
const VIEWS: readonly [string, string][] = [
  ["items/items-view.tsx", "items"],
  ["items/[itemId]/item-detail.tsx", "items"],
  ["parties/parties-view.tsx", "parties"],
  ["parties/[partyId]/party-card.tsx", "parties"],
  ["warehouses/warehouses-view.tsx", "warehouses"],
];

describe("Paraşüt'ten al kaynak kilidi (T-1201)", () => {
  it("kart sayfaları kaynak kilidini domain ekran okumasından alır", () => {
    for (const [p, card] of PAGES) expect(read(p), p).toMatch(new RegExp(`getSourceLock\\([^)]*"${card}"`));
  });

  it("kart ekranları kilidi ortak `useKaynakKilit` ile gösterir (gerekçe yetki kilidinden önce)", () => {
    for (const [p, bolum] of VIEWS) expect(read(p), p).toContain(`useKaynakKilit(slug, "${bolum}"`);
    for (const p of ["items/items-view.tsx", "parties/parties-view.tsx", "warehouses/warehouses-view.tsx"]) {
      const src = read(p);
      expect(src, p).toMatch(/lockedAction: kk\.create \? kk\.eylem : undefined/);
      expect(src, p).toContain("useKaynakYeniUyarisi(");
    }
  });

  it("cari formunun kilitli alanları domain'deki Paraşüt alanlarıyla aynı", () => {
    const m = /const SOURCE_OWNED: ReadonlySet<keyof Form> = new Set<keyof Form>\(\[([^\]]+)\]\)/.exec(read("parties/parties-view.tsx"));
    expect(m).not.toBeNull();
    const fields = (m?.[1] ?? "").split(",").map((s) => s.trim().replace(/"/g, "")).sort();
    expect(fields).toEqual([...SOURCE_OWNED_FIELDS.PARTY].sort());
  });
});
