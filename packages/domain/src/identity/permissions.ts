// Rol × izin matrisi (ADR-016 §4, OPEN_QUESTIONS A-45). TEK KAYNAK: değişiklik A-45/Q-22 güncellemesi ister.
// Görev ayrımı (A-03) bu dosyada yoktur: firma ayarı, identity/separation.ts (T-416). Depo kapsamı warehouse/scope.ts (T-413).
import type { Membership } from "@wms/db";

export const ROLE_KEYS = Object.freeze(["TENANT_ADMIN", "WAREHOUSE_MANAGER", "PICKER", "COUNTER", "READ_ONLY"] as const);
export type RoleKey = (typeof ROLE_KEYS)[number];

const PERMISSION_LIST = [
  "stock.view",
  "document.create",
  "document.approve",
  "stock.post",
  "reversal.create",
  "count_diff.approve",
  "takeout.request",
  "settings.manage",
  "users.manage",
  "audit.view",
  // T-421/T-427: Excel'den aktarım (ürün, cari, açılış stoku). Hesap sahibinde her zaman; diğerlerine yalnız özel yetki grubuyla.
  "data.import",
  // T-1141 (kullanıcı kararı 31 Ekim): kart bölümü × işlem. Rollerde yalnız `TENANT_ADMIN` (bugünkü `settings.manage` erişimiyle birebir;
  // hiçbir rol erişim kaybetmez/kazanmaz). Gruba verilebilirlik (GRANTABLE + 0051 CHECK) yetki ekranı işinde açılır.
  "items.create",
  "items.edit",
  "items.archive",
  "parties.create",
  "parties.edit",
  "parties.archive",
  "warehouses.create",
  "warehouses.edit",
  "warehouses.archive",
  "locations.create",
  "locations.edit",
  "locations.archive",
] as const;
export type Permission = (typeof PERMISSION_LIST)[number];
/** Derin dondurulmuş (çalışma anında değiştirilemez). */
export const PERMISSIONS: readonly Permission[] = Object.freeze([...PERMISSION_LIST]);

// Derleme zamanı: bu dosyadaki RoleKey ile `@wms/db` üyelik rolü aynı küme olmalı.
type DbRoleKey = Membership["roles"][number];
const _roleKeysMatchDb: [RoleKey] extends [DbRoleKey] ? ([DbRoleKey] extends [RoleKey] ? true : never) : never = true;
void _roleKeysMatchDb;

const freeze = (list: readonly Permission[]): readonly Permission[] => Object.freeze([...list]);

export const ROLE_PERMISSIONS: Readonly<Record<RoleKey, readonly Permission[]>> = Object.freeze({
  TENANT_ADMIN: PERMISSIONS,
  WAREHOUSE_MANAGER: freeze([
    "stock.view",
    "document.create",
    "document.approve",
    "stock.post",
    "reversal.create",
    "count_diff.approve",
    "audit.view",
  ]),
  PICKER: freeze(["stock.view", "stock.post"]),
  COUNTER: freeze(["stock.view", "document.create"]),
  READ_ONLY: freeze(["stock.view"]),
});

/**
 * T-421: özel gruba verilebilecek EK yetkiler (0051 CHECK ile aynı kapalı liste). `stock.view` her üyede rol yoluyla vardır.
 * `users.manage` ve `settings.manage` BİLEREK yoktur: ekip yönetimi rol değiştirme, davet, parola sıfırlama bağlantısı ve cihaz onayı taşır
 * (yönetici olmayan biri başka hesabı yönetici yapabilirdi); ayarlar görev ayrımını kapatma, örnek veri silme ve entegrasyonları taşır (onaylayan
 * kendi denetimini kapatabilirdi; güvenlik incelemesi). İkisi de yalnız Yönetici rolündedir.
 */
export const GRANTABLE: readonly Permission[] = Object.freeze([
  "stock.post",
  "document.create",
  "document.approve",
  "count_diff.approve",
  "reversal.create",
  "data.import",
] as const);
/** Taşıyana MFA zorunlu kılan yetkiler (rolde MFA_REQUIRED_ROLES ile aynı gerekçe: onay, ters kayıt, toplu yazma). */
export const MFA_GRANTS: readonly Permission[] = Object.freeze(["document.approve", "count_diff.approve", "reversal.create", "data.import"] as const);

/**
 * Rollerden en az biri izni taşıyorsa ya da üyenin özel grubu (T-421) bu yetkiyi veriyorsa `true`. Bilinmeyen rol/izin → `false`.
 * `grants` yalnız kapalı listedeki (GRANTABLE) değerlerle eşleşir.
 */
