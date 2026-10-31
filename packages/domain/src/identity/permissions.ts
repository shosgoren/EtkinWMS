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
  // hiçbir rol erişim kaybetmez/kazanmaz). T-1142: gruba verilebilir (GRANTABLE + 0070 CHECK).
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
 * T-421: özel gruba verilebilecek EK yetkiler (0070 CHECK ile aynı kapalı liste). `stock.view` her üyede rol yoluyla vardır.
 * `users.manage` ve `settings.manage` BİLEREK yoktur: ekip yönetimi rol değiştirme, davet, parola sıfırlama bağlantısı ve cihaz onayı taşır
 * (yönetici olmayan biri başka hesabı yönetici yapabilirdi); ayarlar görev ayrımını kapatma, örnek veri silme ve entegrasyonları taşır (onaylayan
 * kendi denetimini kapatabilirdi; güvenlik incelemesi). İkisi de yalnız Yönetici rolündedir. `audit.view` ve `takeout.request` de yalnız roldedir.
 * T-1142 (kullanıcı kararı 31 Ekim, yetki ekranı): kart bölümü × işlem anahtarları (T-1141) gruba verilebilir (migration 0070).
 */
export const GRANTABLE: readonly Permission[] = Object.freeze([
  "stock.post",
  "document.create",
  "document.approve",
  "count_diff.approve",
  "reversal.create",
  "data.import",
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
] as const);
/**
 * Taşıyana MFA zorunlu kılan yetkiler (rolde MFA_REQUIRED_ROLES ile aynı gerekçe: onay, ters kayıt, toplu yazma).
 * T-1142: cari anahtarları — cari kartı kişisel veri taşır (vergi no, telefon, e-posta, adres). Ürün ve depo anahtarları — bağlı dış sisteme
 * (ERP) giden kart değişikliği. Taşıyan üye iki adımlı doğrulama ister, saha hesabına (MFA yapamaz) verilemez. Raf yeri anahtarları MFA
 * istemez: raf yerleri yalnız Etkin'dedir ve saha personeli kullanır. Toplu kişisel veri (Excel aktarımı/indirmesi) yine yalnız `settings.manage`.
 */
export const MFA_GRANTS: readonly Permission[] = Object.freeze([
  "document.approve",
  "count_diff.approve",
  "reversal.create",
  "data.import",
  "items.create",
  "items.edit",
  "items.archive",
  "parties.create",
  "parties.edit",
  "parties.archive",
  "warehouses.create",
  "warehouses.edit",
  "warehouses.archive",
] as const);

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

/**
 * T-1142 (kullanıcı kararı 31 Ekim: "tüm kullanıcı yetkileri toggle ile pratik ayarlanmalı"): YETKİ EKRANI KATALOĞU — tek kaynak.
 * Ekran (Ayarlar › Kullanıcılar ve yetki › Yetkiler) bölüm başlığı + işlem başına aç/kapa satırı olarak çizer; liste sabit kodlanmaz.
 * Her izin en az bir satırda (birim testi). `grantable` = gruba verilebilir (GRANTABLE); değilse satır kilitli ve gerekçesi `lock`:
 * `everyone` (her üyede rol yoluyla açık), `admin` (yalnız Yönetici rolü). `mfa` = taşıyana iki adımlı doğrulama zorunlu (MFA_GRANTS).
 * Satır kimliği `<bölüm>.<işlem>` web dil dosyasında `yetkiler.rows.<bölüm>.<işlem>` etiketidir. Entegrasyon ayrı anahtar değildir
 * (`settings.manage`); satır yalnız bilgi verir.
 */
export const PERMISSION_SECTIONS = Object.freeze(["items", "parties", "warehouses", "locations", "stock", "documents", "excel", "reports", "settings", "integrations"] as const);
export type PermissionSection = (typeof PERMISSION_SECTIONS)[number];

