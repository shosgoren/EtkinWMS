// T-1135: senkronun saf yardımcıları — irsaliye keşfi alt sınırı (kapat/aç sıfırlamaz) ve kesin red sınıflaması (401/429 yeniden denenir).
import { describe, expect, it } from "vitest";
import { ProviderError } from "./parasut.ts";
import { definiteRejection, shipmentDiscoveryFloor } from "./sync.ts";

describe("shipmentDiscoveryFloor", () => {
  it("ilk açılış anı kullanılır; yeniden açılış (enabled_at) alt sınırı ileri taşımaz", () => {
    expect(shipmentDiscoveryFloor({ first_enabled_at: "2026-10-01T08:00:00Z", enabled_at: "2026-10-30T08:00:00Z" })?.toISOString()).toBe("2026-10-01T08:00:00.000Z");
  });
  it("0066 öncesi satır: ilk açılış boşsa enabled_at; hiç açılmamışsa null", () => {
    expect(shipmentDiscoveryFloor({ first_enabled_at: null, enabled_at: new Date("2026-10-02T00:00:00Z") })?.toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(shipmentDiscoveryFloor({ first_enabled_at: null, enabled_at: null })).toBeNull();
    expect(shipmentDiscoveryFloor({ first_enabled_at: "bozuk", enabled_at: null })).toBeNull();
  });
});

describe("definiteRejection", () => {
  it.each([
    [new ProviderError("INVALID", 422), true],
    [new ProviderError("INVALID", 400), true],
    [new ProviderError("FORBIDDEN", 403), true],
    [new ProviderError("NOT_FOUND", 404), true],
    [new ProviderError("AUTH_FAILED", 401), false],
    [new ProviderError("RATE_LIMITED", 429), false],
    [new ProviderError("UNAVAILABLE", 503), false],
    [new ProviderError("NETWORK", null), false],
    [new ProviderError("BAD_RESPONSE", 201), false],
    [new Error("x"), false],
  ])("%s → %s", (e, want) => {
    expect(definiteRejection(e)).toBe(want);
  });
});
