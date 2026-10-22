// T-436 (ALTIN-KURAL 5, 13): uygulamanın TEK ses ve titreşim kaynağı. `AudioContext` yalnız bu dosyada açılır (bekçi:
// `ses-tek-kaynak.test.ts`). Ses yalnız anlamlı sonuçlardadır (kaydetme, okutma, onay, hata, uyarı; kullanıcı kararı 21 Ekim):
// küçük işlemler (kopyala, aç/kapat, sekme) sessizdir — onlar için `geri-bildirim.ts` `feedback.minor()` ses çalmaz.
// "Sessiz" tercihi cihazda saklanır (localStorage); "Hareketi azalt" açıksa titreşim de durur.

export type SesTur = "tamam" | "uyari" | "hata" | "okutma-iyi" | "okutma-kotu";

/** Cihazda saklanan "Sessiz" tercihinin anahtarı. */
export const SESSIZ_ANAHTAR = "etkin.sessiz";
/** Tercih değişince pencereye yayılan olay (aynı sekmedeki menüler eşitlensin). */
export const SESSIZ_OLAY = "etkin:sessiz";

// [frekans Hz, başlangıç s, süre s]
const TONLAR: Readonly<Record<SesTur, ReadonlyArray<readonly [number, number, number]>>> = {
  tamam: [
    [660, 0, 0.12],
    [990, 0.13, 0.12],
  ],
  uyari: [
    [520, 0, 0.14],
    [520, 0.2, 0.14],
  ],
  hata: [
    [330, 0, 0.12],
    [220, 0.13, 0.12],
  ],
  "okutma-iyi": [[1200, 0, 0.12]],
  "okutma-kotu": [
    [220, 0, 0.18],
    [220, 0.26, 0.18],
  ],
};
const TITRESIM: Readonly<Record<SesTur, number | readonly number[]>> = {
  tamam: 30,
  uyari: [40, 40, 40],
  hata: [60, 40, 60],
  "okutma-iyi": 60,
  "okutma-kotu": [200, 80, 200],
};

type AudioCtor = new () => AudioContext;
let baglam: AudioContext | null = null;
let son: { tur: SesTur; at: number } | null = null;

/** Kullanıcı "Sessiz" seçtiyse `true` (depolama kapalıysa sesli). */
export function sessizMi(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(SESSIZ_ANAHTAR) === "1";
  } catch {
    return false;
  }
}

/** "Sessiz" tercihini cihaza yazar ve aynı sekmedeki dinleyicilere duyurur. */
export function sessizYap(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(SESSIZ_ANAHTAR, "1");
    else window.localStorage.removeItem(SESSIZ_ANAHTAR);
  } catch {
    /* depolama kapalı: yalnız bu oturum */
  }
  try {
    window.dispatchEvent(new CustomEvent(SESSIZ_OLAY, { detail: on }));
  } catch {
    /* olay yok */
  }
}

