import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderActivationEmail, renderWelcomeEmail, trialDate } from "./trial-templates.js";

describe("T-995 deneme e-postaları", () => {
  it("aktivasyon: bağlantı ve firma adı kaçışlı; javascript: bağlantı reddedilir", () => {
    const token = randomBytes(32).toString("base64url");
    const r = renderActivationEmail("tr", `https://wms.example.invalid/activate/${token}`, `<b>Acme</b> & Co`);
    expect(r.subject).toContain("onaylandı");
    expect(r.html).toContain("&lt;b&gt;Acme&lt;/b&gt; &amp; Co");
    expect(r.html).not.toContain("<b>Acme");
    expect(r.text).toContain(token);
    expect(() => renderActivationEmail("tr", "javascript:alert(1)", "x")).toThrow();
  });
  it("hoş geldiniz: adres, giriş e-postası, saha alanı adı, deneme bitişi; parola/belirteç alanı yok", () => {
    const r = renderWelcomeEmail({
      locale: "tr",
      appBaseUrl: "https://wms.example.invalid/",
      company: "Motive Rubber",
      slug: "motive",
      email: "yonetici@example.invalid",
      trialEndsAt: new Date("2027-01-16T09:00:00Z"),
    });
    expect(r.subject).toBe("Etkin WMS çalışma alanınız hazır");
    for (const s of ["wms.example.invalid/motive", "yonetici@example.invalid", "Çalışma alanı: motive", "16.01.2027 tarihine kadar", "Hoş geldiniz, Motive Rubber"]) {
      expect(r.text, s).toContain(s);
    }
    expect(r.html).toContain('href="https://wms.example.invalid/motive"');
    expect(`${r.text}${r.html}`).not.toMatch(/activate\/|token|parola:/i);
    expect(renderWelcomeEmail({ locale: "en", appBaseUrl: "https://a.invalid", company: "A", slug: "a-b", email: "a@b.invalid", trialEndsAt: null }).text).not.toContain("TRIAL");
  });
  it("tarih İstanbul saatiyle gg.aa.yyyy", () => {
    expect(trialDate(new Date("2026-12-31T22:30:00Z"))).toBe("01.01.2027");
  });
});
