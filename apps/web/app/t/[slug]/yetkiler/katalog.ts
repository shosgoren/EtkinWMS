// T-1142: yetki ekranının İSTEMCİ tarafı tipleri ve saf yardımcıları. "use client" dosyaları `@wms/domain` içe aktaramaz (T-127b, AC-28);
// tipler `@wms/domain/identity/permissions` (`Permission`, `PermissionSection`, `PermissionRow`, `RoleKey`) ile birebir aynıdır (eşlik
// `katalog.test.ts` içinde derleme zamanında). Katalog DEĞERİ (satırlar, hazır şablonlar, rol izinleri) sunucu sayfasında domain'den okunup
// prop olarak gelir; burada liste sabit kodlanmaz. Kararın kendisi domain komutundadır; bu dosya yalnız gösterim hesaplar.
export type YetkiAnahtar =
  | "stock.view"
  | "document.create"
  | "document.approve"
  | "stock.post"
  | "reversal.create"
  | "count_diff.approve"
  | "takeout.request"
  | "settings.manage"
  | "users.manage"
  | "audit.view"
  | "data.import"
  | "items.create"
  | "items.edit"
  | "items.archive"
  | "parties.create"
  | "parties.edit"
  | "parties.archive"
  | "warehouses.create"
  | "warehouses.edit"
  | "warehouses.archive"
  | "locations.create"
  | "locations.edit"
  | "locations.archive"
  | "labels.view"
  | "labels.design"
  | "labels.publish"
  | "labels.print"
  | "labels.printers";

export type YetkiBolum = "items" | "parties" | "warehouses" | "locations" | "stock" | "documents" | "excel" | "reports" | "settings" | "integrations" | "labels";

export type YetkiRol = "TENANT_ADMIN" | "WAREHOUSE_MANAGER" | "PICKER" | "COUNTER" | "READ_ONLY";

export interface YetkiSatir {
  readonly section: YetkiBolum;
  readonly id: string;
  readonly permission: YetkiAnahtar;
  readonly grantable: boolean;
  readonly mfa: boolean;
  readonly lock: "everyone" | "admin" | null;
}

export interface YetkiSablon {
  readonly id: string;
  readonly grants: readonly YetkiAnahtar[];
}

/** Sunucunun verdiği katalog (domain tek kaynağı). */
export interface YetkiKatalog {
  readonly sections: readonly YetkiBolum[];
  readonly rows: readonly YetkiSatir[];
  readonly presets: readonly YetkiSablon[];
  readonly rolePermissions: Readonly<Record<YetkiRol, readonly YetkiAnahtar[]>>;
}

export type YetkiKaynak = "role" | "group" | null;

/** Domain `permissionSource` ile aynı kural: rollerden BİRİ taşıyorsa rol (birleşim, `hasPermission` gibi); grup yalnız verilebilir anahtarda. */
export function yetkiKaynagi(k: YetkiKatalog, roles: readonly string[], grants: readonly string[], p: YetkiAnahtar): YetkiKaynak {
  if (roles.some((role) => Object.hasOwn(k.rolePermissions, role) && k.rolePermissions[role as YetkiRol].includes(p))) return "role";
  if (grants.includes(p) && k.rows.some((r) => r.permission === p && r.grantable)) return "group";
  return null;
}

/** Grubun yetkileri bir hazır şablona birebir eşitse onun kimliği, değilse `null` (sıra önemsiz). */
export function eslesenSablon(presets: readonly YetkiSablon[], grants: readonly string[]): string | null {
  const set = new Set(grants);
  return presets.find((p) => p.grants.length === set.size && p.grants.every((g) => set.has(g)))?.id ?? null;
}

/** Bölümün verilebilir anahtarları ve açık olan sayısı. */
export function bolumDurumu(rows: readonly YetkiSatir[], section: YetkiBolum, grants: readonly string[]): { readonly keys: readonly YetkiAnahtar[]; readonly on: number } {
  const keys = [...new Set(rows.filter((r) => r.section === section && r.grantable).map((r) => r.permission))];
  return { keys, on: keys.filter((g) => grants.includes(g)).length };
}

/** Şablonu uygulamak için ekle/çıkar kümesi (sunucu küme işlemi; boşsa değişiklik yok). */
export function sablonFarki(rows: readonly YetkiSatir[], grants: readonly string[], target: readonly string[]): { readonly add: YetkiAnahtar[]; readonly remove: YetkiAnahtar[] } {
  const all = [...new Set(rows.filter((r) => r.grantable).map((r) => r.permission))];
  return { add: all.filter((g) => target.includes(g) && !grants.includes(g)), remove: all.filter((g) => !target.includes(g) && grants.includes(g)) };
}

/** Arama: Türkçe küçük harf, bölüm adı ya da satır adı/açıklaması içinde geçen. Boş arama hepsini döner. */
export function yetkiAra(rows: readonly YetkiSatir[], q: string, metin: (r: YetkiSatir) => string, kucuk: (s: string) => string): readonly YetkiSatir[] {
  const n = kucuk(q.trim());
  if (n === "") return rows;
  return rows.filter((r) => kucuk(metin(r)).includes(n));
}

/**
 * İyimser gösterimli istek: önce `uygula`, sonra istek. İstek REDDEDİLİRSE (ağ kopması, sunucu çökmesi) `geriAl` çalışır ve hata yeniden
 * fırlatılır (çağıran balonla söyler). Dönen hata sonucu (ok: false) çağıranın işidir.
 */
export async function iyimserIstek<T>(uygula: () => void, geriAl: () => void, istek: () => Promise<T>): Promise<T> {
  uygula();
  try {
    return await istek();
  } catch (e) {
    geriAl();
    throw e;
  }
}
