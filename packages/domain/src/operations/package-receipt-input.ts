// T-931: pure input contract only. No package identity allocation, DB write or stock effect.
import { AppError, type ErrorDetail } from "@wms/shared/errors";
import { assertLotDates, parseDateOnly, parseNfcText } from "../catalog/lots.ts";
import { addDecimal, assertConversionFactor, assertQuantityScale, toBase } from "../catalog/quantity.ts";

export interface PackageReceiptItemContext {
  /** Loaded by the server for the selected item/unit; never spread from caller input. */
  readonly quantityScale: number;
  readonly toBaseFactor: string;
  readonly trackingMode: "NONE" | "LOT" | "SERIAL" | "LOT_AND_SERIAL";
}

export interface PackageReceiptRow {
  readonly quantity: string;
  readonly baseQuantity: string;
  readonly lotCode?: string;
  readonly producedOn?: string;
  readonly expiresOn?: string;
}

export interface ValidatedPackageReceipt {
  readonly packages: readonly PackageReceiptRow[];
  readonly totalQuantity: string;
  readonly totalBaseQuantity: string;
  readonly toBaseFactor: string;
}

const MAX_PACKAGES = 200;
const ROW_KEYS = ["quantity", "lotCode", "producedOn", "expiresOn"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QR_PREFIX = "EWMS:PKG:1:";

function invalid(detail?: ErrorDetail): never {
  throw new AppError("VALIDATION_FAILED", detail === undefined ? undefined : { detail });
}

function record(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) invalid();
  const prototype: unknown = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid();
  return value;
}

function date(raw: unknown): string | undefined {
  return raw === undefined ? undefined : parseDateOnly(raw);
}

function row(raw: unknown, context: PackageReceiptItemContext): PackageReceiptRow {
  const value = record(raw, ROW_KEYS);
  if (typeof value.quantity !== "string") invalid();
  const quantity = assertQuantityScale(value.quantity, 6, "positive");
  const baseQuantity = toBase(quantity, context.toBaseFactor, context.quantityScale);
  let lotCode: string | undefined;
  if (value.lotCode !== undefined) {
    if (typeof value.lotCode !== "string" || value.lotCode.length > 256 || /[\p{C}\u2028\u2029]/u.test(value.lotCode)) invalid();
    lotCode = parseNfcText(value.lotCode, 64);
  }
  if (context.trackingMode === "LOT" && lotCode === undefined) invalid();
  const producedOn = date(value.producedOn);
  const expiresOn = date(value.expiresOn);
  assertLotDates(producedOn, expiresOn);
  return {
    quantity, baseQuantity,
    ...(lotCode === undefined ? {} : { lotCode }),
    ...(producedOn === undefined ? {} : { producedOn }),
    ...(expiresOn === undefined ? {} : { expiresOn }),
  };
}

/**
 * Explicit: {mode:"explicit", packages:[{quantity, lotCode?, producedOn?, expiresOn?}]}.
 * Equal shortcut: {mode:"equal", count, quantity, lotCode?, producedOn?, expiresOn?}.
 * Quantity is PER physical package. No total/count division; no identities are minted here.
 * Output decimals/order are canonical for a future persisted idempotency payload.
 */
export function validatePackageReceiptInput(raw: unknown, trustedItem: PackageReceiptItemContext): ValidatedPackageReceipt {
  const context = record(trustedItem, ["quantityScale", "toBaseFactor", "trackingMode"]);
  if (typeof context.quantityScale !== "number" || !Number.isInteger(context.quantityScale) || context.quantityScale < 0 || context.quantityScale > 6) invalid();
  if (context.trackingMode !== "NONE" && context.trackingMode !== "LOT") invalid();
  if (typeof context.toBaseFactor !== "string") invalid();
  const factor = assertConversionFactor(context.toBaseFactor);
  const item: PackageReceiptItemContext = { quantityScale: context.quantityScale, toBaseFactor: factor, trackingMode: context.trackingMode };
  const input = record(raw, ["mode", "packages", "count", ...ROW_KEYS]);
  let packages: PackageReceiptRow[];
  if (input.mode === "explicit") {
    record(input, ["mode", "packages"]);
    if (!Array.isArray(input.packages) || input.packages.length === 0) invalid();
    if (input.packages.length > MAX_PACKAGES) invalid("DOCUMENT_TOO_LARGE");
    // Array.from deliberately visits sparse holes; missing physical packages must fail.
    packages = Array.from(input.packages, (value) => row(value, item));
  } else if (input.mode === "equal") {
    record(input, ["mode", "count", ...ROW_KEYS]);
    if (typeof input.count !== "number" || !Number.isInteger(input.count) || input.count < 1) invalid();
    if (input.count > MAX_PACKAGES) invalid("DOCUMENT_TOO_LARGE");
    const validated = row(Object.fromEntries(ROW_KEYS.map((key) => [key, input[key]])), item);
    packages = Array.from({ length: input.count }, () => ({ ...validated }));
  } else invalid();
  const totalQuantity = assertQuantityScale(packages.reduce((sum, value) => addDecimal(sum, value.quantity), "0"), 6, "positive");
  const totalBaseQuantity = assertQuantityScale(packages.reduce((sum, value) => addDecimal(sum, value.baseQuantity), "0"), item.quantityScale, "positive");
  return { packages, totalQuantity, totalBaseQuantity, toBaseFactor: factor };
}

/** Identity only: caller must load and authorize the tenant package; QR is never a capability. */
export function encodePackageQr(packageId: unknown): string {
  if (typeof packageId !== "string" || !UUID.test(packageId)) invalid();
  return `${QR_PREFIX}${packageId.toLowerCase()}`;
}

export function decodePackageQr(raw: unknown): string {
  if (typeof raw !== "string" || raw.length !== QR_PREFIX.length + 36 || !raw.startsWith(QR_PREFIX)) invalid();
  const packageId = raw.slice(QR_PREFIX.length);
  if (!UUID.test(packageId)) invalid();
  return packageId.toLowerCase();
}
