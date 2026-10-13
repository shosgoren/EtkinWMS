import { afterEach, expect, it, vi } from "vitest";
import { assertPackageReceivingEnabled, packageReceivingEnabled } from "./package-receiving-config.ts";
afterEach(() => vi.unstubAllEnvs());
it.each([undefined, "", "false", "TRUE", "1", " true", "true "])("fails closed for %s", value => {
  expect(packageReceivingEnabled({ PACKAGE_RECEIVING_ENABLED: value })).toBe(false);
});
it("accepts only exact server flag", () => {
  expect(packageReceivingEnabled({ PACKAGE_RECEIVING_ENABLED: "true" })).toBe(true);
  vi.stubEnv("PACKAGE_RECEIVING_ENABLED", "false");
  expect(() => assertPackageReceivingEnabled()).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  vi.stubEnv("PACKAGE_RECEIVING_ENABLED", "true");
  expect(() => assertPackageReceivingEnabled()).not.toThrow();
});
