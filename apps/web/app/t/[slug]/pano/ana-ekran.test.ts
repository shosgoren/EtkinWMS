// T-1115: ana ekran (StandartAnaEkran.dc.html) saf seçimleri — İşler kutularının yetki süzgeci (Modüller sayfasıyla aynı), bekleyen işler
// kutuları ve "Düzenle" sırası. T-1128: Düzenle'de eklenebilir işler (Modüller sayfasıyla aynı süzgeç) ve seçim kaydı (ekle / çıkar).
import { describe, expect, it } from "vitest";
import { ANA_ISLER, anaIsAdaylari, anaIsler, bekleyenler } from "./ana-ekran.ts";
import { cikar, ekle, eklenebilir, kaydir, secimKaydi, secimUygula, siraUygula, tasi } from "./ana-sira.ts";

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

describe("Düzenle: eklenebilir işler (T-1128)", () => {
  const adaylar = (roles: string[], grants: string[] = [], screens: string[] | null = null) => anaIsAdaylari(base, { roles, grants, screens });

  it("hesap sahibi: önce sekiz tuval kutusu, sonra ekranı olan diğer modüller (YAKINDA, Ana ekran, tuvaldeki modül yok)", () => {
    const a = adaylar(["TENANT_ADMIN"]);
    const k = a.map((x) => x.key);
    expect(k.slice(0, 8)).toEqual(["giris", "satis", "stok", "urun", "cari", "depo", "excel", "kayit"]);
    expect(k.slice(8)).toEqual(["topla", "trans", "uret", "qr", "koli", "tara", "sayim", "fis", "etiket", "ekip", "ayar"]);
    expect(new Set(k).size).toBe(k.length);
    for (const yok of ["home", "satin", "ayin", "ses", "abone"]) expect(k).not.toContain(yok);
    expect(a.find((x) => x.key === "etiket")).toMatchObject({ href: "/t/demo/label-designs" });
    // Tuval kutusu modül rengi taşımaz; modül kutusu Modüller sayfasının bağlantısı, rengi ve ikonuyla.
    expect(a[0]).toEqual({ key: "giris", href: "/t/demo/field/receive" });
    expect(a.find((x) => x.key === "trans")).toMatchObject({ href: "/t/demo/stock/documents?new=TRANSFER", mod: { color: "6C4BD8" } });
    expect(a.find((x) => x.key === "ekip")?.mod?.d.length ?? 0).toBeGreaterThan(0);
  });

  it("varsayılan kutular eklenebilirlerin başıdır (anaIsler ile aynı süzgeç)", () => {
    for (const roles of [["TENANT_ADMIN"], ["WAREHOUSE_MANAGER"], ["READ_ONLY"]]) {
      const v = anaIsler(base, { roles, grants: [], screens: null });
      expect(adaylar(roles).slice(0, v.length)).toEqual(v);
    }
  });

  it("yetki süzgeci: salt okunur yazma / yönetim modülü göremez; özel grup ekranı listede yoksa modül yok", () => {
    const r = adaylar(["READ_ONLY"]).map((x) => x.key);
    for (const yok of ["giris", "excel", "kayit", "topla", "trans", "sayim", "ekip", "etiket", "ayar"]) expect(r).not.toContain(yok);
    expect(r).toEqual(expect.arrayContaining(["fis", "koli", "tara", "qr", "uret"]));
    const g = adaylar(["WAREHOUSE_MANAGER"], [], ["count"]).map((x) => x.key);
    expect(g).toContain("sayim");
    for (const yok of ["trans", "uret", "qr", "topla", "satis"]) expect(g).not.toContain(yok);
  });

  it("saha personeli: mal girişi (kendi izni) + yalnız saha modülleri", () => {
    expect(adaylar(["PICKER"]).map((x) => x.key)).toEqual(["giris", "topla", "koli", "tara"]);
    expect(adaylar(["PICKER"], ["labels.print"]).some(x => x.key === "etiket")).toBe(false);
    expect(adaylar(["PICKER"], ["labels.view"]).find(x => x.key === "etiket")).toMatchObject({ href: "/t/demo/label-designs" });
  });
});

describe("Düzenle: seçim kaydı (T-1128)", () => {
  const v = ["giris", "satis", "stok"];
  const izin = ["giris", "satis", "stok", "trans", "fis"];

  it("kayıt yoksa ya da bozuksa varsayılan", () => {
    expect(secimUygula(v, izin, null)).toEqual(v);
    expect(secimUygula(v, izin, "x")).toEqual(v);
    expect(secimUygula(v, izin, { secim: "trans" })).toEqual(v);
    expect(secimUygula(v, izin, { baska: [] })).toEqual(v);
  });

  it("eski kayıt (dizi) varsayılanların sırasıdır: eksik varsayılan sona, izinli olsa da varsayılan dışı eklenmez", () => {
    expect(secimUygula(v, izin, ["stok", "giris"])).toEqual(["stok", "giris", "satis"]);
    expect(secimUygula(v, izin, ["trans", "stok"])).toEqual(["stok", "giris", "satis"]);
  });

  it("yeni kayıt olduğu gibi: çıkarılan varsayılan geri gelmez; izni kalmayan / bilinmeyen / tekrar eden / metin olmayan düşer", () => {
    expect(secimUygula(v, izin, { secim: ["trans", "giris"] })).toEqual(["trans", "giris"]);
    expect(secimUygula(v, izin, { secim: ["ayar", "fis", "fis", 3, "satis"] })).toEqual(["fis", "satis"]);
    expect(secimUygula(v, izin, { secim: [] })).toEqual([]);
  });

  it("kayıt gidiş-dönüş, ekle / çıkar / eklenebilir", () => {
    const o = ekle(cikar(v, "satis"), "trans");
    expect(o).toEqual(["giris", "stok", "trans"]);
    expect(ekle(o, "trans")).toEqual(o);
    expect(cikar(o, "yok")).toEqual(o);
    expect(eklenebilir(izin, o)).toEqual(["satis", "fis"]);
    expect(eklenebilir(izin, izin)).toEqual([]);
    expect(secimUygula(v, izin, JSON.parse(JSON.stringify(secimKaydi(o))) as unknown)).toEqual(o);
  });
});
