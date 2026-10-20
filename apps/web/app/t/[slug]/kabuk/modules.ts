// T-958 (Kabuk.dc.html "Modüller"): kaynaktaki modül listesi (renderVals `M`, aynı sıra) → GERÇEK uygulama ekranı ve yetki.
// Saf işlev (sunucuda, kiracı düzeninde çağrılır; birim testli). Yetki kararı domain'in `hasPermission` işlevidir; hedef sayfa erişimi
// ayrıca sunucuda denetler (bu liste yalnız görünürlüktür, yetki vermez).
// Kurallar:
// - Kaynakta saha personeli yalnız FIELD modüllerini görür (Ana ekran, Toplama, Tara, Sayım, Koli & palet, Sesli komut). Uygulamada
//   rolleri yalnız saha rolleri (Toplayıcı / Sayım) olan üye "saha"dır; diğer üyeler yetkilerinin açtığı tüm modülleri görür.
// - `need`: modülü açan izin (rol ya da özel grup yetkisi, `grants`). `screen`: özel yetki grubunun görünür görev ekranı (T-421);
//   üyenin grubu ekran listesi verdiyse (`screens !== null`) listede olmayan ekranın modülü çizilmez.
// - `path: null`: ekranı henüz yok → "YAKINDA" (bağlantı değildir). Yine de yetki kuralına uyar (yönetici modülü salt okuyana görünmez).
import { hasPermission, type Permission } from "@wms/domain/identity/permissions";
import { KICON } from "../../../design/kabuk-icons.ts";
import type { KabukModule, KabukModuleId } from "./types.ts";

export type { KabukModule, KabukModuleId } from "./types.ts";

interface ModuleDef {
  readonly id: KabukModuleId;
  /** Kaynak renk (onaltılık, `#` yok). */
  readonly color: string;
  readonly d: string;
  /** Kiracı köküne göre yol; `null` = ekranı yok (YAKINDA). */
  readonly path: string | null;
  readonly need: Permission | null;
  /** Özel yetki grubunun ekran anahtarı (GROUP_SCREENS). */
  readonly screen?: "receive" | "pick" | "transfer" | "prod" | "count" | "labels" | "reports" | "problem";
  /** Kaynak FIELD kümesi: saha personeli de görür. */
  readonly field?: true;
}

export const MODULE_DEFS: readonly ModuleDef[] = Object.freeze([
  { id: "home", color: "0E7C7B", d: KICON.mHome, path: "", need: null, field: true },
  { id: "urun", color: "2F5DA8", d: KICON.mUrun, path: "/items", need: "stock.view" },
  { id: "depo", color: "30475A", d: KICON.mDepo, path: "/warehouses", need: "stock.view" },
  { id: "satin", color: "B5552B", d: KICON.mSatin, path: null, need: "document.create" },
  { id: "satis", color: "C25A00", d: KICON.mSatis, path: "/shipping", need: "stock.view", screen: "pick" },
  { id: "topla", color: "2F7D5B", d: KICON.mTopla, path: "/field/tasks", need: "stock.post", screen: "pick", field: true },
  { id: "trans", color: "6C4BD8", d: KICON.mTrans, path: "/stock/documents?new=TRANSFER", need: "stock.post", screen: "transfer" },
  { id: "uret", color: "8A5A12", d: KICON.mUret, path: "/production", need: "stock.view", screen: "prod" },
  { id: "qr", color: "172E42", d: KICON.mQr, path: "/labels", need: "stock.view", screen: "labels" },
  { id: "koli", color: "9A5B2E", d: KICON.mKoli, path: "/field/packages", need: "stock.view", field: true },
  { id: "tara", color: "0E7C7B", d: KICON.mTara, path: "/field", need: "stock.view", field: true },
  { id: "sayim", color: "2F5DA8", d: KICON.mSayim, path: "/field/tasks", need: "document.create", screen: "count", field: true },
  { id: "ayin", color: "B07D0B", d: KICON.mAyin, path: null, need: "users.manage" },
  { id: "ses", color: "6C4BD8", d: KICON.mSes, path: null, need: null, field: true },
  { id: "abone", color: "17804F", d: KICON.mAbone, path: null, need: "settings.manage" },
  { id: "fis", color: "4E6476", d: KICON.mFis, path: "/stock/documents", need: "stock.view" },
  { id: "excel", color: "1E7B45", d: KICON.mExcel, path: "/import", need: "data.import" },
  { id: "etiket", color: "B23A3A", d: KICON.mEtiket, path: null, need: "settings.manage" },
  { id: "cari", color: "0F6E8C", d: KICON.mCari, path: "/parties", need: "stock.view" },
  { id: "ekip", color: "7A4BC2", d: KICON.mEkip, path: "/team", need: "users.manage" },
] satisfies ModuleDef[]);

export interface KabukMember {
  readonly roles: readonly string[];
  readonly grants: readonly string[];
  /** Özel grubun görünür ekranları; `null` = rolün varsayılanı (hepsi). */
  readonly screens: readonly string[] | null;
}

const FIELD_ROLES: readonly string[] = ["PICKER", "COUNTER"];

/** Rolleri yalnız saha rolleri olan üye (kaynaktaki "Saha personeli"). */
export function isFieldOnly(roles: readonly string[]): boolean {
  return roles.length > 0 && roles.every((r) => FIELD_ROLES.includes(r));
}

/** Üyenin görebileceği modüller (kaynak sırası). `base`: `/t/<slug>`. */
export function kabukModules(base: string, member: KabukMember): KabukModule[] {
  const field = isFieldOnly(member.roles);
  return MODULE_DEFS.filter((m) => {
    if (field && m.field !== true) return false;
    if (m.need !== null && !hasPermission(member.roles, m.need, member.grants)) return false;
    if (m.screen !== undefined && member.screens !== null && !member.screens.includes(m.screen)) return false;
    return true;
  }).map((m) => ({ id: m.id, color: m.color, d: m.d, href: m.path === null ? null : `${base}${m.path}` }));
}
