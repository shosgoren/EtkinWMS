// T-1002 (B-62): web sunucusu → iç `voice` servisi (konuşma → yazı). Adres yalnız ortam değişkeninden (`VOICE_URL`, varsayılan iç ağ
// adı `http://voice:8000`); istek içeriğinden adres/yol ALINMAZ (SSRF yok), yönlendirme izlenmez. Ses bellekte kalır: diske yazılmaz,
// loglanmaz; hata günlüğüne yalnız sınıf adı gider. Servis yoksa/çökmüşse/yavaşsa "unavailable" döner ve uygulama çalışmaya devam eder.

export const WAV_RATE = 16000;
export const WAV_MAX_SECONDS = 8.5;
export const WAV_MAX_BYTES = 44 + Math.floor(WAV_MAX_SECONDS * WAV_RATE) * 2;
const TIMEOUT_MS = 20_000;
const DEFAULT_URL = "http://voice:8000";

export type SttResult =
  | { readonly status: "ok"; readonly text: string; readonly confidence: number }
  | { readonly status: "unavailable" | "busy" };

/** Yalnız tarayıcının ürettiği biçim: 44 bayt başlık, PCM, mono, 16 kHz, 16 bit, en çok 8,5 sn. */
export function isAcceptedWav(b: Uint8Array): boolean {
  if (b.length < 46 || b.length > WAV_MAX_BYTES) return false;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o: number): string => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
  return (
    tag(0) === "RIFF" &&
    tag(8) === "WAVE" &&
    tag(12) === "fmt " &&
    v.getUint32(16, true) === 16 &&
    v.getUint16(20, true) === 1 &&
    v.getUint16(22, true) === 1 &&
    v.getUint32(24, true) === WAV_RATE &&
    v.getUint16(34, true) === 16 &&
    tag(36) === "data" &&
    v.getUint32(40, true) === b.length - 44
  );
}

/** Ortamdaki adres: yalnız http(s), kimlik bilgisi yok, sorgu/parça yok. Geçersizse `null` (Etkin kullanılamaz). */
export function voiceBaseUrl(raw: string | undefined = process.env.VOICE_URL): URL | null {
  const value = raw === undefined || raw.trim() === "" ? DEFAULT_URL : raw.trim();
  try {
    const u = new URL(value);
    if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username !== "" || u.password !== "" || u.search !== "" || u.hash !== "") return null;
    return u;
  } catch {
    return null;
  }
}

export async function transcribe(wav: Uint8Array<ArrayBuffer>, fetchImpl: typeof fetch = fetch): Promise<SttResult> {
  const base = voiceBaseUrl();
  if (base === null) return { status: "unavailable" };
  try {
    const res = await fetchImpl(new URL("/stt", base), {
      method: "POST",
      body: wav,
      headers: { "content-type": "audio/wav" },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as { text?: unknown; confidence?: unknown; error?: unknown } | null;
    if (res.status === 503 && body?.error === "BUSY") return { status: "busy" };
    if (!res.ok || body === null || typeof body.text !== "string") return { status: "unavailable" };
    const confidence = typeof body.confidence === "number" && Number.isFinite(body.confidence) ? Math.max(0, Math.min(1, body.confidence)) : 0;
    return { status: "ok", text: body.text.slice(0, 500), confidence };
  } catch {
    return { status: "unavailable" };
  }
}
