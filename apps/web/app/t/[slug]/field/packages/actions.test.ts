import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@wms/shared/errors";
const mocks = vi.hoisted(() => ({ principal: vi.fn(), access: vi.fn(), limit: vi.fn(), current: vi.fn(), resolve: vi.fn(), quality: vi.fn(), putaway: vi.fn(), locations: vi.fn(), find: vi.fn(), headers: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("../../../../../lib/auth-service.ts", () => ({ getAuthService: () => ({ getPrincipal: mocks.principal }) }));
vi.mock("@wms/db", () => ({ getAppDb: () => ({}) }));
vi.mock("@wms/domain/identity/access", () => ({ runTenantQuery: mocks.access }));
vi.mock("../../../../../lib/rate-limit.ts", async original => ({ ...await original<typeof import("../../../../../lib/rate-limit.ts")>(), createProductionLimiter: () => ({ check: mocks.limit }) }));
vi.mock("@wms/domain/operations", () => ({ getCurrentPackage: mocks.current, resolveCurrentPackageQr: mocks.resolve, approvePackageQuality: mocks.quality, putawayPackage: mocks.putaway }));
vi.mock("@wms/domain/warehouse", () => ({ getLocationTree: mocks.locations, findLocationByCode: mocks.find }));
import { getCurrentPackageAction, resolveCurrentPackageQrAction, qualityReleasePackageAction, putawayPackageAction, packageStorageLocationsAction, resolvePackageDestinationAction } from "./actions.ts";
const ID = "11111111-1111-4111-8111-111111111111", KEY = "22222222-2222-4222-8222-222222222222", DEST = "33333333-3333-4333-8333-333333333333";
const identity = { slug: "motive", packageId: ID }, command = { ...identity, clientKey: KEY, predecessorVersion: 0, currentBalanceVersion: "2" };
const endpoints = [() => getCurrentPackageAction(identity), () => resolveCurrentPackageQrAction({ slug: "motive", qr: `EWMS:PKG:1:${ID}` }), () => qualityReleasePackageAction(command), () => putawayPackageAction({ ...command, targetLocationId: DEST }), () => packageStorageLocationsAction(identity), () => resolvePackageDestinationAction({ ...identity, code: "RAF1" })];
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("BETTER_AUTH_URL", "https://app.example.test"); vi.stubEnv("PACKAGE_RECEIVING_ENABLED", "true");
  mocks.headers.mockResolvedValue(new Headers({ origin: "https://app.example.test", "fly-client-ip": "203.0.113.7" }));
  mocks.principal.mockResolvedValue({ userId: ID, mfaVerified: true }); mocks.access.mockResolvedValue("verified-tenant");
  mocks.current.mockResolvedValue({ id: ID, warehouseId: ID, currentLocation: { id: ID } });
  mocks.quality.mockResolvedValue({ documentId: DEST, status: "POSTED", replayed: false }); mocks.putaway.mockResolvedValue({ documentId: DEST, status: "POSTED", replayed: true });
  mocks.locations.mockResolvedValue({ items: [], next: null }); mocks.find.mockResolvedValue({ id: DEST, code: "RAF1", name: "Raf", status: "ACTIVE", kind: "STORAGE" });
});
afterEach(() => vi.unstubAllEnvs());
describe("T-943 authenticated, strict, fail-closed physical package actions", () => {
  it("disabled flag blocks all endpoints before tenant/domain access", async () => {
    vi.stubEnv("PACKAGE_RECEIVING_ENABLED", "false"); for (const action of endpoints) expect(await action()).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.current).not.toHaveBeenCalled(); expect(mocks.quality).not.toHaveBeenCalled();
  });
  it("anonymous, Origin rejection and missing permissions cannot reach domain", async () => {
    mocks.principal.mockResolvedValue(null); for (const action of endpoints) expect(await action()).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    mocks.principal.mockResolvedValue({ userId: ID, mfaVerified: true }); mocks.access.mockRejectedValue(new AppError("FORBIDDEN"));
    for (const action of endpoints) expect(await action()).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(mocks.quality).not.toHaveBeenCalled(); expect(mocks.putaway).not.toHaveBeenCalled(); expect(mocks.current).not.toHaveBeenCalled();
    mocks.headers.mockResolvedValue(new Headers({ origin: "https://foreign.example" })); expect(await qualityReleasePackageAction(command)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
  it("operation permission is server chosen, committed result survives subsequent read failure", async () => {
    mocks.current.mockRejectedValue(new AppError("INTERNAL"));
    expect(await qualityReleasePackageAction(command)).toEqual({ ok: true, data: { documentId: DEST, status: "POSTED", replayed: false } });
    expect(await putawayPackageAction({ ...command, targetLocationId: DEST })).toEqual({ ok: true, data: { documentId: DEST, status: "POSTED", replayed: true } });
    expect(mocks.access.mock.calls.map(c => c[0].permission)).toEqual(["document.approve", "stock.post"]); expect(mocks.current).not.toHaveBeenCalled();
    expect(mocks.quality).toHaveBeenCalledWith(expect.objectContaining({ clientKey: KEY, tenantSlug: "motive" }), expect.objectContaining({ packageId: ID, predecessorVersion: 0, currentBalanceVersion: "2" }));
  });
  it.each(["tenantId", "quantity", "factor", "sourceLocationId", "stockStatus", "warehouseId", "requestId"])("strict actions reject %s injection", async key => {
    expect(await qualityReleasePackageAction({ ...command, [key]: ID })).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(mocks.quality).not.toHaveBeenCalled();
  });
  it("destination list/scanning stays in authorized current warehouse and excludes current/invalid locations", async () => {
    mocks.locations.mockResolvedValue({ items: [{ id: DEST, code: "RAF1", name: "Raf", kind: "STORAGE", status: "ACTIVE" }, { id: ID, kind: "STORAGE", status: "ACTIVE" }, { id: KEY, kind: "RECEIVING", status: "ACTIVE" }], next: null });
    expect(await packageStorageLocationsAction(identity)).toEqual({ ok: true, data: { items: [{ id: DEST, code: "RAF1", name: "Raf" }], next: null } });
    expect(await resolvePackageDestinationAction({ ...identity, code: "RAF1" })).toEqual({ ok: true, data: { id: DEST, code: "RAF1", name: "Raf" } });
    expect(mocks.find).toHaveBeenCalledWith(expect.anything(), { warehouseId: ID, code: "RAF1" });
    mocks.find.mockResolvedValue({ id: DEST, status: "ARCHIVED", kind: "STORAGE" }); expect(await resolvePackageDestinationAction({ ...identity, code: "OLD" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
});
