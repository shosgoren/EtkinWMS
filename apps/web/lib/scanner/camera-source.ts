// Kamera okuma kaynağı (T-286, ADR-010; hız T-446): arka kamera akışı, çözücü seçimi (yerleşik BarcodeDetector ya da uygulama içi zxing-wasm),
// okunan değerin biçim doğrulaması (T-287g), tek uçuşlu okuma döngüsü ve ses/titreşim geri bildirimi.
// İstemci grafı (T-313): yalnızca `scanner-config.ts` içe aktarılır; sunucu paketi ve domain YOK. Çözücü tembel yüklenir (`import()`),
// tarama ekranı açılana kadar ne betik ne WASM indirilir. Stok/iş kuralı burada YOKTUR: bu dosya yalnızca "okunan metin" üretir;
// ürün/lokasyon çözümü ve kurallar sunucuda (domain) kalır.
import { SCANNER_CONFIG } from "./scanner-config.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Biçim doğrulaması
// ---------------------------------------------------------------------------------------------------------------------

/** Kabul edilen sembolojiler (A-29: raf/ürün etiketleri). Başkası (ör. PDF417, ITF) reddedilir. */
export const CAMERA_SYMBOLOGIES = ["ean13", "ean8", "upca", "code128", "code39", "qrcode", "datamatrix"] as const;
export type CameraSymbology = (typeof CAMERA_SYMBOLOGIES)[number];

/** Yerleşik `BarcodeDetector` biçim adları (spec) ve zxing-wasm çıktı adları ("EAN13", "Code128", "QRCode"…) tek anahtara indirgenir. */
const SYMBOLOGY_BY_KEY: Readonly<Record<string, CameraSymbology>> = {
  ean13: "ean13",
  ean8: "ean8",
  upca: "upca",
  code128: "code128",
  code39: "code39",
  qrcode: "qrcode",
  datamatrix: "datamatrix",
};
/** `BarcodeDetector` `formats` değerleri (yerleşik yol). */
export const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "code_128", "code_39", "qr_code", "data_matrix"] as const;
/** zxing-wasm `formats` değerleri (uygulama içi yol; ad kümesi kurulu tiplerden doğrulandı: `BARCODE_FORMATS`). */
export const WASM_FORMATS = ["EAN13", "EAN8", "UPCA", "Code128", "Code39", "QRCode", "DataMatrix"] as const;

export function symbologyOf(format: string): CameraSymbology | null {
  return SYMBOLOGY_BY_KEY[format.toLowerCase().replace(/[^a-z0-9]/g, "")] ?? null;
}

export type RejectReason = "empty" | "edge_space" | "too_long" | "control_chars" | "unexpected_format" | "bad_digits" | "bad_checksum";
export type CameraVerdict = { readonly ok: true; readonly value: string; readonly symbology: CameraSymbology | null } | { readonly ok: false; readonly reason: RejectReason };

