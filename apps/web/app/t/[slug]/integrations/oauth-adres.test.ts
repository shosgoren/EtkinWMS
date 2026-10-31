import { describe, expect, it } from "vitest";
import { OOB_DONUS, donusAdresi } from "./oauth-adres.ts";

describe("donusAdresi (T-1133)", () => {
  const cb = "https://wms.example.test/api/integrations/parasut/callback";
  it("OOB seçiliyken URN (gösterilen = kopyalanan)", () => expect(donusAdresi(true, cb)).toBe(OOB_DONUS));
  it("OOB kapalıyken sunucunun callback'i", () => expect(donusAdresi(false, cb)).toBe(cb));
  it("OOB, sunucu adresi yokken de URN", () => expect(donusAdresi(true, null)).toBe(OOB_DONUS));
  it("adres yoksa null", () => expect(donusAdresi(false, null)).toBeNull());
});
