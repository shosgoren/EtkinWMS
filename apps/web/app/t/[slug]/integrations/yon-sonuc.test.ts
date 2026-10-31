// T-1136: yön seçiminin sonuç cümlesi ve onay kararı (hangi geçiş önce sorar). Metinlerin iki dilde var olduğu ve tek cümle kaldığı da burada.
import { describe, expect, it } from "vitest";
import tr from "../../../../messages/tr.json" with { type: "json" };
import en from "../../../../messages/en.json" with { type: "json" };
import { KART_AKISLARI, kartAkisi, yonDegisimi, yonOnayAnahtari, yonOnayGerekir, yonSonucAnahtari, type YonDirection, type YonSecim } from "./yon-sonuc.ts";

const DIRS: readonly YonDirection[] = ["PULL", "PUSH", "BOTH"];
const SECIMLER: readonly YonSecim[] = [...DIRS, "OFF"];
const kapali = { enabled: false, direction: "PULL" as YonDirection };
const acik = (direction: YonDirection) => ({ enabled: true, direction });
const get = (root: unknown, key: string): unknown => key.split(".").reduce<unknown>((o, k) => (o !== null && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), root);

describe("sonuç cümlesi", () => {
  it("yalnız kart akışlarında (ürün, cari, depo); kapalıda ortak 'eşitleme yapılmaz'", () => {
    expect(KART_AKISLARI).toEqual(["PRODUCTS", "CONTACTS", "WAREHOUSES"]);
    for (const f of KART_AKISLARI) {
      expect(kartAkisi(f)).toBe(true);
      for (const s of SECIMLER) expect(yonSonucAnahtari(f, s)).toBe(`sonuc.${s}`);
    }
    for (const f of ["STOCK", "SHIPMENTS", "SALES_ORDERS", "x"]) {
      expect(kartAkisi(f)).toBe(false);
      for (const s of SECIMLER) expect(yonSonucAnahtari(f, s)).toBeNull();
    }
  });
  it("her anahtar iki dilde var, tek cümle ve kısa (390 px'te mümkünse tek satır)", () => {
    for (const msgs of [tr, en]) {
      const root = (msgs as Record<string, unknown>).integrations;
      for (const f of KART_AKISLARI)
        for (const s of SECIMLER) {
          const v = get(root, yonSonucAnahtari(f, s) as string);
          expect(typeof v, `${f}.${s}`).toBe("string");
          const text = (v as string).replace("{provider}", "Paraşüt");
          expect(text.length, text).toBeLessThanOrEqual(60);
          expect(text.match(/[.!?]/g)?.length ?? 0, text).toBe(1);
        }
    }
  });
  it("Türkçe metin koddaki gerçek kuralı söyler: al = gönderim yok, gönder = karşı taraftan gelmez, iki yönlü = çakışmada sağlayıcı kazanır", () => {
    const s = (tr as unknown as { integrations: { sonuc: Record<string, string> } }).integrations.sonuc;
    expect(s.PULL).toContain("gitmez");
    expect(s.PULL).toContain("ona uyar"); // bağlı kart sağlayıcıdan güncellenir (apply.ts), ürün arşivi izler (product-lifecycle.ts)
    expect(s.PUSH).toContain("olmayanlar eklenir");
    expect(s.PUSH).toContain("gelmez");
    expect(s.BOTH).toContain("çakışmada {provider} kazanır");
    expect(s.BOTH).not.toMatch(/son değişen/i);
    expect(s.OFF).toBe("Eşitleme yapılmaz.");
  });
});

