import { SCANNER_CONFIG } from "../../../../lib/scanner/scanner-config.ts";
import { create } from "qrcode";
import { AppError } from "@wms/shared/errors";
import { MAX_LABELS_PER_DOCUMENT, type LabelData } from "@wms/domain/labels";

const escape = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const short = (s: string, max: number): string => Array.from(s).length > max ? `${Array.from(s).slice(0, max - 1).join("")}…` : s;

/** Standart ürün barkodu aynen QR içine girer; fiziksel paket kimliği üretilmez. Stok/barkod yazmaz. */
export function productQrDocument(datas: readonly LabelData[], copies: number): { readonly pages: readonly string[]; readonly minWidth: number; readonly minHeight: number } {
  if (!Number.isSafeInteger(copies) || copies < 1 || datas.length === 0 || datas.length * copies > MAX_LABELS_PER_DOCUMENT) throw new AppError("VALIDATION_FAILED");
  // Önce bütün etiketleri üret; bir hata olduğunda kısmi baskı paketi dönmez.
  let maxSize = 0;
  const pages = datas.flatMap((d) => {
    if (!("unit" in d)) throw new AppError("VALIDATION_FAILED");
    const value = d.barcode ?? "";
    if (value.startsWith("EWMS:") || value.length === 0 || value.length > SCANNER_CONFIG.maxLength || /[\u0000-\u001f\u007f]/.test(value)) throw new AppError("VALIDATION_FAILED");
    const { modules } = create(value, { errorCorrectionLevel: "M" });
    const size = modules.size + 8;
    maxSize = Math.max(maxSize, size);
    const path: string[] = [];
    for (let y = 0; y < modules.size; y++) for (let x = 0; x < modules.size; x++) if (modules.get(y, x)) path.push(`M${x + 4} ${y + 4}h1v1h-1z`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 1000 500"><rect width="1000" height="500" fill="white"/><defs><clipPath id="productTextClip"><rect width="610" height="360"/></clipPath></defs><g fill="black" font-family="Arial,sans-serif"><g clip-path="url(#productTextClip)"><text x="30" y="65" font-size="34" font-weight="bold">${escape(short(d.code, 27))}</text><text x="30" y="135" font-size="30">${escape(short(d.name, 30))}</text><text x="30" y="180" font-size="30">${escape(short(Array.from(d.name).slice(29).join(""), 30))}</text><text x="30" y="265" font-size="28">${escape(short(d.unit, 27))}</text></g><svg x="650" y="20" width="330" height="330" viewBox="0 0 ${size} ${size}"><path d="${path.join("")}"/></svg><text x="30" y="440" font-size="22">${escape(short(value, 72))}</text></g></svg>`;
    return Array.from({ length: copies }, () => svg);
  });
  // En az 0,25 mm/modül (~203 dpi yazıcıda 2 nokta); SVG ölçeklemesi her iki eksende de güvenli olmalı.
  return { pages, minWidth: Math.max(20, Math.ceil(maxSize * 0.25 / 0.33)), minHeight: Math.max(15, Math.ceil(maxSize * 0.25 / 0.66)) };
}
