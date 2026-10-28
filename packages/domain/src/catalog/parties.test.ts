import { describe, expect, it } from "vitest";
import { cleanParty, parseDeliveryMode, parseKind } from "./parties.ts";

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

  it("T-1117: teslimat metni (Türkçe, İngilizce, sabit değer); boş verilmedi, tanınmayan hata", () => {
    expect(parseDeliveryMode("OWN")).toBe("OWN");
    expect(parseDeliveryMode("CARRIER")).toBe("CARRIER");
    expect(parseDeliveryMode("Kendi personelim")).toBe("OWN");
    expect(parseDeliveryMode("KARGO FİRMASI")).toBe("CARRIER");
    expect(parseDeliveryMode("carrier")).toBe("CARRIER");
    expect(parseDeliveryMode("")).toBeNull();
    expect(parseDeliveryMode("uçak")).toBe("UNKNOWN");
  });

  it("T-1117: kısa ad ve ilçe normalize edilir, sınır ve kontrol karakteri reddedilir; teslimat verilmezse null", () => {
    const r = cleanParty({ code: "A", name: "B", shortName: "  Kaya  Oto ", district: " Kadıköy ", deliveryMode: "kargo" });
    expect(r.ok && r.value).toMatchObject({ shortName: "Kaya Oto", district: "Kadıköy", deliveryMode: "CARRIER" });
    const bos = cleanParty({ code: "A", name: "B", shortName: " ", district: "" });
    expect(bos.ok && bos.value).toMatchObject({ shortName: null, district: null, deliveryMode: null });
    expect(cleanParty({ code: "A", shortName: "x".repeat(101) })).toEqual({ ok: false, issue: "TEXT_TOO_LONG" });
    expect(cleanParty({ code: "A", district: "y".repeat(101) })).toEqual({ ok: false, issue: "TEXT_TOO_LONG" });
    expect(cleanParty({ code: "A", shortName: "a\u0007b" })).toEqual({ ok: false, issue: "TEXT_TOO_LONG" });
    expect(cleanParty({ code: "A", deliveryMode: "uçak" })).toEqual({ ok: false, issue: "DELIVERY_UNKNOWN" });
  });
  it("C1 kontrol karakteri (U+0080–009F) satır sorunu olur, veritabanına gitmez", () => {
    expect(cleanParty({ code: "A", name: "B", shortName: "Ka\u0086ya" })).toEqual({ ok: false, issue: "TEXT_TOO_LONG" });
    expect(cleanParty({ code: "A", name: "B\u009fC" })).toEqual({ ok: false, issue: "NAME_INVALID" });
  });
});
