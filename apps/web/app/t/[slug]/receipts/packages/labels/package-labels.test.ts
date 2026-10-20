import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@wms/shared/errors";
import type { PackageReceiptDto, ReceiptPackageDto } from "../actions.ts";
const mocks = vi.hoisted(() => ({ receipt: vi.fn(), batch: vi.fn(), principal: vi.fn() }));
vi.mock("@wms/domain/operations", () => ({ getPackageReceipt: mocks.receipt, getPackageProductionBatch: mocks.batch }));
vi.mock("@wms/db", () => ({ getAppDb: () => ({}) }));
// T-973: kalıp kabı burada sınanmaz (yalnız sunucu sınırı ve etiket verisi).
vi.mock("./package-label-ekran.tsx", () => ({ PackageLabelEkran: ({ children }: { children: unknown }) => children }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); }, redirect: (url: string) => { throw new Error(url); } }));
vi.mock("../../../../../../lib/auth-service.ts", () => ({ getAuthService: () => ({ getPrincipal: mocks.principal }) }));
import { generatePackageQrs, packageQr, postedLabelPackages, validPackagePrintSettings } from "./package-labels.ts";
import Page from "./page.tsx";
import { printCss } from "../../../labels/print-settings.ts";
const packages: ReceiptPackageDto[] = Array.from({ length: 5 }, (_, i) => {
  const id = `11111111-1111-4111-8111-11111111111${i}`;
  return { id, qr: `EWMS:PKG:1:${id}`, packageNo: i + 1, kind: "VARIL", receiptLineId: id, documentLineId: id, itemId: id, itemCode: "HM-000001", itemName: "Rubber", unitId: id, unitCode: "KG", unitName: "Kilogram", quantity: "200.000", conversionFactor: "1", baseQuantity: "200.000", receivingLocationId: id, stockStatus: "QUARANTINE", lotId: id, lotCode: "LOT-1", producedOn: "2026-10-01", expiresOn: "2027-10-01" };
});
const receipt: PackageReceiptDto = { documentId: packages[0]!.id, documentStatus: "POSTED", documentVersion: 2, documentNumber: "IN-1", receiptId: packages[0]!.id, receiptStatus: "CLOSED", receiptVersion: 2, receiptNumber: "R-1", warehouseId: packages[0]!.id, supplierRef: null, packages };
const page = (extra = {}) => Page({ params: Promise.resolve({ slug: "acme" }), searchParams: Promise.resolve({ document: receipt.documentId, ...extra }) });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("PACKAGE_RECEIVING_ENABLED", "true"); mocks.principal.mockResolvedValue({ userId: packages[0]!.id, mfaVerified: true }); mocks.receipt.mockResolvedValue(receipt); mocks.batch.mockRejectedValue(new AppError("NOT_FOUND")); });
afterEach(() => vi.unstubAllEnvs());
describe("server label source", () => {
  it("reads only the document from the authorized query and ignores client status claims", async () => {
    expect(await page({ status: "DRAFT", quantity: "999" })).toBeTruthy();
    expect(mocks.receipt).toHaveBeenCalledWith(expect.objectContaining({ tenantSlug: "acme", principal: expect.objectContaining({ mfaVerified: true }) }), { documentId: receipt.documentId });
  });
  it("fails closed before auth/query when flag is absent", async () => { vi.stubEnv("PACKAGE_RECEIVING_ENABLED", ""); await expect(page()).rejects.toThrow("404"); expect(mocks.receipt).not.toHaveBeenCalled(); });
  it("rejects anonymous source before query", async () => { mocks.principal.mockResolvedValue(null); await expect(page()).rejects.toThrow("/login?next="); expect(mocks.receipt).not.toHaveBeenCalled(); });
  it.each(["DRAFT", "PREPARED", "CANCELLED"])("rejects document %s even if client says POSTED", async status => { mocks.receipt.mockResolvedValue({ ...receipt, documentStatus: status }); const result = await page({ status: "POSTED" }); expect(JSON.stringify(result)).not.toContain("EWMS:PKG"); });
  it("requires the server-closed receipt too", () => { expect(() => postedLabelPackages({ ...receipt, receiptStatus: "DRAFT" })).toThrow(AppError); });
  it("foreign document NOT_FOUND propagates to 404", async () => { mocks.receipt.mockRejectedValue(new AppError("NOT_FOUND")); await expect(page()).rejects.toThrow("404"); });
  it.each(["no stock.view", "warehouse ACL"])("does not expose labels after domain denies %s", async () => { mocks.receipt.mockRejectedValue(new AppError("FORBIDDEN")); expect(JSON.stringify(await page())).not.toContain("EWMS:PKG"); expect(mocks.batch).not.toHaveBeenCalled(); });
  it("resolves actual POSTED production output after receipt NOT_FOUND and projects only label metadata", async () => {
    mocks.receipt.mockRejectedValue(new AppError("NOT_FOUND"));
    const output={id:packages[0]!.id,qr:packages[0]!.qr,packageNo:1,kind:"KOLI",itemCode:"MM-000001",itemName:"Output",quantity:"50.000000",unitCode:"KG",stockStatus:"AVAILABLE",lotCode:"OUT-1",producedOn:"2026-10-14",expiresOn:"2027-10-14",targetLocationId:"private-output-location",documentLineId:"private-line"};
    mocks.batch.mockResolvedValue({documentId:receipt.documentId,documentStatus:"POSTED",packages:[output],sourceWarehouseId:"private-input-warehouse",inputs:[{packageId:"private-input"}]});
    const rendered=JSON.stringify(await page({source:"receipt",status:"DRAFT",quantity:"999"}));
    expect(mocks.batch).toHaveBeenCalledWith(expect.objectContaining({tenantSlug:"acme",principal:expect.objectContaining({mfaVerified:true})}),{documentId:receipt.documentId});
    expect(rendered).toContain("MM-000001");expect(rendered).toContain("50.000000");expect(rendered).toContain("EWMS:PKG");
    expect(rendered).not.toContain("private-");expect(rendered).not.toContain("receiptStatus");expect(rendered).not.toContain("receiptLineId");expect(rendered).not.toContain("targetLocationId");
  });
  it("rejects APPROVED production output despite client POSTED claims", async () => {
    mocks.receipt.mockRejectedValue(new AppError("NOT_FOUND"));mocks.batch.mockResolvedValue({documentId:receipt.documentId,documentStatus:"APPROVED",packages});
    expect(JSON.stringify(await page({source:"production",status:"POSTED"}))).not.toContain("EWMS:PKG");
    expect(mocks.batch).toHaveBeenCalledTimes(1);
  });
  it("ignores a production source claim for a real authorized receipt", async () => {
    expect(JSON.stringify(await page({source:"production"}))).toContain("HM-000001");expect(mocks.batch).not.toHaveBeenCalled();
  });
  it("keeps production warehouse denial and MFA redirects within the readonly query", async () => {
    mocks.receipt.mockRejectedValue(new AppError("NOT_FOUND"));mocks.batch.mockRejectedValue(new AppError("FORBIDDEN"));
    expect(JSON.stringify(await page())).not.toContain("EWMS:PKG");
    mocks.batch.mockRejectedValue(new AppError("FORBIDDEN",{detail:"MFA_REQUIRED"}));await expect(page()).rejects.toThrow("/mfa?next=");
  });
  it("requires one document query parameter", async () => { await expect(page({ document: [receipt.documentId] })).rejects.toThrow("404"); expect(mocks.receipt).not.toHaveBeenCalled(); });
});
describe("same physical identities and all-or-nothing QR generation", () => {
  it("encodes five distinct versioned payloads and reprint preserves every matrix/UUID", async () => {
    const generate = vi.fn(packageQr);
    const first = await generatePackageQrs(postedLabelPackages(receipt), generate);
    expect(generate.mock.calls.map(([p]) => p.qr)).toEqual(packages.map(p => `EWMS:PKG:1:${p.id}`));
    expect(new Set(first.map(q => q.path)).size).toBe(5);
    expect(await generatePackageQrs(postedLabelPackages(receipt))).toEqual(first);
    for (const q of first) { expect(q.size).toBeGreaterThan(8); expect(q.path).toMatch(/^M\d+ \d+h1v1h-1z/); }
  });
  it("a generation fault rejects the entire collection and permits explicit retry", async () => {
    const generate = vi.fn(packageQr).mockImplementationOnce(() => { throw new Error("fault"); });
    await expect(generatePackageQrs(packages, generate)).rejects.toThrow("fault");
    expect(await generatePackageQrs(packages)).toHaveLength(5);
  });
  it("rejects empty QR output and wrong identity", async () => {
    await expect(generatePackageQrs(packages, p => ({ id: p.id, size: 1, path: "" }))).rejects.toThrow();
    expect(() => postedLabelPackages({ ...receipt, packages: [{ ...packages[0]!, qr: "<svg onload=alert(1)>" }] })).toThrow();
    expect(() => postedLabelPackages({ ...receipt, packages: [packages[0]!, packages[0]!] })).toThrow();
  });
  it("validates physical bounds and reuses both A4 and roll print CSS", () => {
    const base = { width: 100, height: 75, gap: 3, mode: "a4" as const };
    expect(validPackagePrintSettings(base)).toBe(true);
    expect(validPackagePrintSettings({ ...base, width: 100, height: 50, mode: "label" })).toBe(true);
    for (const change of [{ width: NaN }, { width: 19 }, { height: 14 }, { width: 191 }, { gap: -1 }]) expect(validPackagePrintSettings({ ...base, ...change })).toBe(false);
    expect(printCss(base)).toContain("A4 portrait");
    expect(printCss({ ...base, mode: "label" })).toContain("100mm 75mm");
    expect(printCss({ ...base, mode: "label" })).toContain("break-after:page");
  });
});
