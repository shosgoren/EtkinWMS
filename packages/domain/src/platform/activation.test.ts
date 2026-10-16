import { describe, expect, it } from "vitest";
import {
  generateActivationToken,
  hashActivationToken,
  isAllowedWorkspaceName,
  isWellFormedActivationToken,
  normalizeWorkspaceName,
  placeholderActivationHash,
} from "./activation.ts";

describe("T-995 aktivasyon belirteci", () => {
  it("32 bayt base64url (43 karakter); özet 64 hex; yer tutucu her seferinde farklı", () => {
    const t = generateActivationToken();
    expect(isWellFormedActivationToken(t)).toBe(true);
    expect(hashActivationToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashActivationToken(t)).toBe(hashActivationToken(t));
    expect(placeholderActivationHash()).not.toBe(placeholderActivationHash());
    for (const bad of ["", "kısa", `${t}x`, "a".repeat(42), null, 42]) expect(isWellFormedActivationToken(bad)).toBe(false);
  });
});

describe("T-995 çalışma alanı adı (ADR-026 §2)", () => {
  it("Türkçe harfler sadeleşir, işaretler tireye döner, 30 karakterle sınırlanır", () => {
    expect(normalizeWorkspaceName("Motive Rubber")).toBe("motive-rubber");
    expect(normalizeWorkspaceName("Çağrı Gıda Şirketi")).toBe("cagri-gida-sirketi");
    expect(normalizeWorkspaceName("  İstanbul Depo  ")).toBe("istanbul-depo");
    expect(normalizeWorkspaceName("a".repeat(50)).length).toBeLessThanOrEqual(30);
    expect(normalizeWorkspaceName("!!!")).toBe("");
    expect(normalizeWorkspaceName(7)).toBe("");
  });
  it("3–30 karakter, uçlarda tire yok, ayrılmış adlar (uygulama yolları dahil) yok", () => {
    expect(isAllowedWorkspaceName("motive")).toBe(true);
    expect(isAllowedWorkspaceName("ab")).toBe(false);
    expect(isAllowedWorkspaceName("a".repeat(31))).toBe(false);
    expect(isAllowedWorkspaceName("-motive")).toBe(false);
    for (const r of ["login", "activate", "mfa", "t", "demo", "panel", "api", "invite"]) expect(isAllowedWorkspaceName(r), r).toBe(false);
  });
});
