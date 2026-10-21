import { describe, expect, it } from "vitest";
import { degisti, dogrula, ilkHatali, ozet, type AlanKurali } from "./dogrula.ts";

const MSG = { required: "Zorunlu", email: "Geçerli bir e-posta yaz", number: "Sayı yaz", tooLong: "Çok uzun" };
const RULES: AlanKurali[] = [
  { name: "code", label: "Cari kodu", required: true, maxLength: 4 },
  { name: "name", label: "Ünvan", required: true },
  { name: "email", label: "E-posta", kind: "email" },
  { name: "qty", label: "Miktar", kind: "decimal" },
];
const fmt = { missing: (n: number, l: string) => `${n} alan eksik: ${l}`, invalid: (n: number, l: string) => `${n} alan hatalı: ${l}` };

describe("ortak form doğrulaması (T-990)", () => {
  it("boş zorunlu alanlar ve geçersiz e-posta: kural sırasıyla, tek satırlık neden", () => {
    const h = dogrula(RULES, { code: "  ", name: "", email: "sdfsdf", qty: "" }, MSG);
    expect(h).toEqual({ code: "Zorunlu", name: "Zorunlu", email: "Geçerli bir e-posta yaz" });
    expect(ilkHatali(h, RULES)).toBe("code");
    expect(ozet(h, RULES, MSG.required, fmt)).toBe("2 alan eksik: Cari kodu, Ünvan · 1 alan hatalı: E-posta");
  });

  it("geçerli değerlerde hata yok; ondalık virgül/nokta kabul, uzunluk sınırı", () => {
    expect(dogrula(RULES, { code: "C1", name: "Acme", email: "a@b.co", qty: "1,5" }, MSG)).toEqual({});
    expect(dogrula(RULES, { code: "C12345", name: "Acme", qty: "1.5x" }, MSG)).toEqual({ code: "Çok uzun", qty: "Sayı yaz" });
  });

  it("ek kural ve sunucu hatası sıralaması", () => {
    const rules: AlanKurali[] = [{ name: "a", label: "A", check: (v) => (v === "x" ? "x olmaz" : null) }];
    expect(dogrula(rules, { a: "x" }, MSG)).toEqual({ a: "x olmaz" });
    expect(ilkHatali({ server: "Kod zaten var", a: "x olmaz" }, rules)).toBe("a");
    expect(ilkHatali({}, rules)).toBeNull();
  });

  it("değişiklik kararı başlangıçla karşılaştırılır: yazılıp silinen alan ve boşluk değişiklik değildir", () => {
    const init = { code: "", name: "Acme", kind: "CUSTOMER" };
    expect(degisti({ code: "", name: "Acme", kind: "CUSTOMER" }, init)).toBe(false);
    expect(degisti({ kind: "CUSTOMER", name: "Acme ", code: "" }, init)).toBe(false);
    expect(degisti({ code: "X", name: "Acme", kind: "CUSTOMER" }, init)).toBe(true);
    expect(degisti({ code: "", name: "Acme", kind: "SUPPLIER" }, init)).toBe(true);
  });
});
