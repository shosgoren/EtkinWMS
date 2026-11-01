// T-1145: ürün görseli yükleme işleme (yalnız sunucu). Tür bayt imzasından (`sniffImageType`: JPEG / PNG / WebP; SVG, GIF, HEIC, metin
// reddedilir — dosya adı ve istemcinin bildirdiği tür dikkate alınmaz), boyut ≤ 5 MiB. `sharp` (Next'in görsel bağımlılığı, aynı sürüm)
// görseli çözer ve YENİDEN KODLAR: EXIF yönü uygulanır, bütün meta veri (EXIF / konum / ICC dışı) atılır, uzun kenar ≤ 1280 px, WebP; ayrıca
// ≤ 16 KiB küçük resim. Çözülen biçim imzayla eşleşmezse ret. Piksel bombasına karşı giriş ≤ 40 MP; hareketli görselin yalnız ilk karesi.
// Çıktının imzası ve sınırları domain'de (`addItemImage`) ve DB CHECK'inde yeniden denetlenir.
import sharp from "sharp";
import { AppError } from "@wms/shared/errors";
import {
  IMAGE_MAX_SIDE,
  IMAGE_STORED_MAX_BYTES,
  IMAGE_THUMB_MAX_BYTES,
  IMAGE_THUMB_SIDE,
  IMAGE_UPLOAD_MAX_BYTES,
  sniffImageType,
  type ProcessedItemImage,
} from "@wms/domain/catalog/item-images";

const MAX_INPUT_PIXELS = 40_000_000;
const FORMAT_OF = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" } as const;

const invalid = (): AppError => new AppError("VALIDATION_FAILED", { detail: "IMAGE_INVALID" });

function pipeline(bytes: Uint8Array) {
  return sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", animated: false, autoOrient: true });
}

async function encode(bytes: Uint8Array, side: number, quality: number): Promise<{ data: Buffer; width: number; height: number }> {
  const out = await pipeline(bytes).resize({ width: side, height: side, fit: "inside", withoutEnlargement: true }).webp({ quality, effort: 4 }).toBuffer({ resolveWithObject: true });
  return { data: out.data, width: out.info.width, height: out.info.height };
}

/** Sınıra sığana dek kaliteyi, gerekirse kenarı düşürür; sığmazsa `IMAGE_TOO_LARGE`. */
async function fit(bytes: Uint8Array, steps: readonly (readonly [side: number, quality: number])[], max: number): Promise<{ data: Buffer; width: number; height: number }> {
  for (const [side, quality] of steps) {
    const r = await encode(bytes, side, quality);
    if (r.data.length <= max) return r;
  }
  throw new AppError("VALIDATION_FAILED", { detail: "IMAGE_TOO_LARGE" });
}

export async function processItemImage(bytes: Uint8Array): Promise<ProcessedItemImage> {
  if (bytes.length === 0) throw invalid();
  if (bytes.length > IMAGE_UPLOAD_MAX_BYTES) throw new AppError("VALIDATION_FAILED", { detail: "IMAGE_TOO_LARGE" });
  const type = sniffImageType(bytes);
  if (type === null) throw invalid();
  let format: string | undefined;
  try {
    format = (await pipeline(bytes).metadata()).format;
  } catch {
    throw invalid();
  }
  if (format !== FORMAT_OF[type]) throw invalid();
  try {
    const full = await fit(bytes, [[IMAGE_MAX_SIDE, 82], [IMAGE_MAX_SIDE, 70], [1024, 65], [800, 60]], IMAGE_STORED_MAX_BYTES);
    const thumb = await fit(full.data, [[IMAGE_THUMB_SIDE, 70], [IMAGE_THUMB_SIDE, 50], [120, 45]], IMAGE_THUMB_MAX_BYTES);
    return { data: new Uint8Array(full.data), thumb: new Uint8Array(thumb.data), width: full.width, height: full.height };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw invalid();
  }
}
