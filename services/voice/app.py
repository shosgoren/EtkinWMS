"""Etkin ses servisi (T-1002, B-62; Q-129 kullanıcı kararı 20 Ekim): yerel konuşma → yazı ve (T-1106) yazı → doğal Türkçe ses.

- faster-whisper `small` (MIT), CPU int8, Silero VAD (faster-whisper içindeki ONNX). Model imaja gömülüdür; çalışırken internet yok.
- Yalnız iç ağ (compose `voice` ağı, `internal: true`); tek istemci web sunucusudur. Dışarıya port açılmaz.
- Ses diske yazılmaz, loglanmaz; tanınan metin de loglanmaz (erişim günlüğü kapalı, uygulama günlüğü yok).
- Kaynak sınırı: tek eşzamanlı çözümleme (semafor), en çok QUEUE_MAX bekleyen, girdi en çok 8,5 sn 16 kHz mono 16 bit PCM WAV.
  Sıkıştırılmış biçim (webm/ogg/mp3) kabul edilmez: güvenilmeyen girdi için medya çözücü (ffmpeg/PyAV) hiç çalışmaz.
- T-1106: `/tts` EMA Lightning (Apache-2.0, CPU) ile en çok TTS_MAX_CHARS karakteri 24 kHz mono 16 bit WAV'a çevirir. Raf kodu ve
  "x,5" ön çevirisi (Q-129), aynı metin için sabit tohum + küçük bellek önbelleği (rehber cümleleri tekrar eder). Metin loglanmaz/saklanmaz.
  Model yüklenemezse STT çalışmaya devam eder, `/tts` 503 döner (web tarayıcı sesine düşer).
"""
import asyncio
import io
import json
import math
import os
import re
import wave
from collections import OrderedDict
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
TTS_DIR = os.environ.get("VOICE_TTS_DIR", "/models/ema-lightning")
TTS_RATE = 24000
TTS_MAX_CHARS = 400
TTS_BODY_MAX = 4096
TTS_CACHE_MAX = 48
TTS_CACHE_BYTES = 16 * 1024 * 1024
# Güvenlik incelemesi (T-1106): 400 karakter, normalleştirici sayıları/tarihleri sözcüğe açınca çok uzayabilir. Okunacak metin (harf) ve
# üretilen ses süresi ayrıca sınırlanır; aşan istek CPU'yu uzun tutmadan reddedilir, önbelleğe girmez.
TTS_MAX_SPOKEN = 600
TTS_MAX_SECONDS = 40
TTS_QUEUE_MAX = int(os.environ.get("VOICE_TTS_QUEUE_MAX", "4"))
# Kısa alan ipucu: Whisper'ı depo sözcüklerine yaklaştırır (kiracı verisi içermez).
PROMPT = (
    "Depo komutu: mal kabul et, rafına koy, sayım başlat, transfer et, çıkış yap, sarf et, etiket yazdır, "
    "rafında ne var, kaç tane var, görevlerini göster, sevk et, onayla, düzelt. Koli, palet, adet, kilo."
)


class AudioRejected(Exception):
    """Girdi sözleşmeye uymuyor (biçim, süre, boyut)."""


class Engine(Protocol):
    def transcribe(self, audio: np.ndarray) -> tuple[str, float]: ...


class TextTooLong(Exception):
    """Okunacak hâli (normalleştirme sonrası) sınırı aşıyor."""


class Voice(Protocol):
    def synthesize(self, text: str) -> np.ndarray: ...


_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2066-\u2069]")
_SHELF = re.compile(r"\b([A-Za-zÇĞİÖŞÜçğıöşü]{1,3})-(\d{1,4})\b")
_HALF = re.compile(r"\b(\d+),5\b")


def speakable(text: str) -> str:
    """Q-129 ön çevirisi: "A-3" → "A 3" (tire okunmaz), "7,5" → "7 buçuk"; sayıları/birimleri modelin normalleştiricisi okur."""
    text = _CONTROL.sub(" ", text)
    text = _SHELF.sub(r"\1 \2", text)
    text = _HALF.sub(r"\1 buçuk", text)
    return " ".join(text.split())[:TTS_MAX_CHARS]


def encode_wav(audio: np.ndarray, rate: int = TTS_RATE) -> bytes:
    pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).round().astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


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


