// T-1142: yetki ekranı istemci tipleri domain ile birebir (derleme zamanı) ve gösterim hesabı domain kuralıyla aynı (çalışma zamanı).
import { describe, expect, it } from "vitest";
import {
  GRANTABLE,
  PERMISSIONS,
  PERMISSION_CATALOGUE,
  ROLE_KEYS,
  permissionSource,
  type Permission,
  type PermissionRow,
  type PermissionSection,
  type RoleKey,
} from "@wms/domain/identity/permissions";
import { bolumDurumu, eslesenSablon, sablonFarki, yetkiAra, yetkiKaynagi, type YetkiAnahtar, type YetkiBolum, type YetkiRol, type YetkiSatir } from "./katalog.ts";
import { yetkiKatalogu } from "./katalog-sunucu.ts";

type Ayni<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _anahtar: Ayni<YetkiAnahtar, Permission> = true;
const _bolum: Ayni<YetkiBolum, PermissionSection> = true;
const _rol: Ayni<YetkiRol, RoleKey> = true;
const _satir: Ayni<YetkiSatir, PermissionRow> = true;
void _anahtar;
void _bolum;
void _rol;
void _satir;

const k = yetkiKatalogu();

describe("yetki ekranı kataloğu (T-1142)", () => {
  it("katalog domain'den gelir: bütün izinler ve bölümler", () => {
    expect(k.rows).toBe(PERMISSION_CATALOGUE);
    for (const p of PERMISSIONS) expect(k.rows.some((r) => r.permission === p), p).toBe(true);
  });

  it("yetkiKaynagi her rol × izin × grup için domain permissionSource ile aynı", () => {
    const grantSets: readonly (readonly string[])[] = [[], [...GRANTABLE], ["items.edit"], ["settings.manage", "users.manage"], ["parties.create", "stock.post"]];
    for (const role of [...ROLE_KEYS, "NOPE"]) {
      for (const g of grantSets) {
        for (const p of PERMISSIONS) expect(yetkiKaynagi(k, role, g, p), `${role} ${p} ${g.join(",")}`).toBe(permissionSource([role], g, p));
      }
    }
  });

  it("şablon eşleşmesi sıradan bağımsız; fark küme işlemi", () => {
    expect(eslesenSablon(k.presets, [])).toBe("readOnly");
    expect(eslesenSablon(k.presets, ["stock.post"])).toBe("picker");
    expect(eslesenSablon(k.presets, ["stock.post", "items.edit"])).toBeNull();
    expect(sablonFarki(k.rows, ["stock.post", "items.edit"], ["stock.post", "document.create"])).toEqual({ add: ["document.create"], remove: ["items.edit"] });
    expect(sablonFarki(k.rows, ["stock.post"], ["stock.post"])).toEqual({ add: [], remove: [] });
  });

  it("bölüm durumu yalnız verilebilir anahtarları sayar", () => {
    expect(bolumDurumu(k.rows, "items", ["items.edit"])).toEqual({ keys: ["items.create", "items.edit", "items.archive"], on: 1 });
    expect(bolumDurumu(k.rows, "settings", ["settings.manage"]).keys).toEqual([]);
    expect(bolumDurumu(k.rows, "stock", ["stock.post", "reversal.create"]).on).toBe(2);
  });

  it("arama küçük harf duyarsız; boş arama hepsini döner", () => {
    const lower = (s: string) => s.toLocaleLowerCase("tr");
    expect(yetkiAra(k.rows, "", (r) => r.id, lower)).toHaveLength(k.rows.length);
    expect(yetkiAra(k.rows, "PARTIES", (r) => r.id, lower).every((r) => r.section === "parties")).toBe(true);
  });
});
