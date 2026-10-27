// T-958: Modüller sayfasının modül → yetki eşlemesi (Kabuk.dc.html). Görünürlük yalnız üyenin rol/yetki/grup ekranlarına göre;
// salt okuyan ve saha personeli yönetici modüllerini görmez; ekranı olmayan modül YAKINDA (bağlantı yok).
import { describe, expect, it } from "vitest";
import { MODULE_DEFS, isFieldOnly, kabukModules } from "./modules.ts";

const base = "/t/demo";
const ids = (roles: string[], grants: string[] = [], screens: string[] | null = null) => kabukModules(base, { roles, grants, screens }).map((m) => m.id);

describe("Kabuk modülleri (T-958)", () => {
  it("T-979c: görünüm geçişi Ana ekrandan hemen sonra; İşlemler'deyken Genel bakış, Genel bakış'tayken İşlemler; saha personeli de görür", () => {
    const flow = kabukModules(base, { roles: ["READ_ONLY"], grants: [], screens: null }, "flow");
    expect(flow.slice(0, 2).map((m) => m.id)).toEqual(["home", "kokpit"]);
    expect(flow[1]).toMatchObject({ view: "cockpit", href: "/t/demo" });
    const cockpit = kabukModules(base, { roles: ["PICKER"], grants: [], screens: null }, "cockpit");
    expect(cockpit.slice(0, 2).map((m) => m.id)).toEqual(["home", "akis"]);
    expect(cockpit[1]).toMatchObject({ view: "flow" });
    expect(kabukModules(base, { roles: ["PICKER"], grants: [], screens: null }).some((m) => m.view !== undefined)).toBe(false);
  });

  it("kaynak listesinin sırası (19 modül; T-1094 Excel çıktı) + T-979c eski menüden taşınan 3 yönetim ekranı", () => {
    expect(MODULE_DEFS.map((m) => m.id)).toEqual(["home", "urun", "depo", "satin", "satis", "topla", "trans", "uret", "qr", "koli", "tara", "sayim", "ayin", "ses", "abone", "fis", "etiket", "cari", "ekip", "stok", "ayar", "kayit"]);
  });

  it("hesap sahibi hepsini görür; gerçek ekranlar bağlantı, ekranı olmayanlar YAKINDA", () => {
    const all = kabukModules(base, { roles: ["TENANT_ADMIN"], grants: [], screens: null });
    expect(all).toHaveLength(22);
    expect(all.find((m) => m.id === "stok")?.href).toBe("/t/demo/stock");
    expect(all.find((m) => m.id === "ayar")?.href).toBe("/t/demo/settings");
    expect(all.find((m) => m.id === "kayit")?.href).toBe("/t/demo/audit");
    const soon = all.filter((m) => m.href === null).map((m) => m.id);
    expect(soon).toEqual(["satin", "ayin", "ses", "abone", "etiket"]);
    expect(all.find((m) => m.id === "ekip")?.href).toBe("/t/demo/team");
    // T-1094: Excel'den aktar Modüller'de yok (yalnız Ayarlar › Entegrasyonlar).
    expect(all.some((m) => m.id === "excel")).toBe(false);
    expect(all.find((m) => m.id === "home")?.href).toBe("/t/demo");
    expect(all.find((m) => m.id === "trans")?.href).toBe("/t/demo/stock/documents?new=TRANSFER");
  });

  it("salt okunur: yönetici ve yazma modülleri yok (Ekip, Excel, Abonelik, Etiket, Ayın personeli, Satın alma, Transfer, Toplama, Sayım)", () => {
    const r = ids(["READ_ONLY"]);
    for (const admin of ["ekip", "excel", "abone", "etiket", "ayin", "satin", "trans", "topla", "sayim", "ayar"]) expect(r).not.toContain(admin);
    expect(r.slice(0, 11)).toEqual(["home", "urun", "depo", "satis", "uret", "qr", "koli", "tara", "ses", "fis", "cari"]);
    expect(r).toContain("stok");
  });

  it("depo sorumlusu: ekip / içe aktarma / abonelik yok; transfer ve satın alma var", () => {
    const r = ids(["WAREHOUSE_MANAGER"]);
    expect(r).not.toContain("ekip");
    expect(r).not.toContain("excel");
    expect(r).not.toContain("abone");
    expect(r).toContain("trans");
    expect(r).toContain("satin");
  });

  it("saha personeli yalnız kaynaktaki FIELD alt kümesini görür (rolüne göre)", () => {
    expect(isFieldOnly(["PICKER"])).toBe(true);
    expect(isFieldOnly(["PICKER", "READ_ONLY"])).toBe(false);
    expect(isFieldOnly([])).toBe(false);
    expect(ids(["PICKER"])).toEqual(["home", "topla", "koli", "tara", "ses"]);
    expect(ids(["COUNTER"])).toEqual(["home", "koli", "tara", "sayim", "ses"]);
    expect(ids(["PICKER", "COUNTER"])).toEqual(["home", "topla", "koli", "tara", "sayim", "ses"]);
  });

  it("özel grup yetkisi Excel modülü açmaz (T-1094: Excel yalnız Ayarlar › Entegrasyonlar); saha kişisinde yönetici modülü yine yok", () => {
    expect(ids(["READ_ONLY"], ["data.import"])).not.toContain("excel");
    expect(ids(["PICKER"], ["data.import"])).not.toContain("excel");
    // Kapalı listede olmayan yetki grubu yoluyla verilemez (users.manage).
    expect(ids(["READ_ONLY"], ["users.manage"])).not.toContain("ekip");
  });

  it("özel grubun görünür ekranları görev modüllerini daraltır", () => {
    expect(ids(["PICKER", "COUNTER"], [], ["count"])).toEqual(["home", "koli", "tara", "sayim", "ses"]);
    expect(ids(["TENANT_ADMIN"], [], ["receive"])).not.toContain("trans");
    expect(ids(["TENANT_ADMIN"], [], ["receive"])).toContain("ekip");
  });

  it("bilinmeyen rol hiçbir yetkili modülü açmaz", () => {
    expect(ids(["GHOST"])).toEqual(["home", "ses"]);
  });
});
