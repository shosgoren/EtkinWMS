// T-1002 (B-62): sahte iç ses servisi (yalnız 127.0.0.1; gerçek model yok). `POST /stt` gerçek servisle aynı sözleşme: yalnız 16 kHz mono
// 16 bit PCM WAV kabul; yanıt kaydın süresine göre sabit metin — kısa (< 2 sn) basış demo komutu, uzun (≥ 2 sn) basış "onayla" (A-172).
// Ses saklanmaz; yalnız istek sayısı tutulur.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export const FAKE_VOICE_COMMAND = "Beş adet ahşap palet A bir G sıfır bir rafına koy";

export interface FakeVoice {
  readonly url: string;
  readonly calls: () => number;
  close(): Promise<void>;
}

export async function startFakeVoice(): Promise<FakeVoice> {
  let calls = 0;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size <= 300_000) chunks.push(c);
    });
    req.on("end", () => {
      const send = (status: number, body: unknown): void => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.method === "GET" && req.url === "/health") return send(200, { status: "ok" });
      if (req.method !== "POST" || req.url !== "/stt") return send(404, { error: "NOT_FOUND" });
      const b = Buffer.concat(chunks);
      chunks.length = 0;
      const ok = size <= 300_000 && b.length > 44 && b.toString("latin1", 0, 4) === "RIFF" && b.readUInt16LE(22) === 1 && b.readUInt32LE(24) === 16000 && b.readUInt16LE(34) === 16;
      if (!ok) return send(400, { error: "AUDIO_REJECTED" });
      calls++;
      const seconds = (b.length - 44) / 32000;
      send(200, { text: seconds >= 2 ? "Onayla." : FAKE_VOICE_COMMAND, confidence: 0.9, seconds });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls: () => calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
