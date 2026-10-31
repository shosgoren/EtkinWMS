// T-1141: kart bölümü × işlem kataloğu (ürün / cari / depo / raf yeri) — tek kaynak, rol eşlemesi ve ekran gösterim kararı.
import { describe, expect, it } from "vitest";
import {
  CARD_ACTIONS,
  CARD_PERMISSION_CATALOGUE,
  CARD_SECTIONS,
  GRANTABLE,
  PERMISSIONS,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
  cardPermission,
  cardRights,
  hasPermission,
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

describe("kart anahtarları ve roller (erişim değişmez)", () => {
  it("rollerde yalnız TENANT_ADMIN taşır (bugünkü settings.manage erişimiyle aynı)", () => {
    for (const k of WRITE_KEYS) {
      for (const r of ROLE_KEYS) expect(ROLE_PERMISSIONS[r].includes(k), `${r} ${k}`).toBe(r === "TENANT_ADMIN");
      expect(hasPermission(["TENANT_ADMIN"], k)).toBe(hasPermission(["TENANT_ADMIN"], "settings.manage"));
    }
  });

  it("gruba verilemez: grants listesinde olsa bile yetki vermez (yetki ekranı + 0051 CHECK işi T-1142)", () => {
    for (const k of WRITE_KEYS) {
      expect(GRANTABLE).not.toContain(k);
      expect(hasPermission(["WAREHOUSE_MANAGER"], k, [k, ...GRANTABLE])).toBe(false);
    }
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

  it("bilinmeyen rol hiçbir şey vermez", () => {
    expect(cardRights(["NOPE"], ["items.create"], "items")).toEqual({ create: false, edit: false, archive: false, import: false });
  });
});
