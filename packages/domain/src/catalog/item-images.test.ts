// T-1145: ürün görseli saf denetimleri — bayt imzasından tür (SVG / GIF / HEIC / metin reddi) ve domain'in yalnız yeniden kodlanmış
// WebP'yi kabul etmesi (DB'ye gitmeden önce: imza, boyut, kenar, kimlik biçimi).
import { describe, expect, it } from "vitest";
import { AppError } from "@wms/shared/errors";
import { addItemImage, IMAGE_STORED_MAX_BYTES, IMAGE_THUMB_MAX_BYTES, isWebp, sniffImageType } from "./item-images.ts";

const bytes = (...xs: number[]): Uint8Array => new Uint8Array(xs);
const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const webp = (len = 64): Uint8Array => {
  const b = new Uint8Array(len);
  b.set(text("RIFF"), 0);
  b.set(text("WEBP"), 8);
  return b;
};

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return `${e.code}/${e.detail ?? ""}`;
    throw e;
  }
  return "OK";
}

// DB'ye hiç ulaşılmamalı: erişim parametresi bilerek geçersiz (çağrılırsa test başka hata görür).
const params = { db: {} as never, principal: { userId: "00000000-0000-4000-8000-000000000001", mfaVerified: true }, tenantSlug: "x" };
const ITEM = "00000000-0000-4000-8000-0000000000aa";

describe("sniffImageType", () => {
  it("JPEG, PNG ve WebP imzasını tanır", () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("image/jpeg");
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(sniffImageType(webp())).toBe("image/webp");
  });
  it("SVG, GIF, HEIC, PDF, HTML, boş ve kısa girdiyi reddeder (dosya adı / tür dikkate alınmaz)", () => {
    expect(sniffImageType(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImageType(text('<?xml version="1.0"?><svg/>'))).toBeNull();
    expect(sniffImageType(text("GIF89a...."))).toBeNull();
    expect(sniffImageType(bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63))).toBeNull(); // ftypheic
    expect(sniffImageType(text("%PDF-1.7"))).toBeNull();
    expect(sniffImageType(text("<html><body>"))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
    expect(sniffImageType(bytes(0xff, 0xd8))).toBeNull();
    expect(sniffImageType(text("RIFF\0\0\0\0WAVE"))).toBeNull();
  });
  it("isWebp yalnız RIFF....WEBP", () => {
    expect(isWebp(webp(12))).toBe(true);
    expect(isWebp(text("RIFF0000AVI "))).toBe(false);
  });
});

describe("addItemImage giriş denetimi (DB'den önce)", () => {
  const img = (over: Partial<{ data: Uint8Array; thumb: Uint8Array; width: number; height: number }> = {}) => ({ data: webp(), thumb: webp(), width: 100, height: 80, ...over });
  it("WebP olmayan görsel ya da küçük resim IMAGE_INVALID (yeniden kodlanmamış JPEG/PNG/SVG doğrudan saklanamaz)", async () => {
    expect(await code(addItemImage(params, { itemId: ITEM, image: img({ data: bytes(0xff, 0xd8, 0xff, 0xe0) }) }))).toBe("VALIDATION_FAILED/IMAGE_INVALID");
    expect(await code(addItemImage(params, { itemId: ITEM, image: img({ thumb: text("<svg/>") }) }))).toBe("VALIDATION_FAILED/IMAGE_INVALID");
  });
  it("saklama sınırını aşan görsel / küçük resim IMAGE_TOO_LARGE", async () => {
    expect(await code(addItemImage(params, { itemId: ITEM, image: img({ data: webp(IMAGE_STORED_MAX_BYTES + 1) }) }))).toBe("VALIDATION_FAILED/IMAGE_TOO_LARGE");
    expect(await code(addItemImage(params, { itemId: ITEM, image: img({ thumb: webp(IMAGE_THUMB_MAX_BYTES + 1) }) }))).toBe("VALIDATION_FAILED/IMAGE_TOO_LARGE");
  });
  it("kenar 1..4096 tam sayı; kimlikler UUID", async () => {
    for (const bad of [0, 4097, 1.5, Number.NaN]) expect(await code(addItemImage(params, { itemId: ITEM, image: img({ width: bad }) }))).toBe("VALIDATION_FAILED/IMAGE_INVALID");
    expect(await code(addItemImage(params, { itemId: "nope", image: img() }))).toBe("VALIDATION_FAILED/");
    expect(await code(addItemImage(params, { itemId: ITEM, image: img(), replaces: "nope" }))).toBe("VALIDATION_FAILED/");
  });
});
