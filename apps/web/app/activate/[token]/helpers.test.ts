import { describe, expect, it } from "vitest";
import { slugOf, totpKeyOf, trialDateLabel } from "./helpers.ts";

describe("T-995 aktivasyon ekranı yardımcıları", () => {
  it("slugOf kaynaktaki gibi; kesimden sonra uçta tire yok", () => {
    expect(slugOf("Motive Rubber")).toBe("motive-rubber");
    expect(slugOf("Çağrı Gıda")).toBe("cagri-gida");
    expect(slugOf(`${"a".repeat(29)} b`)).toBe("a".repeat(29));
  });
  it("TOTP anahtarı 4'lü gruplar; bozuk adres boş", () => {
    expect(totpKeyOf("otpauth://totp/E:x?secret=ABCDEFGHIJKLMNOP&issuer=E")).toBe("ABCD EFGH IJKL MNOP");
    expect(totpKeyOf("bozuk")).toBe("");
  });
  it("deneme bitişi gg.aa.yyyy (İstanbul)", () => {
    expect(trialDateLabel("2027-01-16T08:00:00Z")).toBe("16.01.2027");
  });
});
