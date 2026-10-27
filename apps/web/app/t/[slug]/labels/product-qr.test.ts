import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import { toProductQrSvg } from "@wms/domain/labels";
import { productQrDocument } from "./product-qr.ts";
import { parseExtraFilters, domainExtraFilters, extraFilterParams } from "../items/filters.ts";

const data = { code: "GRANUL-01", name: "Granül", unit: "KG", barcode: "EWMS-ITEM-12345678-1234-1234-1234-123456789012" };
describe("ürün QR etiketi", () => {
  it("gerçek QR okuyucu, basılan modüllerden standart değeri aynen çözer", async () => {
    const doc = productQrDocument([data], 1);
    const svg = doc.pages[0]!;
    expect(doc.minWidth).toBeGreaterThan(20);

    const qr = /viewBox="0 0 (\d+) (\d+)"[^>]*><path d="([^"]+)"/.exec(svg)!;
    expect(doc.minWidth * 0.33 / Number(qr[1])).toBeGreaterThanOrEqual(0.25);
    expect(doc.minHeight * 0.66 / Number(qr[1])).toBeGreaterThanOrEqual(0.25);
    const scale = 5;
    const width = Number(qr[1]) * scale;
    const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
    for (const match of qr[3]!.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
      for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
        const p = ((Number(match[2]) * scale + y) * width + Number(match[1]) * scale + x) * 4;
        pixels[p] = pixels[p + 1] = pixels[p + 2] = 0;
      }
    }
    const zx = await import("zxing-wasm/reader");
    const bin = readFileSync(createRequire(import.meta.url).resolve("zxing-wasm/reader/zxing_reader.wasm"));
    await zx.prepareZXingModule({ overrides: { wasmBinary: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) }, fireImmediately: true });
    const result = await zx.readBarcodes({ data: pixels, width, height: width, colorSpace: "srgb" } as ImageData, { formats: ["QRCode"] });
    expect(result.map((r) => r.text)).toEqual([data.barcode]);
  });
  it("tekrar aynı QR; kopya adedi sınırlı, kısmi paket yok, HTML metinleri kaçışlı", () => {
    const first = productQrDocument([{ ...data, name: '<script>alert("x")</script>' }], 2).pages;
    expect(first[0]).toBe(first[1]);
    expect(first[0]).not.toContain("<script>");
    expect(first[0]).toContain("&lt;script&gt;");
    expect(() => productQrDocument([data], 1001)).toThrow();
    expect(() => productQrDocument([data], 0)).toThrow();
    expect(() => toProductQrSvg(data, { size: 29, path: '<path onload="alert(1)"/>' })).toThrow();
    expect(() => productQrDocument([{ ...data, barcode: null }], 1)).toThrow();
    expect(() => productQrDocument([data, { ...data, barcode: "EWMS:PKG:1:other" }], 1)).toThrow();
    expect(() => productQrDocument([{ ...data, barcode: "x".repeat(257) }], 1)).toThrow();
  });
  it("kategori/takip/barkod URL boyunca aynen korunur; geçersiz seçenek reddedilir", () => {
    const parsed = parseExtraFilters({ category: " Granül ", tracking: "LOT", barcode: "PRESENT" })!;
    expect(domainExtraFilters(parsed)).toEqual({ category: "Granül", trackingMode: "LOT", barcode: "PRESENT" });
    expect(Object.fromEntries(extraFilterParams(parsed))).toEqual({ category: "Granül", tracking: "LOT", barcode: "PRESENT" });
    expect(parseExtraFilters({ tracking: "unknown" })).toBeNull();
    expect(parseExtraFilters({ category: ["A", "B"] })).toBeNull();
  });
});
