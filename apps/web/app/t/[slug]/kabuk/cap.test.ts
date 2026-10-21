// T-979c: alt cam çubuğun orta ana işlem etiketi tek satır, en çok 10 karakter (çubuğun içinde okunur); tam metin erişilebilir adda kalır.
import { describe, expect, it } from "vitest";
import { CAP_MAX, capOf } from "./kabuk-bar.tsx";

describe("orta etiket (capOf)", () => {
  it("kısa etiket aynen kalır", () => {
    for (const l of ["OKUT", "KAYDET", "ÜRÜN EKLE", "CSV İNDİR", "ONAYLA"]) expect(capOf(l)).toBe(l);
  });
  it("uzun etiket son kelimeye (eylem) iner; o da uzunsa ilk 10 karakter", () => {
    expect(capOf("YENİ SİPARİŞ OLUŞTUR")).toBe("OLUŞTUR");
    expect(capOf("Yeni teslim ekle")).toBe("ekle");
    expect(capOf("SAYIMIBAŞLATVEKAYDET")).toBe("SAYIMIBAŞL");
    for (const l of ["YENİ SİPARİŞ OLUŞTUR", "SAYIMIBAŞLATVEKAYDET", "Excel'den toplu aktar"]) expect(Array.from(capOf(l)).length).toBeLessThanOrEqual(CAP_MAX);
  });
});
