// T-421: özel yetki grubu — saf doğrulama ve yetki birleşimi (rol ∪ grup; kapalı liste dışı yetki yok sayılır).
import { describe, expect, it } from "vitest";
import { cleanGroup, needsMfa, nextGrants } from "./groups.ts";
import { GRANTABLE, MFA_GRANTS, hasPermission } from "./permissions.ts";

describe("cleanGroup", () => {
  it("ad kırpılır, kontrol karakteri boşluk olur; renk büyük harf; liste kanonik sırada ve tekrarsız", () => {
    const r = cleanGroup({ name: "  Satın\u0007alma  ", color: "#2f5da8", screens: ["count", "receive", "count"], grants: ["data.import", "document.create"] });
    expect(r).toEqual({ ok: true, value: { name: "Satın alma", color: "#2F5DA8", screens: ["receive", "count"], grants: ["document.create", "data.import"] } });
  });
  it("boş ad, uzun ad, palet dışı renk sorun döner", () => {
    expect(cleanGroup({ name: "   " })).toEqual({ ok: false, issue: "NAME_MISSING" });
    expect(cleanGroup({ name: "x".repeat(61) })).toEqual({ ok: false, issue: "NAME_TOO_LONG" });
    expect(cleanGroup({ name: "A", color: "#000000" })).toEqual({ ok: false, issue: "COLOR_INVALID" });
  });
  it("kapalı liste dışı ekran ya da yetki (ör. audit.view, stock.view) reddedilir", () => {
    expect(() => cleanGroup({ name: "A", grants: ["audit.view"] })).toThrow();
    expect(() => cleanGroup({ name: "A", grants: ["stock.view"] })).toThrow();
    expect(() => cleanGroup({ name: "A", grants: ["users.manage"] })).toThrow(); // ekip yönetimi grupla verilmez (yetki yükseltme)
    expect(() => cleanGroup({ name: "A", screens: ["admin"] })).toThrow();
    expect(() => cleanGroup({ name: "A", grants: "users.manage" })).toThrow();
  });
});

describe("hasPermission + grants", () => {
  it("grup yetkisi role eklenir; rol izni daralmaz", () => {
    expect(hasPermission(["PICKER"], "document.create")).toBe(false);
    expect(hasPermission(["PICKER"], "document.create", ["document.create"])).toBe(true);
    expect(hasPermission(["WAREHOUSE_MANAGER"], "document.approve", [])).toBe(true);
  });
  it("kapalı liste dışı grant yetki vermez", () => {
    expect(hasPermission(["READ_ONLY"], "audit.view", ["audit.view"])).toBe(false);
    expect(hasPermission(["READ_ONLY"], "takeout.request", ["takeout.request"])).toBe(false);
    expect(hasPermission(["PICKER"], "users.manage", ["users.manage"])).toBe(false);
  });
  it("hassas yetkiler MFA ister", () => {
    expect(needsMfa(["stock.post", "document.create"])).toBe(false);
    for (const g of MFA_GRANTS) expect(needsMfa([g])).toBe(true);
    expect(MFA_GRANTS.every((g) => GRANTABLE.includes(g))).toBe(true);
  });
});

describe("nextGrants (T-1142 aç/kapa)", () => {
  it("ekle / çıkar kanonik sırada; tekrar aynı sonucu verir (idempotent)", () => {
    expect(nextGrants([], ["items.edit", "stock.post"], [])).toEqual(["stock.post", "items.edit"]);
    expect(nextGrants(["stock.post", "items.edit"], ["items.edit"], [])).toEqual(["stock.post", "items.edit"]);
    expect(nextGrants(["stock.post", "items.edit"], [], ["items.edit"])).toEqual(["stock.post"]);
    expect(nextGrants(["stock.post"], [], ["items.edit"])).toEqual(["stock.post"]);
    expect(nextGrants([], [...GRANTABLE], [])).toEqual([...GRANTABLE]);
  });
  it("kapalı liste dışı, boş, çakışan ya da dizi olmayan girdi reddedilir", () => {
    expect(() => nextGrants([], ["settings.manage"], [])).toThrow();
    expect(() => nextGrants([], ["users.manage"], [])).toThrow();
    expect(() => nextGrants([], [], [])).toThrow();
    expect(() => nextGrants([], ["items.edit"], ["items.edit"])).toThrow();
    expect(() => nextGrants([], "items.edit", [])).toThrow();
    expect(() => nextGrants([], [...GRANTABLE, "stock.post"], [])).toThrow();
  });
  it("cari anahtarları MFA ister; ürün anahtarları istemez", () => {
    expect(needsMfa(["parties.edit"])).toBe(true);
    expect(needsMfa(["items.edit", "warehouses.create", "locations.archive"])).toBe(false);
  });
});
