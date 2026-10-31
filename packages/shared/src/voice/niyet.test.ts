// T-1002 (B-62): niyet ayrıştırıcı — ölçüm setindeki 20 cümle (sttpoc/phrases.txt) ve beklenen niyetler; Türkçe sayılar; eşleştirme.
import { describe, expect, it } from "vitest";
import { codeKey, decide, decideLocation, spokenCodeKey } from "./eslestir.ts";
import { completePlan, resolveWrite, unitMatches } from "./cozum.ts";
import { parseCommand, WRITE_INTENTS } from "./niyet.ts";
import { openTarget } from "./acilis.ts";
import { parseNumberAt, words } from "./turkce.ts";

const PHRASES: readonly [string, Record<string, unknown>][] = [
  ["Beş koli kauçuk conta mal kabul et", { kind: "receive", qty: "5", unit: "koli", item: "kaucuk conta" }],
  ["Yirmi kilo siyah granül A üç rafına koy", { kind: "receive", qty: "20", unit: "kilo", item: "siyah granul", to: "a uc" }],
  ["Ahmet'in görevlerini göster", { kind: "tasks", person: "ahmet" }],
  ["Motive Rubber siparişini aç", { kind: "open", target: "motive rubber siparisini" }],
  ["B iki rafında sayım başlat", { kind: "count", at: "b iki" }],
  ["Üç palet ikinci depoya transfer et", { kind: "transfer", qty: "3", unit: "palet", toWarehouse: "#2" }],
  ["Yüz elli adet O ring çıkışı yap", { kind: "issue", qty: "150", unit: "adet", item: "o ring" }],
  ["Stokta kaç tane EPDM profil var", { kind: "howMany", item: "epdm profil" }],
  ["Bugünkü sevkiyatları listele", { kind: "open", target: "sevkiyatlari" }],
  ["Görev numarası iki yüz kırk beş", { kind: "task", no: "245" }],
  ["Kırk iki koli için etiket yazdır", { kind: "label", qty: "42", unit: "koli" }],
  ["C bir rafında ne var", { kind: "whatAt", at: "c bir" }],
  ["Kritik stoktaki ürünleri göster", { kind: "open", target: "kritik stoktaki urunleri" }],
  ["On iki varil hammadde girişi yap", { kind: "receive", qty: "12", unit: "varil", item: "hammadde" }],
  ["Mehmet'e toplama görevi ata", { kind: "assign", person: "mehmet", taskKind: "PICK" }],
  ["Yedi buçuk kilo boya sarf et", { kind: "issue", qty: "7.5", unit: "kilo", item: "boya" }],
  ["Altı yüz on yedi numaralı siparişi sevk et", { kind: "ship", orderNo: "617" }],
  ["Teslim alanındaki paletleri yerleştir", { kind: "receive" }],
  ["Onayla", { kind: "confirm" }],
  ["Düzelt", { kind: "fix" }],
];

describe("Etkin niyet ayrıştırıcı (20 ölçüm cümlesi)", () => {
  for (const [text, expected] of PHRASES) {
    it(text, () => {
      expect(parseCommand(text)).toMatchObject(expected);
    });
  }
  it("konuşma tanımanın rakamlı ve noktalamalı çıktısı da aynı niyete iner", () => {
    expect(parseCommand("5 koli kağıtçup konta mal kabul et.")).toMatchObject({ kind: "receive", qty: "5", unit: "koli", item: "kagitcup konta" });
    expect(parseCommand("20 kg siyah granül A-3 rafına koy")).toMatchObject({ kind: "receive", qty: "20", unit: "kg", to: "a 3" });
    expect(parseCommand("C1 rafında ne var?")).toMatchObject({ kind: "whatAt", at: "c 1" });
  });
  it("sesli onay yalnız tam 'onayla' / 'onaylıyorum' (A-172 kapalı gramer)", () => {
    expect(parseCommand("Onaylıyorum.").kind).toBe("confirm");
    expect(parseCommand("onayla bunu").kind).not.toBe("confirm");
    expect(parseCommand("onaylama").kind).not.toBe("confirm");
  });
  it("transfer: kaynak ve hedef raf ayrı okunur", () => {
    expect(parseCommand("C bir rafından A üç rafına yirmi adet conta taşı")).toMatchObject({ kind: "transfer", qty: "20", unit: "adet", item: "conta", from: "c bir", to: "a uc" });
  });
  it("yazma niyetleri: kabul, çıkış, transfer, sayım", () => {
    expect([...WRITE_INTENTS].sort()).toEqual(["count", "issue", "receive", "transfer"]);
  });
});

