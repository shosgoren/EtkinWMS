// ADR-027 §1 / T-401 inceleme M-1: eylem ve route guard'ı kip dışında çağrılırsa NOT_FOUND; işleyici ve diğer denetimler çalışmaz.
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createActionGuard, createRouteGuard, type GuardDeps } from "./action-guard.ts";

const APP = "https://app.example.test";
const deps = (allowed: boolean, resolvePrincipal = vi.fn(() => Promise.resolve({ userId: "u1", mfaVerified: true }))): GuardDeps => ({
  getHeaders: () => Promise.resolve(new Headers({ origin: APP })),
  resolvePrincipal,
  appUrl: APP,
  log: () => undefined,
  newRequestId: () => "rid",
  surfaceAllowed: () => allowed,
});

describe("kip denetimi (surfaceAllowed)", () => {
  it("izinli kipte işleyici çalışır", async () => {
    const res = await createActionGuard(deps(true))({ schema: z.object({}) }, async () => 1)({});
    expect(res).toEqual({ ok: true, data: 1 });
  });
  it("kip dışı eylem NOT_FOUND; kimlik ve işleyici çağrılmaz", async () => {
    const principal = vi.fn(() => Promise.resolve({ userId: "u1", mfaVerified: true }));
    const handler = vi.fn(async () => 1);
    const res = await createActionGuard(deps(false, principal))({ schema: z.object({}) }, handler)({});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("NOT_FOUND");
    expect(principal).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
  it("kip dışı route 404 gövdesi döner", async () => {
    const handler = vi.fn(async () => new Response("x"));
    const res = await createRouteGuard(deps(false))({}, handler)(new Request("http://localhost/api/t/x"));
    expect(res.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });
});
