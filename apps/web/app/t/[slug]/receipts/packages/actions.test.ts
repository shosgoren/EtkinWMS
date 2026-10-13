import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@wms/shared/errors";
const mocks = vi.hoisted(() => ({ principal: vi.fn(), access: vi.fn(), limit: vi.fn(), prepare: vi.fn(), post: vi.fn(), receipt: vi.fn(), item: vi.fn(), conversions: vi.fn(), units: vi.fn(), barcode: vi.fn(), search: vi.fn(), warehouses: vi.fn(), warehouse: vi.fn(), locations: vi.fn(), headers: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("../../../../../lib/auth-service.ts", () => ({ getAuthService: () => ({ getPrincipal: mocks.principal }) }));
vi.mock("@wms/db", () => ({ getAppDb: () => ({}) }));
vi.mock("@wms/domain/identity/access", () => ({ runTenantQuery: mocks.access }));
vi.mock("../../../../../lib/rate-limit.ts", async original => ({ ...await original<typeof import("../../../../../lib/rate-limit.ts")>(), createProductionLimiter: () => ({ check: mocks.limit }) }));
vi.mock("@wms/domain/operations", () => ({ preparePackageReceipt: mocks.prepare, postPackageReceipt: mocks.post, getPackageReceipt: mocks.receipt }));
vi.mock("@wms/domain/catalog", () => ({ getItem: mocks.item, listItemConversions: mocks.conversions, listUnits: mocks.units, resolveBarcodeQuery: mocks.barcode, searchItems: mocks.search }));
vi.mock("@wms/domain/warehouse", () => ({ getLocationTree: mocks.locations, getWarehouse: mocks.warehouse, listWarehouses: mocks.warehouses }));
import { getPackageReceiptAction, packageItemOptionsAction, packageReceivingLocationsAction, packageWarehousesAction, postPackageReceiptAction, preparePackageReceiptAction, resolvePackageItemScanAction, searchPackageItemsAction } from "./actions.ts";
const ID = "11111111-1111-4111-8111-111111111111";
const UNIT = "22222222-2222-4222-8222-222222222222";
const KEY = "33333333-3333-4333-8333-333333333333";
const REQUEST = "44444444-4444-4444-8444-444444444444";
const draft = { slug: "acme", clientKey: KEY, warehouseId: ID, receivingLocationId: ID, itemId: ID, unitId: UNIT, kind: "VARIL", packages: { mode: "equal", count: 5, quantity: "200.000", lotCode: "LOT-1", producedOn: "2026-01-01" } };
const post = { slug: "acme", clientKey: UNIT, documentId: ID, expectedVersion: 1 };
const item = { id: ID, code: "HM-000001", name: "Rubber", baseUnitId: ID, trackingMode: "LOT", quantityScale: 3, status: "ACTIVE" };
const endpoints = [
  () => preparePackageReceiptAction(draft), () => postPackageReceiptAction(post),
  () => getPackageReceiptAction({ slug: "acme", documentId: ID }), () => packageItemOptionsAction({ slug: "acme", itemId: ID }),
  () => packageReceivingLocationsAction({ slug: "acme", warehouseId: ID }), () => packageWarehousesAction({ slug: "acme" }),
  () => resolvePackageItemScanAction({ slug: "acme", code: "barcode" }), () => searchPackageItemsAction({ slug: "acme" }),
];
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("BETTER_AUTH_URL", "https://app.example.test");
  vi.stubEnv("PACKAGE_RECEIVING_ENABLED", "true");
  mocks.headers.mockResolvedValue(new Headers({ origin: "https://app.example.test", "fly-client-ip": "203.0.113.7", "x-request-id": REQUEST }));
  mocks.principal.mockResolvedValue({ userId: ID, mfaVerified: true });
  mocks.access.mockResolvedValue("verified-tenant");
  mocks.prepare.mockResolvedValue({ documentId: ID, status: "DRAFT", replayed: false });
  mocks.post.mockResolvedValue({ documentId: ID, status: "POSTED", replayed: false });
  mocks.item.mockResolvedValue(item);
  mocks.units.mockResolvedValue([{ id: ID, code: "KG", name: "Kilogram", status: "ACTIVE" }, { id: UNIT, code: "GR", name: "Gram", status: "ACTIVE" }]);
  mocks.conversions.mockResolvedValue([{ unitId: UNIT, unitCode: "GR", unitName: "Gram", factor: "0.001" }]);
  mocks.warehouse.mockResolvedValue({ status: "ACTIVE" });
});
afterEach(() => vi.unstubAllEnvs());
describe("entry point authorization and server gate", () => {
  it("disabled flag blocks every action before tenant/domain access", async () => {
    vi.stubEnv("PACKAGE_RECEIVING_ENABLED", "false");
    for (const action of endpoints) expect(await action()).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.receipt).not.toHaveBeenCalled();
  });
  it("anonymous requests cannot reach any domain", async () => {
    mocks.principal.mockResolvedValue(null);
    for (const action of endpoints) expect(await action()).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it("origin rejection precedes principal resolution", async () => {
    mocks.headers.mockResolvedValue(new Headers({ origin: "https://foreign.example" }));
    expect(await preparePackageReceiptAction(draft)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(mocks.principal).not.toHaveBeenCalled();
  });
  it.each([undefined, "MFA_REQUIRED"] as const)("access authority rejects forbidden detail %s before verified tenant limit", async detail => {
    mocks.principal.mockResolvedValue({ userId: ID, mfaVerified: detail !== "MFA_REQUIRED" });
    mocks.access.mockRejectedValue(new AppError("FORBIDDEN", detail === undefined ? undefined : { detail }));
    for (const action of endpoints) expect(await action()).toMatchObject({ ok: false, error: { code: "FORBIDDEN", ...(detail === undefined ? {} : { detail }) } });
    expect(mocks.limit.mock.calls.some(c => c[0] === "tenant")).toBe(false);
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.receipt).not.toHaveBeenCalled();
  });
  it("uses verified tenant and operation permissions", async () => {
    await preparePackageReceiptAction(draft); await postPackageReceiptAction(post);
    mocks.receipt.mockResolvedValue({ documentId: ID });
    await getPackageReceiptAction({ slug: "acme", documentId: ID });
    expect(mocks.access.mock.calls.map(c => c[0].permission)).toEqual(["document.create", "stock.post", "stock.view"]);
    expect(mocks.limit.mock.calls.filter(c => c[0] === "tenant")).toEqual(Array.from({ length: 3 }, () => ["tenant", "verified-tenant"]));
  });
});
describe("strict bounded inputs", () => {
  it.each(["tenantId", "status", "id", "toBaseFactor", "baseQuantity", "requestId"])("rejects caller %s", async field => {
    expect(await preparePackageReceiptAction({ ...draft, [field]: ID })).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it.each([
    { mode: "equal", count: 201, quantity: "1" }, { mode: "equal", count: 1.5, quantity: "1" },
    { mode: "equal", count: 1, quantity: 200 }, { mode: "equal", count: 1, quantity: "1", baseQuantity: "2" },
    { mode: "explicit", packages: [] }, { mode: "explicit", packages: [{ quantity: "1", id: ID }] },
    { mode: "explicit", packages: [{ quantity: "1".repeat(33) }] },
  ])("rejects malformed packages %#", async packages => {
    expect(await preparePackageReceiptAction({ ...draft, packages })).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("post rejects forged status and noninteger version", async () => {
    for (const value of [{ ...post, status: "POSTED" }, { ...post, expectedVersion: 1.2 }]) expect(await postPackageReceiptAction(value)).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("query rejects unknown and invalid IDs", async () => {
    for (const value of [{ slug: "acme", documentId: "bad" }, { slug: "acme", documentId: ID, tenantId: ID }]) expect(await getPackageReceiptAction(value)).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(mocks.receipt).not.toHaveBeenCalled();
  });
});
describe("command/recovery transport", () => {
  it("preserves exact decimals, keys, metadata and server request context", async () => {
    expect(await preparePackageReceiptAction(draft)).toEqual({ ok: true, data: { documentId: ID, status: "DRAFT", replayed: false } });
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ clientKey: KEY, tenantSlug: "acme", principal: { userId: ID, mfaVerified: true } }), expect.objectContaining({ packages: draft.packages, requestId: REQUEST }));
    expect(mocks.receipt).not.toHaveBeenCalled();
  });
  it("replays both commands with unchanged keys and reports domain IDs", async () => {
    await preparePackageReceiptAction(draft); mocks.prepare.mockResolvedValue({ documentId: ID, status: "DRAFT", replayed: true });
    expect(await preparePackageReceiptAction(draft)).toMatchObject({ ok: true, data: { documentId: ID, replayed: true } });
    expect(mocks.prepare.mock.calls[0]).toEqual(mocks.prepare.mock.calls[1]);
    await postPackageReceiptAction(post); mocks.post.mockResolvedValue({ documentId: ID, status: "POSTED", replayed: true });
    expect(await postPackageReceiptAction(post)).toMatchObject({ ok: true, data: { documentId: ID, status: "POSTED", replayed: true } });
    expect(mocks.post.mock.calls[0]).toEqual(mocks.post.mock.calls[1]);
  });
  it("post fault leaves prepared identity queryable and retries post only", async () => {
    await preparePackageReceiptAction(draft);
    mocks.post.mockRejectedValueOnce(new AppError("VERSION_CONFLICT", { retryable: true }));
    expect(await postPackageReceiptAction(post)).toMatchObject({ ok: false, error: { code: "VERSION_CONFLICT" } });
    mocks.receipt.mockResolvedValue({ documentId: ID, documentStatus: "DRAFT", documentVersion: 1, packages: [{ id: UNIT, qr: `EWMS:PKG:1:${UNIT}`, stockStatus: "QUARANTINE" }] });
    expect(await getPackageReceiptAction({ slug: "acme", documentId: ID })).toMatchObject({ ok: true, data: { documentId: ID, documentStatus: "DRAFT" } });
    expect(await postPackageReceiptAction(post)).toMatchObject({ ok: true, data: { status: "POSTED" } });
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
  });
  it.each(["FORBIDDEN", "NOT_FOUND"] as const)("preserves domain scope/foreign UUID rejection %s", async code => {
    mocks.prepare.mockRejectedValue(new AppError(code)); mocks.post.mockRejectedValue(new AppError(code)); mocks.receipt.mockRejectedValue(new AppError(code));
    for (const action of endpoints.slice(0, 3)) expect(await action()).toMatchObject({ ok: false, error: { code } });
  });
  it("does not fabricate success if domain result lacks ID/status", async () => {
    mocks.prepare.mockResolvedValue({}); mocks.post.mockResolvedValue({ documentId: ID, status: "DRAFT" });
    expect(await preparePackageReceiptAction(draft)).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
    expect(await postPackageReceiptAction(post)).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
  });
});
describe("trusted catalog and scoped warehouse reads", () => {
  it("returns trusted GR→KG factor; archived/unmapped units excluded", async () => {
    mocks.conversions.mockResolvedValue([{ unitId: UNIT, unitCode: "GR", unitName: "Gram", factor: "0.001" }, { unitId: KEY, factor: "999" }]);
    expect(await packageItemOptionsAction({ slug: "acme", itemId: ID })).toMatchObject({ ok: true, data: { baseUnit: { code: "KG" }, units: [{ toBaseFactor: "1" }, { unitId: UNIT, toBaseFactor: "0.001" }] } });
  });
  it("retains SERIAL visibility without pretending NONE", async () => {
    mocks.item.mockResolvedValue({ ...item, trackingMode: "SERIAL" });
    expect(await packageItemOptionsAction({ slug: "acme", itemId: ID })).toMatchObject({ ok: true, data: { item: { trackingMode: "SERIAL" } } });
  });
  it("barcode selects item/unit only", async () => {
    mocks.barcode.mockResolvedValue({ itemId: ID, unitId: UNIT, quantity: "999", baseQuantity: "999" });
    const result = await resolvePackageItemScanAction({ slug: "acme", code: "barcode" });
    expect(result).toMatchObject({ ok: true, data: { selectedUnitId: UNIT } });
    if (result.ok) { expect(result.data).not.toHaveProperty("quantity"); expect(result.data).not.toHaveProperty("baseQuantity"); }
  });
  it("missing conversion/active base and archived item fail explicitly", async () => {
    mocks.barcode.mockResolvedValue({ itemId: ID, unitId: KEY });
    expect(await resolvePackageItemScanAction({ slug: "acme", code: "barcode" })).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    mocks.units.mockResolvedValue([]);
    expect(await packageItemOptionsAction({ slug: "acme", itemId: ID })).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    mocks.item.mockResolvedValue({ ...item, status: "ARCHIVED" });
    expect(await packageItemOptionsAction({ slug: "acme", itemId: ID })).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });
  it("search retains bounded cursor and uses ACTIVE server filter", async () => {
    mocks.search.mockResolvedValue({ items: [item], nextCursor: "next" });
    expect(await searchPackageItemsAction({ slug: "acme", q: "HM", after: "cursor" })).toMatchObject({ ok: true, data: { nextCursor: "next", items: [{ id: ID }] } });
    expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({ tenantSlug: "acme" }), { q: "HM", after: "cursor", status: "ACTIVE", limit: 50 });
  });
  it("warehouse pagination and RECEIVING pagination preserve cursors after filtering", async () => {
    mocks.warehouses.mockResolvedValue({ items: [{ id: ID, code: "W", name: "Warehouse", status: "ACTIVE" }, { status: "ARCHIVED" }], nextAfterCode: "next" });
    expect(await packageWarehousesAction({ slug: "acme" })).toEqual({ ok: true, data: { items: [{ id: ID, code: "W", name: "Warehouse" }], nextAfterCode: "next" } });
    const after = { depth: 1, code: "X", id: ID };
    mocks.locations.mockResolvedValue({ items: [{ id: ID, code: "R", name: "Receiving", kind: "RECEIVING", status: "ACTIVE" }, { kind: "STORAGE", status: "ACTIVE" }], next: after });
    expect(await packageReceivingLocationsAction({ slug: "acme", warehouseId: ID, after })).toEqual({ ok: true, data: { items: [{ id: ID, code: "R", name: "Receiving" }], next: after } });
    expect(mocks.locations).toHaveBeenCalledWith(expect.objectContaining({ tenantSlug: "acme" }), { warehouseId: ID, after, limit: 200 });
  });
  it("empty RECEIVING remains empty and scoped warehouse rejection stops tree query", async () => {
    mocks.locations.mockResolvedValue({ items: [], next: null });
    expect(await packageReceivingLocationsAction({ slug: "acme", warehouseId: ID })).toEqual({ ok: true, data: { items: [], next: null } });
    mocks.locations.mockClear(); mocks.warehouse.mockRejectedValue(new AppError("FORBIDDEN"));
    expect(await packageReceivingLocationsAction({ slug: "acme", warehouseId: ID })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(mocks.locations).not.toHaveBeenCalled();
  });
});
