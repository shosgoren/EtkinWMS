// T-1200 (güvenlik incelemesi MINOR-A, MINOR-B): yükleme gövdesi okuma — zorunlu uzunluk, süre ve boyut sınırı, okuyucunun iptali,
// süreç genelinde okuma yuvası sayacı.
import { describe, expect, it } from "vitest";
import { AppError } from "@wms/shared/errors";
import { READ_SLOTS, READ_SLOTS_PER_TENANT, readUploadBody, tryAcquireReadSlot, uploadDeadlineMs } from "./upload-body.ts";

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return `${e.code}/${e.detail ?? ""}`;
    throw e;
  }
  return "OK";
}

const req = (body: ReadableStream<Uint8Array> | null, length?: number | string) => ({ headers: new Headers(length === undefined ? {} : { "content-length": String(length) }), body });
const stream = (...chunks: number[][]) => new ReadableStream<Uint8Array>({ start(c) { for (const x of chunks) c.enqueue(new Uint8Array(x)); c.close(); } });

describe("readUploadBody", () => {
  it("bildirilen uzunlukta gövdeyi tek tampona okur", async () => {
    expect([...(await readUploadBody(req(stream([1, 2], [3]), 3), 10))]).toEqual([1, 2, 3]);
  });

  it("Content-Length yoksa ya da biçimsizse IMAGE_LENGTH_REQUIRED; 0 ya da eksik gelen gövde IMAGE_INVALID", async () => {
    expect(await code(readUploadBody(req(stream([1])), 10))).toBe("VALIDATION_FAILED/IMAGE_LENGTH_REQUIRED");
    expect(await code(readUploadBody(req(stream([1]), "1e3"), 10))).toBe("VALIDATION_FAILED/IMAGE_LENGTH_REQUIRED");
    expect(await code(readUploadBody(req(stream([1]), 0), 10))).toBe("VALIDATION_FAILED/IMAGE_INVALID");
    expect(await code(readUploadBody(req(stream([1, 2]), 5), 10))).toBe("VALIDATION_FAILED/IMAGE_INVALID");
  });

  it("damlatılan (bitmeyen) gövde süre dolunca IMAGE_TIMEOUT ve okuyucu iptal edilir", async () => {
    let cancelled = false;
    const s = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1])); }, cancel() { cancelled = true; } });
    const t0 = Date.now();
    expect(await code(readUploadBody(req(s, 5), 10, { deadlineMs: 50 }))).toBe("VALIDATION_FAILED/IMAGE_TIMEOUT");
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(cancelled).toBe(true);
  });

  it("bildirilen boyut sınırı aşınca, ya da bildirilenden fazla bayt gelince IMAGE_TOO_LARGE (fazlası okunmaz)", async () => {
    expect(await code(readUploadBody(req(null, 11), 10))).toBe("VALIDATION_FAILED/IMAGE_TOO_LARGE");
    let cancelled = false;
    const s = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(4)); c.enqueue(new Uint8Array(4)); }, cancel() { cancelled = true; } });
    expect(await code(readUploadBody(req(s, 6), 10))).toBe("VALIDATION_FAILED/IMAGE_TOO_LARGE");
    expect(cancelled).toBe(true);
  });
});

describe("süre ve takılma (MINOR-C)", () => {
  it("süre uzunlukla orantılı: 5 sn + 256 KiB başına 1 sn, en çok 20 sn", () => {
    expect(uploadDeadlineMs(1)).toBe(6_000);
    expect(uploadDeadlineMs(256 * 1024)).toBe(6_000);
    expect(uploadDeadlineMs(256 * 1024 + 1)).toBe(7_000);
    expect(uploadDeadlineMs(5 * 1024 * 1024)).toBe(20_000);
  });

  it("bayt akmaya devam etse de takılma süresi her parçada yenilenir; akış durunca (stall) kesilir", async () => {
    let n = 0;
    let cancelled = false;
    // Her 20 ms'de bir bayt, sonra durur (4 bayt): takılma 60 ms → ilk 4 bayt geçer, sonra kesilir.
    const s = new ReadableStream<Uint8Array>({
      async pull(c) {
        if (n >= 4) return new Promise<void>(() => undefined);
        await new Promise((r) => setTimeout(r, 20));
        n += 1;
        c.enqueue(new Uint8Array([n]));
      },
      cancel() {
        cancelled = true;
      },
    });
    expect(await code(readUploadBody(req(s, 10), 10, { deadlineMs: 5_000, stallMs: 60 }))).toBe("VALIDATION_FAILED/IMAGE_TIMEOUT");
    expect(n).toBe(4);
    expect(cancelled).toBe(true);
  });

  it("yavaş ama sürekli akan gövde toplam süre dolunca kesilir", async () => {
    const s = new ReadableStream<Uint8Array>({
      async pull(c) {
        await new Promise((r) => setTimeout(r, 10));
        c.enqueue(new Uint8Array([1]));
      },
    });
    const t0 = Date.now();
    expect(await code(readUploadBody(req(s, 100_000), 200_000, { deadlineMs: 120, stallMs: 1_000 }))).toBe("VALIDATION_FAILED/IMAGE_TIMEOUT");
    expect(Date.now() - t0).toBeLessThan(1_000);
  });
});

describe("okuma yuvası (MINOR-B, MINOR-C)", () => {
  it("toplam 6; alan başına 2, kullanıcı başına 1: tek kullanıcı / tek alan ötekileri aç bırakamaz", () => {
    expect(READ_SLOTS).toBe(6);
    expect(READ_SLOTS_PER_TENANT).toBe(2);
    const a1 = tryAcquireReadSlot("ta", "u1");
    expect(a1).not.toBeNull();
    expect(tryAcquireReadSlot("ta", "u1")).toBeNull();
    const a2 = tryAcquireReadSlot("ta", "u2");
    expect(a2).not.toBeNull();
    expect(tryAcquireReadSlot("ta", "u3")).toBeNull();
    const others = ["tb", "tc", "td", "te"].map((t, k) => tryAcquireReadSlot(t, `v${k}`));
    expect(others.every((r) => r !== null)).toBe(true);
    expect(tryAcquireReadSlot("tf", "w")).toBeNull();
    a1!();
    a1!();
    expect(tryAcquireReadSlot("tf", "w")).not.toBeNull();
  });
});
