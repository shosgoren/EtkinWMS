import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), post: vi.fn(), get: vi.fn(), principal: vi.fn(), membership: vi.fn() }));
vi.mock("./actions.ts", () => ({ preparePackageReceiptAction: mocks.prepare, postPackageReceiptAction: mocks.post, getPackageReceiptAction: mocks.get, packageItemOptionsAction: vi.fn(), packageReceivingLocationsAction: vi.fn(), packageWarehousesAction: vi.fn(), resolvePackageItemScanAction: vi.fn(), searchPackageItemsAction: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => createElement("a", { href }, children) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@wms/db", () => ({ getAppDb: () => ({}) }));
vi.mock("@wms/domain/identity/member-queries", () => ({ getMembershipSummary: mocks.membership }));
vi.mock("../../../../../lib/auth-service.ts", () => ({ getAuthService: () => ({ getPrincipal: mocks.principal }) }));
vi.mock("@wms/ui", () => ({ Banner: ({ children }: { children: React.ReactNode }) => createElement("p", {}, children), PackagePlus: () => null }));
vi.mock("../../field/receive/receive-flow.tsx", () => ({ PrimaryButton: ({ children, disabled }: { children: React.ReactNode; disabled: boolean }) => createElement("button", { disabled, className: "min-h-14" }, children), SecondaryButton: ({ children }: { children: React.ReactNode }) => createElement("button", {}, children), ScanPanel: () => null, useScanner: () => ({ service: null, camera: vi.fn(), dropped: false }), useScanPrimary: () => ({ ready: false, press: vi.fn(), overlay: null }) }));
vi.mock("../../screen-shell.tsx", () => ({ FormSteps: () => null }));
vi.mock("../receipt-form.tsx", () => ({ ErrorNotice: () => null }));
// T-973: kalıp kabı (üst çubuk, alt cam çubuk) burada sınanmaz; yalnız adım içeriği.
vi.mock("../../kalip/ekran.tsx", () => ({ KalipEkran: ({ children }: { children: React.ReactNode }) => createElement("div", {}, children), Ico: () => null }));
vi.mock("../../kalip/liste.tsx", () => ({ KalipKilitliEkran: ({ text }: { text: string }) => createElement("p", { role: "alert" }, text), KalipHataEkran: ({ text }: { text: string }) => createElement("p", { role: "alert" }, text) }));
import { createPackageSubmission, displayQuantity, PackageFlow, packageLabelHref, packagePreview, type PrepareInput } from "./package-flow.tsx";
import Page from "./page.tsx";
import type { PackageItemOptionsDto, PackageReceiptDto } from "./actions.ts";
const options: PackageItemOptionsDto = { item: { id: "item", name: "Rubber", code: "HM-000001", trackingMode: "NONE", quantityScale: 3, baseUnitId: "kg" }, baseUnit: { id: "kg", code: "KG", name: "Kilogram" }, units: [{ unitId: "kg", unitCode: "KG", unitName: "Kilogram", toBaseFactor: "1" }, { unitId: "gr", unitCode: "GR", unitName: "Gram", toBaseFactor: "0.001" }] };
const input: PrepareInput = { slug: "acme", warehouseId: "warehouse", receivingLocationId: "receiving", itemId: "item", unitId: "kg", kind: "VARIL", packages: { mode: "equal", count: 5, quantity: "200" } };
const draft: PackageReceiptDto = { documentId: "document", documentStatus: "DRAFT", documentVersion: 3, documentNumber: null, receiptId: "receipt", receiptStatus: "DRAFT", receiptVersion: 1, receiptNumber: "R-1", warehouseId: "warehouse", supplierRef: null, packages: [] };
const posted = { ...draft, documentStatus: "POSTED" };
function fixture(initial: PackageReceiptDto | null = null) {
  let next = 0;
  const prepare = vi.fn().mockResolvedValue({ ok: true, data: { documentId: "document", status: "DRAFT", replayed: false } });
  const post = vi.fn().mockResolvedValue({ ok: true, data: { documentId: "document", status: "POSTED", replayed: false } });
  const get = vi.fn().mockResolvedValueOnce({ ok: true, data: draft }).mockResolvedValue({ ok: true, data: posted });
  const submission = createPackageSubmission(initial, { prepare, post, get }, () => `key-${++next}`);
  return { submission, prepare, post, get, saved: vi.fn() };
}
afterEach(() => vi.unstubAllEnvs());
describe("package preview", () => {
  it("shows five 200KG packages as exactly 1.000 KG", () => {
    const result = packagePreview(input.packages, options, "kg");
    expect(result).toEqual({ count: 5, total: "1000", baseTotal: "1000" });
    expect(displayQuantity(result?.baseTotal ?? "")).toBe("1.000");
  });
  it("sums unequal 200/190/210/195/205 quantities", () => {
    expect(packagePreview({ mode: "explicit", packages: ["200", "190", "210", "195", "205"].map(quantity => ({ quantity })) }, options, "kg")).toEqual({ count: 5, total: "1000", baseTotal: "1000" });
  });
  it("uses the catalog conversion factor with exact decimals", () => {
    expect(packagePreview({ mode: "equal", count: 5, quantity: "200000" }, options, "gr")?.baseTotal).toBe("1000");
    expect(packagePreview({ mode: "explicit", packages: [{ quantity: "0.1" }, { quantity: "0.2" }] }, options, "kg")?.baseTotal).toBe("0.3");
    expect(packagePreview({ mode: "equal", count: 2, quantity: "99999999999999.999" }, options, "kg")?.total).toBe("199999999999999.998");
  });
  it.each([0, -1, 201, 1.5])( "rejects count %s", count => expect(packagePreview({ mode: "equal", count, quantity: "200" }, options, "kg")).toBeNull());
  it.each(["", "0", "-1", "2e3", "1,5"])("rejects quantity %s", quantity => expect(packagePreview({ mode: "equal", count: 1, quantity }, options, "kg")).toBeNull());
  it("rejects unsupported tracking and missing conversion", () => {
    for (const trackingMode of ["SERIAL", "LOT_AND_SERIAL"] as const) expect(packagePreview(input.packages, { ...options, item: { ...options.item, trackingMode } }, "kg")).toBeNull();
    expect(packagePreview(input.packages, options, "unknown")).toBeNull();
  });
  it("accepts SQL padded factor and uses nine-place catalog scale without rounding", () => {
    const precise = { ...options, item: { ...options.item, quantityScale: 9 }, units: [{ unitId: "gr", unitCode: "GR", unitName: "Gram", toBaseFactor: "0.001000000" }] };
    expect(packagePreview({ mode: "equal", count: 5, quantity: "200000.000000000" }, precise, "gr")?.baseTotal).toBe("1000");
    expect(packagePreview({ mode: "equal", count: 1, quantity: "0.000001" }, precise, "gr")?.baseTotal).toBe("0.000000001");
    expect(packagePreview({ mode: "equal", count: 1, quantity: "0.0000001" }, precise, "gr")).toBeNull();
  });
  it("NONE preserves optional lot and date snapshot metadata", () => {
    expect(packagePreview({ mode: "equal", count: 1, quantity: "200", lotCode: "OPTIONAL", producedOn: "2026-10-01", expiresOn: "2027-10-01" }, options, "kg")?.baseTotal).toBe("200");
  });
  it("requires lot and valid date order for LOT", () => {
    const lotOptions = { ...options, item: { ...options.item, trackingMode: "LOT" as const } };
    expect(packagePreview(input.packages, lotOptions, "kg")).toBeNull();
    expect(packagePreview({ mode: "equal", count: 5, quantity: "200", lotCode: "L1", producedOn: "2026-10-01", expiresOn: "2027-10-01" }, lotOptions, "kg")?.baseTotal).toBe("1000");
    for (const dates of [{ producedOn: "2026-02-30" }, { producedOn: "2027-10-01", expiresOn: "2026-10-01" }]) expect(packagePreview({ mode: "equal", count: 5, quantity: "200", lotCode: "L1", ...dates }, lotOptions, "kg")).toBeNull();
  });
});
describe("durable prepare/post flow", () => {
  it("saves document before reading/posting, with separate command keys", async () => {
    const f = fixture();
    expect(await f.submission.run(input, "acme", f.saved)).toEqual(posted);
    expect(f.prepare.mock.calls[0]?.[0]).toEqual({ ...input, clientKey: "key-1" });
    expect(f.saved).toHaveBeenCalledWith("document");
    expect(f.post).toHaveBeenCalledWith({ slug: "acme", documentId: "document", expectedVersion: 3, clientKey: "key-2" });
    expect(f.saved.mock.invocationCallOrder[0]).toBeLessThan(f.get.mock.invocationCallOrder[0] ?? 0);
  });
  it("lost prepare response retries frozen content and the same key", async () => {
    const f = fixture(); f.prepare.mockRejectedValueOnce(new Error("offline"));
    await expect(f.submission.run(input, "acme", f.saved)).rejects.toThrow("offline");
    expect(f.submission.frozen).toBe(true);
    await f.submission.run({ ...input, kind: "KOLI" }, "acme", f.saved);
    expect(f.prepare.mock.calls[1]).toEqual(f.prepare.mock.calls[0]);
  });
  it.each(["VALIDATION_FAILED", "FORBIDDEN"])("definite first prepare %s allows correction with a new key", async code => {
    const f = fixture(); f.prepare.mockResolvedValueOnce({ ok: false, error: { code, requestId: "r" } });
    await expect(f.submission.run(input, "acme", f.saved)).rejects.toMatchObject({ code });
    expect(f.submission.frozen).toBe(false); expect(f.submission.documentId).toBeNull();
    await f.submission.run({ ...input, kind: "KOLI" }, "acme", f.saved);
    expect(f.prepare.mock.calls[1]?.[0]).toEqual({ ...input, kind: "KOLI", clientKey: "key-2" });
  });
  it("permission rejection after lost prepare response cannot unlock possibly committed content", async () => {
    const f = fixture(); f.prepare.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ok: false, error: { code: "FORBIDDEN", requestId: "r" } });
    await expect(f.submission.run(input, "acme", f.saved)).rejects.toThrow();
    await expect(f.submission.run({ ...input, kind: "KOLI" }, "acme", f.saved)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.submission.frozen).toBe(true); expect(f.prepare.mock.calls[1]).toEqual(f.prepare.mock.calls[0]);
  });
  it("explicit INTERNAL preserves unknown prepare content and key", async () => {
    const f = fixture(); f.prepare.mockResolvedValueOnce({ ok: false, error: { code: "INTERNAL", requestId: "r" } });
    await expect(f.submission.run(input, "acme", f.saved)).rejects.toMatchObject({ code: "INTERNAL" });
    expect(f.submission.frozen).toBe(true); await f.submission.run(null, "acme", f.saved);
    expect(f.prepare.mock.calls[1]).toEqual(f.prepare.mock.calls[0]);
  });
  it("failed post retains draft and key; does not prepare again", async () => {
    const f = fixture(); f.post.mockResolvedValueOnce({ ok: false, error: { code: "INTERNAL", requestId: "r" } });
    await expect(f.submission.run(input, "acme", f.saved)).rejects.toMatchObject({ code: "INTERNAL" });
    expect(f.submission.documentId).toBe("document");
    expect(await f.submission.run(null, "acme", f.saved)).toEqual(posted);
    expect(f.prepare).toHaveBeenCalledTimes(1);
    expect(f.post.mock.calls[1]).toEqual(f.post.mock.calls[0]);
  });
  it("read failure after prepare retains URL identity and resumes", async () => {
    const f = fixture(); f.get.mockReset().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ok: true, data: draft }).mockResolvedValue({ ok: true, data: posted });
    await expect(f.submission.run(input, "acme", f.saved)).rejects.toThrow();
    expect(f.saved).toHaveBeenCalledWith("document"); expect(f.submission.documentId).toBe("document");
    await f.submission.run(null, "acme", f.saved);
    expect(f.prepare).toHaveBeenCalledTimes(1);
  });
  it("lost post response retries same document/version/key", async () => {
    const f = fixture(); f.post.mockRejectedValueOnce(new Error("offline"));
    await expect(f.submission.run(input, "acme", f.saved)).rejects.toThrow();
    await f.submission.run(null, "acme", f.saved);
    expect(f.post.mock.calls[1]).toEqual(f.post.mock.calls[0]); expect(f.prepare).toHaveBeenCalledTimes(1);
  });
  it("successful post with unread metadata recovers POSTED without duplicate post", async () => {
    const f = fixture(); f.get.mockReset().mockResolvedValueOnce({ ok: true, data: draft }).mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ ok: true, data: posted });
    await expect(f.submission.run(input, "acme", f.saved)).rejects.toThrow();
    expect(await f.submission.run(null, "acme", f.saved)).toEqual(posted);
    expect(f.post).toHaveBeenCalledTimes(1); expect(f.prepare).toHaveBeenCalledTimes(1);
  });
  it("recovered draft does not prepare; recovered POSTED does not write", async () => {
    const f = fixture(draft); f.get.mockReset().mockResolvedValue({ ok: true, data: posted });
    await f.submission.run(null, "acme", f.saved); expect(f.prepare).not.toHaveBeenCalled(); expect(f.post).toHaveBeenCalledTimes(1);
    const p = fixture(posted); await p.submission.run(null, "acme", p.saved); expect(p.prepare).not.toHaveBeenCalled(); expect(p.post).not.toHaveBeenCalled();
  });
  it("synchronous double submission is rejected", async () => {
    const f = fixture(); let resolve: (r: unknown) => void = () => {};
    f.prepare.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const first = f.submission.run(input, "acme", f.saved);
    await expect(f.submission.run(input, "acme", f.saved)).rejects.toMatchObject({ code: "BUSY" });
    resolve({ ok: true, data: { documentId: "document", status: "DRAFT" } }); await first;
    expect(f.prepare).toHaveBeenCalledTimes(1);
  });
});
describe("server entry and truthful status", () => {
  it("disabled route fails closed before auth/domain", async () => {
    vi.stubEnv("PACKAGE_RECEIVING_ENABLED", "false");
    await expect(Page({ params: Promise.resolve({ slug: "acme" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.principal).not.toHaveBeenCalled();
  });
  it("stock viewer without write permissions sees no new wizard", async () => {
    vi.stubEnv("PACKAGE_RECEIVING_ENABLED", "true"); mocks.principal.mockResolvedValue({ userId: "u" }); mocks.membership.mockResolvedValue({ memberships: [{ slug: "acme", roles: ["viewer"] }] });
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ slug: "acme" }), searchParams: Promise.resolve({}) }));
    expect(html).toContain("locked"); expect(html).not.toContain("button"); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("draft has retry and locked text, no success or labels", () => {
    const html = renderToStaticMarkup(createElement(PackageFlow, { slug: "acme", initial: draft, canWrite: true }));
    expect(html).toContain("draftLocked"); expect(html).toContain("retry"); expect(html).not.toContain("/packages/labels?"); expect(html).not.toContain("✓ posted");
  });
  it("server-rendered draft retry is disabled until the client can handle its click", () => {
    const html = renderToStaticMarkup(createElement(PackageFlow, { slug: "acme", initial: draft, canWrite: true }));
    const retry = html.match(/<button\b[^>]*>retry<\/button>/)?.[0];
    expect(retry).toBeDefined();
    expect(retry).toContain('disabled=""');
  });
  it("read-only recovery hides write controls", () => {
    const html = renderToStaticMarkup(createElement(PackageFlow, { slug: "acme", initial: draft, canWrite: false }));
    expect(html).toContain("locked"); expect(html).not.toContain("<button");
  });
  it("real POSTED links labels by document; exposes quarantine and receipt-time metadata", () => {
    const value = { ...posted, packages: [{ id: "p", qr: "EWMS:PKG:1:server", packageNo: 1, kind: "VARIL", receiptLineId: "rl", documentLineId: "dl", itemId: "i", itemCode: "HM", itemName: "Rubber", unitId: "kg", unitCode: "KG", unitName: "Kilogram", quantity: "200", conversionFactor: "1", baseQuantity: "200", receivingLocationId: "r", stockStatus: "QUARANTINE", lotId: "l", lotCode: "L1", producedOn: "2026-10-01", expiresOn: "2027-10-01" }] };
    const html = renderToStaticMarkup(createElement(PackageFlow, { slug: "acme", initial: value, canWrite: false }));
    expect(html).toContain(packageLabelHref("acme", "document").replaceAll("&", "&amp;")); expect(html).toContain("✓ posted"); expect(html).toContain("quarantine"); expect(html).toContain("initialQuantity");
  });
});