describe("Türkçe sayı", () => {
  const n = (s: string) => parseNumberAt(words(s), 0)?.value;
  it("bileşik sayılar, buçuk, yarım, rakam", () => {
    expect(n("yirmi")).toBe("20");
    expect(n("iki yüz kırk beş")).toBe("245");
    expect(n("altı yüz on yedi")).toBe("617");
    expect(n("bin iki yüz")).toBe("1200");
    expect(n("yedi buçuk")).toBe("7.5");
    expect(n("yarım")).toBe("0.5");
    expect(n("7,5")).toBe("7.5");
    expect(n("on iki")).toBe("12");
    expect(n("kırk iki")).toBe("42");
  });
  it("Türkçe dizilime aykırı ardışık sözcük ayrı sayıdır", () => {
    expect(n("otuz yirmi")).toBe("30");
    expect(n("iki üç")).toBe("2");
    expect(n("koli")).toBeUndefined();
  });
});

describe("eşleştirme", () => {
  const items = [
    { id: "1", code: "KC-10", name: "Kauçuk conta 10mm", unitCode: "ADET", unitName: "Adet" },
    { id: "2", code: "EP-20", name: "EPDM profil 20x10", unitCode: "M", unitName: "Metre" },
    { id: "3", code: "OR-5", name: "O-ring 5mm", unitCode: "ADET", unitName: "Adet" },
    { id: "4", code: "BY-1", name: "Boya siyah", unitCode: "KG", unitName: "Kilogram" },
  ];
  const locs = [
    { id: "a", code: "A-03", name: "A3", warehouseId: "w1", warehouseName: "Ana depo" },
    { id: "b", code: "B-02", name: "B2", warehouseId: "w1", warehouseName: "Ana depo" },
    { id: "c", code: "C-01", name: "C1", warehouseId: "w1", warehouseName: "Ana depo" },
    { id: "g", code: "A1-G01", name: "Göz 01", warehouseId: "w1", warehouseName: "Ana depo" },
  ];
  it("raf kodu sözle söylenir: 'c bir' → C-01, 'a bir g sıfır bir' → A1-G01", () => {
    expect(codeKey("A1-G01")).toBe("a-1-g-1");
    expect(spokenCodeKey("a bir g sıfır bir")).toBe("a-1-g-1");
    expect(decideLocation("c bir", locs)).toMatchObject({ kind: "one", c: { id: "c" } });
    expect(decideLocation("b iki", locs)).toMatchObject({ kind: "one", c: { id: "b" } });
    expect(decideLocation("a bir g sıfır bir", locs)).toMatchObject({ kind: "one", c: { id: "g" } });
    expect(decideLocation("z dokuz", locs).kind).toBe("none");
  });
  it("tanıma hatasına dayanır; belirsizse 2–3 aday, zayıfsa hiç", () => {
    expect(decide("kauçuk conta", items)).toMatchObject({ kind: "one", c: { id: "1" } });
    expect(decide("epdm profil", items)).toMatchObject({ kind: "one", c: { id: "2" } });
    expect(decide("o ring", items)).toMatchObject({ kind: "one", c: { id: "3" } });
    const noisy = decide("kağıtçup konta", items);
    expect(noisy.kind === "one" ? noisy.c.id : noisy.kind === "many" ? noisy.list[0]?.id : null).toBe("1");
    expect(decide("helikopter", items).kind).toBe("none");
  });
  it("yazma taslağı: eksik raf ve birim çakışması planı durdurur", () => {
    const cat = { items, locations: locs, warehouses: [{ id: "w1", code: "ANA", name: "Ana depo" }] };
    const ok = resolveWrite({ kind: "receive", qty: "5", unit: "adet", item: "kauçuk conta", to: "a üç" }, cat);
    expect(ok.missing).toEqual([]);
    expect(completePlan(ok.op, ok.draft).plan).toEqual({ op: "stockIn", warehouseId: "w1", itemId: "1", locationId: "a", quantity: "5" });
    const noLoc = resolveWrite({ kind: "receive", qty: "5", unit: "koli", item: "kauçuk conta" }, cat);
    expect(noLoc.missing).toEqual(["unit", "loc"]);
    const count = resolveWrite({ kind: "count", at: "b iki" }, cat);
    expect(completePlan(count.op, count.draft).plan).toEqual({ op: "count", warehouseId: "w1", code: "B-02" });
    expect(unitMatches("kilo", "KG", "Kilogram")).toBe(true);
    expect(unitMatches("tane", "ADET", "Adet")).toBe(true);
    expect(unitMatches("koli", "ADET", "Adet")).toBe(false);
  });
});

