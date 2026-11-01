// T-1160 (güvenlik incelemesi MINOR-A, MINOR-B): yükleme gövdesi okuma — zorunlu uzunluk, süre ve boyut sınırı, okuyucunun iptali,
// süreç genelinde okuma yuvası sayacı.
import { describe, expect, it } from "vitest";
import { AppError } from "@wms/shared/errors";
import { READ_SLOTS, readUploadBody, tryAcquireReadSlot } from "./upload-body.ts";

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
    expect(await code(readUploadBody(req(s, 5), 10, 50))).toBe("VALIDATION_FAILED/IMAGE_TIMEOUT");
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

describe("okuma yuvası (MINOR-B)", () => {
  it("en çok READ_SLOTS gövde aynı anda; dolu ise null; bırakma bir kez sayılır", () => {
    expect(READ_SLOTS).toBe(6);
    const held = Array.from({ length: READ_SLOTS }, () => tryAcquireReadSlot());
    expect(held.every((r) => r !== null)).toBe(true);
    expect(tryAcquireReadSlot()).toBeNull();
    held[0]!();
    held[0]!();
    const again = tryAcquireReadSlot();
    expect(again).not.toBeNull();
    expect(tryAcquireReadSlot()).toBeNull();
    again!();
    for (const r of held.slice(1)) r!();
  });
});
