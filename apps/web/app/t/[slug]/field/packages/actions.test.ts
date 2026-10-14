import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@wms/shared/errors";
const mocks = vi.hoisted(() => ({ principal: vi.fn(), access: vi.fn(), limit: vi.fn(), current: vi.fn(), resolve: vi.fn(), quality: vi.fn(), putaway: vi.fn(), transfer: vi.fn(), warehouses: vi.fn(), warehouse: vi.fn(), locations: vi.fn(), find: vi.fn(), headers: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("../../../../../lib/auth-service.ts", () => ({ getAuthService: () => ({ getPrincipal: mocks.principal }) }));
vi.mock("@wms/db", () => ({ getAppDb: () => ({}) }));
vi.mock("@wms/domain/identity/access", () => ({ runTenantQuery: mocks.access }));
vi.mock("../../../../../lib/rate-limit.ts", async original => ({ ...await original<typeof import("../../../../../lib/rate-limit.ts")>(), createProductionLimiter: () => ({ check: mocks.limit }) }));
vi.mock("@wms/domain/operations", () => ({ getCurrentPackage: mocks.current, resolveCurrentPackageQr: mocks.resolve, approvePackageQuality: mocks.quality, putawayPackage: mocks.putaway, transferPackage: mocks.transfer }));
vi.mock("@wms/domain/warehouse", () => ({ getLocationTree: mocks.locations, findLocationByCode: mocks.find, listWarehouses: mocks.warehouses, getWarehouse: mocks.warehouse }));
import { getCurrentPackageAction, resolveCurrentPackageQrAction, qualityReleasePackageAction, putawayPackageAction, packageStorageLocationsAction, resolvePackageDestinationAction, transferPackageAction, packageTransferWarehousesAction, packageTransferLocationsAction, resolvePackageTransferDestinationAction } from "./actions.ts";
const ID = "11111111-1111-4111-8111-111111111111", KEY = "22222222-2222-4222-8222-222222222222", DEST = "33333333-3333-4333-8333-333333333333";
const identity = { slug: "motive", packageId: ID }, command = { ...identity, clientKey: KEY, predecessorVersion: 0, currentBalanceVersion: "2" };
const endpoints = [() => getCurrentPackageAction(identity), () => resolveCurrentPackageQrAction({ slug: "motive", qr: `EWMS:PKG:1:${ID}` }), () => qualityReleasePackageAction(command), () => putawayPackageAction({ ...command, targetLocationId: DEST }), () => packageStorageLocationsAction(identity), () => resolvePackageDestinationAction({ ...identity, code: "RAF1" }), () => transferPackageAction({ ...command, targetLocationId: DEST }), () => packageTransferWarehousesAction(identity), () => packageTransferLocationsAction({ ...identity, warehouseId: KEY }), () => resolvePackageTransferDestinationAction({ ...identity, warehouseId: KEY, code: "RAF1" })];
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("BETTER_AUTH_URL", "https://app.example.test"); vi.stubEnv("PACKAGE_RECEIVING_ENABLED", "true");
  mocks.headers.mockResolvedValue(new Headers({ origin: "https://app.example.test", "fly-client-ip": "203.0.113.7" }));
  mocks.principal.mockResolvedValue({ userId: ID, mfaVerified: true }); mocks.access.mockResolvedValue("verified-tenant");
  mocks.current.mockResolvedValue({ id: ID, warehouseId: ID, currentLocation: { id: ID }, canTransfer: true });
  mocks.quality.mockResolvedValue({ documentId: DEST, status: "POSTED", replayed: false }); mocks.putaway.mockResolvedValue({ documentId: DEST, status: "POSTED", replayed: true });
  mocks.transfer.mockResolvedValue({ documentId: DEST, status: "POSTED", replayed: false });
  mocks.warehouses.mockResolvedValue({ items: [], nextAfterCode: null }); mocks.warehouse.mockResolvedValue({ id: KEY, status: "ACTIVE" });
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

describe("T-948 current-warehouse transfer boundary", () => {
  it("returns committed terminal IN without read, preserves same client key and versions", async () => {
    mocks.current.mockRejectedValue(new AppError("INTERNAL"));
    expect(await transferPackageAction({ ...command, targetLocationId: DEST })).toEqual({ ok: true, data: { documentId: DEST, status: "POSTED", replayed: false } });
    expect(mocks.current).not.toHaveBeenCalled();
    expect(mocks.access).toHaveBeenCalledWith(expect.objectContaining({ permission: "stock.post", tenantSlug: "motive" }), expect.anything());
    expect(mocks.transfer).toHaveBeenCalledWith(expect.objectContaining({ clientKey: KEY, tenantSlug: "motive" }), expect.objectContaining({ packageId: ID, targetLocationId: DEST, predecessorVersion: 0, currentBalanceVersion: "2" }));
    mocks.transfer.mockResolvedValue({ documentId: DEST, status: "POSTED", replayed: true });
    expect(await transferPackageAction({ ...command, targetLocationId: DEST })).toMatchObject({ ok: true, data: { documentId: DEST, replayed: true } });
  });
  it.each(["tenantId", "quantity", "factor", "sourceLocationId", "sourceWarehouseId", "warehouseId", "requestId"])("transfer rejects forged %s", async key => {
    expect(await transferPackageAction({ ...command, targetLocationId: DEST, [key]: ID })).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(mocks.transfer).not.toHaveBeenCalled();
  });
  it("missing/false canTransfer fails closed before target data lookup", async () => {
    for (const canTransfer of [undefined, false]) {
      mocks.current.mockResolvedValue({ id: ID, warehouseId: ID, canTransfer });
      expect(await packageTransferWarehousesAction(identity)).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
      expect(await packageTransferLocationsAction({ ...identity, warehouseId: KEY })).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
      expect(await resolvePackageTransferDestinationAction({ ...identity, warehouseId: KEY, code: "RAF1" })).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    }
    expect(mocks.warehouses).not.toHaveBeenCalled(); expect(mocks.warehouse).not.toHaveBeenCalled(); expect(mocks.find).not.toHaveBeenCalled();
  });
  it("filtered warehouse/location pages retain true continuation cursors", async () => {
    mocks.warehouses.mockResolvedValue({ items: [{ id: ID, code: "A", name: "Current", status: "ACTIVE" }, { id: KEY, code: "B", name: "Target", status: "ACTIVE" }, { id: DEST, status: "ARCHIVED" }], nextAfterCode: "Z" });
    expect(await packageTransferWarehousesAction({ ...identity, afterCode: "A" })).toEqual({ ok: true, data: { items: [{ id: KEY, code: "B", name: "Target" }], nextAfterCode: "Z" } });
    expect(mocks.warehouses).toHaveBeenCalledWith(expect.anything(), { afterCode: "A", limit: 100 });
    const cursor = { depth: 1, code: "Z", id: DEST };
    mocks.locations.mockResolvedValue({ items: [{ id: DEST, code: "RAF1", name: "Raf", status: "ACTIVE", kind: "STORAGE" }, { id: ID, status: "ACTIVE", kind: "RECEIVING" }], next: cursor });
    expect(await packageTransferLocationsAction({ ...identity, warehouseId: KEY, after: cursor })).toEqual({ ok: true, data: { items: [{ id: DEST, code: "RAF1", name: "Raf" }], next: cursor } });
    expect(mocks.locations).toHaveBeenCalledWith(expect.anything(), { warehouseId: KEY, after: cursor, limit: 200 });
  });
  it("code lookup is strictly inside explicitly authorized target warehouse; no cross-warehouse fallback", async () => {
    expect(await resolvePackageTransferDestinationAction({ ...identity, warehouseId: KEY, code: "RAF1" })).toEqual({ ok: true, data: { id: DEST, code: "RAF1", name: "Raf" } });
    expect(mocks.warehouse).toHaveBeenCalledWith(expect.anything(), { warehouseId: KEY });
    expect(mocks.find).toHaveBeenCalledWith(expect.anything(), { warehouseId: KEY, code: "RAF1" });
    mocks.find.mockResolvedValue(null);
    expect(await resolvePackageTransferDestinationAction({ ...identity, warehouseId: KEY, code: "UNKNOWN" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(mocks.find).toHaveBeenCalledTimes(2);
  });
  it("current, hidden or archived target warehouse cannot list/resolve destinations", async () => {
    expect(await packageTransferLocationsAction({ ...identity, warehouseId: ID })).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(mocks.warehouse).not.toHaveBeenCalled();
    mocks.warehouse.mockRejectedValue(new AppError("NOT_FOUND"));
    expect(await resolvePackageTransferDestinationAction({ ...identity, warehouseId: KEY, code: "RAF1" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(mocks.find).not.toHaveBeenCalled();
    mocks.warehouse.mockResolvedValue({ status: "ARCHIVED" });
    expect(await packageTransferLocationsAction({ ...identity, warehouseId: KEY })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(mocks.locations).not.toHaveBeenCalled();
  });
});

it("T963 preserves server origin and zero remaining metadata in readonly current transport", async () => {
  for (const originKind of ["RECEIPT", "PRODUCTION"] as const) {
    const current = { id: ID, qr: `EWMS:PKG:1:${ID}`, originKind, baseQuantity: "200.000000", originBaseQuantity: "200.000000",
      remainingBaseQuantity: "0.000000", currentBaseQuantity: "0.000000", currentStockStatus: null,
      currentLocation: null, currentBalanceVersion: null, predecessorVersion: 2, warehouseId: KEY,
      allowedActions: [], canTransfer: false, blockedReason: "UNSUPPORTED_STATE" };
    mocks.current.mockResolvedValue(current); mocks.resolve.mockResolvedValue(current);
    expect(await getCurrentPackageAction(identity)).toEqual({ ok: true, data: current });
    expect(await resolveCurrentPackageQrAction({ slug: "motive", qr: current.qr })).toEqual({ ok: true, data: current });
  }
  expect(mocks.access.mock.calls.map(c => c[0].permission)).toEqual(["stock.view", "stock.view", "stock.view", "stock.view"]);
  expect(mocks.quality).not.toHaveBeenCalled(); expect(mocks.putaway).not.toHaveBeenCalled(); expect(mocks.transfer).not.toHaveBeenCalled();
});
