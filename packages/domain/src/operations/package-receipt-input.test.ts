import { describe, expect, it } from "vitest";
import { AppError } from "@wms/shared/errors";
import { decodePackageQr, encodePackageQr, validatePackageReceiptInput, type PackageReceiptItemContext } from "./package-receipt-input.ts";

const kg: PackageReceiptItemContext = { quantityScale: 3, toBaseFactor: "1", trackingMode: "NONE" };
const equal = (quantity: unknown = "200", count: unknown = 5) => ({ mode: "equal", count, quantity });
const explicit = (...packages: unknown[]) => ({ mode: "explicit", packages });

describe("physical package receipt contract", () => {
  it("5 drums retain five quantities, not one total identity; no invented persisted IDs", () => {
    const result = validatePackageReceiptInput(equal(), kg);
    expect(result.packages).toHaveLength(5);
    expect(result.packages.map((p) => p.baseQuantity)).toEqual(["200", "200", "200", "200", "200"]);
    expect(result.totalBaseQuantity).toBe("1000");
    expect(result.packages.every((p) => Object.keys(p).join(",") === "quantity,baseQuantity")).toBe(true);
    expect(result.packages[0]).not.toBe(result.packages[1]);
  });
  it("keeps unequal package quantities and lot/date associations in input order", () => {
    const result = validatePackageReceiptInput(explicit(
      { quantity: "199.5", lotCode: " LOT-A ", producedOn: "2024-02-29", expiresOn: "2026-02-28" },
      { quantity: "201.25", lotCode: "LOT-B" },
    ), { ...kg, trackingMode: "LOT" });
    expect(result.packages).toEqual([
      { quantity: "199.5", baseQuantity: "199.5", lotCode: "LOT-A", producedOn: "2024-02-29", expiresOn: "2026-02-28" },
      { quantity: "201.25", baseQuantity: "201.25", lotCode: "LOT-B" },
    ]);
    expect(result.totalQuantity).toBe("400.75");
    expect(validatePackageReceiptInput({ ...equal(), lotCode: "e\u0301" }, kg)).toEqual(validatePackageReceiptInput({ ...equal(), lotCode: "é" }, kg));
  });
  it("canonicalizes equal and explicit input identically for later idempotency hashing", () => {
    const a = validatePackageReceiptInput(equal("0001.500000", 2), { ...kg, toBaseFactor: "02.000" });
    const b = validatePackageReceiptInput(explicit({ quantity: "1.5" }, { quantity: "1.500" }), { ...kg, toBaseFactor: "2" });
    expect(a).toEqual(b);
    expect(a.totalBaseQuantity).toBe("6");
  });
  it("unit conversion must fit each package, even if a combined total would fit", () => {
    const pieces = { ...kg, quantityScale: 0, toBaseFactor: "5" };
    expect(() => validatePackageReceiptInput(equal("0.5", 2), pieces)).toThrow(expect.objectContaining({ detail: "QUANTITY_SCALE" }));
    expect(validatePackageReceiptInput(equal("0.2", 5), pieces).totalBaseQuantity).toBe("5");
    expect(() => validatePackageReceiptInput(equal("0.000001", 1), { ...kg, quantityScale: 6, toBaseFactor: "0.5" })).toThrow(expect.objectContaining({ detail: "QUANTITY_SCALE" }));
  });
  it("rejects aggregate overflow while allowing the largest representable single package", () => {
    expect(validatePackageReceiptInput(equal("99999999999999", 1), kg).totalBaseQuantity).toBe("99999999999999");
    expect(() => validatePackageReceiptInput(equal("50000000000000", 2), kg)).toThrow(AppError);
    expect(() => validatePackageReceiptInput(equal("50000000000000", 1), { ...kg, toBaseFactor: "2" })).toThrow(AppError);
  });
  it("accepts exactly 200 packages; invalid count/list sizes and sparse lists fail", () => {
    expect(validatePackageReceiptInput(equal("1", 200), kg).packages).toHaveLength(200);
    for (const count of [0, -1, 1.5, NaN, Infinity, "5", null, 201, 1e12]) {
      expect(() => validatePackageReceiptInput(equal("1", count), kg), String(count)).toThrow(AppError);
    }
    for (const packages of [[], null, {}, new Array(2), Array.from({ length: 201 }, () => ({ quantity: "1" }))]) {
      expect(() => validatePackageReceiptInput({ mode: "explicit", packages }, kg)).toThrow(AppError);
    }
  });
  it("requires positive bounded string decimals; never coerces numeric or locale input", () => {
    for (const quantity of [0, 1, NaN, null, undefined, "0", "-0", "-1", "NaN", "Infinity", "1e3", "1,5", " 1", "1.0000001", "1".repeat(41)]) {
      expect(() => validatePackageReceiptInput({ ...equal(), quantity }, kg), String(quantity)).toThrow(AppError);
    }
  });
  it("caller cannot supply conversion/scale, aggregate total, QR identity or mixed modes", () => {
    for (const input of [
      null, [], {}, Object.create(equal()), { mode: "other" },
      { ...equal(), toBaseFactor: "999" }, { ...equal(), quantityScale: 6 }, { ...equal(), totalQuantity: "1000" },
      { ...equal(), packages: [{ quantity: "1" }] }, { ...explicit({ quantity: "1" }), count: 1 },
      explicit({ quantity: "1", packageId: "invented" }), explicit({ quantity: "1", factor: "2" }),
    ]) expect(() => validatePackageReceiptInput(input, kg)).toThrow(AppError);
  });
  it("revalidates the server context and explicitly rejects unsupported serial tracking", () => {
    for (const context of [null, {}, { ...kg, quantityScale: NaN }, { ...kg, quantityScale: 7 }, { ...kg, toBaseFactor: "0" },
      { ...kg, toBaseFactor: "1.0000001" }, { ...kg, trackingMode: "SERIAL" }, { ...kg, trackingMode: "LOT_AND_SERIAL" }, { ...kg, trackingMode: "unknown" }]) {
      expect(() => validatePackageReceiptInput(equal(), context as PackageReceiptItemContext)).toThrow(AppError);
    }
  });
  it("lot requirement applies to every package, not just the receipt header", () => {
    const lot = { ...kg, trackingMode: "LOT" as const };
    expect(() => validatePackageReceiptInput(explicit({ quantity: "1", lotCode: "A" }, { quantity: "1" }), lot)).toThrow(AppError);
    for (const lotCode of ["", " ", null, 12, "x".repeat(65), "A\u200bB", "A\u2028B", "A\u2029B", "A\nB", "A\u0000B"]) {
      expect(() => validatePackageReceiptInput({ ...equal(), lotCode }, lot)).toThrow(AppError);
    }
  });
  it("validates real Gregorian days without Date rollover or current-time dependence", () => {
    for (const producedOn of ["2023-02-29", "1900-02-29", "2024-04-31", "0000-01-01", "1899-12-31", "3000-01-01", "2024-00-01", "2024-13-01", "2024-01-00", "2024-1-01", "2024-01-01T00:00:00Z", null, 20240101]) {
      expect(() => validatePackageReceiptInput({ ...equal(), producedOn }, kg), String(producedOn)).toThrow(AppError);
    }
    expect(validatePackageReceiptInput({ ...equal(), producedOn: "2000-02-29", expiresOn: "2000-02-29" }, kg).packages[0]?.producedOn).toBe("2000-02-29");
    expect(() => validatePackageReceiptInput({ ...equal(), producedOn: "2026-10-13", expiresOn: "2026-10-12" }, kg)).toThrow(AppError);
    expect(() => validatePackageReceiptInput({ ...equal(), expiresOn: "2024-02-30" }, kg)).toThrow(AppError);
  });
});

