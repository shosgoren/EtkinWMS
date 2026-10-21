// Paket metin biçimleri (Yonet.dc.html `pkSum` ve fiyat gösterimi). Sunucu ve istemci bileşenlerinin ortak, saf yardımcıları.
// T-436 (ALTIN-KURAL 16): sayı biçimi çağıranın verdiği kullanıcı diliyle (`locale`).
import { sayi } from "@wms/ui";

/** Kaynaktaki `pkSum`: "3 yönetici", "Sınırsız saha personeli"… */
export function planLines(
  p: { readonly limits: { readonly admins: number; readonly field: number; readonly warehouses: number; readonly items: number } },
  t: { readonly unlimited: string; readonly admins: string; readonly field: string; readonly warehouses: string; readonly items: string },
  locale: string,
): string[] {
  const lim = (v: number, u: string): string => (v === 0 ? `${t.unlimited} ${u}` : `${sayi(v, locale)} ${u}`);
  return [lim(p.limits.admins, t.admins), lim(p.limits.field, t.field), lim(p.limits.warehouses, t.warehouses), lim(p.limits.items, t.items)];
}

/** Fiyat gösterimi: tamsayı binlik ayraçlı, ondalıklı iki hane (kullanıcının dili). */
export function priceLabel(price: string, locale: string): string {
  const n = Number(price);
  if (price === "" || !Number.isFinite(n)) return price;
  return sayi(n, locale, { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
}

