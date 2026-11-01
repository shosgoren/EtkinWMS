// T-1160 silinen görsel baytı boşaltma zamanlayıcısı birimi: sayfalama, toplam, askıdaki tenant, hata yolunda OK yazılmaması, durdurma.
// DB davranışı (yalnız 10 dk'dan eski silinmiş satır, RLS) tests/integration/catalog/item-images.int.test.ts'tedir.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { runImagePurge, startImagePurgeSchedule } from "./image-purge.js";

const logger = () => ({ info: vi.fn(), error: vi.fn() });
const ids = (n: number) => Array.from({ length: n }, () => randomUUID()).sort();

describe("runImagePurge", () => {
  it("bütün sayfaları dolaşır, boşaltılan satırları toplar; özet info", async () => {
    const all = ids(501);
    const list = vi.fn(async (after: string, limit: number) => all.filter((i) => i > after).slice(0, limit));
    const purgeFor = vi.fn(async (t: string) => (t === all[7] ? 3 : 0));
    const log = logger();
    expect(await runImagePurge({ listActiveTenantIds: list, purgeFor, logger: log })).toEqual({ listed: 501, purged: 3, inactive: 0, failed: 0, listFailed: false });
    expect(purgeFor).toHaveBeenCalledTimes(501);
    expect(log.info).toHaveBeenCalledWith("item_images.purged", { listed: 501, purged: 3, inactive: 0 });
    expect(log.error).not.toHaveBeenCalled();
  });

  it("askıdaki tenant hata sayılmaz; başka hata error + eksik özet (sessiz OK yok)", async () => {
    const [a, b] = ids(2) as [string, string];
    const purgeFor = vi.fn(async (t: string) => {
      if (t === a) throw Object.assign(new Error("x"), { code: "TENANT_SUSPENDED" });
      throw new Error("db");
    });
    const log = logger();
    const r = await runImagePurge({ listActiveTenantIds: async (after) => (after === "00000000-0000-0000-0000-000000000000" ? [a, b] : []), purgeFor, logger: log });
    expect(r).toMatchObject({ inactive: 1, failed: 1, listFailed: false });
    expect(log.error).toHaveBeenCalledWith("item_images.purge_failed", { tenantId: b, reason: "Error" });
    expect(log.info).not.toHaveBeenCalled();
  });

  it("liste hatası listFailed + error", async () => {
    const log = logger();
    const r = await runImagePurge({ listActiveTenantIds: () => Promise.reject(new Error("down")), purgeFor: vi.fn(), logger: log });
    expect(r.listFailed).toBe(true);
    expect(log.error).toHaveBeenCalledWith("item_images.purge_incomplete", expect.objectContaining({ listFailed: true }));
  });
});

describe("startImagePurgeSchedule", () => {
  it("açılışta bir kez koşar, zamanlayıcıyı 15 dk ile kurar ve durdurur", async () => {
    const purgeFor = vi.fn(async () => 0);
    const setTimer = vi.fn(() => "h");
    const clearTimer = vi.fn();
    const s = startImagePurgeSchedule({ listActiveTenantIds: async () => [randomUUID()], purgeFor, logger: logger(), setTimer, clearTimer });
    await vi.waitFor(() => expect(purgeFor).toHaveBeenCalledTimes(1));
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 900_000);
    s.stop();
    expect(clearTimer).toHaveBeenCalledWith("h");
  });
});
