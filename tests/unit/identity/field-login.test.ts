// T-997: saha girişi kurallarının iki kopyası (`@wms/shared/field-login` ve `packages/auth/src/field.ts`; paket bağımlılığı yok) aynı
// davranmalı: kod normalize/özet, PIN kuralı, iç e-posta alanı. Ayrıca cihaz çerezi ayrıştırma biçimi.
import { describe, expect, it } from "vitest";
import * as shared from "../../../packages/shared/src/field-login.ts";
import * as auth from "../../../packages/auth/src/field.ts";
import { pinProblem as clientPinProblem } from "../../../apps/web/app/field/pin.ts";

describe("saha girişi kuralları (shared ↔ auth)", () => {
  it("iç e-posta alanı aynı", () => {
    expect(auth.FIELD_EMAIL_DOMAIN).toBe(shared.FIELD_EMAIL_DOMAIN);
    const e = shared.fieldEmail("00000000-0000-4000-8000-000000000001");
    expect(shared.isFieldEmail(e)).toBe(true);
    expect(auth.isFieldEmail(e.toUpperCase())).toBe(true);
    expect(auth.isFieldEmail("someone@example.test")).toBe(false);
    expect(auth.isFieldEmail(null)).toBe(false);
  });

  it("üretilen kod iki tarafta aynı normalize edilir ve aynı özeti verir", () => {
    for (let i = 0; i < 200; i++) {
      const code = shared.generateActivationCode();
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      const a = shared.normalizeActivationCode(code);
      const b = auth.normalizeActivationCode(code.toLowerCase().replace("-", " "));
      expect(a).not.toBeNull();
      expect(b).toBe(a);
      expect(auth.activationCodeHash(b as string)).toBe(shared.activationCodeHash(a as string));
      expect(shared.activationCodeHash(a as string)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("karışan karakterler ve yanlış uzunluk reddedilir", () => {
    for (const bad of ["ABCD-EFG0", "ABCD-EFGI", "ABCD-EFGL", "ABCD-EFGO", "ABCD-EFG1", "ABCDEFG", "ABCD-EFGHJ", ""]) {
      expect(shared.normalizeActivationCode(bad), bad).toBeNull();
      expect(auth.normalizeActivationCode(bad), bad).toBeNull();
    }
  });

  it("PIN kuralı aynı: 6 hane, bariz diziler yok", () => {
    const cases = ["000000", "111111", "123456", "234567", "890123", "654321", "098765", "12345", "1234567", "12a456", "135790", "482915", "112233"];
    for (const pin of cases) {
      expect(auth.pinAcceptable(pin), pin).toBe(shared.pinProblem(pin) === null);
      expect(clientPinProblem(pin), pin).toBe(shared.pinProblem(pin));
    }
    expect(shared.pinProblem("482915")).toBeNull();
    expect(shared.pinProblem("123456")).toBe("OBVIOUS");
    expect(shared.pinProblem("12345")).toBe("FORMAT");
  });

  it("kullanıcı adı sadeleştirme", () => {
    expect(shared.normalizeFieldUsername("  Ayşe.Çelik ")).toBe("ayse.celik");
    expect(shared.normalizeFieldUsername("İsmail_01")).toBe("ismail_01");
    expect(shared.normalizeFieldUsername("ab")).toBeNull();
    expect(shared.normalizeFieldUsername("-ali")).toBeNull();
    expect(shared.normalizeFieldUsername("ali veli")).toBeNull();
  });

  it("cihaz çerezi `<tenant>.<43 karakter>`; biçimsiz değer null; özet ham belirteç değil", () => {
    const t = "00000000-0000-4000-8000-000000000002";
    const token = "A".repeat(43);
    const p = auth.parseDeviceCookie(`${t}.${token}`);
    expect(p?.tenantId).toBe(t);
    expect(p?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(p?.tokenHash).not.toContain(token);
    for (const bad of [undefined, "", t, `${t}.`, `${t}.short`, `x.${token}`, `${t}.${token}!`]) expect(auth.parseDeviceCookie(bad)).toBeNull();
    expect(auth.fieldDeviceCookieName(true)).toBe("__Host-wms_field_device");
  });
});
