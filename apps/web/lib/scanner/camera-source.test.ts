// T-286 / T-287g: kamera okumasının biçim doğrulaması, çözücü seçimi (yerleşik / uygulama içi) ve tek uçuşlu okuma döngüsü.
// Tarayıcı olmadan (DecoderEnv enjekte) koşar; gerçek kamera akışı ve WASM çözümü e2e'dedir (tests/e2e/camera-scan.spec.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCANNER_CONFIG } from "./scanner-config.ts";
import { classifyCameraError, createFrameDecoder, IOS_MAX_ZOOM, iosVirtualRank, openCamera, pickIosBackCamera, pickMainBackCamera, TARGET_ZOOM, videoRoi, gs1CheckDigitValid, iosShareLocation, loadZxingReader, platformOf, resetZxingReaderForTest, startScanLoop, symbologyOf, validateCameraRead } from "./camera-source.ts";
import type { DecoderEnv, FrameDecoder, RawRead, RejectReason, VideoRect, WasmReader } from "./camera-source.ts";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { ean13CheckDigit, ean13Modules } from "./barcode-y4m.fixture.ts";

describe("validateCameraRead (T-287g)", () => {
  it("geçerli EAN-13, EAN-8, UPC-A değerlerini aynen kabul eder", () => {
    expect(validateCameraRead({ text: "4006381333931", format: "EAN13" })).toEqual({ ok: true, value: "4006381333931", symbology: "ean13" });
    expect(validateCameraRead({ text: "96385074", format: "ean_8" })).toEqual({ ok: true, value: "96385074", symbology: "ean8" });
    expect(validateCameraRead({ text: "036000291452", format: "UPCA" })).toEqual({ ok: true, value: "036000291452", symbology: "upca" });
  });

  it("her iki yolun biçim adını (yerleşik ve zxing-wasm) aynı sembolojiye çevirir", () => {
    for (const [a, b, s] of [["ean_13", "EAN13", "ean13"], ["code_128", "Code128", "code128"], ["qr_code", "QRCode", "qrcode"], ["data_matrix", "DataMatrix", "datamatrix"], ["code_39", "Code39", "code39"], ["upc_a", "UPCA", "upca"]] as const) {
      expect(symbologyOf(a)).toBe(s);
      expect(symbologyOf(b)).toBe(s);
    }
  });

  const rejected: ReadonlyArray<[string, { text: string; format?: string }, RejectReason]> = [
    ["boş metin", { text: "", format: "Code128" }, "empty"],
    ["yalnızca boşluk", { text: "   ", format: "Code128" }, "empty"],
    ["kenarda boşluk", { text: " ABC-1", format: "Code128" }, "edge_space"],
    ["beklenmeyen sembol (PDF417)", { text: "ABC123", format: "PDF417" }, "unexpected_format"],
    ["bilinmeyen biçim adı", { text: "ABC123", format: "ITF" }, "unexpected_format"],
    ["EAN-13 sağlaması hatalı", { text: "4006381333932", format: "EAN13" }, "bad_checksum"],
    ["EAN-8 sağlaması hatalı", { text: "96385075", format: "EAN8" }, "bad_checksum"],
    ["EAN-13 kısa", { text: "400638133393", format: "EAN13" }, "bad_digits"],
    ["EAN-13 rakam dışı", { text: "40063813339A1", format: "EAN13" }, "bad_digits"],
    ["denetim karakteri", { text: "AB\u0000C", format: "Code128" }, "control_chars"],
    ["değiştirme karakteri (bozuk kodlama)", { text: "AB�C", format: "QRCode" }, "control_chars"],
    ["GS, Code39'da meşru değil", { text: "AB\u001dC", format: "Code39" }, "control_chars"],
    ["bidi karakteri (U+202E)", { text: "AB\u202eC", format: "Code128" }, "control_chars"],
    ["bidi karakteri (U+202A)", { text: "\u202aABC", format: "QRCode" }, "control_chars"],
    ["bidi karakteri (U+2066)", { text: "AB\u2066C", format: "Code128" }, "control_chars"],
    ["bidi karakteri (U+2069)", { text: "AB\u2069C", format: "Code128" }, "control_chars"],
    ["sıfır genişlikli (U+200B)", { text: "AB\u200bC", format: "Code128" }, "control_chars"],
    ["sıfır genişlikli (U+200C)", { text: "AB\u200cC", format: "Code128" }, "control_chars"],
    ["sıfır genişlikli (U+200D)", { text: "AB\u200dC", format: "Code128" }, "control_chars"],
    ["sıfır genişlikli (U+FEFF)", { text: "AB\ufeffC", format: "QRCode" }, "control_chars"],
    ["satır ayracı (U+2028)", { text: "AB\u2028C", format: "QRCode" }, "control_chars"],
    ["paragraf ayracı (U+2029)", { text: "AB\u2029C", format: "QRCode" }, "control_chars"],
    ["eşsiz üst vekil (surrogate)", { text: "AB\ud800C", format: "QRCode" }, "control_chars"],
    ["eşsiz alt vekil (surrogate)", { text: "AB\udc00C", format: "QRCode" }, "control_chars"],
    ["fazla uzun", { text: "A".repeat(SCANNER_CONFIG.maxLength + 1), format: "Code128" }, "too_long"],
  ];
  it.each(rejected)("reddeder: %s", (_n, read, reason) => {
    expect(validateCameraRead(read)).toEqual({ ok: false, reason });
  });

  it("geçerli vekil çifti (emoji) bozuk sayılmaz: yalnızca eşsiz vekil reddedilir", () => {
    expect(validateCameraRead({ text: "AB\u{1F600}C", format: "QRCode" }).ok).toBe(true);
  });

  it("GS1 ayracı (GS) yalnızca Code128/QR/DataMatrix'te kabul edilir ve değer değiştirilmez", () => {
    const v = "0104006381333931\u001d10LOT1";
    expect(validateCameraRead({ text: v, format: "Code128" })).toEqual({ ok: true, value: v, symbology: "code128" });
    expect(validateCameraRead({ text: v, format: "DataMatrix" }).ok).toBe(true);
  });

  it("biçim bildirmeyen okuyucuda yalnızca biçimden bağımsız denetimler uygulanır", () => {
    expect(validateCameraRead({ text: "869AB01" })).toEqual({ ok: true, value: "869AB01", symbology: null });
    expect(validateCameraRead({ text: "" })).toEqual({ ok: false, reason: "empty" });
  });

  it("GS1 mod-10 sağlaması", () => {
    expect(gs1CheckDigitValid("4006381333931")).toBe(true);
    expect(gs1CheckDigitValid("4006381333930")).toBe(false);
  });
});

