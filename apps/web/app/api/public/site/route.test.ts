import { beforeEach, describe, expect, it, vi } from "vitest";

// T-407: satış sitesi içerik ucu. Domain çağrısı taklit edilir; önizleme sırrı yalnız başlıktan okunur ve önbelleğe girmez.
const calls: (string | null | undefined)[] = [];
let next: unknown = null;
let fail = false;
vi.mock("@wms/db", () => ({ getAppDb: () => ({}) }));
vi.mock("@wms/domain/platform/site-content", () => ({
  getPublicSite: (_db: unknown, preview?: string | null) => {
    calls.push(preview);
    if (fail) return Promise.reject(new Error("db down"));
    return Promise.resolve(next);
  },
}));
const { GET } = await import("./route");

const site = (over: Record<string, unknown> = {}) => ({ version: 2, preview: false, title1: "A", title2: "B", subtitle: "C", plans: [], ...over });

describe("GET /api/public/site", () => {
  beforeEach(() => {
    calls.length = 0;
    fail = false;
  });

  it("önizleme sırrı başlıktan iletilir; yanıt önbelleksiz ve noindex; sorgudaki sır yok sayılır", async () => {
    next = site({ preview: true, title1: "Taslak" });
    const res = await GET(new Request("http://web/api/public/site?preview=QUERY", { headers: { "x-site-preview": "SECRET" } }));
    expect(calls).toEqual(["SECRET"]);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(((await res.json()) as { site: { title1: string } }).site.title1).toBe("Taslak");
  });

  it("yayındaki içerik kısa süre önbellekte; önizleme içeriği yayın yanıtına asla girmez; hata 503 ve ayrıntı sızdırmaz", async () => {
    next = site();
    const a = await GET(new Request("http://web/api/public/site"));
    expect(a.headers.get("cache-control")).toBe("public, max-age=15");
    expect(((await a.json()) as { site: { version: number } }).site.version).toBe(2);
    next = site({ version: 3 });
    const b = await GET(new Request("http://web/api/public/site"));
    expect(((await b.json()) as { site: { version: number } }).site.version).toBe(2);
    expect(calls).toEqual([null]);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 20_000);
    next = site({ preview: true });
    const c = await GET(new Request("http://web/api/public/site"));
    expect(((await c.json()) as { site: unknown }).site).toBeNull();
    vi.setSystemTime(Date.now() + 20_000);
    fail = true;
    const d = await GET(new Request("http://web/api/public/site"));
    vi.useRealTimers();
    expect(d.status).toBe(503);
    expect(await d.json()).toEqual({ error: "unavailable" });
  });
});
