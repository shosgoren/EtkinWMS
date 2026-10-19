import { describe, expect, it } from "vitest";
import { cleanParty, parseKind } from "./parties.ts";

describe("T-428 cari kart doğrulama", () => {
  it("tür metni: Türkçe ve kısaltmalar", () => {
    expect(parseKind("Müşteri")).toBe("CUSTOMER");
    expect(parseKind("TEDARİKÇİ")).toBe("SUPPLIER");
    expect(parseKind("Alıcı / Satıcı")).toBe("BOTH");
    expect(parseKind("ikisi de")).toBe("BOTH");
    expect(parseKind("")).toBeNull();
    expect(parseKind("bayi")).toBe("UNKNOWN");
  });

  it("normalize eder: kod anahtarı büyük harf, e-posta küçük, vergi no boşluksuz", () => {
    const r = cleanParty({ code: " m-0012 ", name: "  Kaya   Otomotiv ", taxNo: "523 001 2345", email: "Satis@Kaya.com", phone: "0532 111 22 33" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ code: "m-0012", codeKey: "M-0012", name: "Kaya Otomotiv", taxNo: "5230012345", email: "satis@kaya.com", kind: null });
    expect(r.warnings).toEqual([]);
  });

  it("sorunlar satır sorunu olarak döner; vergi no uzunluğu yalnız uyarı", () => {
    expect(cleanParty({ name: "x" })).toEqual({ ok: false, issue: "CODE_MISSING" });
    expect(cleanParty({ code: "A", email: "yok" })).toEqual({ ok: false, issue: "EMAIL_INVALID" });
    expect(cleanParty({ code: "A", phone: "ara beni" })).toEqual({ ok: false, issue: "PHONE_INVALID" });
    expect(cleanParty({ code: "A", kind: "bayi" })).toEqual({ ok: false, issue: "KIND_UNKNOWN" });
    const w = cleanParty({ code: "A", name: "B", taxNo: "12345" });
    expect(w.ok && w.warnings).toEqual(["TAX_NO_LENGTH"]);
  });
});