/** GS1 mod-10 sağlama: son hane kontrol hanesidir. */
export function gs1CheckDigitValid(digits: string): boolean {
  let sum = 0;
  for (let i = digits.length - 2, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(digits[i]) * w;
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/**
 * Görünmeyen/yön değiştiren karakterler (ekranda başka bir kod gibi görünüp başka değer taşıyabilir): sıfır genişlikli (U+200B–200D, U+FEFF), çift yönlü denetim
 * (U+202A–202E, U+2066–2069), satır/paragraf ayracı (U+2028/2029) ve eşi olmayan vekil (surrogate) çiftleri (`for…of` eşsiz vekili tek karakter verir).
 */
const INVISIBLE = (c: number): boolean =>
  (c >= 0x200b && c <= 0x200d) || c === 0xfeff || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0x2028 || c === 0x2029 || (c >= 0xd800 && c <= 0xdfff);

const DIGIT_LENGTH: Readonly<Partial<Record<CameraSymbology, number>>> = { ean13: 13, ean8: 8, upca: 12 };
// GS1 grup ayracı (GS, U+001D) yalnızca GS1 taşıyabilen sembolojilerde meşrudur.
const GS = SCANNER_CONFIG.gs1Separator;
const GS_OK: ReadonlySet<CameraSymbology> = new Set(["code128", "qrcode", "datamatrix"]);

/**
 * Kameradan gelen okumayı doğrular; boş, bozuk, beklenmeyen sembolojili ya da sağlaması tutmayan okuma reddedilir (kullanıcıya satır içi bildirilir).
 * `format` yoksa (biçim bildirmeyen okuyucu) yalnızca biçimden bağımsız denetimler (boş/uzun/denetim karakteri/kenar boşluğu) uygulanır.
 * Değer ASLA değiştirilmez (kırpma/dönüştürme yok): ürün/lokasyon eşlemesi sunucudadır.
 */
export function validateCameraRead(read: { readonly text: string; readonly format?: string | undefined }): CameraVerdict {
  const text = read.text;
  if (text.trim() === "") return { ok: false, reason: "empty" };
  if (text !== text.trim()) return { ok: false, reason: "edge_space" };
  if (text.length > SCANNER_CONFIG.maxLength) return { ok: false, reason: "too_long" };
  let symbology: CameraSymbology | null = null;
  if (read.format !== undefined && read.format !== "") {
    symbology = symbologyOf(read.format);
    if (symbology === null) return { ok: false, reason: "unexpected_format" };
  }
  const gsAllowed = symbology !== null && GS_OK.has(symbology);
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    const control = c < 0x20 || (c >= 0x7f && c <= 0x9f);
    if (c === 0xfffd || (control && !(gsAllowed && ch === GS)) || INVISIBLE(c)) return { ok: false, reason: "control_chars" };
  }
  const len = symbology === null ? undefined : DIGIT_LENGTH[symbology];
  if (len !== undefined) {
    if (text.length !== len || !/^\d+$/.test(text)) return { ok: false, reason: "bad_digits" };
    if (!gs1CheckDigitValid(text)) return { ok: false, reason: "bad_checksum" };
  }
  return { ok: true, value: text, symbology };
}

// ---------------------------------------------------------------------------------------------------------------------
// Çözücü (yerleşik API ya da uygulama içi WASM)
// ---------------------------------------------------------------------------------------------------------------------

export interface RawRead {
  readonly text: string;
  readonly format?: string | undefined;
}
/** Video piksel koordinatlarında dikdörtgen (kaynak kırpma). */
export interface VideoRect {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
}
export interface FrameDecoder {
  readonly kind: "native" | "wasm";
  /**
   * Bir kare çözer; okuma yoksa `null`. Hata fırlatabilir (çağıran yutmaz: döngü sayar). `roi` verilirse (T-446) WASM yolu önce yalnız ekrandaki
   * nişangâh bölgesini çözer (ince 1D çubuklar küçültülmez); yerleşik API tüm kareyi kendisi hızlı tarar.
   */
  decode(video: HTMLVideoElement, roi?: VideoRect | null): Promise<RawRead | null>;
  dispose(): void;
}

interface NativeDetector {
  detect(source: HTMLVideoElement): Promise<readonly { rawValue: string; format?: string }[]>;
}
interface NativeCtor {
  new (options?: { formats?: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}
/** Çözme sıkılığı (T-446): hızlı geçiş (`tryHarder`/ters renk kapalı) her karede; zor geçiş yalnız art arda başarısız karelerden sonra. */
export interface ReadEffort {
  readonly tryHarder: boolean;
  readonly tryInvert: boolean;
}
/** Uygulama içi okuyucu (zxing-wasm `readBarcodes` yüzeyinin kullandığımız kısmı). */
export interface WasmReader {
  read(frame: ImageData, effort?: ReadEffort): Promise<readonly { text: string; format: string; isValid: boolean }[]>;
}
export interface DecoderEnv {
  readonly nativeCtor: NativeCtor | null;
  readonly loadWasm: () => Promise<WasmReader>;
  /** `draw`: videonun `src` dikdörtgenini `w×h` boyutuna çizer ve pikselleri döndürür. */
  readonly makeCanvas: () => { canvas: { width: number; height: number }; draw(video: HTMLVideoElement, src: VideoRect, w: number, h: number): ImageData };
}

/**
 * Çözücüye verilen görüntünün en uzun kenarı (px). T-446 öncesi TÜM kare 960 px'e küçültülüyordu: 1080p akışta 2 px'lik çubuk 1 px'e iniyor, ince 1D barkod
 * okunamıyordu. Artık yalnız nişangâh bölgesi kırpılır ve en çok 1280 px'e (çoğu zaman küçültmeden) verilir.
 */
export const MAX_DECODE_SIDE = 1280;
/** Nişangâh kenarına eklenen pay (kenara taşan barkod da okunsun). */
const ROI_PAD = 0.12;
/** Bu kadar art arda başarısız kareden sonra zor geçiş (tryHarder) devreye girer. */
const HARD_AFTER_MISSES = 3;

export function browserDecoderEnv(): DecoderEnv {
  return {
    nativeCtor: typeof window === "undefined" ? null : ((window as unknown as { BarcodeDetector?: NativeCtor }).BarcodeDetector ?? null),
    loadWasm: () => loadZxingReader(),
    makeCanvas: () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true, alpha: false });
      return {
        canvas,
        draw(video, src, w, h) {
          if (ctx === null) throw new Error("camera: 2d canvas yok");
          if (canvas.width !== w) canvas.width = w;
          if (canvas.height !== h) canvas.height = h;
          ctx.drawImage(video, src.sx, src.sy, src.sw, src.sh, 0, 0, w, h);
          return ctx.getImageData(0, 0, w, h);
        },
      };
    },
  };
}