export interface PermissionRow {
  readonly section: PermissionSection;
  /** `<bölüm>.<işlem>` (etiket anahtarı). */
  readonly id: string;
  readonly permission: Permission;
  readonly grantable: boolean;
  readonly mfa: boolean;
  /** Gruba verilemeyen satırın kilit gerekçesi. */
  readonly lock: "everyone" | "admin" | null;
}

const row = (section: PermissionSection, action: string, permission: Permission): PermissionRow => {
  const grantable = GRANTABLE.includes(permission);
  const lock = grantable ? null : permission === "stock.view" ? "everyone" : "admin";
  return Object.freeze({ section, id: `${section}.${action}`, permission, grantable, mfa: MFA_GRANTS.includes(permission), lock });
};

export const PERMISSION_CATALOGUE: readonly PermissionRow[] = Object.freeze([
  row("items", "create", "items.create"),
  row("items", "edit", "items.edit"),
  row("items", "archive", "items.archive"),
  row("parties", "create", "parties.create"),
  row("parties", "edit", "parties.edit"),
  row("parties", "archive", "parties.archive"),
  row("warehouses", "create", "warehouses.create"),
  row("warehouses", "edit", "warehouses.edit"),
  row("warehouses", "archive", "warehouses.archive"),
  row("locations", "create", "locations.create"),
  row("locations", "edit", "locations.edit"),
  row("locations", "archive", "locations.archive"),
  row("stock", "post", "stock.post"),
  row("stock", "countApprove", "count_diff.approve"),
  row("stock", "reverse", "reversal.create"),
  row("documents", "create", "document.create"),
  row("documents", "approve", "document.approve"),
  row("excel", "import", "data.import"),
  row("reports", "stock", "stock.view"),
  row("reports", "audit", "audit.view"),
  row("reports", "takeout", "takeout.request"),
  row("settings", "manage", "settings.manage"),
  row("settings", "users", "users.manage"),
  row("integrations", "manage", "settings.manage"),
]);

/**
 * Hazır yetki şablonları (yetki ekranında tek dokunuşla gruba uygulanır; grup rolün ÜSTÜNE ek yetki verir). Hepsi GRANTABLE alt kümesi.
 * "Depo sorumlusu" ve "Kart sorumlusu" MFA isteyen anahtar taşır (onay, ters kayıt, ürün/depo/cari kartı): saha hesabı olan grupta ekran bu
 * anahtarları atlar (yalnız MFA istemeyenler uygulanır).
 * "Salt okunur" = ek yetki yok (üye yalnız rolünün izinleriyle kalır).
 */
export const PERMISSION_PRESETS: readonly { readonly id: string; readonly grants: readonly Permission[] }[] = Object.freeze([
  Object.freeze({
    id: "warehouseLead",
    grants: Object.freeze([
      "stock.post",
      "document.create",
      "document.approve",
      "count_diff.approve",
      "reversal.create",
      "items.create",
      "items.edit",
      "warehouses.edit",
      "locations.create",
      "locations.edit",
      "locations.archive",
    ] as const),
  }),
  Object.freeze({ id: "picker", grants: Object.freeze(["stock.post"] as const) }),
  Object.freeze({ id: "counter", grants: Object.freeze(["document.create"] as const) }),
  Object.freeze({ id: "cardKeeper", grants: Object.freeze(CARD_SECTIONS.flatMap((g) => (["create", "edit", "archive"] as const).map((a) => cardPermission(g, a)))) }),
  Object.freeze({ id: "readOnly", grants: Object.freeze([] as Permission[]) }),
]);

/** Etkin iznin kaynağı (yetki ekranı kişi görünümü): rol mü, grup mu, yok mu. Rol öncelikli (grup aynı izni ayrıca verse de "rol"). */
export function permissionSource(roles: readonly string[], grants: readonly string[], permission: Permission): "role" | "group" | null {
  if (hasPermission(roles, permission)) return "role";
  if (hasPermission([], permission, grants)) return "group";
  return null;
}
