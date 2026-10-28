// T-1115: ana ekran (StandartAnaEkran.dc.html) saf seçimleri — İşler kutularının yetki süzgeci (Modüller sayfasıyla aynı), bekleyen işler
// kutuları ve "Düzenle" sırası.
import { describe, expect, it } from "vitest";
import { ANA_ISLER, anaIsler, bekleyenler } from "./ana-ekran.ts";
import { kaydir, siraUygula, tasi } from "./ana-sira.ts";

const base = "/t/demo";
const keys = (roles: string[], grants: string[] = [], screens: string[] | null = null) => anaIsler(base, { roles, grants, screens }).map((x) => x.key);

describe("İşler kutuları (T-1115)", () => {
  it("tuval sırası: 8 kutu", () => {
    expect(ANA_ISLER.map((x) => x.key)).toEqual(["giris", "satis", "stok", "urun", "cari", "depo", "excel", "kayit"]);
  });

  it("hesap sahibi sekizini de görür; bağlantılar Modüller sayfasıyla aynı", () => {
    const all = anaIsler(base, { roles: ["TENANT_ADMIN"], grants: [], screens: null });
    expect(all).toEqual([
      { key: "giris", href: "/t/demo/field/receive" },
      { key: "satis", href: "/t/demo/shipping" },
      { key: "stok", href: "/t/demo/stock" },
      { key: "urun", href: "/t/demo/items" },
      { key: "cari", href: "/t/demo/parties" },
      { key: "depo", href: "/t/demo/warehouses" },
      { key: "excel", href: "/t/demo/import" },
      { key: "kayit", href: "/t/demo/audit" },
    ]);
  });

  it("depo yöneticisi: Excel aktarımı yetkisi yok → kutu gizli; özel yetkiyle görünür", () => {
    expect(keys(["WAREHOUSE_MANAGER"])).toEqual(["giris", "satis", "stok", "urun", "cari", "depo", "kayit"]);
    expect(keys(["WAREHOUSE_MANAGER"], ["data.import"])).toContain("excel");
  });

  it("salt okunur: yazma (mal girişi), denetim kaydı ve Excel yok", () => {
    const r = keys(["READ_ONLY"]);
    expect(r).toEqual(["satis", "stok", "urun", "cari", "depo"]);
  });

  it("özel grubun görünür ekranları: listede olmayan ekranın kutusu çizilmez (mal girişi, sevkiyat)", () => {
    const r = keys(["WAREHOUSE_MANAGER"], [], ["count"]);
    expect(r).not.toContain("giris");
    expect(r).not.toContain("satis");
    expect(keys(["WAREHOUSE_MANAGER"], [], ["receive", "pick"])).toEqual(expect.arrayContaining(["giris", "satis"]));
  });
});

describe("Bekleyen işler (T-1115)", () => {
  const board = { orderCount: 2, oldestOrderDays: 4, countReview: 1, criticalCount: 3 };

  it("üç kutu, getBoard sayıları ve hedef listeler", () => {
    expect(bekleyenler(base, board, true)).toEqual([
      { key: "orders", n: 2, href: "/t/demo/shipping", days: 4 },
      { key: "count", n: 1, href: "/t/demo/counts", days: 0 },
      { key: "critical", n: 3, href: "/t/demo/stock", days: 0 },
    ]);
  });

  it("onay yetkisi yoksa sayım kutusu sayım görevlerini açar; sipariş yoksa gün 0", () => {
    const r = bekleyenler(base, { ...board, orderCount: 0 }, false);
    expect(r[1]?.href).toBe("/t/demo/tasks?kind=COUNT");
    expect(r[0]).toMatchObject({ n: 0, days: 0 });
  });
});

describe("Düzenle sırası (T-1115)", () => {
  const k = ["giris", "satis", "stok", "urun"];

  it("kayıtlı sıra uygulanır; bilinmeyen / tekrar eden / görünmeyen atılır, yeni kutu sona eklenir", () => {
    expect(siraUygula(k, ["stok", "giris", "yok", "stok", 5])).toEqual(["stok", "giris", "satis", "urun"]);
    expect(siraUygula(k, null)).toEqual(k);
    expect(siraUygula(k, { stok: 1 })).toEqual(k);
  });

  it("sürükle bırak ve oklar", () => {
    expect(tasi(k, "urun", 0)).toEqual(["urun", "giris", "satis", "stok"]);
    expect(tasi(k, "giris", 99)).toEqual(["satis", "stok", "urun", "giris"]);
    expect(tasi(k, "yok", 1)).toEqual(k);
    expect(kaydir(k, "satis", -1)).toEqual(["satis", "giris", "stok", "urun"]);
    expect(kaydir(k, "urun", 1)).toEqual(k);
  });
});
