// T-1141: kart bölümü × işlem kataloğu (ürün / cari / depo / raf yeri) — tek kaynak, rol eşlemesi ve ekran gösterim kararı.
import { describe, expect, it } from "vitest";
import {
  CARD_ACTIONS,
  CARD_PERMISSION_CATALOGUE,
  CARD_SECTIONS,
  GRANTABLE,
  MFA_GRANTS,
  PERMISSION_CATALOGUE,
  PERMISSION_PRESETS,
  PERMISSION_SECTIONS,
  PERMISSIONS,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
  cardPermission,
  cardRights,
  hasPermission,
  permissionSource,
  type Permission,
} from "./permissions.ts";

const WRITE_KEYS: readonly Permission[] = CARD_SECTIONS.flatMap((g) => (["create", "edit", "archive"] as const).map((a) => cardPermission(g, a)));

describe("CARD_PERMISSION_CATALOGUE", () => {
  it("her bölümde Ekle / Değiştir / Arşivle / Excel girişi var; anahtarlar izin listesinde", () => {
    for (const g of CARD_SECTIONS) {
      for (const a of ["create", "edit", "archive", "import"] as const) {
        const e = CARD_PERMISSION_CATALOGUE.find((x) => x.group === g && x.action === a);
        expect(e, `${g}.${a}`).toBeDefined();
      }
    }
    for (const e of CARD_PERMISSION_CATALOGUE) {
      expect(CARD_ACTIONS).toContain(e.action);
      for (const p of e.requires) expect(PERMISSIONS).toContain(p);
      expect(Object.isFrozen(e)).toBe(true);
    }
    expect(Object.isFrozen(CARD_PERMISSION_CATALOGUE)).toBe(true);
  });

  it("bölüm × işlem başına tek kayıt; yazma işlemlerinin anahtarı `<bölüm>.<işlem>`", () => {
    const keys = CARD_PERMISSION_CATALOGUE.map((e) => `${e.group}:${e.action}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of CARD_PERMISSION_CATALOGUE.filter((x) => x.action === "create" || x.action === "edit" || x.action === "archive")) {
      expect(e.requires).toEqual([`${e.group}.${e.action}`]);
      expect(e.write).toBe(true);
      expect(e.shared).toBe(false);
    }
  });

  it("etiket basımı yazma değildir; Excel ortak `data.import` anahtarıdır", () => {
    for (const e of CARD_PERMISSION_CATALOGUE.filter((x) => x.action === "label")) expect(e).toMatchObject({ write: false, requires: ["stock.view"] });
    for (const e of CARD_PERMISSION_CATALOGUE.filter((x) => x.action === "import")) {
      expect(e.shared).toBe(true);
      expect(e.requires).toContain("data.import");
    }
  });
});

describe("kart anahtarları, roller ve gruplar", () => {
  it("rollerde yalnız TENANT_ADMIN taşır (bugünkü settings.manage erişimiyle aynı)", () => {
    for (const k of WRITE_KEYS) {
      for (const r of ROLE_KEYS) expect(ROLE_PERMISSIONS[r].includes(k), `${r} ${k}`).toBe(r === "TENANT_ADMIN");
      expect(hasPermission(["TENANT_ADMIN"], k)).toBe(hasPermission(["TENANT_ADMIN"], "settings.manage"));
    }
  });

  it("T-1142: gruba verilebilir — grup yetkiyi verir, yalnız o anahtarı (kısmi küme)", () => {
    for (const k of WRITE_KEYS) {
      expect(GRANTABLE).toContain(k);
      expect(hasPermission(["READ_ONLY"], k, [k])).toBe(true);
      expect(hasPermission(["READ_ONLY"], k, WRITE_KEYS.filter((x) => x !== k))).toBe(false);
    }
    expect(cardRights(["PICKER"], ["items.edit"], "items")).toEqual({ create: false, edit: true, archive: false, import: false });
    expect(cardRights(["PICKER"], ["parties.create"], "parties")).toEqual({ create: true, edit: false, archive: false, import: false });
  });

  it("T-1142: cari (kişisel veri), ürün ve depo (dış sisteme giden) anahtarları MFA ister; raf yeri anahtarları istemez", () => {
    for (const k of WRITE_KEYS) expect(MFA_GRANTS.includes(k), k).toBe(!k.startsWith("locations."));
    expect(MFA_GRANTS.every((g) => GRANTABLE.includes(g))).toBe(true);
  });

  it("yönetici anahtarları hâlâ gruba verilemez", () => {
    for (const k of ["settings.manage", "users.manage", "audit.view", "takeout.request", "stock.view"] as const) {
      expect(GRANTABLE).not.toContain(k);
      expect(hasPermission(["READ_ONLY"], k, [k, ...GRANTABLE])).toBe(k === "stock.view");
    }
  });
});

describe("PERMISSION_CATALOGUE (T-1142 yetki ekranı)", () => {
  it("her izin en az bir satırda; satır kimlikleri tekil; bölümler sıralı listede", () => {
    for (const p of PERMISSIONS) expect(PERMISSION_CATALOGUE.some((r) => r.permission === p), p).toBe(true);
    const ids = PERMISSION_CATALOGUE.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of PERMISSION_CATALOGUE) {
      expect(PERMISSION_SECTIONS).toContain(r.section);
      expect(r.id.startsWith(`${r.section}.`)).toBe(true);
      expect(Object.isFrozen(r)).toBe(true);
    }
    for (const s of PERMISSION_SECTIONS) expect(PERMISSION_CATALOGUE.some((r) => r.section === s), s).toBe(true);
  });

  it("verilebilirlik, MFA ve kilit gerekçesi kapalı listelerden türetilir", () => {
    for (const r of PERMISSION_CATALOGUE) {
      expect(r.grantable).toBe(GRANTABLE.includes(r.permission));
      expect(r.mfa).toBe(MFA_GRANTS.includes(r.permission));
      expect(r.lock).toBe(r.grantable ? null : r.permission === "stock.view" ? "everyone" : "admin");
    }
    for (const g of GRANTABLE) expect(PERMISSION_CATALOGUE.some((r) => r.permission === g && r.grantable), g).toBe(true);
  });

  it("hazır şablonlar GRANTABLE alt kümesi, tekil kimlik; Salt okunur boş", () => {
    const ids = PERMISSION_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PERMISSION_PRESETS) for (const g of p.grants) expect(GRANTABLE, `${p.id} ${g}`).toContain(g);
    expect(PERMISSION_PRESETS.find((p) => p.id === "readOnly")?.grants).toEqual([]);
    expect(PERMISSION_PRESETS.find((p) => p.id === "picker")?.grants).toEqual(["stock.post"]);
    expect(PERMISSION_PRESETS.find((p) => p.id === "cardKeeper")?.grants).toEqual(WRITE_KEYS);
  });

  it("permissionSource: rol önce, sonra grup, yoksa null", () => {
    expect(permissionSource(["WAREHOUSE_MANAGER"], ["document.approve"], "document.approve")).toBe("role");
    expect(permissionSource(["PICKER"], ["items.edit"], "items.edit")).toBe("group");
    expect(permissionSource(["PICKER"], [], "items.edit")).toBeNull();
    expect(permissionSource(["PICKER"], ["settings.manage"], "settings.manage")).toBeNull();
    // İki rollü üye: rollerin birleşimi (ilk rol değil).
    expect(permissionSource(["PICKER", "COUNTER"], [], "document.create")).toBe("role");
    expect(permissionSource(["COUNTER", "PICKER"], [], "stock.post")).toBe("role");
    expect(permissionSource(["PICKER", "COUNTER"], ["items.edit"], "items.edit")).toBe("group");
  });
});

describe("cardRights", () => {
  it("hesap sahibi her şeyi, diğer roller hiçbir kart yazmasını göremez", () => {
    for (const g of CARD_SECTIONS) {
      expect(cardRights(["TENANT_ADMIN"], [], g)).toEqual({ create: true, edit: true, archive: true, import: true });
      for (const r of ["WAREHOUSE_MANAGER", "PICKER", "COUNTER", "READ_ONLY"]) {
        expect(cardRights([r], [], g)).toMatchObject({ create: false, edit: false, archive: false });
      }
    }
  });

  it("Excel: ürün / cari `data.import` ile; depo / raf ayrıca `settings.manage` ister", () => {
    expect(cardRights(["READ_ONLY"], ["data.import"], "items").import).toBe(true);
    expect(cardRights(["READ_ONLY"], ["data.import"], "parties").import).toBe(true);
    expect(cardRights(["READ_ONLY"], ["data.import"], "warehouses").import).toBe(false);
    expect(cardRights(["READ_ONLY"], ["data.import"], "locations").import).toBe(false);
    expect(cardRights(["READ_ONLY"], ["data.import"], "items")).toMatchObject({ create: false, edit: false, archive: false });
  });

  it("bilinmeyen rol hiçbir şey vermez; gruba verilemeyen anahtar grants'ta olsa da yok sayılır", () => {
    expect(cardRights(["NOPE"], [], "items")).toEqual({ create: false, edit: false, archive: false, import: false });
    expect(cardRights(["NOPE"], ["settings.manage", "data.import"], "warehouses")).toEqual({ create: false, edit: false, archive: false, import: false });
  });
});