describe("cihaz ve hata sınıflaması", () => {
  it("platformOf: iPhone, iPad (masaüstü kılıklı), Android, diğer", () => {
    expect(platformOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/130")).toBe("ios");
    expect(platformOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 5)).toBe("ios");
    expect(platformOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 0)).toBe("other");
    expect(platformOf("Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/130")).toBe("android");
  });
  it("iosShareLocation: Safari alt çubuk, iPhone Chrome adres çubuğu", () => {
    expect(iosShareLocation("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("bottom");
    expect(iosShareLocation("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0 Mobile/15E148 Safari/604.1")).toBe("address");
  });
  it("classifyCameraError", () => {
    expect(classifyCameraError({ name: "NotAllowedError" })).toBe("denied");
    expect(classifyCameraError({ name: "NotFoundError" })).toBe("none");
    expect(classifyCameraError({ name: "NotReadableError" })).toBe("busy");
    expect(classifyCameraError(new Error("x"))).toBe("failed");
  });
});

function env(over: Partial<DecoderEnv>): DecoderEnv {
  return {
    nativeCtor: null,
    loadWasm: () => Promise.reject(new Error("wasm beklenmiyordu")),
    makeCanvas: () => ({ canvas: { width: 0, height: 0 }, draw: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }) as unknown as ImageData }),
    ...over,
  };
}
const video = { videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;

describe("createFrameDecoder: çözücü seçimi", () => {
  it("yerleşik API EAN-13 ve Code128'i destekliyorsa onu kullanır, WASM yüklenmez", async () => {
    const loadWasm = vi.fn(() => Promise.reject(new Error("yüklenmemeliydi")));
    class Native {
      static getSupportedFormats = () => Promise.resolve(["ean_13", "code_128", "qr_code"]);
      constructor(readonly o?: { formats?: string[] }) {
        seen.push(o?.formats ?? []);
      }
      detect = () => Promise.resolve([{ rawValue: "4006381333931", format: "ean_13" }]);
    }
    const seen: string[][] = [];
    const d = await createFrameDecoder(env({ nativeCtor: Native, loadWasm }));
    expect(d.kind).toBe("native");
    expect(loadWasm).not.toHaveBeenCalled();
    expect(seen[0]).toEqual(["ean_13", "code_128", "qr_code"]);
    expect(await d.decode(video)).toEqual({ text: "4006381333931", format: "ean_13" });
  });

  it("yerleşik API yoksa uygulama içi WASM çözücü kullanılır; nişangâh yokken tüm kare en çok 1280 px'e küçültülür, ilk geçiş hızlıdır", async () => {
    const reads: ImageData[] = [];
    const efforts: unknown[] = [];
    const reader: WasmReader = {
      read: (f, e) => {
        reads.push(f);
        efforts.push(e);
        return Promise.resolve([{ text: "4006381333931", format: "EAN13", isValid: true }]);
      },
    };
    const sizes: Array<[number, number]> = [];
    const d = await createFrameDecoder(
      env({
        loadWasm: () => Promise.resolve(reader),
        makeCanvas: () => ({ canvas: { width: 0, height: 0 }, draw: (_v, _src, w, h) => (sizes.push([w, h]), { width: w, height: h, data: new Uint8ClampedArray(4) } as unknown as ImageData) }),
      }),
    );
    expect(d.kind).toBe("wasm");
    expect(await d.decode({ videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement)).toEqual({ text: "4006381333931", format: "EAN13" });
    expect(sizes).toEqual([[1280, 720]]);
    expect(reads).toHaveLength(1);
    expect(efforts).toEqual([{ tryHarder: false, tryInvert: false }]);
  });

  it("WASM çözücüde geçersiz sonuç yok sayılır ve kare yokken (0×0) çözülmez", async () => {
    const read = vi.fn(() => Promise.resolve([{ text: "X", format: "Code128", isValid: false }]));
    const d = await createFrameDecoder(env({ loadWasm: () => Promise.resolve({ read }) }));
    expect(await d.decode({ videoWidth: 0, videoHeight: 0 } as HTMLVideoElement)).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(await d.decode(video)).toBeNull();
  });

  it("yerleşik API gerekli biçimleri desteklemiyorsa ya da yapıcı hata verirse WASM'a düşer", async () => {
    const reader: WasmReader = { read: () => Promise.resolve([]) };
    class Weak {
      static getSupportedFormats = () => Promise.resolve(["qr_code"]);
    }
    class Broken {
      static getSupportedFormats = () => Promise.resolve(["ean_13", "code_128"]);
      constructor() {
        throw new Error("kurulamadı");
      }
    }
    expect((await createFrameDecoder(env({ nativeCtor: Weak as never, loadWasm: () => Promise.resolve(reader) }))).kind).toBe("wasm");
    expect((await createFrameDecoder(env({ nativeCtor: Broken as never, loadWasm: () => Promise.resolve(reader) }))).kind).toBe("wasm");
  });

  it("WASM yüklenemezse hata yutulmaz (tarama ekranı hatayı kullanıcıya bildirir)", async () => {
    await expect(createFrameDecoder(env({ loadWasm: () => Promise.reject(new Error("ağ")) }))).rejects.toThrow("ağ");
  });
});

describe("startScanLoop: tek uçuş, tek kabul, satır içi ret", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function decoderOf(next: () => Promise<RawRead | null>): FrameDecoder & { calls: number } {
    const d = {
      kind: "wasm" as const,
      calls: 0,
      decode: () => {
        d.calls++;
        return next();
      },
      dispose: () => undefined,
    };
    return d;
  }

  it("ilk kabulden sonra durur: aynı kod art arda iki kez gönderilmez", async () => {
    const accepted: string[] = [];
    const d = decoderOf(() => Promise.resolve({ text: "4006381333931", format: "EAN13" }));
    startScanLoop({ decoder: d, video, intervalMs: 250, onAccepted: (v) => accepted.push(v), onRejected: () => undefined });
    await vi.advanceTimersByTimeAsync(5000);
    expect(accepted).toEqual(["4006381333931"]);
    expect(d.calls).toBe(1);
  });

  it("çözme sürerken yeni kare başlamaz (tek uçuş)", async () => {
    let release: (r: RawRead | null) => void = () => undefined;
    const d = decoderOf(() => new Promise<RawRead | null>((res) => (release = res)));
    startScanLoop({ decoder: d, video, intervalMs: 100, onAccepted: () => undefined, onRejected: () => undefined });
    await vi.advanceTimersByTimeAsync(2000);
    expect(d.calls).toBe(1);
    release(null);
    await vi.advanceTimersByTimeAsync(150);
    expect(d.calls).toBe(2);
  });

  it("bozuk okuma reddedilir, döngü sürer, aynı bozuk okuma tekrar bildirilmez; sonra doğru okuma kabul edilir", async () => {
    const rejected: Array<[RejectReason, string]> = [];
    const accepted: string[] = [];
    let text = "4006381333932"; // sağlaması hatalı
    let clock = 0;
    const d = decoderOf(() => Promise.resolve({ text, format: "EAN13" }));
    startScanLoop({ decoder: d, video, intervalMs: 250, now: () => clock, onAccepted: (v) => accepted.push(v), onRejected: (r, t) => rejected.push([r, t]) });
    for (let i = 0; i < 4; i++) {
      clock += 250;
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(rejected).toEqual([["bad_checksum", "4006381333932"]]);
    expect(accepted).toEqual([]);
    clock += 2000; // bildirim penceresi geçti: yeniden bildirilir (ses/titreşim yeniden)
    await vi.advanceTimersByTimeAsync(250);
    expect(rejected).toHaveLength(2);
    text = "4006381333931";
    await vi.advanceTimersByTimeAsync(250);
    expect(accepted).toEqual(["4006381333931"]);
  });

  it("çözücü hata verirse döngü durmaz; durdurma işlevi döngüyü bitirir", async () => {
    let n = 0;
    const d = decoderOf(() => (++n < 3 ? Promise.reject(new Error("kare")) : Promise.resolve(null)));
    const stop = startScanLoop({ decoder: d, video, intervalMs: 50, onAccepted: () => undefined, onRejected: () => undefined });
    await vi.advanceTimersByTimeAsync(500);
    expect(d.calls).toBeGreaterThan(3);
    stop();
    const after = d.calls;
    await vi.advanceTimersByTimeAsync(1000);
    expect(d.calls).toBe(after);
  });
});

describe("loadZxingReader: hazırlık tek kez (T-286 MAJOR-1)", () => {
  beforeEach(() => resetZxingReaderForTest());

  function fakeModule() {
    const seen: unknown[] = [];
    const prepare = vi.fn((o: { overrides: unknown }) => {
      seen.push(o.overrides);
      return Promise.resolve({});
    });
    const importer = vi.fn(() => Promise.resolve({ prepareZXingModule: prepare, readBarcodes: () => Promise.resolve([]) }));
    return { prepare, importer, seen };
  }

  it("iki tarama ekranı açılışında modül yalnızca bir kez hazırlanır ve içe aktarılır", async () => {
    const { prepare, importer } = fakeModule();
    const a = await loadZxingReader(importer);
    const b = await loadZxingReader(importer);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("hazırlık hata verirse önbellek temizlenir; yeniden denemede başarılı olur ve WASM adresi kendi kaynağımızdır", async () => {
    const { prepare, importer, seen } = fakeModule();
    prepare.mockRejectedValueOnce(new Error("ağ"));
    await expect(loadZxingReader(importer)).rejects.toThrow("ağ");
    await loadZxingReader(importer);
    expect(prepare).toHaveBeenCalledTimes(2);
    const o = seen.at(-1) as { locateFile: (p: string, prefix: string) => string };
    expect(o.locateFile("zxing_reader.wasm", "https://cdn.example/")).not.toContain("cdn.example");
    expect(o.locateFile("other.js", "pre/")).toBe("pre/other.js");
  });

  it("aynı overrides nesnesi yeniden kullanılır (kütüphane önbellek eşitliği)", async () => {
    const { prepare, importer, seen } = fakeModule();
    await loadZxingReader(importer);
    await loadZxingReader(importer);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
  });
});

describe("ROI'li çözme (T-446): gerçek zxing-wasm", () => {
  it("1080p dikey karede küçük EAN-13'ü ilk karede nişangâh bölgesinden okur (tüm kare küçültülmez)", async () => {
    const zx = (await import("zxing-wasm/reader")) as unknown as {
      prepareZXingModule: (o: unknown) => Promise<unknown>;
      readBarcodes: (f: ImageData, o: Record<string, unknown>) => Promise<Array<{ text: string; format: string; isValid: boolean }>>;
    };
    const bin = readFileSync(createRequire(import.meta.url).resolve("zxing-wasm/reader/zxing_reader.wasm"));
    await zx.prepareZXingModule({ overrides: { wasmBinary: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) }, fireImmediately: true });
    // iPhone dikey akış 1080×1920; barkod 2 px'lik modüllerle (190 px) nişangâhın ortasında. Eski yol (tüm kare → 960 px) modülü 1 px'e indiriyordu.
    const vw = 1080;
    const vh = 1920;
    const body = "869012345678";
    const code = body + ean13CheckDigit(body);
    const mods = ean13Modules(code);
    const luma = new Uint8Array(vw * vh).fill(235);
    const x0 = Math.floor((vw - mods.length * 2) / 2);
    for (let y = 900; y < 1020; y++) for (let m = 0; m < mods.length; m++) if (mods[m] === "1") luma.fill(16, y * vw + x0 + m * 2, y * vw + x0 + m * 2 + 2);
    const sizes: Array<[number, number]> = [];
    const draw = (_v: HTMLVideoElement, src: VideoRect, w: number, h: number): ImageData => {
      sizes.push([w, h]);
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const l = luma[(src.sy + Math.floor((y * src.sh) / h)) * vw + src.sx + Math.floor((x * src.sw) / w)] ?? 235;
          data.set([l, l, l, 255], (y * w + x) * 4);
        }
      return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
    };
    const reader: WasmReader = { read: (f, e) => zx.readBarcodes(f, { formats: ["EAN13", "Code128"], tryHarder: e?.tryHarder ?? true, tryInvert: e?.tryInvert ?? true, tryRotate: true, maxNumberOfSymbols: 1 }) };
    const d = await createFrameDecoder(env({ loadWasm: () => Promise.resolve(reader), makeCanvas: () => ({ canvas: { width: 0, height: 0 }, draw }) }));
    // Ekran 390×693 (object-fit: cover), nişangâh 240×180 ortada.
    const roi = videoRoi(vw, vh, { width: 390, height: 693 }, { left: 75, top: 256, width: 240, height: 180 });
    expect(roi).not.toBeNull();
    expect(await d.decode({ videoWidth: vw, videoHeight: vh } as HTMLVideoElement, roi)).toEqual({ text: code, format: "EAN13" });
    expect(sizes).toHaveLength(1);
    const [w] = sizes[0] ?? [0];
    expect(w).toBe(roi?.sw); // kırpılan bölge küçültülmeden çözüldü
  });
});

describe("iPhone netlik (T-450): arka kamera seçimi ve zoom", () => {
  const dev = (deviceId: string, label: string) => ({ kind: "videoinput", deviceId, label });
  const EN = [dev("u", "Back Ultra Wide Camera"), dev("w", "Back Camera"), dev("t", "Back Telephoto Camera"), dev("dw", "Back Dual Wide Camera"), dev("d", "Back Dual Camera"), dev("tr", "Back Triple Camera"), dev("f", "Front Camera")];
  const TR = [dev("u", "Arka Ultra Geniş Kamera"), dev("w", "Arka Kamera"), dev("t", "Arka Telefoto Kamera"), dev("dw", "Arka Çift Geniş Kamera"), dev("d", "Arka Çift Kamera"), dev("tr", "Arka Üçlü Kamera"), dev("f", "Ön Kamera")];
  const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
  const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1";
  const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36";

  it("sıra: üçlü → çift geniş → çift → normal; EN ve TR etiketler", () => {
    for (const list of [EN, TR]) {
      expect(pickIosBackCamera(list)).toMatchObject({ deviceId: "tr", virtual: true });
      expect(pickIosBackCamera(list.filter((d) => d.deviceId !== "tr"))).toMatchObject({ deviceId: "dw", virtual: true });
      expect(pickIosBackCamera(list.filter((d) => !["tr", "dw"].includes(d.deviceId)))).toMatchObject({ deviceId: "d", virtual: true });
      expect(pickIosBackCamera(list.filter((d) => !["tr", "dw", "d"].includes(d.deviceId)))).toMatchObject({ deviceId: "w", virtual: false });
    }
  });
  it("ultra geniş ya da tele tek başına seçilmez; etiketsiz liste null", () => {
    expect(pickIosBackCamera([dev("u", "Back Ultra Wide Camera"), dev("t", "Back Telephoto Camera")])).toBeNull();
    expect(pickIosBackCamera([dev("u", "Arka Ultra Geniş Kamera"), dev("f", "Ön Kamera")])).toBeNull();
    expect(pickIosBackCamera([dev("", ""), dev("", "")])).toBeNull();
  });
  it("iosVirtualRank", () => {
    expect(iosVirtualRank("Back Triple Camera")).toBe(0);
    expect(iosVirtualRank("Arka Çift Geniş Kamera")).toBe(1);
    expect(iosVirtualRank("Arka Çift Kamera")).toBe(2);
    expect(iosVirtualRank("Back Camera")).toBe(-1);
  });
  it("Android: düz ana kamera (T-446 davranışı değişmedi)", () => {
    expect(pickMainBackCamera([dev("a", "camera2 2, facing back ultra"), dev("b", "camera2 0, facing back"), dev("c", "camera2 1, facing front")])?.deviceId).toBe("b");
    expect(pickMainBackCamera(EN)?.deviceId).toBe("w");
  });
  it("platformOf: iPhone Safari, iPhone Chrome (CriOS), iPadOS → ios; Android → android", () => {
    expect(platformOf(IPHONE_SAFARI)).toBe("ios");
    expect(platformOf(IPHONE_CHROME)).toBe("ios");
    expect(platformOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 CriOS/130", 5)).toBe("ios");
    expect(platformOf(ANDROID)).toBe("android");
  });

  type Applied = Record<string, unknown>[];
  function fakeTrack(label: string, deviceId: string, applied: Applied) {
    return {
      label,
      readyState: "live",
      stop: vi.fn(),
      getSettings: () => ({ deviceId }),
      getCapabilities: () => ({ zoom: { min: 1, max: 10, step: 0.1 }, focusMode: ["continuous"] }),
      applyConstraints: vi.fn((c: { advanced: Record<string, unknown>[] }) => {
        applied.push(...c.advanced);
        return Promise.resolve();
      }),
    };
  }
  async function open(ua: string, devices: ReturnType<typeof dev>[], firstLabel: string) {
    const applied: Applied = [];
    const opened: unknown[] = [];
    const getUserMedia = vi.fn((c: { video: { deviceId?: { exact: string } } }) => {
      opened.push(c.video);
      const id = c.video.deviceId?.exact;
      const d = id === undefined ? devices.find((x) => x.label === firstLabel)! : devices.find((x) => x.deviceId === id)!;
      const tr = fakeTrack(d.label, d.deviceId, applied);
      return Promise.resolve({ getVideoTracks: () => [tr], getTracks: () => [tr] });
    });
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { userAgent: ua, maxTouchPoints: 5, mediaDevices: { getUserMedia, enumerateDevices: () => Promise.resolve(devices), getSupportedConstraints: () => ({}) } });
    const s = await openCamera();
    vi.unstubAllGlobals();
    return { s, applied, opened, label: s.stream.getVideoTracks()[0]!.label };
  }

  it("iPhone Chrome (CriOS) + TR: düz Arka Kamera verilse de Arka Üçlü Kamera'ya geçer, zoom en çok 1,5×", async () => {
    const r = await open(IPHONE_CHROME, TR, "Arka Kamera");
    expect(r.label).toBe("Arka Üçlü Kamera");
    expect(r.s.zoom).toBe(IOS_MAX_ZOOM);
    expect(r.applied.some((a) => "zoom" in a && (a.zoom as number) > 1.5)).toBe(false);
  });
  it("iPhone Safari + EN: üçlü yoksa çift geniş; ilk akış zaten doğru aygıtsa yeniden açılmaz", async () => {
    const r = await open(IPHONE_SAFARI, EN.filter((d) => d.deviceId !== "tr"), "Back Dual Wide Camera");
    expect(r.label).toBe("Back Dual Wide Camera");
    expect(r.opened).toHaveLength(1);
    expect(r.s.zoom).toBe(1.5);
  });
  it("iPhone yalnız düz arka kamera: zoom uygulanmaz", async () => {
    const r = await open(IPHONE_SAFARI, [dev("u", "Back Ultra Wide Camera"), dev("w", "Back Camera")], "Back Ultra Wide Camera");
    expect(r.label).toBe("Back Camera");
    expect(r.s.zoom).toBeNull();
    expect(r.applied.some((a) => "zoom" in a)).toBe(false);
  });
  it("Android: ultra geniş verilirse ana kameraya geçer, 2× zoom sürer", async () => {
    const list = [dev("a", "camera2 2, facing back ultra wide"), dev("b", "camera2 0, facing back")];
    const r = await open(ANDROID, list, "camera2 2, facing back ultra wide");
    expect(r.label).toBe("camera2 0, facing back");
    expect(r.s.zoom).toBe(TARGET_ZOOM);
  });
});
