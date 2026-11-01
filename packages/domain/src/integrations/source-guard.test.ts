// T-1201: kaynak kilidinin saf parçaları (DB'siz). Kilit kararı ve yarış int testinde (tests/integration/integrations/source-guard).
import { describe, expect, it } from "vitest";
import { AppError, ERROR_DETAIL_CODE } from "@wms/shared/errors";
import { SOURCE_FLOW, SOURCE_OWNED_FIELDS, isSourceManaged, sourceManagedError } from "./source-guard.ts";
import { partyFields } from "./apply.ts";

describe("kaynak kilidi (T-1201)", () => {
  it("her durum ayrı ayrıntıyla VALIDATION_FAILED; ayrıntı hata sözleşmesinde kayıtlı", () => {
    for (const c of ["CREATE", "FIELD", "ARCHIVE"] as const) {
      const e = sourceManagedError(c);
      expect(e).toBeInstanceOf(AppError);
      expect(e).toMatchObject({ code: "VALIDATION_FAILED", detail: `SOURCE_MANAGED_${c}` });
      expect(ERROR_DETAIL_CODE[`SOURCE_MANAGED_${c}`]).toBe("VALIDATION_FAILED");
      expect(isSourceManaged(e)).toBe(true);
    }
    expect(isSourceManaged(new AppError("VALIDATION_FAILED", { detail: "IN_USE" }))).toBe(false);
    expect(isSourceManaged(new Error("SOURCE_MANAGED_CREATE"))).toBe(false);
  });

  it("bölüm → akış eşlemesi kart akışlarıyla aynı", () => {
    expect(SOURCE_FLOW).toEqual({ ITEM: "PRODUCTS", PARTY: "CONTACTS", WAREHOUSE: "WAREHOUSES" });
  });

  it("cari Paraşüt alanları: apply.ts `partyFields`'in yazdığı her alan + kod (eşleme anahtarı)", () => {
    const f = partyFields({ externalId: "1", name: "A", accountType: "customer", taxNumber: null, taxOffice: null, email: null, phone: null, city: null, address: null, shortName: null, district: null });
    expect(f).not.toBeNull();
    const pulled = Object.keys(f ?? {});
    expect([...SOURCE_OWNED_FIELDS.PARTY].sort()).toEqual(["code", ...pulled].sort());
    expect(SOURCE_OWNED_FIELDS.ITEM).toEqual(["code", "name"]);
    expect(SOURCE_OWNED_FIELDS.WAREHOUSE).toEqual(["code", "name"]);
  });
});