/** Modül düzeyi tek örnek: `prepareZXingModule` aynı `overrides` nesnesiyle çağrılırsa kütüphane önbelleği tutar ve WASM yeniden derlenmez (T-286 MAJOR-1). */
interface ZxingReaderModule {
  prepareZXingModule(options: { overrides: { locateFile: (path: string, prefix: string) => string }; fireImmediately: true }): Promise<unknown>;
  readBarcodes(
    frame: ImageData,
    options: { formats: string[]; tryHarder: boolean; tryInvert: boolean; tryRotate: boolean; maxNumberOfSymbols: number },
  ): Promise<ReadonlyArray<{ text: string; format: string; isValid: boolean }>>;
}
type ZxingImporter = () => Promise<ZxingReaderModule>;
let zxingOverrides: { locateFile: (path: string, prefix: string) => string } | null = null;
let zxingReader: Promise<WasmReader> | null = null;

/**
 * zxing-wasm'ı (zxing-cpp WASM derlemesi) tembel yükler. VARSAYILAN `locateFile` WASM'ı üçüncü taraf CDN'den (jsDelivr) indirir; CSP'yi (`connect-src 'self'`) ve
 * tedarik zincirini bozacağından KULLANILMAZ: WASM paketten, bundler varlığı olarak kendi kaynağımızdan (içerik karmalı, uzun önbellekli) sunulur. Hazırlık (derleme)
 * tarama ekranı kaç kez açılırsa açılsın TEK kez yapılır; hata olursa sonraki açılış yeniden dener. T-446: tarama ekranı açılırken kamerayla PARALEL başlatılır.
 */
export function loadZxingReader(importer: ZxingImporter = () => import("zxing-wasm/reader") as unknown as Promise<ZxingReaderModule>): Promise<WasmReader> {
  zxingReader ??= (async () => {
    const mod = await importer();
    if (zxingOverrides === null) {
      const wasmUrl = new URL("zxing-wasm/reader/zxing_reader.wasm", import.meta.url).href;
      zxingOverrides = { locateFile: (path, prefix) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) };
    }
    await mod.prepareZXingModule({ overrides: zxingOverrides, fireImmediately: true });
    return {
      async read(frame: ImageData, effort: ReadEffort = { tryHarder: true, tryInvert: true }) {
        // Döndürme açık: dikey tutulan 1D barkod da okunur. Gri tonlama kütüphanede (RGBA → parlaklık) yapılır.
        return mod.readBarcodes(frame, { formats: [...WASM_FORMATS], tryHarder: effort.tryHarder, tryInvert: effort.tryInvert, tryRotate: true, maxNumberOfSymbols: 1 });
      },
    };
  })().catch((e: unknown) => {
    zxingReader = null;
    zxingOverrides = null;
    throw e;
  });
  return zxingReader;
}

/** Yalnızca testler: modül düzeyi önbelleği sıfırlar. */
export function resetZxingReaderForTest(): void {
  zxingReader = null;
  zxingOverrides = null;
}

