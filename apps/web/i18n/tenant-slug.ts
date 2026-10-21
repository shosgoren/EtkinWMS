// T-999c: tenant sayfasının alan adını (slug) yoldan çıkarır; proxy bunu istek başlığına koyar, dil seçimi (request.ts) okur.
// Saf modül (proxy edge/node çalışma zamanında DB veya next/headers içe aktarmaz).
export const TENANT_SLUG_HEADER = "x-wms-tenant-slug";

const TENANT_PATH = /^\/(?:api\/)?t\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\/|$)/;

/** `/t/<alan>/...` veya `/api/t/<alan>/...` → `<alan>`; başka yol ya da geçersiz alan biçimi → null. */
export function tenantSlugFromPath(pathname: string): string | null {
  return TENANT_PATH.exec(pathname)?.[1] ?? null;
}
