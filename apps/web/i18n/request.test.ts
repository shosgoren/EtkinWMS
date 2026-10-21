// T-999c: dil seçimi sırası ve tenant yolundan alan çıkarımı.
import { describe, expect, it, vi } from "vitest";
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("next-intl/server", () => ({ getRequestConfig: (fn: unknown) => fn }));
import { resolveLocale } from "./request.ts";
import { tenantSlugFromPath } from "./tenant-slug.ts";

const ws = (v: "tr" | "en" | undefined) => vi.fn(() => Promise.resolve(v));

describe("resolveLocale", () => {
  it("çalışma alanı dili tarayıcı dilinden önce gelir", async () => {
    expect(await resolveLocale({ cookie: undefined, workspace: ws("en"), acceptLanguage: "tr-TR,tr;q=0.9" })).toBe("en");
    expect(await resolveLocale({ cookie: undefined, workspace: ws("tr"), acceptLanguage: "en-US" })).toBe("tr");
  });
  it("cihaz çerezi en öncelikli; çalışma alanı okunmaz", async () => {
    const w = ws("tr");
    expect(await resolveLocale({ cookie: "en", workspace: w, acceptLanguage: null })).toBe("en");
    expect(w).not.toHaveBeenCalled();
  });
  it("alan yoksa/okunamazsa Accept-Language, o da yoksa tr; geçersiz çerez yok sayılır", async () => {
    expect(await resolveLocale({ cookie: "de", workspace: ws(undefined), acceptLanguage: "en-GB,en;q=0.8" })).toBe("en");
    expect(await resolveLocale({ cookie: undefined, workspace: ws(undefined), acceptLanguage: "de-DE" })).toBe("tr");
    expect(await resolveLocale({ cookie: undefined, workspace: ws(undefined), acceptLanguage: null })).toBe("tr");
  });
});

describe("tenantSlugFromPath", () => {
  it("tenant sayfa ve API yollarından alanı çıkarır", () => {
    expect(tenantSlugFromPath("/t/motive")).toBe("motive");
    expect(tenantSlugFromPath("/t/motive-rubber/items?x=1".split("?")[0]!)).toBe("motive-rubber");
    expect(tenantSlugFromPath("/api/t/acme/audit/export")).toBe("acme");
  });
  it("başka yol ya da geçersiz alan biçimi → null", () => {
    for (const p of ["/", "/login", "/t", "/t/", "/t/Büyük", "/t/-x", "/tx/acme", "/help/t/acme"]) expect(tenantSlugFromPath(p)).toBeNull();
  });
});