describe("onay kararı", () => {
  const dolu = { total: 1240, unlinked: 7 };
  const bagliHepsi = { total: 1240, unlinked: 0 };
  const bos = { total: 0, unlinked: 0 };

  it("kapalıdan al / iki yönlü: dolu katalogda sorar, boşta sormaz", () => {
    for (const d of ["PULL", "BOTH"] as const) {
      const x = yonDegisimi("PRODUCTS", kapali, d);
      expect(x?.yeniAl).toBe(true);
      expect(yonOnayGerekir(x, dolu)).toBe(true);
      expect(yonOnayGerekir(x, bagliHepsi)).toBe(true);
      expect(yonOnayGerekir(x, bos)).toBe(false);
    }
  });
  it("al → gönder: eşlenmemiş yerel kayıt varsa sorar; hepsi eşliyse (gidecek bir şey yok) sormaz", () => {
    const x = yonDegisimi("PRODUCTS", acik("PULL"), "PUSH");
    expect(x).toEqual({ yeniAl: false, yeniGonder: true });
    expect(yonOnayGerekir(x, dolu)).toBe(true);
    expect(yonOnayGerekir(x, bagliHepsi)).toBe(false);
    expect(yonOnayGerekir(x, bos)).toBe(false);
  });
  it("kapalıdan gönder de aynı (yerel kart dışarı gider)", () => {
    expect(yonOnayGerekir(yonDegisimi("CONTACTS", kapali, "PUSH"), dolu)).toBe(true);
  });
  it("al → iki yönlü yeni gönderim; gönder → iki yönlü yeni alma", () => {
    expect(yonDegisimi("WAREHOUSES", acik("PULL"), "BOTH")).toEqual({ yeniAl: false, yeniGonder: true });
    expect(yonDegisimi("WAREHOUSES", acik("PUSH"), "BOTH")).toEqual({ yeniAl: true, yeniGonder: false });
    expect(yonOnayGerekir(yonDegisimi("WAREHOUSES", acik("PUSH"), "BOTH"), dolu)).toBe(true);
  });
  it("yeni bir şey başlatmayan geçiş, kapatma ve kart dışı akış hiç sormaz", () => {
    expect(yonDegisimi("PRODUCTS", acik("BOTH"), "PULL")).toBeNull();
    expect(yonDegisimi("PRODUCTS", acik("BOTH"), "PUSH")).toBeNull();
    expect(yonDegisimi("PRODUCTS", acik("PULL"), "PULL")).toBeNull();
    for (const s of SECIMLER) expect(yonDegisimi("PRODUCTS", s === "OFF" ? acik("PULL") : kapali, "OFF")).toBeNull();
    expect(yonDegisimi("STOCK", kapali, "PUSH")).toBeNull();
    expect(yonDegisimi("SHIPMENTS", kapali, "PUSH")).toBeNull();
    expect(yonOnayGerekir(null, dolu)).toBe(false);
  });
  it("kapalı akışın kayıtlı yönü önemsizdir (kapalıyken hiçbir yön çalışmaz)", () => {
    for (const d of DIRS) expect(yonDegisimi("PRODUCTS", { enabled: false, direction: d }, "PULL")).toEqual({ yeniAl: true, yeniGonder: false });
  });
  it("alma içeren onay metni gerçek etkileri söyler: bağlı kart sağlayıcıdan güncellenir; yalnız üründe silinen/arşivlenen burada arşive alınır", () => {
    const o = (tr as unknown as { integrations: { onay: Record<string, Record<string, string>> } }).integrations.onay;
    for (const d of ["PULL", "BOTH"] as const) {
      expect(o.PRODUCTS?.[d]).toContain("bağlı kartların adı {provider}'tekiyle güncellenir");
      expect(o.PRODUCTS?.[d]).toContain("silinen ya da arşivlenen ürünler burada arşive alınır");
      expect(o.CONTACTS?.[d]).toContain("bağlı carilerin adı ve bilgileri {provider}'tekiyle güncellenir");
      expect(o.WAREHOUSES?.[d]).toContain("bağlı depoların adı {provider}'tekiyle güncellenir");
      expect(o.CONTACTS?.[d]).not.toContain("arşiv");
      expect(o.WAREHOUSES?.[d]).not.toContain("arşiv");
    }
    expect(o.CONTACTS?.PULL).toContain("silinen cari burada kalır");
    expect(o.WAREHOUSES?.PULL).toContain("silinen depo burada kalır");
    for (const f of KART_AKISLARI) expect(o[f]?.PUSH).not.toContain("güncellenir");
  });
  it("onay metni her akış ve yön için iki dilde var; sayılar yer tutucuyla", () => {
    for (const msgs of [tr, en]) {
      const root = (msgs as Record<string, unknown>).integrations;
      for (const f of KART_AKISLARI)
        for (const d of DIRS) {
          const v = get(root, yonOnayAnahtari(f, d));
          expect(typeof v, `${f}.${d}`).toBe("string");
          expect(v as string).toContain("{n, number}");
          if (d !== "PULL") expect(v as string).toMatch(/\{m, /);
        }
      for (const d of DIRS) expect(typeof get(root, `onayEvet.${d}`)).toBe("string");
      expect(typeof get(root, "onayVazgec")).toBe("string");
    }
  });
});