/** İşletim sistemi "Hareketi azalt" açık mı (ALTIN-KURAL 13: titreşim ve SVG hareketi de durur). */
export function hareketAzaltMi(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export interface SesSonucu {
  readonly sounded: boolean;
  readonly vibrated: boolean;
}

/**
 * Sesi ve titreşimi çalar. Destek yoksa (iOS `vibrate`, kilitli ses) kanal atlanır ve `false` döner; sahte "çaldı" bildirilmez.
 * Aynı tür 250 ms içinde ikinci kez çalmaz (balon + düğme aynı sonucu iki kez seslendirmesin).
 */
export function sesCal(tur: SesTur): SesSonucu {
  if (typeof window === "undefined") return { sounded: false, vibrated: false };
  const now = Date.now();
  if (son !== null && son.tur === tur && now - son.at < 250) return { sounded: false, vibrated: false };
  son = { tur, at: now };
  let vibrated = false;
  let sounded = false;
  if (!hareketAzaltMi()) {
    try {
      const v = TITRESIM[tur];
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") vibrated = navigator.vibrate(typeof v === "number" ? v : [...v]);
    } catch {
      vibrated = false;
    }
  }
  if (sessizMi()) return { sounded: false, vibrated };
  try {
    const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (Ctor !== undefined) {
      baglam ??= new Ctor();
      const ctx = baglam;
      if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
      const t0 = ctx.currentTime;
      for (const [f, at, dur] of TONLAR[tur]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const t = t0 + at;
        o.type = "sine";
        o.frequency.value = f;
        // Zarf (tık sesi olmasın); zarf desteklemeyen ortamda sabit ses düzeyi.
        if (typeof g.gain.setValueAtTime === "function" && typeof g.gain.exponentialRampToValueAtTime === "function") {
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        } else g.gain.value = 0.16;
        o.connect(g);
        g.connect(ctx.destination);
        o.start(t);
        o.stop(t + dur + 0.01);
      }
      sounded = true;
    }
  } catch {
    sounded = false;
  }
  return { sounded, vibrated };
}

/** Yalnız birim testi: iç durumu sıfırlar. */
export function sesSifirlaTest(): void {
  baglam = null;
  son = null;
}

// ---------------------------------------------------------------------------------------------
// T-1002 (B-62): Etkin bas-konuş kaydı — tarayıcının tek ses modülü burasıdır (ALTIN-KURAL 5 bekçisi: AudioContext yalnız ses.ts).
// Ses 16 kHz mono 16 bit PCM WAV'a çevrilir (en çok 8 sn) ve yalnız bellekte tutulur: diske/depolamaya yazılmaz, istek bitince atılır.
// Sıkıştırılmış biçim (webm/opus) bilerek seçilmedi: sunucudaki ses servisi güvenilmeyen girdi için medya çözücü çalıştırmaz, yalnız
// sabit biçimli PCM kabul eder (services/voice/app.py). Uzun dinlemede konuşma bittikten sonra 1,2 sn sessizlikte kayıt kendiliğinden durur.
export const KAYIT_MAX_MS = 8000;
export const KAYIT_HZ = 16000;
const SILENCE_MS = 1200;
const SPEECH_RMS = 0.03;

export interface KayitSonucu {
  readonly base64: string;
  readonly seconds: number;
}

export interface Kayit {
  stop(): Promise<KayitSonucu>;
  cancel(): void;
}

type KayitCtx = typeof AudioContext;

/** Float32 örnekleri 16 kHz'e indirir (pencere ortalaması). */
export function yenidenOrnekle(input: Float32Array, from: number, to = KAYIT_HZ): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let k = a; k < b; k++) sum += input[k]!;
    out[i] = b > a ? sum / (b - a) : 0;
  }
  return out;
}

/** 16 bit PCM mono WAV (44 bayt başlık). */
export function wavYaz(samples: Float32Array, rate = KAYIT_HZ): Uint8Array {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

export function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Mikrofonu açar ve kaydı başlatır. `onAuto`: süre dolunca ya da (uzun dinlemede) sessizlikte çağrılır. İzin yoksa hata fırlatır.
 */
export async function kayitBaslat(opts: { readonly long: boolean; readonly onAuto: () => void }): Promise<Kayit> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const AC: KayitCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: KayitCtx }).webkitAudioContext;
  const ctx = new AC();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let total = 0;
  let spoke = false;
  let quietSince = 0;
  let done = false;
  const maxSamples = Math.floor((ctx.sampleRate * KAYIT_MAX_MS) / 1000);
  const fire = (): void => {
    if (done) return;
    done = true;
    window.setTimeout(opts.onAuto, 0);
  };
  proc.onaudioprocess = (e) => {
    if (done) return;
    const data = new Float32Array(e.inputBuffer.getChannelData(0));
    chunks.push(data);
    total += data.length;
    if (total >= maxSamples) fire();
    if (opts.long) {
      let sq = 0;
      for (let i = 0; i < data.length; i++) sq += data[i]! * data[i]!;
      const rms = Math.sqrt(sq / data.length);
      const now = performance.now();
      if (rms > SPEECH_RMS) {
        spoke = true;
        quietSince = 0;
      } else if (spoke) {
        if (quietSince === 0) quietSince = now;
        else if (now - quietSince > SILENCE_MS) fire();
      }
    }
  };
  src.connect(proc);
  proc.connect(ctx.destination);
  const release = (): void => {
    done = true;
    proc.onaudioprocess = null;
    try {
      src.disconnect();
      proc.disconnect();
    } catch {
      /* zaten ayrık */
    }
    for (const tr of stream.getTracks()) tr.stop();
    void ctx.close().catch(() => undefined);
  };
  return {
    stop: () => {
      const rate = ctx.sampleRate;
      release();
      const merged = new Float32Array(Math.min(total, maxSamples));
      let o = 0;
      for (const c of chunks) {
        if (o >= merged.length) break;
        const part = c.subarray(0, merged.length - o);
        merged.set(part, o);
        o += part.length;
      }
      chunks.length = 0;
      const pcm = yenidenOrnekle(merged, rate);
      return Promise.resolve({ base64: base64(wavYaz(pcm)), seconds: pcm.length / KAYIT_HZ });
    },
    cancel: () => {
      release();
      chunks.length = 0;
    },
  };
}