async function nativeFormats(ctor: NativeCtor): Promise<string[]> {
  if (typeof ctor.getSupportedFormats !== "function") return [...NATIVE_FORMATS];
  const supported = new Set(await ctor.getSupportedFormats());
  return NATIVE_FORMATS.filter((f) => supported.has(f));
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Ekrandaki nişangâh kutusunu (videoya göre CSS px) video piksel dikdörtgenine çevirir (`object-fit: cover | contain | fill`), kenarlara `pad` oranında pay ekler
 * ve kareye kırpar. Kutu görünür alanın dışındaysa `null`.
 */
export function videoRoi(
  vw: number,
  vh: number,
  box: { readonly width: number; readonly height: number },
  target: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
  fit: string = "cover",
  pad: number = ROI_PAD,
): VideoRect | null {
  if (vw <= 0 || vh <= 0 || box.width <= 0 || box.height <= 0 || target.width <= 0 || target.height <= 0) return null;
  let kx: number;
  let ky: number;
  if (fit === "fill") {
    kx = box.width / vw;
    ky = box.height / vh;
  } else {
    kx = ky = fit === "contain" ? Math.min(box.width / vw, box.height / vh) : Math.max(box.width / vw, box.height / vh);
  }
  const ox = (box.width - vw * kx) / 2;
  const oy = (box.height - vh * ky) / 2;
  const w = target.width / kx;
  const h = target.height / ky;
  const x0 = clamp((target.left - ox) / kx - w * pad, 0, vw);
  const y0 = clamp((target.top - oy) / ky - h * pad, 0, vh);
  const x1 = clamp((target.left - ox) / kx + w * (1 + pad), 0, vw);
  const y1 = clamp((target.top - oy) / ky + h * (1 + pad), 0, vh);
  if (x1 - x0 < 8 || y1 - y0 < 8) return null;
  return { sx: Math.round(x0), sy: Math.round(y0), sw: Math.round(x1 - x0), sh: Math.round(y1 - y0) };
}

/** Tarayıcıda: nişangâh öğesinin ekrandaki yerini videonun piksel bölgesine çevirir. */
export function roiOfElement(video: HTMLVideoElement, target: Element | null): VideoRect | null {
  if (target === null || typeof video.getBoundingClientRect !== "function") return null;
  const vr = video.getBoundingClientRect();
  const tr = target.getBoundingClientRect();
  const fit = typeof getComputedStyle === "function" ? getComputedStyle(video).objectFit : "cover";
  return videoRoi(video.videoWidth, video.videoHeight, vr, { left: tr.left - vr.left, top: tr.top - vr.top, width: tr.width, height: tr.height }, fit);
}

/** Aynı merkezli, en-boy oranı ters çevrilmiş bölge: dikey tutulan 1D barkod nişangâhın kısa kenarından taşsa da tamamı kırpılır. */
function transposed(r: VideoRect, vw: number, vh: number): VideoRect {
  const cx = r.sx + r.sw / 2;
  const cy = r.sy + r.sh / 2;
  const sw = Math.min(vw, r.sh);
  const sh = Math.min(vh, r.sw);
  return { sx: Math.round(clamp(cx - sw / 2, 0, vw - sw)), sy: Math.round(clamp(cy - sh / 2, 0, vh - sh)), sw: Math.round(sw), sh: Math.round(sh) };
}

/**
 * Çözücü seçimi: yerleşik `BarcodeDetector` EAN-13 ve Code128'i destekliyorsa o; yoksa (iPhone/WebKit, masaüstü Chromium) uygulama içi WASM.
 * Yerleşik yol kurulamazsa (yapıcı hata verirse) WASM'a düşülür.
 *
 * WASM kare sırası (T-446, `roi` varken 4'lü döngü): nişangâh, nişangâh, döndürülmüş nişangâh, tüm kare. Her geçiş ≤1280 px; ilk 3 başarısız kareden sonra
 * zor geçiş (tryHarder + ters renk) her iki karede bir açılır. Başarılı okumada sayaç sıfırlanır.
 */
export async function createFrameDecoder(env: DecoderEnv = browserDecoderEnv()): Promise<FrameDecoder> {
  if (env.nativeCtor !== null) {
    try {
      const formats = await nativeFormats(env.nativeCtor);
      if (formats.includes("ean_13") && formats.includes("code_128")) {
        const detector = new env.nativeCtor({ formats });
        return {
          kind: "native",
          async decode(video) {
            const found = await detector.detect(video);
            const first = found.find((f) => f.rawValue !== "");
            return first === undefined ? null : { text: first.rawValue, format: first.format };
          },
          dispose() {},
        };
      }
    } catch {
      // Yerleşik API kurulamadı: uygulama içi çözücüye düş.
    }
  }
  const reader = await env.loadWasm();
  const surface = env.makeCanvas();
  let frameNo = 0;
  let misses = 0;
  return {
    kind: "wasm",
    async decode(video, roi) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw === 0 || vh === 0) return null; // henüz kare yok
      const full: VideoRect = { sx: 0, sy: 0, sw: vw, sh: vh };
      const step = frameNo++ % 4;
      const src = roi === null || roi === undefined ? full : step === 3 ? full : step === 2 ? transposed(roi, vw, vh) : roi;
      const scale = Math.min(1, MAX_DECODE_SIDE / Math.max(src.sw, src.sh));
      const hard = misses >= HARD_AFTER_MISSES && frameNo % 2 === 0;
      const frame = surface.draw(video, src, Math.max(1, Math.round(src.sw * scale)), Math.max(1, Math.round(src.sh * scale)));
      const hit = (await reader.read(frame, { tryHarder: hard, tryInvert: hard })).find((r) => r.isValid && r.text !== "");
      if (hit === undefined) {
        misses++;
        return null;
      }
      misses = 0;
      return { text: hit.text, format: hit.format };
    },
    dispose() {},
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Okuma döngüsü: tek uçuş, tek kabul
// ---------------------------------------------------------------------------------------------------------------------

/** Okuma süresi ölçümü (T-446): ilk görüntülü kareden kabule kadar geçen süre ve kare başına çözme süresi. */
export interface ScanStats {
  readonly firstReadMs: number;
  readonly frames: number;
  readonly decodeAvgMs: number;
  readonly decodeMaxMs: number;
}

export interface ScanLoopOptions {
  readonly decoder: FrameDecoder;
  readonly video: HTMLVideoElement;
  /** Ekrandaki nişangâh öğesi (T-446): verilirse WASM yolu önce yalnız bu bölgeyi çözer. */
  readonly roiTarget?: () => Element | null;
  /** `requestVideoFrameCallback` yoksa (ya da video durduysa) kareler arası en uzun bekleme (ms). */
  readonly intervalMs?: number;
  /** Aynı reddedilen okuma bu süre (ms) içinde yeniden bildirilmez (geri bildirim yağmuru olmasın). */
  readonly repeatRejectMs?: number;
  /** Aynı ekranda (aynı çözücü) kabul edilen kod bu süre (ms) içinde yeniden okunursa yok sayılır (T-446). */
  readonly repeatAcceptMs?: number;
  readonly now?: () => number;
  readonly onAccepted: (value: string, symbology: CameraSymbology | null) => void;
  readonly onRejected: (reason: RejectReason, text: string) => void;
  readonly onStats?: (stats: ScanStats) => void;
}

/** Çözücü başına son kabul (aynı ekranda aynı kodun 1,5 sn içinde ikinci kez okunmasını engeller). */
const lastAccepted = new WeakMap<FrameDecoder, { value: string; at: number }>();

interface FrameVideo {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
}

/**
 * Döngü bir kare çözerken yenisi başlamaz (tek uçuş) ve ilk kabulden sonra DURUR: aynı kod ikinci kez gönderilemez (T-280 çift okuma koruması, tek mekanizma).
 * Reddedilen okuma döngüyü durdurmaz; bir sonraki doğru okumaya kadar kamera açık kalır. Döndürülen işlev döngüyü durdurur.
 * T-446: bir sonraki çözme yeni video karesinde (`requestVideoFrameCallback`) başlar; API yoksa ya da kare gelmezse en geç `intervalMs` (≈15 fps) sonra.
 */
export function startScanLoop(opts: ScanLoopOptions): () => void {
  const interval = opts.intervalMs ?? 66;
  const repeatMs = opts.repeatRejectMs ?? 1500;
  const repeatAcceptMs = opts.repeatAcceptMs ?? 1500;
  const now = opts.now ?? (() => Date.now());
  const clock = typeof performance !== "undefined" ? () => performance.now() : () => Date.now();
  const fv = opts.video as unknown as FrameVideo;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let frameCb: number | null = null;
  let lastRejected: { key: string; at: number } | null = null;
  let firstFrameAt: number | null = null;
  const decodeMs: number[] = [];
  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (frameCb !== null) fv.cancelVideoFrameCallback?.(frameCb);
    frameCb = null;
  };
  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(tick, interval);
    if (typeof fv.requestVideoFrameCallback === "function") frameCb = fv.requestVideoFrameCallback.call(opts.video, tick);
  };
  const tick = (): void => {
    cancel();
    if (stopped) return;
    const started = clock();
    if (firstFrameAt === null && opts.video.videoWidth > 0) firstFrameAt = started;
    const roi = opts.roiTarget === undefined ? null : roiOfElement(opts.video, opts.roiTarget());
    opts.decoder
      .decode(opts.video, roi)
      .then((read) => {
        decodeMs.push(clock() - started);
        if (stopped || read === null) return;
        const verdict = validateCameraRead(read);
        if (verdict.ok) {
          const t = now();
          const prev = lastAccepted.get(opts.decoder);
          if (prev !== undefined && prev.value === verdict.value && t - prev.at >= 0 && t - prev.at < repeatAcceptMs) return; // aynı kod hâlâ kamerada: yok say
          lastAccepted.set(opts.decoder, { value: verdict.value, at: t });
          stopped = true; // kabulden sonra tek bildirim
          if (opts.onStats !== undefined) {
            const total = decodeMs.reduce((a, b) => a + b, 0);
            opts.onStats({ firstReadMs: Math.round(clock() - (firstFrameAt ?? started)), frames: decodeMs.length, decodeAvgMs: Math.round(total / decodeMs.length), decodeMaxMs: Math.round(Math.max(...decodeMs)) });
          }
          opts.onAccepted(verdict.value, verdict.symbology);
          return;
        }
        const key = `${verdict.reason}|${read.text}`;
        const t = now();
        if (lastRejected !== null && lastRejected.key === key && t - lastRejected.at < repeatMs) return; // aynı bozuk okuma sürüyor: yeniden bildirme
        lastRejected = { key, at: t };
        opts.onRejected(verdict.reason, read.text);
      })
      .catch(() => undefined) // kare çözülemedi: sonraki kare denenir (kalıcı hata kamera/çözücü kurulumunda bildirilir)
      .finally(() => {
        if (!stopped) schedule();
      });
  };
  timer = setTimeout(tick, 0);
  return () => {
    stopped = true;
    cancel();
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Kamera akışı
// ---------------------------------------------------------------------------------------------------------------------

export type CameraFailure = "insecure" | "denied" | "none" | "busy" | "failed";
export type Platform = "ios" | "android" | "other";

export function platformOf(userAgent: string, maxTouchPoints = 0): Platform {
  if (/android/i.test(userAgent)) return "android";
  // iPadOS Safari masaüstü gibi görünür (Macintosh + dokunmatik).
  if (/iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && maxTouchPoints > 1)) return "ios";
  return "other";
}

