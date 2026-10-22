"""Etkin ses servisi (T-1002, B-62; Q-129 kullanıcı kararı 20 Ekim): yerel konuşma → yazı.

- faster-whisper `small` (MIT), CPU int8, Silero VAD (faster-whisper içindeki ONNX). Model imaja gömülüdür; çalışırken internet yok.
- Yalnız iç ağ (compose `voice` ağı, `internal: true`); tek istemci web sunucusudur. Dışarıya port açılmaz.
- Ses diske yazılmaz, loglanmaz; tanınan metin de loglanmaz (erişim günlüğü kapalı, uygulama günlüğü yok).
- Kaynak sınırı: tek eşzamanlı çözümleme (semafor), en çok QUEUE_MAX bekleyen, girdi en çok 8,5 sn 16 kHz mono 16 bit PCM WAV.
  Sıkıştırılmış biçim (webm/ogg/mp3) kabul edilmez: güvenilmeyen girdi için medya çözücü (ffmpeg/PyAV) hiç çalışmaz.
"""
import asyncio
import io
import math
import os
import wave
from contextlib import asynccontextmanager
from typing import Protocol

import numpy as np

RATE = 16000
MAX_SECONDS = 8.5
MAX_BYTES = 44 + int(MAX_SECONDS * RATE) * 2 + 1024
QUEUE_MAX = int(os.environ.get("VOICE_QUEUE_MAX", "4"))
QUEUE_WAIT = float(os.environ.get("VOICE_QUEUE_WAIT", "6"))
MODEL_DIR = os.environ.get("VOICE_MODEL_DIR", "/models/whisper-small")
THREADS = max(1, int(os.environ.get("VOICE_THREADS", "2")))
BEAM = max(1, int(os.environ.get("VOICE_BEAM", "1")))
# Kısa alan ipucu: Whisper'ı depo sözcüklerine yaklaştırır (kiracı verisi içermez).
PROMPT = (
    "Depo komutu: mal kabul et, rafına koy, sayım başlat, transfer et, çıkış yap, sarf et, etiket yazdır, "
    "rafında ne var, kaç tane var, görevlerini göster, sevk et, onayla, düzelt. Koli, palet, adet, kilo."
)


class AudioRejected(Exception):
    """Girdi sözleşmeye uymuyor (biçim, süre, boyut)."""


class Engine(Protocol):
    def transcribe(self, audio: np.ndarray) -> tuple[str, float]: ...


def decode_wav(data: bytes) -> np.ndarray:
    """Yalnız 16 kHz, mono, 16 bit, sıkıştırmasız PCM; 0 < süre ≤ 8,5 sn. Aksi `AudioRejected`."""
    if len(data) < 44 or len(data) > MAX_BYTES:
        raise AudioRejected
    try:
        with wave.open(io.BytesIO(data), "rb") as w:
            if w.getnchannels() != 1 or w.getsampwidth() != 2 or w.getframerate() != RATE or w.getcomptype() != "NONE":
                raise AudioRejected
            n = w.getnframes()
            if n <= 0 or n > MAX_SECONDS * RATE:
                raise AudioRejected
            frames = w.readframes(n)
    except (wave.Error, EOFError, ValueError):
        raise AudioRejected from None
    usable = len(frames) - (len(frames) % 2)
    if usable < 2:
        raise AudioRejected
    pcm = np.frombuffer(frames[:usable], dtype="<i2")
    return pcm.astype(np.float32) / 32768.0


class WhisperEngine:
    def __init__(self, path: str, threads: int) -> None:
        from faster_whisper import WhisperModel

        self._model = WhisperModel(path, device="cpu", compute_type="int8", cpu_threads=threads, num_workers=1, local_files_only=True)

    def transcribe(self, audio: np.ndarray) -> tuple[str, float]:
        segments, _info = self._model.transcribe(
            audio,
            language="tr",
            beam_size=BEAM,
            temperature=0.0,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 400},
            condition_on_previous_text=False,
            without_timestamps=True,
            initial_prompt=PROMPT,
        )
        segs = list(segments)
        text = " ".join(s.text.strip() for s in segs).strip()
        if not segs:
            return "", 0.0
        conf = math.exp(sum(s.avg_logprob for s in segs) / len(segs))
        return text, max(0.0, min(1.0, conf))


class Service:
    """Çözümleme kapısı: tek çalışan, sınırlı kuyruk, bekleme süresi aşılırsa BUSY."""

    def __init__(self, engine: Engine | None) -> None:
        self.engine = engine
        self._slot = asyncio.Semaphore(1)
        self._waiting = 0

    async def stt(self, body: bytes) -> tuple[int, dict[str, object]]:
        try:
            audio = decode_wav(body)
        except AudioRejected:
            return 400, {"error": "AUDIO_REJECTED"}
        engine = self.engine
        if engine is None:
            return 503, {"error": "LOADING"}
        if self._waiting >= QUEUE_MAX:
            return 503, {"error": "BUSY"}
        self._waiting += 1
        try:
            await asyncio.wait_for(self._slot.acquire(), timeout=QUEUE_WAIT)
        except TimeoutError:
            return 503, {"error": "BUSY"}
        finally:
            self._waiting -= 1
        try:
            text, conf = await asyncio.to_thread(engine.transcribe, audio)
        finally:
            self._slot.release()
        return 200, {"text": text[:500], "confidence": round(conf, 3), "seconds": round(len(audio) / RATE, 2)}


def create_app(engine_factory=None):
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse

    service = Service(None)

    @asynccontextmanager
    async def lifespan(_app):
        factory = engine_factory or (lambda: WhisperEngine(MODEL_DIR, THREADS))
        service.engine = await asyncio.to_thread(factory)
        yield

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

    @app.get("/health")
    async def health():
        if service.engine is None:
            return JSONResponse({"status": "loading"}, status_code=503)
        return {"status": "ok"}

    @app.post("/stt")
    async def stt(request: Request):
        length = request.headers.get("content-length", "")
        if not length.isdigit() or int(length) > MAX_BYTES:
            return JSONResponse({"error": "AUDIO_REJECTED"}, status_code=413)
        body = bytearray()
        async for chunk in request.stream():
            body += chunk
            if len(body) > MAX_BYTES:
                return JSONResponse({"error": "AUDIO_REJECTED"}, status_code=413)
        status, payload = await service.stt(bytes(body))
        body.clear()
        return JSONResponse(payload, status_code=status, headers={"Cache-Control": "no-store"})

    return app


if os.environ.get("VOICE_NO_APP") != "1":
    app = create_app()
