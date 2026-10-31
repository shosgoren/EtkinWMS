// T-1142 (güvenlik incelemesi MINOR-3): grup sihirbazı kaydı Yetkiler ekranında açılan anahtarları silmez.
import { describe, expect, it } from "vitest";
import { birlesikYetkiler, gruptakiGucler, gucYetkileri } from "./guc.ts";

describe("grup sihirbazı güç kartları (T-1142)", () => {
  it("kart dışı anahtarlar (kart yetkileri, tek başına belge onayı) kayıtta korunur", () => {
    const original = ["stock.post", "items.edit", "document.approve", "locations.create"];
    expect(birlesikYetkiler(original, gruptakiGucler(original), gruptakiGucler(original)).sort()).toEqual([...original].sort());
  });
  it("kart kapatılınca yalnız o kartın anahtarları çıkar; açılınca eklenir", () => {
    const original = ["stock.post", "document.create", "items.edit"];
    const before = gruptakiGucler(original);
    expect(before).toEqual(["scan", "create"]);
    expect(birlesikYetkiler(original, before, ["create"]).sort()).toEqual(["document.create", "items.edit"]);
    expect(birlesikYetkiler(original, before, ["scan", "create", "approve"]).sort()).toEqual(["count_diff.approve", "document.approve", "document.create", "items.edit", "stock.post"]);
  });
  it("yarım kart (yalnız belge onayı) açık görünmez ve dokunulmadıkça silinmez; ekip/ayar kartı yetki vermez", () => {
    expect(gruptakiGucler(["document.approve"])).toEqual([]);
    expect(birlesikYetkiler(["document.approve"], [], [])).toEqual(["document.approve"]);
    expect(gucYetkileri(["team", "settings"])).toEqual([]);
  });
});
