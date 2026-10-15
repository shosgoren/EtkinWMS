import { describe, expect, it } from "vitest";
import { appSurface, isPanelInternal, panelRoute } from "./surface.ts";

describe("ADR-027 kip ayrımı", () => {
  it("kip yalnız APP_SURFACE=panel ile panel", () => {
    expect(appSurface({ APP_SURFACE: "panel" })).toBe("panel");
    expect(appSurface({ APP_SURFACE: " panel " })).toBe("panel");
    expect(appSurface({})).toBe("app");
    expect(appSurface({ APP_SURFACE: "PANEL" })).toBe("app");
  });
  it("panel sayfaları iç yola yazılır; ortak yollar açık; tenant yolları yok", () => {
    expect(panelRoute("/")).toEqual({ kind: "page", internal: "/panel" });
    expect(panelRoute("/talepler")).toEqual({ kind: "page", internal: "/panel/talepler" });
    for (const p of ["/login", "/mfa", "/reset-password", "/api/auth/sign-in/email", "/api/health/live", "/icon.svg", "/manifest.webmanifest"]) {
      expect(panelRoute(p), p).toEqual({ kind: "shared" });
    }
    for (const p of ["/t/motive", "/t", "/onboarding", "/invite/x", "/field", "/panel", "/panel/talepler", "/operator/demo-requests", "/api/t/motive/audit/export", "/loginx"]) {
      expect(panelRoute(p), p).toEqual({ kind: "missing" });
    }
  });
  it("müşteri kipinde panel iç yolları tanınır", () => {
    expect(isPanelInternal("/panel")).toBe(true);
    expect(isPanelInternal("/panel/talepler")).toBe(true);
    expect(isPanelInternal("/panels")).toBe(false);
    expect(isPanelInternal("/t/motive")).toBe(false);
  });
});
