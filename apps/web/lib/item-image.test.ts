// T-1145: yükleme işleme — bayt imzası, yeniden kodlama (WebP), EXIF / konum silme, boyut sınırları. Görseller test içinde `sharp` ile
// üretilir (sentetik; dosya yok).
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { AppError } from "@wms/shared/errors";
import { IMAGE_MAX_SIDE, IMAGE_THUMB_MAX_BYTES, IMAGE_UPLOAD_MAX_BYTES, isWebp } from "@wms/domain/catalog/item-images";
import { processItemImage } from "./item-image.ts";

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return `${e.code}/${e.detail ?? ""}`;
    throw e;
  }
  return "OK";
}

const solid = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 40 } } });

describe("processItemImage", () => {
  it("JPEG (EXIF + GPS + yön etiketi) → WebP, meta veri yok, yön uygulanmış, uzun kenar ≤ 1280", async () => {
    const jpeg = await solid(3000, 2000)
      .withMetadata({ orientation: 6 })
      .withExifMerge({ IFD0: { Artist: "Gizli Kişi" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "41/1 0/1 0/1" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();
    expect(jpeg.includes(Buffer.from("Gizli"))).toBe(true);
    const out = await processItemImage(new Uint8Array(jpeg));
    expect(isWebp(out.data)).toBe(true);
    expect(isWebp(out.thumb)).toBe(true);
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.orientation === undefined || meta.orientation === 1).toBe(true);
    // Yön 6 (90° saat yönü): 3000×2000 dikey olur → 853×1280.
    expect(Math.max(out.width, out.height)).toBe(IMAGE_MAX_SIDE);
    expect(out.height).toBeGreaterThan(out.width);
    expect(out.thumb.length).toBeLessThanOrEqual(IMAGE_THUMB_MAX_BYTES);
    expect(Buffer.from(out.data).includes(Buffer.from("Gizli"))).toBe(false);
  });

  it("PNG ve WebP de kabul edilir; küçük görsel büyütülmez", async () => {
    const png = await solid(300, 200).png().toBuffer();
    const a = await processItemImage(new Uint8Array(png));
    expect([a.width, a.height]).toEqual([300, 200]);
    const webp = await solid(400, 400).webp().toBuffer();
    const b = await processItemImage(new Uint8Array(webp));
    expect([b.width, b.height]).toEqual([400, 400]);
  });

  it("SVG (betikli), GIF, HTML ve rastgele baytlar IMAGE_INVALID", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>');
    expect(await code(processItemImage(new Uint8Array(svg)))).toBe("VALIDATION_FAILED/IMAGE_INVALID");
    const gif = await solid(10, 10).gif().toBuffer();
    expect(await code(processItemImage(new Uint8Array(gif)))).toBe("VALIDATION_FAILED/IMAGE_INVALID");
    expect(await code(processItemImage(new TextEncoder().encode("<html><script>x</script></html>")))).toBe("VALIDATION_FAILED/IMAGE_INVALID");
    expect(await code(processItemImage(new Uint8Array(0)))).toBe("VALIDATION_FAILED/IMAGE_INVALID");
  });

  it("imzası JPEG ama içi bozuk / başka biçim (çok dilli dosya) IMAGE_INVALID", async () => {
    const fake = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode("<svg onload=alert(1)>")]);
    expect(await code(processItemImage(fake))).toBe("VALIDATION_FAILED/IMAGE_INVALID");
    const png = await solid(20, 20).png().toBuffer();
    const pngWithJpegMagic = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), png]);
    expect(await code(processItemImage(new Uint8Array(pngWithJpegMagic)))).toBe("VALIDATION_FAILED/IMAGE_INVALID");
  });

  it("5 MiB üstü dosya çözülmeden IMAGE_TOO_LARGE", async () => {
    const big = new Uint8Array(IMAGE_UPLOAD_MAX_BYTES + 1);
    big.set([0xff, 0xd8, 0xff, 0xe0]);
    expect(await code(processItemImage(big))).toBe("VALIDATION_FAILED/IMAGE_TOO_LARGE");
  });

  it("piksel bombası (40 MP üstü) reddedilir", async () => {
    const huge = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png({ compressionLevel: 9 }).toBuffer();
    expect(huge.length).toBeLessThan(IMAGE_UPLOAD_MAX_BYTES);
    expect(await code(processItemImage(new Uint8Array(huge)))).toBe("VALIDATION_FAILED/IMAGE_INVALID");
  });
});