/** iPhone'da "Ana Ekrana Ekle" yolu tarayıcıya göre değişir: Safari'de Paylaş alt çubukta, iPhone Chrome'da (CriOS) adres çubuğundadır. */
export function iosShareLocation(userAgent: string): "bottom" | "address" {
  return /CriOS/i.test(userAgent) ? "address" : "bottom";
}

export function classifyCameraError(e: unknown): CameraFailure {
  const name = typeof e === "object" && e !== null && "name" in e ? String((e as { name: unknown }).name) : "";
  if (name === "InsecureContext") return "insecure";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "none";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "busy";
  return "failed";
}

export interface CameraSession {
  readonly stream: MediaStream;
  /** Fener (torch) bu cihazda/akışta destekleniyor mu: yalnızca izlek yeteneği bildirirse. */
  readonly torchSupported: boolean;
  /** Uygulanan yakınlaştırma (yetenek yoksa `null`). */
  readonly zoom: number | null;
  /** Feneri açar/kapatır; başarısızsa `false` döner (durum uydurulmaz). */
  setTorch(on: boolean): Promise<boolean>;
  /** Dokun-odakla (T-446): `x`,`y` 0–1 arası video konumu. Destek yoksa `false` (sahte başarı yok). */
  focusAt(x: number, y: number): Promise<boolean>;
  stop(): void;
}

