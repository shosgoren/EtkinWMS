// T-1002 (B-62): iç ses servisi istemcisi — adres yalnız ortamdan (SSRF yok), yönlendirme izlenmez, hata/zaman aşımı "unavailable".
import { describe, expect, it, vi } from "vitest";
import { wavYaz, yenidenOrnekle } from "@wms/ui";
import { isAcceptedWav, synthesize, transcribe, TTS_MAX_BYTES, voiceBaseUrl } from "./voice.ts";

function wav(n = 1600): Uint8Array<ArrayBuffer> {
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  return new Uint8Array(b);
}

describe("voice client", () => {
  it("WAV sözleşmesi", () => {
    expect(isAcceptedWav(wav())).toBe(true);
    const bad = wav();
    bad[22] = 2;
    expect(isAcceptedWav(bad)).toBe(false);
    expect(isAcceptedWav(wav(16000 * 9))).toBe(false);
    expect(isAcceptedWav(new Uint8Array(10))).toBe(false);
  });

  it("tarayıcı kaydedicisinin ürettiği WAV sunucu sözleşmesine uyar (48 kHz → 16 kHz)", () => {
    const pcm = yenidenOrnekle(new Float32Array(48000).fill(0.25), 48000);
    expect(pcm.length).toBe(16000);
    const out = wavYaz(pcm);
    expect(out.length).toBe(44 + 32000);
    expect(isAcceptedWav(new Uint8Array(out))).toBe(true);
  });

  it("adres yalnız http(s), kimlik bilgisiz; varsayılan iç ağ adı", () => {
    expect(voiceBaseUrl(undefined)?.href).toBe("http://voice:8000/");
    expect(voiceBaseUrl("http://127.0.0.1:9")?.href).toBe("http://127.0.0.1:9/");
    expect(voiceBaseUrl("file:///etc/passwd")).toBeNull();
    expect(voiceBaseUrl("http://u:p@voice:8000")).toBeNull();
    expect(voiceBaseUrl("http://voice:8000/?x=1")).toBeNull();
  });

  it("yanıt eşlemesi: ok, BUSY, hata, ağ hatası", async () => {
    const f = vi.fn();
    f.mockResolvedValueOnce(new Response(JSON.stringify({ text: "onayla", confidence: 0.9 }), { status: 200 }));
    expect(await transcribe(wav(), f)).toEqual({ status: "ok", text: "onayla", confidence: 0.9 });
    const [url, init] = f.mock.calls[0]! as [URL, RequestInit];
    expect(url.pathname).toBe("/stt");
    expect(init.redirect).toBe("error");
    f.mockResolvedValueOnce(new Response(JSON.stringify({ error: "BUSY" }), { status: 503 }));
    expect(await transcribe(wav(), f)).toEqual({ status: "busy" });
    f.mockResolvedValueOnce(new Response("x", { status: 500 }));
    expect(await transcribe(wav(), f)).toEqual({ status: "unavailable" });
    f.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await transcribe(wav(), f)).toEqual({ status: "unavailable" });
  });

  // T-1106: yazı → ses yanıtı yalnız audio/wav + RIFF + boyut sınırı; meşgul/yok/hata durum olarak döner, metin 400 karakterle kesilir.
  it("tts: WAV yanıtı, BUSY, yanlış tür, yanlış biçim, aşırı boyut, ağ hatası", async () => {
    const f = vi.fn();
    const ok = wav();
    new DataView(ok.buffer).setUint32(24, 24000, true);
    f.mockResolvedValueOnce(new Response(ok, { status: 200, headers: { "content-type": "audio/wav" } }));
    expect(await synthesize("a".repeat(500), f)).toEqual({ status: "ok", wav: ok });
    const [url, init] = f.mock.calls[0]! as [URL, RequestInit];
    expect(url.pathname).toBe("/tts");
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body as string)).toEqual({ text: "a".repeat(400) });
    f.mockResolvedValueOnce(new Response(JSON.stringify({ error: "BUSY" }), { status: 503 }));
    expect(await synthesize("x", f)).toEqual({ status: "busy" });
    f.mockResolvedValueOnce(new Response(JSON.stringify({ error: "TTS_UNAVAILABLE" }), { status: 503 }));
    expect(await synthesize("x", f)).toEqual({ status: "unavailable" });
    f.mockResolvedValueOnce(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect(await synthesize("x", f)).toEqual({ status: "unavailable" });
    f.mockResolvedValueOnce(new Response(wav(), { status: 200, headers: { "content-type": "audio/wav" } }));
    expect(await synthesize("x", f)).toEqual({ status: "unavailable" });
    f.mockResolvedValueOnce(new Response(new Uint8Array(TTS_MAX_BYTES + 1), { status: 200, headers: { "content-type": "audio/wav" } }));
    expect(await synthesize("x", f)).toEqual({ status: "unavailable" });
    f.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await synthesize("x", f)).toEqual({ status: "unavailable" });
  });
});
