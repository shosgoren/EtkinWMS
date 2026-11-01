// T-1160 (güvenlik incelemesi MINOR-A): yükleme gövdesi okuma — süre sınırı, boyut sınırı, okuyucunun iptali.
import { describe, expect, it } from "vitest";
import { AppError } from "@wms/shared/errors";
import { readUploadBody } from "./upload-body.ts";

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return `${e.code}/${e.detail ?? ""}`;
    throw e;
  }
  return "OK";
}

const req = (body: ReadableStream<Uint8Array> | null, length?: number) => ({ headers: new Headers(length === undefined ? {} : { "content-length": String(length) }), body });

describe("readUploadBody", () => {
  it("tam gövdeyi birleştirir", async () => {
    const s = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.enqueue(new Uint8Array([3])); c.close(); } });
    expect([...(await readUploadBody(req(s), 10))]).toEqual([1, 2, 3]);
  });

  it("damlatılan (bitmeyen) gövde süre dolunca IMAGE_TIMEOUT ve okuyucu iptal edilir", async () => {
    let cancelled = false;
    const s = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1])); }, cancel() { cancelled = true; } });
    const t0 = Date.now();
    expect(await code(readUploadBody(req(s), 10, 50))).toBe("VALIDATION_FAILED/IMAGE_TIMEOUT");
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(cancelled).toBe(true);
  });

  it("bildirilen ya da okunan boyut sınırı aşınca IMAGE_TOO_LARGE (fazlası okunmaz)", async () => {
    expect(await code(readUploadBody(req(null, 11), 10))).toBe("VALIDATION_FAILED/IMAGE_TOO_LARGE");
    let cancelled = false;
    const s = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(8)); c.enqueue(new Uint8Array(8)); }, cancel() { cancelled = true; } });
    expect(await code(readUploadBody(req(s), 10))).toBe("VALIDATION_FAILED/IMAGE_TOO_LARGE");
    expect(cancelled).toBe(true);
  });
});