/** Hedef yakınlaştırma (T-446): iPhone ana kamerası ~15–20 cm'den yakını netleyemez; 2× ile barkod uzaktan tutulduğunda da çubuklar büyük görünür. */
export const TARGET_ZOOM = 2;

interface TrackCaps {
  torch?: boolean;
  focusMode?: string[];
  zoom?: { min?: number; max?: number; step?: number };
}

/** Yakınlaştırma yeteneğinden uygulanacak değer: hedef aralığa kırpılır; yetenek yoksa ya da 1,2×'e çıkamıyorsa `null` (dokunulmaz). */
export function pickZoom(cap: TrackCaps["zoom"] | undefined, target: number = TARGET_ZOOM): number | null {
  if (cap === undefined || typeof cap.max !== "number" || cap.max < 1.2) return null;
  const min = typeof cap.min === "number" ? cap.min : 1;
  const z = Math.min(cap.max, Math.max(min, target));
  const step = typeof cap.step === "number" && cap.step > 0 ? cap.step : 0;
  return step > 0 ? Math.round(z / step) * step : z;
}

/** Ultra geniş açı (0,5×) ya da tele kamera mı (iOS etiketi: "Back Ultra Wide Camera" / "Arka Ultra Geniş Kamera"): yakını netleyemez/dar alanlı; seçilmez. */
export function isSecondaryLens(label: string): boolean {
  return /ultra|tele/i.test(label);
}

/** iOS yakın çekim için en fazla yakınlaştırma (T-450): dijital zoom görüntüyü yumuşatır; yalnız sanal çoklu kamerada ve en çok 1,5×. */
export const IOS_MAX_ZOOM = 1.5;

/** Kullanıcıya "biraz uzaklaştır" ipucunun çıkacağı süre (T-450): kamera açıldıktan bu kadar sonra hâlâ okuma yoksa. */
export const DISTANCE_HINT_MS = 1500;

export interface CameraDeviceLike {
  readonly kind: string;
  readonly deviceId: string;
  readonly label: string;
}

/**
 * iOS sanal çoklu kamerası mı (T-450): "Back Triple/Dual Wide/Dual Camera" — Türkçe iOS "Arka Üçlü/Çift Geniş/Çift Kamera".
 * Yalnız bu aygıtlar yakına gelince makro/ultra geniş lense kendiliğinden geçer; düz "Back Camera" (Pro'larda en yakın odak ~20 cm) geçemez.
 */
export function iosVirtualRank(label: string): number {
  if (/triple|üçlü/i.test(label)) return 0;
  if (/dual\s*wide|çift\s*geniş/i.test(label)) return 1;
  if (/dual|çift/i.test(label)) return 2;
  return -1;
}

