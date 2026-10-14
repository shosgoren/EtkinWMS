import { create } from "qrcode";
import { AppError } from "@wms/shared/errors";
import type { PackageReceiptDto, ReceiptPackageDto } from "../actions.ts";
import { validPrintSettings, type PrintSettings } from "../../../labels/print-settings.ts";

export interface PackageQr { readonly id: string; readonly size: number; readonly path: string; }
export function postedLabelPackages(receipt: PackageReceiptDto): readonly ReceiptPackageDto[] {
  if (receipt.documentStatus !== "POSTED" || receipt.receiptStatus !== "CLOSED") throw new AppError("FORBIDDEN");
  if (receipt.packages.length === 0 || receipt.packages.length > 200) throw new AppError("VALIDATION_FAILED");
  const ids = new Set<string>();
  for (const p of receipt.packages) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.id) || p.qr !== `EWMS:PKG:1:${p.id}` || ids.has(p.id)) throw new AppError("VALIDATION_FAILED");
    ids.add(p.id);
  }
  return receipt.packages;
}
// Shared paper geometry; the preview separately measures actual QR/text fit.
export function validPackagePrintSettings(settings: PrintSettings): boolean {
  return validPrintSettings(settings);
}
export function packageQr(p: ReceiptPackageDto): PackageQr {
  if (p.qr !== `EWMS:PKG:1:${p.id}`) throw new AppError("VALIDATION_FAILED");
  const { modules } = create(p.qr, { errorCorrectionLevel: "M" });
  const quiet = 4;
  const parts: string[] = [];
  for (let y = 0; y < modules.size; y++) for (let x = 0; x < modules.size; x++) {
    if (modules.get(y, x)) parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
  }
  if (parts.length === 0) throw new Error("QR generation failed");
  return { id: p.id, size: modules.size + quiet * 2, path: parts.join("") };
}
// Atomic collection: a failed QR never exposes a partial printable sheet.
export async function generatePackageQrs(packages: readonly ReceiptPackageDto[], generate: (p: ReceiptPackageDto) => PackageQr | Promise<PackageQr> = packageQr): Promise<readonly PackageQr[]> {
  const qrs = await Promise.all(packages.map(p => Promise.resolve().then(() => generate(p))));
  if (qrs.length === 0 || qrs.some((qr, i) => qr.id !== packages[i]?.id || !qr.path || !Number.isFinite(qr.size) || qr.size <= 0)) throw new Error("QR generation failed");
  return qrs;
}
