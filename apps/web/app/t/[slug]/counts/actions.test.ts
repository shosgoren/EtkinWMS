import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// T-977: sayım eylemleri sınırı — Origin/oturum korunur, girdi strict (kimlik/tenant/üye alanı enjekte edilemez), istemci anahtarı zorunlu, raf kodu
// bulunamazsa komut ÇALIŞMAZ, komutlar doğru izinle sayaçlanır ve domain'e aynen gider (kural/kilit domain'de).
const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  tasks: vi.fn(),
  record: vi.fn(),
  submit: vi.fn(),
  approve: vi.fn(),
  post: vi.fn(),
  cancel: vi.fn(),
  find: vi.fn(),
  principal: vi.fn(),
  limited: vi.fn(),
  origin: "https://app.example.test",
}));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers({ origin: mocks.origin })) }));
vi.mock("../../../../lib/auth-service.ts", () => ({ getAuthService: () => ({ getPrincipal: mocks.principal }) }));
vi.mock("@wms/db", () => ({ getAppDb: () => ({}) }));
vi.mock("@wms/domain/operations", () => ({
  startCount: mocks.start,
  createCountTasks: mocks.tasks,
  recordCount: mocks.record,
  submitCount: mocks.submit,
  approveCount: mocks.approve,
  postCountAdjustment: mocks.post,
  cancelCount: mocks.cancel,
}));
vi.mock("@wms/domain/warehouse", () => ({ findLocationByCode: mocks.find }));
vi.mock("../../../../lib/rate-limit.ts", async (original) => ({ ...(await original<object>()), createProductionLimiter: () => ({ check: () => Promise.resolve() }) }));
vi.mock("next-intl/server", () => ({ getTranslations: () => Promise.resolve((key: string) => key) }));
vi.mock("@wms/domain/identity/access", () => ({
  runTenantQuery: (access: { permission: string }) => {
    mocks.limited(access.permission);
    return Promise.resolve("tenant");
  },
}));
import { approveCountAction, cancelCountAction, postCountAction, recordCountAction, startCountAction, submitCountAction } from "./actions.ts";

const id = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const wh = "33333333-3333-4333-8333-333333333333";
let original: string | undefined;
beforeEach(() => {
  original = process.env.BETTER_AUTH_URL;
  process.env.BETTER_AUTH_URL = "https://app.example.test";
  mocks.origin = "https://app.example.test";
  mocks.principal.mockResolvedValue({ userId: "user", mfaVerified: true });
});
afterEach(() => {
  if (original === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = original;
  vi.clearAllMocks();
});

describe("count action boundary", () => {
  it("starts only when every shelf code resolves; then opens shelf tasks with the same session", async () => {
    mocks.find.mockImplementation((_p: unknown, input: { code: string }) => Promise.resolve(input.code === "R1" ? { id, status: "ACTIVE" } : null));
    const missing = await startCountAction({ slug: "pilot", clientKey: key, warehouseId: wh, codes: ["R1", "NOPE", " R1 "], blind: true });
    expect(missing).toMatchObject({ ok: true, data: { sessionId: null, missing: ["NOPE"] } });
    expect(mocks.start).not.toHaveBeenCalled();
    mocks.start.mockResolvedValue({ sessionId: id, documentId: id, replayed: false });
    mocks.tasks.mockResolvedValue({ taskIds: [key], created: 1 });
    const ok = await startCountAction({ slug: "pilot", clientKey: key, warehouseId: wh, codes: ["R1"], blind: false });
    expect(ok).toMatchObject({ ok: true, data: { sessionId: id, tasks: 1 } });
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ clientKey: key }), expect.objectContaining({ warehouseId: wh, locationIds: [id], blind: false }));
    expect(mocks.tasks).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sessionId: id }));
    expect(mocks.limited).toHaveBeenCalledWith("document.approve");
  });

  it("rejects injected identity fields, numeric quantities and missing keys before any command", async () => {
    const base = { slug: "pilot", clientKey: key, sessionId: id, locationId: id, itemId: id, countedQuantity: "3" };
    for (const raw of [
      { ...base, membershipId: id },
      { ...base, countedBy: id },
      { ...base, countedQuantity: 3 },
      { ...base, clientKey: undefined },
      { ...base, stockStatus: "LOST" },
      { ...base, tenantId: id },
    ]) {
      expect((await recordCountAction(raw)).ok).toBe(false);
    }
    expect((await startCountAction({ slug: "pilot", clientKey: key, warehouseId: wh, codes: [], blind: true })).ok).toBe(false);
    expect((await cancelCountAction({ slug: "pilot", clientKey: key, sessionId: id, reason: "" })).ok).toBe(false);
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("routes each command with its own permission and forwards the exact counted string", async () => {
    mocks.record.mockResolvedValue({ recorded: 1 });
    mocks.submit.mockResolvedValue({ status: "SUBMITTED" });
    mocks.approve.mockResolvedValue({ status: "APPROVED", differences: [{}, {}] });
    mocks.post.mockResolvedValue({ documentId: id, replayed: false });
    mocks.cancel.mockResolvedValue({ replayed: false });
    expect((await recordCountAction({ slug: "pilot", clientKey: key, sessionId: id, locationId: id, itemId: id, countedQuantity: "0.500000" })).ok).toBe(true);
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ clientKey: key }), expect.objectContaining({ lines: [{ locationId: id, itemId: id, countedQuantity: "0.500000" }] }));
    expect(mocks.limited).toHaveBeenLastCalledWith("document.create");
    expect((await submitCountAction({ slug: "pilot", clientKey: key, sessionId: id })).ok).toBe(true);
    expect(mocks.limited).toHaveBeenLastCalledWith("document.create");
    expect(await approveCountAction({ slug: "pilot", clientKey: key, sessionId: id })).toMatchObject({ ok: true, data: { status: "APPROVED", differences: 2 } });
    expect(mocks.limited).toHaveBeenLastCalledWith("count_diff.approve");
    expect((await postCountAction({ slug: "pilot", clientKey: key, sessionId: id })).ok).toBe(true);
    expect(mocks.limited).toHaveBeenLastCalledWith("count_diff.approve");
    expect((await cancelCountAction({ slug: "pilot", clientKey: key, sessionId: id, reason: "yanlış raf" })).ok).toBe(true);
    expect(mocks.limited).toHaveBeenLastCalledWith("document.approve");
  });

  it("guards Origin and session", async () => {
    mocks.origin = "https://evil.example.test";
    expect((await submitCountAction({ slug: "pilot", clientKey: key, sessionId: id })).ok).toBe(false);
    mocks.origin = "https://app.example.test";
    mocks.principal.mockResolvedValue(null);
    expect((await approveCountAction({ slug: "pilot", clientKey: key, sessionId: id })).ok).toBe(false);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();
  });
});