// T-1110 (kullanıcı 28 Ekim): doğal söyleyişler — bekleyen işler ve ekek ekran adları.
describe("Etkin doğal komutlar (T-1110)", () => {
  it.each([
    ["Bekleyen işi var mı?", { kind: "tasks" }],
    ["Bekleyen işim var mı", { kind: "tasks" }],
    ["İşlerim", { kind: "tasks" }],
    ["Bugün yapılacak iş var mı", { kind: "tasks" }],
    ["Görevim var mı", { kind: "tasks" }],
    ["Bekleyen toplama işleri", { kind: "tasks", taskKind: "PICK" }],
    ["Kullanıcı ayarlarına git", { kind: "open", target: "kullanici ayarlarina" }],
    ["Ürünleri aç", { kind: "open", target: "urunleri" }],
    ["Ürünler sayfasını açar mısın", { kind: "open", target: "urunler" }],
    ["Aç cariler", { kind: "open", target: "cariler" }],
    ["Ayarlar", { kind: "open", target: "ayarlar" }],
    ["Yetkileri aç", { kind: "open", target: "yetkileri" }],
    ["Stok durumuna bak", { kind: "open", target: "stok durumuna" }],
    ["Ana ekrana git", { kind: "open", target: "ana" }],
  ] as const)("%s", (text, expected) => {
    expect(parseCommand(text)).toMatchObject(expected);
  });
});

describe("ekran hedefi (T-1110)", () => {
  it.each([
    ["kullanici ayarlarina", { id: "ayar", suffix: "?sekme=kullanici" }],
    ["yetkiler", { id: "ekip", path: "/yetkiler" }],
    ["kullanici yetkileri", { id: "ekip", path: "/yetkiler" }],
    ["yetki ayarlari", { id: "ekip", path: "/yetkiler" }],
    ["yetkili kullanici", { id: "ekip" }],
    ["tema ayarlari", { id: "ayar", suffix: "?sekme=gorunum" }],
    ["parasut baglantisi", { id: "ayar", path: "/integrations" }],
    ["entegrasyonlar", { id: "ayar", path: "/integrations" }],
    ["excel", { id: "ayar", suffix: "/baglantilar" }],
    ["ayarlar", { id: "ayar" }],
    ["urunleri", { id: "urun" }],
    ["carilere", { id: "cari" }],
    ["musteriler", { id: "cari" }],
    ["stok durumuna", { id: "stok" }],
    ["depolar", { id: "depo" }],
    ["stok fislerini", { id: "fis" }],
    ["sayimlar", { id: "sayim" }],
    ["ekip", { id: "ekip" }],
    ["ana ekran", { id: "home" }],
  ] as const)("%s", (text, expected) => {
    expect(openTarget(text)).toEqual(expected);
  });
  it("bilinmeyen hedef null", () => {
    expect(openTarget("motive rubber")).toBeNull();
  });
  it("ekran sözcüğü geçen ürün/cari adı ekran değildir (katalog aramasına düşer)", () => {
    expect(openTarget("koli bandi 45mm seffaf")).toBeNull();
    expect(openTarget("stok kalemi vida")).toBeNull();
    expect(openTarget("urunler sayfasi")).toEqual({ id: "urun" });
    expect(openTarget("tum cariler")).toEqual({ id: "cari" });
  });
});

describe("ekran hedefi ek durumlar (T-1110)", () => {
  it("komuttan 'ekran' atılınca 'ana' ana ekrandır; stok hareketleri fiş ekranıdır", () => {
    expect(openTarget("ana")).toEqual({ id: "home" });
    expect(openTarget("stok hareketleri")).toEqual({ id: "fis" });
  });
});