const BACK_RE = /back|rear|arka|environment/i;

/**
 * iOS arka kamera tercihi (T-450): üçlü → çift geniş → çift → normal arka kamera. Ultra geniş ya da tele lens tek başına seçilmez.
 * Etiketsiz (izin öncesi) ya da uygun aygıt yoksa `null`.
 */
export function pickIosBackCamera(devices: readonly CameraDeviceLike[]): { readonly deviceId: string; readonly label: string; readonly virtual: boolean } | null {
  const back = devices.filter((d) => d.kind === "videoinput" && d.deviceId !== "" && BACK_RE.test(d.label));
  let best: CameraDeviceLike | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const d of back) {
    const v = iosVirtualRank(d.label);
    const rank = v >= 0 ? v : isSecondaryLens(d.label) ? -1 : 3;
    if (rank >= 0 && rank < bestRank) {
      best = d;
      bestRank = rank;
    }
  }
  return best === null ? null : { deviceId: best.deviceId, label: best.label, virtual: bestRank < 3 };
}

/** Android/diğer: tarayıcı ultra geniş/tele verdiyse geçilecek düz ana arka kamera (T-446 davranışı, değişmedi). */
export function pickMainBackCamera(devices: readonly CameraDeviceLike[]): CameraDeviceLike | undefined {
  return devices.find((d) => d.kind === "videoinput" && d.deviceId !== "" && BACK_RE.test(d.label) && !isSecondaryLens(d.label) && !/dual|triple|çift|üçlü/i.test(d.label));
}

const SIZE_CONSTRAINTS: MediaTrackConstraints = {
  // T-446: 720p → 1080p ideal. Düşük çözünürlük ince 1D çubukları bulanıklaştırır; çözme yine yalnız nişangâh bölgesinde yapılır.
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  frameRate: { ideal: 30 },
};
const VIDEO_CONSTRAINTS: MediaTrackConstraints = { ...SIZE_CONSTRAINTS, facingMode: { ideal: "environment" } };

/**
 * Arka kamerayı açar (HTTPS zorunlu: `isSecureContext`). 1080p ideal, sürekli otomatik odak (destek varsa) ve ~2× yakınlaştırma (destek varsa) istenir;
 * desteklenmeyen kısıt sessizce yok sayılır. iOS (her tarayıcı, T-450): makro geçişli sanal çoklu kamera (üçlü → çift geniş → çift) seçilir, zoom yalnız onda ve ≤1,5×.
 * Android/diğer: tarayıcı ultra geniş açıyı verdiyse aynı yönlü ana kameraya geçilir (T-446).
 */
