// T-994 demo talebi içe alma zamanlayıcısı birimi: yalnız tam satırlar, bayt konumu, dosya küçülünce baştan, dosya yoksa sessiz,
// günlükte kişisel veri yok. DB'siz; veritabanı davranışı tests/integration/platform/demo-requests.int.test.ts'tedir.
import { describe, expect, it, vi } from "vitest";
import { runDemoLeadsIngest, startDemoLeadsSchedule } from "./demo-leads.js";

const logger = () => ({ info: vi.fn(), error: vi.fn() });
const file = (content: () => string) => async (from: number) => {
  const buf = Buffer.from(content(), "utf8");
  return { text: buf.subarray(Math.min(from, buf.length)).toString("utf8"), size: buf.length };
};

describe("runDemoLeadsIngest", () => {
  it("yalnız tam satırları alır; yarım son satır bir sonraki koşuya kalır; konum bayt cinsinden", async () => {
    let content = '{"a":"ş"}\n{"b":1}';
    const ingest = vi.fn(async () => ({ inserted: 1, skipped: 0 }));
    const log = logger();
    const deps = { readFrom: file(() => content), ingest, logger: log };
    const o1 = await runDemoLeadsIngest(deps, 0);
    expect(ingest).toHaveBeenLastCalledWith('{"a":"ş"}\n');
    expect(o1).toBe(Buffer.byteLength('{"a":"ş"}\n'));
    content += "\n";
    const o2 = await runDemoLeadsIngest(deps, o1);
    expect(ingest).toHaveBeenLastCalledWith('{"b":1}\n');
    expect(o2).toBe(Buffer.byteLength(content));
    expect(await runDemoLeadsIngest(deps, o2)).toBe(o2);
    expect(ingest).toHaveBeenCalledTimes(2);
    expect(log.info).toHaveBeenCalledWith("platform.demo_leads.ingested", { inserted: 1, skipped: 0 });
  });

  it("dosya küçülürse baştan okur; dosya yoksa 0 ve içe alma yok", async () => {
    const ingest = vi.fn(async () => ({ inserted: 0, skipped: 0 }));
    expect(await runDemoLeadsIngest({ readFrom: file(() => "x\n"), ingest, logger: logger() }, 500)).toBe(2);
    expect(ingest).toHaveBeenCalledWith("x\n");
    expect(await runDemoLeadsIngest({ readFrom: async () => null, ingest, logger: logger() }, 10)).toBe(0);
  });
});

describe("startDemoLeadsSchedule", () => {
  it("açılışta koşar, üst üste binmez, hata günlüğe yalnız sınıf adıyla, stop zamanlayıcıyı durdurur", async () => {
    let tick: () => void = () => undefined;
    const clearTimer = vi.fn();
    const log = logger();
    const ingest = vi.fn(async () => {
      throw new TypeError("ayse@example.com");
    });
    const s = startDemoLeadsSchedule({ readFrom: file(() => "x\n"), ingest, logger: log, setTimer: (fn) => ((tick = fn), 1), clearTimer });
    tick();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith("platform.demo_leads.failed", { reason: "TypeError" });
    s.stop();
    expect(clearTimer).toHaveBeenCalledWith(1);
  });
});
