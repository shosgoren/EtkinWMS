// T-1200: ürün görseli yükleme işleme (yalnız sunucu). Tür bayt imzasından (`sniffImageType`: JPEG / PNG / WebP; SVG, GIF, HEIC, metin
// reddedilir — dosya adı ve istemcinin bildirdiği tür dikkate alınmaz), boyut ≤ 5 MiB. `sharp` (Next'in görsel bağımlılığı, aynı sürüm)
// görseli çözer ve YENİDEN KODLAR: EXIF yönü uygulanır, bütün meta veri (EXIF / konum) atılır, uzun kenar ≤ 1280 px, WebP; ayrıca ≤ 16 KiB
// küçük resim. Çözülen biçim imzayla eşleşmezse ret.
// Kaynak sınırı (güvenlik incelemesi MAJOR-1; web kabı ortak, bellek sınırı 1,5 GiB):
// - süreç genelinde en çok IMAGE_SLOTS görsel aynı anda işlenir (çalışma alanı ve kullanıcı başına 1); dolu ise çağıran 429
//   (`RATE_LIMITED`/`IMAGE_BUSY`) döner, kuyruk yok;
// - `sharp.concurrency(1)`, `sharp.cache(false)`; giriş ≤ 24 MP, `sequentialRead`; satır atlamalı (interlaced) PNG reddedilir
//   (tamamı bellekte çözülmek zorunda);
// - asıl görsel YALNIZ BİR KEZ çözülür: ≤ 1280 px ham ara görüntüye indirilir; kalite / boyut basamakları ve küçük resim bu ara
//   görüntüden üretilir (asıl dosya yeniden çözülmez).
// Çıktının imzası ve sınırları domain'de (`addItemImage`) ve DB CHECK'inde yeniden denetlenir.
import sharp from "sharp";
import { AppError } from "@wms/shared/errors";
import { createKeyedSlots } from "./upload-slots.ts";
import {
  IMAGE_MAX_SIDE,
  IMAGE_STORED_MAX_BYTES,
  IMAGE_THUMB_MAX_BYTES,
  IMAGE_THUMB_SIDE,
  IMAGE_UPLOAD_MAX_BYTES,
  sniffImageType,
  type ProcessedItemImage,
} from "@wms/domain/catalog/item-images";

sharp.concurrency(1);
sharp.cache(false);

export const MAX_INPUT_PIXELS = 24_000_000;
/** Aynı anda işlenebilen görsel sayısı (süreç başına). */
export const IMAGE_SLOTS = 2;
const FORMAT_OF = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" } as const;

/** MINOR-C: toplam 2 işleme yuvası; çalışma alanı ve kullanıcı başına 1 (tek alan ikisini birden tutamaz). */
const processing = createKeyedSlots({ total: IMAGE_SLOTS, perTenant: 1, perUser: 1 });

/** İşleme yuvası al; toplam ya da çalışma alanı / kullanıcı payı doluysa `null` (çağıran 429 döner). Dönen işlev yuvayı bir kez bırakır. */
export function tryAcquireImageSlot(tenant: string, user: string): (() => void) | null {
  return processing.acquire(tenant, user);
}

/** Yuvalar doluyken verilen hata (HTTP 429). */
export const imageBusy = (): AppError => new AppError("RATE_LIMITED", { detail: "IMAGE_BUSY", retryable: true });

const invalid = (): AppError => new AppError("VALIDATION_FAILED", { detail: "IMAGE_INVALID" });

interface Raw {
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
  readonly channels: 1 | 2 | 3 | 4;
}

const fromRaw = (r: Raw) => sharp(r.data, { raw: { width: r.width, height: r.height, channels: r.channels } });

async function encode(r: Raw, side: number, quality: number): Promise<{ data: Buffer; width: number; height: number }> {
  const out = await fromRaw(r).resize({ width: side, height: side, fit: "inside", withoutEnlargement: true }).webp({ quality, effort: 4 }).toBuffer({ resolveWithObject: true });
  return { data: out.data, width: out.info.width, height: out.info.height };
}

/** Sınıra sığana dek kaliteyi, gerekirse kenarı düşürür; sığmazsa `IMAGE_TOO_LARGE`. */
async function fit(r: Raw, steps: readonly (readonly [side: number, quality: number])[], max: number): Promise<{ data: Buffer; width: number; height: number }> {
  for (const [side, quality] of steps) {
    const out = await encode(r, side, quality);
    if (out.data.length <= max) return out;
  }
  throw new AppError("VALIDATION_FAILED", { detail: "IMAGE_TOO_LARGE" });
}

export async function processItemImage(bytes: Uint8Array): Promise<ProcessedItemImage> {
  if (bytes.length === 0) throw invalid();
  if (bytes.length > IMAGE_UPLOAD_MAX_BYTES) throw new AppError("VALIDATION_FAILED", { detail: "IMAGE_TOO_LARGE" });
  const type = sniffImageType(bytes);
  if (type === null) throw invalid();
  const input = () => sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", animated: false, autoOrient: true, sequentialRead: true });
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await input().metadata();
  } catch {
    throw invalid();
  }
  if (meta.format !== FORMAT_OF[type]) throw invalid();
  if (type === "image/png" && meta.isProgressive === true) throw invalid();
  if ((meta.width ?? 0) * (meta.height ?? 0) > MAX_INPUT_PIXELS) throw invalid();
  try {
    const dec = await input().resize({ width: IMAGE_MAX_SIDE, height: IMAGE_MAX_SIDE, fit: "inside", withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
    const raw: Raw = { data: dec.data, width: dec.info.width, height: dec.info.height, channels: dec.info.channels };
    const full = await fit(raw, [[IMAGE_MAX_SIDE, 82], [IMAGE_MAX_SIDE, 70], [1024, 65], [800, 60]], IMAGE_STORED_MAX_BYTES);
    const thumb = await fit(raw, [[IMAGE_THUMB_SIDE, 70], [IMAGE_THUMB_SIDE, 50], [120, 45]], IMAGE_THUMB_MAX_BYTES);
    return { data: new Uint8Array(full.data), thumb: new Uint8Array(thumb.data), width: full.width, height: full.height };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw invalid();
  }
}
