// T-1002 (B-62): Etkin bas-konuş kaydı. Ses tarayıcıda 16 kHz mono 16 bit PCM WAV'a çevrilir (en çok 8 sn) ve yalnız bellekte tutulur:
// diske/depolamaya yazılmaz, istek bitince atılır. Sıkıştırılmış biçim (webm/opus) seçilmedi: sunucudaki ses servisi güvenilmeyen girdi
// için medya çözücü çalıştırmaz, yalnız sabit biçimli PCM kabul eder (services/voice/app.py). Uzun dinlemede (iki dokunuş) konuşma bittikten
// sonra 1,2 sn sessizlikte kayıt kendiliğinden durur ("bitti" deyip susmak yeter).

export const MAX_MS = 8000;
export const RATE = 16000;
const SILENCE_MS = 1200;
const SPEECH_RMS = 0.03;

export interface Recording {
  readonly base64: string;
  readonly seconds: number;
}

export interface Recorder {
  stop(): Promise<Recording>;
  cancel(): void;
}

type Ctx = typeof AudioContext;

/** Float32 örnekleri 16 kHz'e indirir (pencere ortalaması). */
export function resample(input: Float32Array, from: number, to = RATE): Float32Array {
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
export function encodeWav(samples: Float32Array, rate = RATE): Uint8Array {
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

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Mikrofonu açar ve kaydı başlatır. `onAuto`: süre dolunca ya da (uzun dinlemede) sessizlikte çağrılır. İzin yoksa hata fırlatır.
 */
export async function startRecorder(opts: { readonly long: boolean; readonly onAuto: () => void }): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const AC: Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: Ctx }).webkitAudioContext;
  const ctx = new AC();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let total = 0;
  let spoke = false;
  let quietSince = 0;
  let done = false;
  const maxSamples = Math.floor((ctx.sampleRate * MAX_MS) / 1000);
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
      const pcm = resample(merged, rate);
      return Promise.resolve({ base64: toBase64(encodeWav(pcm)), seconds: pcm.length / RATE });
    },
    cancel: () => {
      release();
      chunks.length = 0;
    },
  };
}
