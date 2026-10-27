import { SCANNER_CONFIG } from "../../../../lib/scanner/scanner-config.ts";
import { create } from "qrcode";
import { AppError } from "@wms/shared/errors";
import { MAX_LABELS_PER_DOCUMENT, toProductQrSvg, type LabelData } from "@wms/domain/labels";


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
    const svg = toProductQrSvg(d, { size, path: path.join("") });
    return Array.from({ length: copies }, () => svg);
  });
  // En az 0,25 mm/modül (~203 dpi yazıcıda 2 nokta); SVG ölçeklemesi her iki eksende de güvenli olmalı.
  return { pages, minWidth: Math.max(20, Math.ceil(maxSize * 0.25 / 0.33)), minHeight: Math.max(15, Math.ceil(maxSize * 0.25 / 0.66)) };
}
