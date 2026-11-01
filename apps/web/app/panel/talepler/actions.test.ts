// T-1144 (security-reviewer MINOR-2): panel demo talebi eylem katmanı. Domain komutları sahtedir (davranış int testinde:
// tests/integration/platform/demo-requests.int.test.ts). Kanıtlanan: ret uygulama kökü (WMS_APP_URL) olmadan çalışır; onay ve yeni
// bağlantı kök yoksa domain'e (veritabanına) hiç gitmeden düşer; geri açma posta ayarını hiç okumaz; bilinen ret ayrıntısı istemciye döner.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@wms/shared/errors";

const decideDemoRequest = vi.hoisted(() => vi.fn());
const reissueActivation = vi.hoisted(() => vi.fn());
const reopenDemoRequest = vi.hoisted(() => vi.fn());
const loadMailConfig = vi.hoisted(() => vi.fn());
const getSenderQueue = vi.hoisted(() => vi.fn());
const getPrincipal = vi.hoisted(() => vi.fn());
const ensureRecentAuth = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers({ origin: "https://yonet.example.test", "fly-client-ip": "203.0.113.9" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("../../../lib/auth-service.ts", () => ({ getAuthService: () => ({ getPrincipal }), ensureRecentAuth }));
vi.mock("../../../lib/queue.ts", () => ({ getSenderQueue }));
vi.mock("../../../lib/rate-limit.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/rate-limit.ts")>()),
  createProductionLimiter: () => ({ check: () => Promise.resolve() }),
}));
vi.mock("@wms/db", () => ({ getAppDb: () => ({}) }));
vi.mock("@wms/shared/mailer", () => ({ loadMailConfig, assertMailModeAllowed: vi.fn() }));
vi.mock("@wms/domain/platform/demo-requests", () => ({ decideDemoRequest, reissueActivation, reopenDemoRequest }));

import { demoRequestAction } from "./actions.ts";

const ID = "77777777-7777-4777-8777-777777777777";
const KEYS = ["APP_SURFACE", "BETTER_AUTH_URL", "WMS_APP_URL"] as const;
let saved: Record<string, string | undefined> = {};
const form = (intent: string): FormData => {
  const f = new FormData();
  f.set("id", ID);
  f.set("intent", intent);
  return f;
};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  process.env.APP_SURFACE = "panel";
  process.env.BETTER_AUTH_URL = "https://yonet.example.test";
  delete process.env.WMS_APP_URL;
  getPrincipal.mockResolvedValue({ userId: ID, mfaVerified: true });
  loadMailConfig.mockReturnValue({ mode: "disabled" });
  getSenderQueue.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("WMS_APP_URL tanımsız (panel)", () => {
  it("ret çalışır: karar domain'e gider, bağlantı dönmez", async () => {
    decideDemoRequest.mockResolvedValue({ decision: "REJECTED" });
    const r = await demoRequestAction({}, form("REJECTED"));
    expect(decideDemoRequest).toHaveBeenCalledTimes(1);
    expect(decideDemoRequest.mock.calls[0]?.[0]).toMatchObject({ id: ID, decision: "REJECTED" });
    expect(r.link).toBeUndefined();
    expect(r.error).toBeUndefined();
    expect(r.done).toMatchObject({ intent: "REJECTED" });
  });

  it.each(["APPROVED", "REISSUE"])("%s veritabanına hiç gitmeden INTERNAL ile düşer", async (intent) => {
    const r = await demoRequestAction({}, form(intent));
    expect(r).toEqual({ error: "INTERNAL" });
    expect(decideDemoRequest).not.toHaveBeenCalled();
    expect(reissueActivation).not.toHaveBeenCalled();
    expect(reopenDemoRequest).not.toHaveBeenCalled();
  });
});

describe("geri açma", () => {
  it("posta ayarını ve kuyruğu okumaz; yalnız geri açma komutu çağrılır", async () => {
    reopenDemoRequest.mockResolvedValue({ status: "PENDING" });
    const r = await demoRequestAction({}, form("REOPEN"));
    expect(reopenDemoRequest).toHaveBeenCalledTimes(1);
    expect(reopenDemoRequest.mock.calls[0]?.[0]).toMatchObject({ id: ID });
    expect(loadMailConfig).not.toHaveBeenCalled();
    expect(getSenderQueue).not.toHaveBeenCalled();
    expect(decideDemoRequest).not.toHaveBeenCalled();
    expect(r.done).toMatchObject({ intent: "REOPEN" });
  });

  it("aynı e-postada açık/onaylı talep: istemciye VERSION_CONFLICT + DEMO_EMAIL_TAKEN", async () => {
    reopenDemoRequest.mockRejectedValue(new AppError("VERSION_CONFLICT", { detail: "DEMO_EMAIL_TAKEN" }));
    expect(await demoRequestAction({}, form("REOPEN"))).toEqual({ error: "VERSION_CONFLICT", detail: "DEMO_EMAIL_TAKEN" });
  });

  it("WMS_APP_URL varken onay bağlantıyı uygulama kökünden kurar", async () => {
    process.env.WMS_APP_URL = "https://app.example.test";
    decideDemoRequest.mockResolvedValue({ decision: "APPROVED", activation: { delivery: "SCREEN", expiresAt: new Date(), token: "tok" } });
    const r = await demoRequestAction({}, form("APPROVED"));
    expect(r.link).toBe("https://app.example.test/activate/tok");
    expect(r.done).toMatchObject({ intent: "APPROVED", delivery: "SCREEN" });
  });
});
