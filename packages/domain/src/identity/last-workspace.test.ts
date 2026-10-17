// T-999: açılış kararı ve son alan kaydı yazma kararı (saf işlevler).
import { describe, expect, it } from "vitest";
import { landingFor, needsMark } from "./last-workspace.ts";

const m = (slug: string, lastUsedAt: Date | null = null) => ({ slug, tenantName: slug.toUpperCase(), roles: [] as const, lastUsedAt });
const NOW = new Date("2026-10-17T10:00:00Z");

describe("landingFor", () => {
  it("üyelik yok → kurulum", () => {
    expect(landingFor({ memberships: [], lastSlug: null })).toEqual({ kind: "onboarding" });
  });
  it("tek üyelik → o alan (son kayıt ne olursa olsun)", () => {
    expect(landingFor({ memberships: [m("a")], lastSlug: null })).toEqual({ kind: "workspace", slug: "a" });
    expect(landingFor({ memberships: [m("a")], lastSlug: "b" })).toEqual({ kind: "workspace", slug: "a" });
  });
  it("çok üyelik + listede olan son alan → son alan", () => {
    expect(landingFor({ memberships: [m("a"), m("b")], lastSlug: "b" })).toEqual({ kind: "workspace", slug: "b" });
  });
  it("çok üyelik + son alan yok ya da listede değil (pasif/askıda) → seçici", () => {
    expect(landingFor({ memberships: [m("a"), m("b")], lastSlug: null })).toEqual({ kind: "pick" });
    expect(landingFor({ memberships: [m("a"), m("b")], lastSlug: "c" })).toEqual({ kind: "pick" });
  });
});

describe("needsMark", () => {
  it("alan son değilse ya da hiç kaydı yoksa yazar", () => {
    expect(needsMark({ memberships: [m("a", NOW), m("b")], lastSlug: "a" }, "b", NOW)).toBe(true);
    expect(needsMark({ memberships: [m("a")], lastSlug: null }, "a", NOW)).toBe(true);
  });
  it("son alan ve 5 dakikadan tazeyse yazmaz; eskiyse yazar", () => {
    const fresh = new Date(NOW.getTime() - 4 * 60_000);
    const stale = new Date(NOW.getTime() - 5 * 60_000);
    expect(needsMark({ memberships: [m("a", fresh)], lastSlug: "a" }, "a", NOW)).toBe(false);
    expect(needsMark({ memberships: [m("a", stale)], lastSlug: "a" }, "a", NOW)).toBe(true);
  });
  it("listede olmayan alan için yazmaz", () => {
    expect(needsMark({ memberships: [m("a")], lastSlug: "a" }, "x", NOW)).toBe(false);
  });
});
