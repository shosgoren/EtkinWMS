import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@wms/shared/errors";
const mocks = vi.hoisted(() => ({ read: vi.fn(), principal: vi.fn(), membership: vi.fn(), db: {}, headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => mocks.headers, cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@wms/db", () => ({ getAppDb: () => mocks.db }));
// Any attempted write export or client action use fails: only the readonly query exists here.
vi.mock("@wms/domain/operations", () => ({ getPackageReceipt: mocks.read }));
vi.mock("./actions.ts", () => ({}));
vi.mock("@wms/domain/identity/member-queries", () => ({ getMembershipSummary: mocks.membership }));
vi.mock("../../../../../lib/auth-service.ts", () => ({ getAuthService: () => ({ getPrincipal: mocks.principal }) }));
vi.mock("../../../../../lib/package-receiving-config.ts", () => ({ packageReceivingEnabled: vi.fn(() => true) }));
vi.mock("./package-flow.tsx", () => ({ PackageFlow: () => null }));
vi.mock("../../kalip/liste.tsx", () => ({ KalipKilitliEkran: ({ text }: { text: string }) => createElement("p", { role: "alert" }, text), KalipHataEkran: ({ text }: { text: string }) => createElement("p", { role: "alert" }, text) }));
import Page from "./page.tsx";
import { PackageFlow } from "./package-flow.tsx";
import { packageReceivingEnabled } from "../../../../../lib/package-receiving-config.ts";
const documentId = "a419f885-b129-4c82-bb94-3e61c5213495";
const principal = { userId: "user", mfaVerified: true };
const returnTo = `/t/acme/receipts/packages?document=${documentId}`;
const call = (document: string | string[] | undefined = documentId) => Page({ params: Promise.resolve({ slug: "acme" }), searchParams: Promise.resolve(document === undefined ? {} : { document }) });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(packageReceivingEnabled).mockReturnValue(true);
  mocks.principal.mockResolvedValue(principal);
  mocks.membership.mockResolvedValue({ memberships: [{ slug: "acme", roles: ["TENANT_ADMIN"] }] });
  mocks.read.mockReset();
});
describe("package receipt server GET boundary", () => {
  it.each(["DRAFT", "POSTED"])("opens %s without Origin and preserves server identities", async documentStatus => {
    const receipt = { documentId, documentStatus, packages: [{ id: "server-package", qr: "EWMS:PKG:1:server-package" }] };
    mocks.read.mockResolvedValue(receipt);
    const page = await call();
    expect(mocks.headers.has("origin")).toBe(false);
    expect(mocks.principal).toHaveBeenCalledWith(mocks.headers);
    expect(mocks.membership).toHaveBeenCalledWith({ db: mocks.db, principal });
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith({ db: mocks.db, principal, tenantSlug: "acme" }, { documentId });
    expect(page.type).toBe(PackageFlow);
    expect(page.props).toMatchObject({ initial: receipt, slug: "acme", canWrite: true });
    expect(page.props.initial).toBe(receipt);
  });
  it("rejects disabled routes before authentication or reads", async () => {
    vi.mocked(packageReceivingEnabled).mockReturnValue(false);
    await expect(call()).rejects.toThrow("NOT_FOUND");
    expect(mocks.principal).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each(["", "not-a-uuid", "https://outside.invalid/"])("rejects malformed document %s before query", async document => {
    await expect(call(document)).rejects.toThrow("NOT_FOUND");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("keeps document in unauthenticated login returnTo", async () => {
    mocks.principal.mockResolvedValue(null);
    await expect(call()).rejects.toThrow(`REDIRECT:/login?next=${encodeURIComponent(returnTo)}`);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("rejects a missing tenant membership before read", async () => {
    mocks.membership.mockResolvedValue({ memberships: [{ slug: "foreign", roles: ["TENANT_ADMIN"] }] });
    await expect(call()).rejects.toThrow("NOT_FOUND");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("rejects missing stock.view before read", async () => {
    mocks.membership.mockResolvedValue({ memberships: [{ slug: "acme", roles: [] }] });
    expect(renderToStaticMarkup(await call())).toContain("locked");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("lets stock viewers reopen without granting write permission", async () => {
    mocks.membership.mockResolvedValue({ memberships: [{ slug: "acme", roles: ["READ_ONLY"] }] });
    mocks.read.mockResolvedValue({ documentId, documentStatus: "POSTED", packages: [] });
    expect((await call()).props.canWrite).toBe(false);
    expect(mocks.read).toHaveBeenCalledOnce();
  });
  it.each(["NOT_FOUND", "FORBIDDEN"] as const)("honors domain foreign/out-of-scope rejection %s without data", async code => {
    mocks.read.mockRejectedValue(new AppError(code));
    const html = renderToStaticMarkup(await call());
    expect(html).toContain("loadError");
    expect(html).toContain(code);
    expect(html).not.toContain("EWMS:PKG");
  });
  it("keeps principal MFA status and document in MFA returnTo", async () => {
    const unverified = { ...principal, mfaVerified: false };
    mocks.principal.mockResolvedValue(unverified);
    mocks.read.mockRejectedValue(new AppError("FORBIDDEN", { detail: "MFA_REQUIRED" }));
    await expect(call()).rejects.toThrow(`REDIRECT:/mfa?next=${encodeURIComponent(returnTo)}`);
    expect(mocks.read).toHaveBeenCalledWith({ db: mocks.db, principal: unverified, tenantSlug: "acme" }, { documentId });
  });
  it("keeps document when the domain requires renewed authentication", async () => {
    mocks.read.mockRejectedValue(new AppError("UNAUTHENTICATED"));
    await expect(call()).rejects.toThrow(`REDIRECT:/login?next=${encodeURIComponent(returnTo)}`);
  });
  it("propagates unexpected failures to the server error boundary", async () => {
    const failure = new Error("internal failure");
    mocks.read.mockRejectedValue(failure);
    await expect(call()).rejects.toBe(failure);
  });
});
