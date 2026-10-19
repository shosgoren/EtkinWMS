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
 * `users.manage` BİLEREK yoktur: ekip yönetimi rol değiştirme, davet, parola sıfırlama bağlantısı ve cihaz onayı taşır; grupla verilirse
 * yönetici olmayan biri başka hesabı yönetici yapabilirdi (yetki yükseltme). Ekip yönetimi yalnız Yönetici rolündedir.
 */
export const GRANTABLE: readonly Permission[] = Object.freeze([
  "stock.post",
  "document.create",
  "document.approve",
  "count_diff.approve",
  "reversal.create",
  "data.import",
  "settings.manage",
] as const);
/** Taşıyana MFA zorunlu kılan yetkiler (rolde MFA_REQUIRED_ROLES ile aynı gerekçe: onay, ters kayıt, ayar, toplu yazma). */
export const MFA_GRANTS: readonly Permission[] = Object.freeze(["document.approve", "count_diff.approve", "reversal.create", "data.import", "settings.manage"] as const);

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
