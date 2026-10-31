// T-1142: yetki ekranı kataloğu SUNUCUDA domain tek kaynağından kurulur (sayfa prop olarak verir; istemci domain içe aktarmaz, AC-28).
import { PERMISSION_CATALOGUE, PERMISSION_PRESETS, PERMISSION_SECTIONS, ROLE_PERMISSIONS } from "@wms/domain/identity/permissions";
import type { YetkiKatalog } from "./katalog.ts";

export function yetkiKatalogu(): YetkiKatalog {
  return { sections: PERMISSION_SECTIONS, rows: PERMISSION_CATALOGUE, presets: PERMISSION_PRESETS, rolePermissions: ROLE_PERMISSIONS };
}
