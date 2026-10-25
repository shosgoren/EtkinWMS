// T-1034: iki adımlı doğrulama sihirbazının saf yardımcıları.
import { describe, expect, it } from "vitest";
import { MAGAZA, kodTemizle, telefonMu, totpAnahtari, yedekMetni } from "./totp-sihirbaz.tsx";

describe("totp sihirbazı yardımcıları", () => {
  it("otpauth adresinden anahtarı alır; bozuk adreste boş döner", () => {
    expect(totpAnahtari("otpauth://totp/Etkin%20WMS:a%40b.c?secret=JBSWY3DPEHPK3PXP&issuer=Etkin%20WMS")).toBe("JBSWY3DPEHPK3PXP");
    expect(totpAnahtari("bozuk")).toBe("");
  });

  it("telefon: dokunmatik + mobil işletim sistemi; masaüstü dokunmatik ekran telefon sayılmaz", () => {
    expect(telefonMu("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", true)).toBe(true);
    expect(telefonMu("Mozilla/5.0 (Linux; Android 15; Pixel 9)", true)).toBe(true);
    expect(telefonMu("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", true)).toBe(false);
    expect(telefonMu("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", false)).toBe(false);
  });

  it("kod alanı yalnız rakam ve en çok 6 hane (yapıştırılan boşluklu kod da)", () => {
    expect(kodTemizle("123 456")).toBe("123456");
    expect(kodTemizle("12a3-4567")).toBe("123456");
    expect(kodTemizle("")).toBe("");
  });

  it("yedek kod dosyası başlık + numaralı satırlar", () => {
    expect(yedekMetni("Başlık", ["aa-bb", "cc-dd"])).toBe("Başlık\n\n01  aa-bb\n02  cc-dd\n");
  });

  it("mağaza bağlantıları resmî adreslere gider", () => {
    for (const app of Object.values(MAGAZA)) {
      expect(app.ios).toMatch(/^https:\/\/apps\.apple\.com\/app\//);
      expect(app.android).toMatch(/^https:\/\/play\.google\.com\/store\/apps\/details\?id=/);
    }
  });
});