export async function openCamera(): Promise<CameraSession> {
  if (typeof window === "undefined" || !window.isSecureContext) throw Object.assign(new Error("camera: güvenli bağlam (HTTPS) yok"), { name: "InsecureContext" });
  const md = navigator.mediaDevices as MediaDevices | undefined;
  if (md === undefined || typeof md.getUserMedia !== "function") throw Object.assign(new Error("camera: mediaDevices yok"), { name: "NotFoundError" });
  let stream = await md.getUserMedia({ video: VIDEO_CONSTRAINTS, audio: false });
  let track = stream.getVideoTracks()[0];
  const ios = platformOf(navigator.userAgent, navigator.maxTouchPoints ?? 0) === "ios";
  // iOS (Safari, Chrome/CriOS, iPadOS — hepsi WebKit): makro geçişli sanal çoklu kamera tercih edilir (T-450).
  let iosVirtual = false;
  const switchTo = async (deviceId: string): Promise<void> => {
    for (const t of stream.getTracks()) t.stop();
    stream = await md.getUserMedia({ video: { ...SIZE_CONSTRAINTS, deviceId: { exact: deviceId } }, audio: false });
    track = stream.getVideoTracks()[0];
  };
  const recover = async (): Promise<void> => {
    // Seçilen kamera açılamadı: ilk akışla sürülür (hiç kamera yoksa bu dalda olunmaz).
    if (stream.getVideoTracks().every((t) => t.readyState === "ended")) {
      stream = await md.getUserMedia({ video: VIDEO_CONSTRAINTS, audio: false });
      track = stream.getVideoTracks()[0];
    }
  };
  if (track !== undefined && ios && typeof md.enumerateDevices === "function") {
    try {
      const pick = pickIosBackCamera(await md.enumerateDevices());
      if (pick !== null) {
        const current = track.getSettings?.().deviceId;
        if (pick.deviceId !== current && pick.label !== track.label) await switchTo(pick.deviceId);
        iosVirtual = pick.virtual && track !== undefined && iosVirtualRank(track.label) >= 0;
      }
    } catch {
      await recover();
    }
  } else if (track !== undefined && isSecondaryLens(track.label) && typeof md.enumerateDevices === "function") {
    try {
      const main = pickMainBackCamera(await md.enumerateDevices());
      if (main !== undefined) await switchTo(main.deviceId);
    } catch {
      await recover();
    }
  }
  const caps = (track?.getCapabilities?.() ?? {}) as TrackCaps;
  // Sürekli odak ve yakınlaştırma yalnızca destekleniyorsa istenir (iOS bazı sürümlerde yeteneği bildirmez; zorlanmaz). Ayrı ayrı uygulanır: biri reddedilirse diğeri kalır.
  const continuous = caps.focusMode?.includes("continuous") === true;
  if (track !== undefined && continuous) {
    await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => undefined);
  }
  // iOS: zoom yalnız sanal aygıtta ve en çok 1,5× (dijital zoom yakın çekimi yumuşatır); Android/diğer: T-446 hedefi (2×).
  const wantZoom = ios ? (iosVirtual ? pickZoom(caps.zoom, IOS_MAX_ZOOM) : null) : pickZoom(caps.zoom);
  let zoom: number | null = null;
  if (track !== undefined && wantZoom !== null) {
    zoom = await track
      .applyConstraints({ advanced: [{ zoom: wantZoom } as MediaTrackConstraintSet] })
      .then(() => wantZoom)
      .catch(() => null);
  }
  const torchSupported = caps.torch === true;
  const supported = (typeof md.getSupportedConstraints === "function" ? md.getSupportedConstraints() : {}) as Record<string, boolean | undefined>;
  const singleShot = caps.focusMode?.includes("single-shot") === true;
  const opened = track;
  return {
    stream,
    torchSupported,
    zoom,
    async setTorch(on) {
      if (!torchSupported || opened === undefined) return false;
      try {
        await opened.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
        return true;
      } catch {
        return false;
      }
    },
    async focusAt(x, y) {
      if (opened === undefined) return false;
      const set: Record<string, unknown> = {};
      if (supported.pointsOfInterest === true) set.pointsOfInterest = [{ x: clamp(x, 0, 1), y: clamp(y, 0, 1) }];
      if (singleShot) set.focusMode = "single-shot";
      else if (continuous) set.focusMode = "continuous"; // yeniden uygulamak çoğu cihazda odağı yeniden tetikler
      if (Object.keys(set).length === 0) return false;
      try {
        await opened.applyConstraints({ advanced: [set as MediaTrackConstraintSet] });
        // Tek seferlik odaktan sonra sürekli odağa dönülür (kullanıcı barkodu oynatınca yine netlesin).
        if (singleShot && continuous) setTimeout(() => void opened.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => undefined), 800);
        return true;
      } catch {
        return false;
      }
    },
    stop() {
      for (const t of stream.getTracks()) t.stop();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Ses ve titreşim (T-263 ile aynı dil: iyi = kısa tek bip + kısa titreşim; kötü = alçak çift bip + uzun titreşim)
// ---------------------------------------------------------------------------------------------------------------------

export type FeedbackKind = "ok" | "bad";
export interface FeedbackResult {
  readonly vibrated: boolean;
  readonly sounded: boolean;
}
const VIBRATE: Record<FeedbackKind, number | number[]> = { ok: 60, bad: [200, 80, 200] };
// [frekans Hz, başlangıç s, süre s]
const TONES: Record<FeedbackKind, ReadonlyArray<readonly [number, number, number]>> = {
  ok: [[1200, 0, 0.12]],
  bad: [
    [220, 0, 0.18],
    [220, 0.26, 0.18],
  ],
};
type AudioCtor = new () => AudioContext;
let audio: AudioContext | null = null;

/**
 * Geri bildirim: destek yoksa (iOS Safari `vibrate`, ses kilitli) ilgili kanal atlanır ve `false` döner; sahte "titreşti" bildirilmez (G-07).
 * Ses bağlamı kullanıcı dokunuşuyla açılan tarama ekranında oluşturulur (iOS otomatik oynatma kuralı).
 */
export function cameraFeedback(kind: FeedbackKind): FeedbackResult {
  let vibrated = false;
  let sounded = false;
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") vibrated = navigator.vibrate(VIBRATE[kind]);
  } catch {
    vibrated = false;
  }
  try {
    const Ctor = typeof window === "undefined" ? undefined : ((window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor }).AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext);
    if (Ctor !== undefined) {
      audio ??= new Ctor();
      const ctx = audio;
      if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
      for (const [freq, at, dur] of TONES[kind]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        gain.gain.value = 0.2;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + at);
        osc.stop(ctx.currentTime + at + dur);
      }
      sounded = true;
    }
  } catch {
    sounded = false;
  }
  return { vibrated, sounded };
}