export function hasPermission(roles: readonly string[], permission: Permission, grants: readonly string[] = []): boolean {
  if (grants.includes(permission) && GRANTABLE.includes(permission)) return true;
  return roles.some((role) => {
    if (!Object.hasOwn(ROLE_PERMISSIONS, role)) return false;
    return (ROLE_PERMISSIONS as Readonly<Record<string, readonly Permission[]>>)[role]?.includes(permission) === true;
  });
}

/**
 * T-1141: kart bölümleri ve işlemleri — TEK KATALOG. Yetki ekranı (Yetki grupları / Ekip) bu listeyi bölüm (grup) × işlem anahtarları olarak
 * çizer; ekranlar (`cardRights`) ve domain komutları aynı anahtarları kullanır. Etiketler web dil dosyasında: `yetkiKatalog.groups.<group>`,
 * `yetkiKatalog.actions.<action>`, kilit gerekçesi `yetkiKatalog.locked.<group>.<action>`.
 * `requires`: işlemin istediği izinlerin HEPSİ. `write: false` = yazma değildir (etiket/QR basımı kayıt yazmaz; `stock.view`).
 * `shared: true` = anahtar başka bölümlerle ortaktır (Excel aktarımı `data.import`); ayrı anahtara bölmek grup taşıma migration'ı ister.
 */
export const CARD_SECTIONS = Object.freeze(["items", "parties", "warehouses", "locations"] as const);
export type CardSection = (typeof CARD_SECTIONS)[number];
export const CARD_ACTIONS = Object.freeze(["create", "edit", "archive", "import", "label"] as const);
export type CardAction = (typeof CARD_ACTIONS)[number];

export interface CardPermissionEntry {
  readonly group: CardSection;
  readonly action: CardAction;
  readonly requires: readonly Permission[];
  readonly write: boolean;
  readonly shared: boolean;
  /** Bu anahtarın kapsadığı işlemler (ekran/yetki listesinde açıklama için): ör. arşivle + geri al, kod değiştirme. */
  readonly covers: readonly string[];
}

const entry = (group: CardSection, action: CardAction, requires: readonly Permission[], covers: readonly string[], opts: { write?: boolean; shared?: boolean } = {}): CardPermissionEntry =>
  Object.freeze({ group, action, requires: Object.freeze([...requires]), write: opts.write ?? true, shared: opts.shared ?? false, covers: Object.freeze([...covers]) });

export const CARD_PERMISSION_CATALOGUE: readonly CardPermissionEntry[] = Object.freeze([
  entry("items", "create", ["items.create"], ["create"]),
  entry("items", "edit", ["items.edit"], ["edit", "codeChange", "barcode", "unit", "conversion"]),
  entry("items", "archive", ["items.archive"], ["archive"]),
  entry("items", "import", ["data.import"], ["import"], { shared: true }),
  entry("items", "label", ["stock.view"], ["label"], { write: false, shared: true }),
  entry("parties", "create", ["parties.create"], ["create"]),
  entry("parties", "edit", ["parties.edit"], ["edit", "codeChange"]),
  entry("parties", "archive", ["parties.archive"], ["archive", "restore"]),
  entry("parties", "import", ["data.import"], ["import"], { shared: true }),
  entry("warehouses", "create", ["warehouses.create"], ["create"]),
  entry("warehouses", "edit", ["warehouses.edit"], ["edit", "codeChange"]),
  entry("warehouses", "archive", ["warehouses.archive"], ["archive"]),
  entry("warehouses", "import", ["data.import", "settings.manage"], ["import"], { shared: true }),
  entry("locations", "create", ["locations.create"], ["create", "bulk"]),
  entry("locations", "edit", ["locations.edit"], ["edit", "codeChange", "kind"]),
  entry("locations", "archive", ["locations.archive"], ["archive"]),
  entry("locations", "import", ["data.import", "settings.manage"], ["import"], { shared: true }),
  entry("locations", "label", ["stock.view"], ["label"], { write: false, shared: true }),
]);

/** Bölüm + işlem → yazma anahtarı (yalnız tek anahtarlı yazma işlemleri: create / edit / archive). */
export const cardPermission = (group: CardSection, action: "create" | "edit" | "archive"): Permission => `${group}.${action}` as Permission;

export interface CardRights {
  readonly create: boolean;
  readonly edit: boolean;
  readonly archive: boolean;
  readonly import: boolean;
}

/** Ekranın gösterim kararı (yalnız kilit/gösterim; asıl karar domain komutunda). Katalogdaki `requires` listesinin hepsi gerekir. */
export function cardRights(roles: readonly string[], grants: readonly string[], group: CardSection): CardRights {
  const can = (action: CardAction): boolean => {
    const e = CARD_PERMISSION_CATALOGUE.find((x) => x.group === group && x.action === action);
    return e !== undefined && e.requires.every((p) => hasPermission(roles, p, grants));
  };
  return Object.freeze({ create: can("create"), edit: can("edit"), archive: can("archive"), import: can("import") });
}
