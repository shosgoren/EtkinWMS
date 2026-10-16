import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS } from "@wms/domain/onboarding/reserved";
import { appSurface, isPanelInternal, panelRoute, shortWorkspaceTarget } from "./surface.ts";

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
    expect(panelRoute("/satis")).toEqual({ kind: "page", internal: "/panel/satis" });
    expect(panelRoute("/api/public/site")).toEqual({ kind: "missing" });
    expect(panelRoute("/paketler")).toEqual({ kind: "page", internal: "/panel/paketler" });
    expect(panelRoute("/musteriler")).toEqual({ kind: "page", internal: "/panel/musteriler" });
    expect(panelRoute("/odemeler")).toEqual({ kind: "page", internal: "/panel/odemeler" });
    for (const p of ["/login", "/mfa", "/reset-password", "/api/auth/sign-in/email", "/api/health/live", "/icon.svg", "/manifest.webmanifest"]) {
      expect(panelRoute(p), p).toEqual({ kind: "shared" });
    }
    for (const p of ["/t/motive", "/t", "/onboarding", "/invite/x", "/field", "/panel", "/panel/talepler", "/panel/paketler", "/panel/musteriler", "/musteriler/x", "/panel/odemeler", "/odemeler/x", "/paketler/x", "/operator/demo-requests", "/api/t/motive/audit/export", "/loginx", "/api/health", "/help"]) {
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

describe("ADR-026 §1 kısa çalışma alanı adresi (T-995)", () => {
  it("tek parça alan adı /t/<alan>'a gider; ayrılmış, çok parçalı, noktalı ve biçimsiz yollar gitmez", () => {
    expect(shortWorkspaceTarget("/motive")).toBe("/t/motive");
    expect(shortWorkspaceTarget("/motive/")).toBe("/t/motive");
    expect(shortWorkspaceTarget("/acme-2")).toBe("/t/acme-2");
    for (const p of ["/", "/login", "/mfa", "/activate", "/invite", "/t", "/onboarding", "/reset-password", "/help", "/panel", "/api", "/design", "/fonts",
      "/motive/x", "/Motive", "/-x", "/x-", "/icon.svg", "/robots.txt", "/a_b", "/%2e%2e", "//motive"]) {
      expect(shortWorkspaceTarget(p), p).toBeNull();
    }
  });
  it("bekçi: uygulamanın her üst düzey yolu ayrılmış addır (kısa adresle gölgelenmez)", () => {
    const appDir = path.resolve(import.meta.dirname, "../app");
    const top = readdirSync(appDir)
      .filter((n) => statSync(path.join(appDir, n)).isDirectory())
      .filter((n) => !n.startsWith("(") && !n.startsWith("_") && !n.startsWith("["));
    for (const n of top) expect(RESERVED_SLUGS.has(n), n).toBe(true);
  });
});