describe("versioned physical-package QR identity", () => {
  const id = "a2345678-1234-4abc-8abc-123456789abc";
  it("roundtrips canonical UUID without quantity, tenant, PII or secrets", () => {
    expect(encodePackageQr(id.toUpperCase())).toBe(`EWMS:PKG:1:${id}`);
    expect(decodePackageQr(encodePackageQr(id))).toBe(id);
    expect(decodePackageQr(`EWMS:PKG:1:${id.toUpperCase()}`)).toBe(id);
  });
  it("does not mistake product barcodes, URLs, unknown versions or malformed identities for package QR", () => {
    for (const raw of [null, 123, "8691234567890", id, `https://example.com/${id}`, `EWMS:PKG:2:${id}`, `EWMS:PKG:1:${id}:200`, ` EWMS:PKG:1:${id}`, `EWMS:PKG:1:${id}\n`, "EWMS:PKG:1:00000000-0000-0000-0000-000000000000"]) {
      expect(() => decodePackageQr(raw), String(raw)).toThrow(AppError);
    }
    for (const raw of [null, {}, "", "not-a-uuid", "00000000-0000-0000-0000-000000000000", "a2345678-1234-0abc-8abc-123456789abc", "a2345678-1234-4abc-0abc-123456789abc"]) {
      expect(() => encodePackageQr(raw)).toThrow(AppError);
    }
  });
});