class EmaEngine:
    """EMA Lightning, CPU. Ağırlıklar imajdaki sabit dosyalardan (`weights_only=True`); Hugging Face'e hiç gidilmez."""

    def __init__(self, path: str, threads: int) -> None:
        import torch

        torch.set_num_threads(threads)
        torch.set_num_interop_threads(1)
        from ema_lightning.api import EMA
        from ema_lightning.decoder import load_decoder
        from ema_lightning.frontend import Frontend
        from ema_lightning.model import load_acoustic

        device = torch.device("cpu")
        model = load_acoustic(os.path.join(path, "ema.pt"), device)
        decoder = load_decoder(os.path.join(path, "decoder.pt"), device)
        self._tts = EMA._from_parts(model, decoder, Frontend(model.vocab), device)
        self._tts._batch_size = 1  # ölçüm turu (ve önbellek dosyası yazımı) olmasın; tek eşzamanlı istek

    def synthesize(self, text: str) -> np.ndarray:
        if len(self._tts._frontend(text)) > TTS_MAX_SPOKEN:
            raise TextTooLong
        return self._tts.say(text, seed=0, sample_rate=TTS_RATE).audio


class Service:
    """Çözümleme kapısı: tek çalışan, sınırlı kuyruk, bekleme süresi aşılırsa BUSY."""

    def __init__(self, engine: Engine | None, voice: Voice | None = None) -> None:
        self.engine = engine
        self.voice = voice
        self._slot = asyncio.Semaphore(1)
        self._waiting = 0
        self._tts_slot = asyncio.Semaphore(1)
        self._tts_waiting = 0
        self._cache: OrderedDict[str, bytes] = OrderedDict()

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

    async def tts(self, raw: object) -> tuple[int, bytes | dict[str, object]]:
        if not isinstance(raw, str):
            return 400, {"error": "TEXT_REJECTED"}
        text = speakable(raw)
        if not any(ch.isalpha() for ch in text):
            return 400, {"error": "TEXT_REJECTED"}
        voice = self.voice
        if voice is None:
            return 503, {"error": "TTS_UNAVAILABLE"}
        hit = self._cache.get(text)
        if hit is not None:
            self._cache.move_to_end(text)
            return 200, hit
        if self._tts_waiting >= TTS_QUEUE_MAX:
            return 503, {"error": "BUSY"}
        self._tts_waiting += 1
        try:
            await asyncio.wait_for(self._tts_slot.acquire(), timeout=QUEUE_WAIT)
        except TimeoutError:
            return 503, {"error": "BUSY"}
        finally:
            self._tts_waiting -= 1
        try:
            audio = await asyncio.to_thread(voice.synthesize, text)
        except TextTooLong:
            return 400, {"error": "TEXT_TOO_LONG"}
        finally:
            self._tts_slot.release()
        if audio.size == 0:
            return 400, {"error": "TEXT_REJECTED"}
        if audio.size > TTS_MAX_SECONDS * TTS_RATE:
            return 400, {"error": "TEXT_TOO_LONG"}
        data = encode_wav(audio)
        self._cache[text] = data
        while len(self._cache) > TTS_CACHE_MAX or sum(len(v) for v in self._cache.values()) > TTS_CACHE_BYTES:
            self._cache.popitem(last=False)
        return 200, data


def create_app(engine_factory=None, voice_factory=None):
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse, Response

    service = Service(None)

    @asynccontextmanager
    async def lifespan(_app):
        factory = engine_factory or (lambda: WhisperEngine(MODEL_DIR, THREADS))
        service.engine = await asyncio.to_thread(factory)
        try:
            # Tek iş parçacığı: STT ile aynı 1,5 CPU'yu paylaşır, okuma konuşma tanımayı yavaşlatmasın (güvenlik incelemesi).
            service.voice = await asyncio.to_thread(voice_factory or (lambda: EmaEngine(TTS_DIR, 1)))
        except Exception as error:  # ses modeli yoksa/bozuksa yalnız /tts kapalı; STT sürer
            print(f"tts kapalı: {type(error).__name__}", flush=True)
        yield

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

    @app.get("/health")
    async def health():
        if service.engine is None:
            return JSONResponse({"status": "loading"}, status_code=503)
        return {"status": "ok", "tts": service.voice is not None}

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

    @app.post("/tts")
    async def tts(request: Request):
        length = request.headers.get("content-length", "")
        if not length.isdigit() or int(length) > TTS_BODY_MAX:
            return JSONResponse({"error": "TEXT_REJECTED"}, status_code=413)
        body = bytearray()
        async for chunk in request.stream():
            body += chunk
            if len(body) > TTS_BODY_MAX:
                return JSONResponse({"error": "TEXT_REJECTED"}, status_code=413)
        try:
            payload = json.loads(bytes(body))
        except ValueError:
            payload = None
        status, out = await service.tts(payload.get("text") if isinstance(payload, dict) else None)
        if isinstance(out, bytes):
            return Response(out, media_type="audio/wav", headers={"Cache-Control": "no-store"})
        return JSONResponse(out, status_code=status, headers={"Cache-Control": "no-store"})

    return app


if os.environ.get("VOICE_NO_APP") != "1":
    app = create_app()
