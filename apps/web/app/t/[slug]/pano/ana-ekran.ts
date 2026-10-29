// T-1115 (STANDART §8 adım 3, tuval `StandartAnaEkran.dc.html` "1 · Ana ekran"): hesap sahibi / depo yöneticisi ana ekranının saf
// seçimleri — sunucuda çağrılır (birim testli). Yalnız görünürlüktür, yetki vermez: hedef sayfa erişimi ayrıca sunucuda denetler.
// - "Bekleyen işler" üç kutusu `getBoard` sayılarından (uydurma yok, G-07): bekleyen sipariş (`orderCount`), onay bekleyen sayım
//   (`countReview`), kritik stok (`criticalCount`).
// - "İşler" sekiz kutusu tuval sırasıyla; modülü olan kutu Modüller sayfasının yetki süzgecinden geçer (`kabukModules`: rol, özel grup
//   yetkisi, grubun görünür ekranları). Modülü olmayan iki kutu (Depoya mal geldi, Excel'den aktar) aynı kuralla kendi izniyle süzülür.
// - T-1128: "Düzenle"de eklenebilir kutular = izinli sekiz tuval kutusu + Modüller sayfasında açılabilen diğer bütün modüller (ekranı olan;
//   YAKINDA, Ana ekran ve görünüm geçişi hariç). Aynı süzgeç; yalnız görünürlük.
import { hasPermission, type Permission } from "@wms/domain/identity/permissions";
import type { Board } from "@wms/domain/operations";
import { kabukModules, type KabukMember, type KabukModuleId } from "../kabuk/modules.ts";
import type { AnaAday, AnaIs, AnaIsKey } from "./ana-sira.ts";

export type { AnaAday, AnaIs, AnaIsKey } from "./ana-sira.ts";

interface AnaIsDef {
  readonly key: AnaIsKey;
  /** Modüller sayfasındaki karşılığı (yetki ve bağlantı oradan). */
  readonly mod?: KabukModuleId;
  /** Modülü yoksa: kiracı köküne göre yol, izin ve grubun ekran anahtarı. */
  readonly path?: string;
  readonly need?: Permission;
  readonly screen?: string;
}

/** Tuval sırası (kullanıcı "Düzenle" ile cihazında yeniden sıralayabilir). */
export const ANA_ISLER: readonly AnaIsDef[] = Object.freeze([
  // Kokpit "Depoya mal geldi" ile aynı hedef (saha kabulü; yazma `stock.post`).
  { key: "giris", path: "/field/receive", need: "stock.post", screen: "receive" },
  { key: "satis", mod: "satis" },
  { key: "stok", mod: "stok" },
  { key: "urun", mod: "urun" },
  { key: "cari", mod: "cari" },
  { key: "depo", mod: "depo" },
  // T-1094: Modüller'de yok; ana ekran tuvalinde var → Excel aktarım ekranı (`data.import`, ekranın kendi denetimi).
  { key: "excel", path: "/import", need: "data.import" },
  { key: "kayit", mod: "kayit" },
] satisfies AnaIsDef[]);

/** Üyenin görebileceği İşler kutuları (tuval sırası). Yetkisiz ya da ekranı olmayan kutu listede yoktur (gizlenir). */
export function anaIsler(base: string, member: KabukMember): AnaIs[] {
  const mods = kabukModules(base, member);
  const out: AnaIs[] = [];
  for (const d of ANA_ISLER) {
    if (d.mod !== undefined) {
      const href = mods.find((m) => m.id === d.mod)?.href ?? null;
      if (href !== null) out.push({ key: d.key, href });
      continue;
    }
    if (d.need !== undefined && !hasPermission(member.roles, d.need, member.grants)) continue;
    if (d.screen !== undefined && member.screens !== null && !member.screens.includes(d.screen)) continue;
    out.push({ key: d.key, href: `${base}${d.path ?? ""}` });
  }
  return out;
}

/**
 * T-1128: üyenin "Düzenle"de ekleyebileceği bütün kutular — önce izinli tuval kutuları (tuval sırası; `anaIsler` ile aynı), sonra tuval
 * kutusu olmayan izinli modüller (Modüller sayfası sırası, renk + ikon). Tuval kutusunun modülü (ör. Sevkiyat) ikinci kez gelmez.
 */
export function anaIsAdaylari(base: string, member: KabukMember): AnaAday[] {
  const tuvalMod = new Set<string>(ANA_ISLER.flatMap((d) => (d.mod === undefined ? [] : [d.mod])));
  const out: AnaAday[] = [...anaIsler(base, member)];
  for (const m of kabukModules(base, member)) {
    if (m.href === null || m.id === "home" || m.view !== undefined || tuvalMod.has(m.id)) continue;
    out.push({ key: m.id, href: m.href, mod: { color: m.color, d: m.d } });
  }
  return out;
}

export type BekleyenKey = "orders" | "count" | "critical";

export interface Bekleyen {
  readonly key: BekleyenKey;
  readonly n: number;
  readonly href: string;
  /** Yalnız sipariş: en eski bekleyenin günü (sipariş yoksa 0). */
  readonly days: number;
}

/**
 * "Bekleyen işler" üç kutusu (tuval sırası). Sayım kutusu onay yetkisi (`document.approve`) olana sayım oturumları listesini, olmayana
 * sayım görevlerini açar (sayım ekranı onay yetkisi ister).
 */
export function bekleyenler(base: string, board: Pick<Board, "orderCount" | "oldestOrderDays" | "countReview" | "criticalCount">, canApprove: boolean): Bekleyen[] {
  return [
    { key: "orders", n: board.orderCount, href: `${base}/shipping`, days: board.orderCount > 0 ? board.oldestOrderDays : 0 },
    { key: "count", n: board.countReview, href: canApprove ? `${base}/counts` : `${base}/tasks?kind=COUNT`, days: 0 },
    { key: "critical", n: board.criticalCount, href: `${base}/stock`, days: 0 },
  ];
}
