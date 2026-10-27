"""Etkin ses servisi birim testleri (T-1002, T-1106). Model gerektiren testler, model dizini yoksa atlanır (CI'da imaj içinde koşar).

Çalıştırma: `VOICE_NO_APP=1 python -m unittest -v test_app` (imajda: `docker run --rm --network none <imaj> python -m unittest -v test_app`).
"""
import asyncio
import io
import os
import struct
import unittest
import wave
from pathlib import Path

os.environ.setdefault("VOICE_NO_APP", "1")
import app as voice  # noqa: E402

HERE = Path(__file__).parent


def wav(seconds=1.0, rate=16000, channels=1, width=2):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        w.writeframes(b"\x00" * int(seconds * rate) * channels * width)
    return buf.getvalue()


class FakeEngine:
    def __init__(self, delay=0.0):
        self.delay = delay
        self.calls = 0

    def transcribe(self, audio):
        import time

        self.calls += 1
        time.sleep(self.delay)
        return "beş koli mal kabul et", 0.8


class DecodeTests(unittest.TestCase):
    def test_accepts_pcm16_mono_16k(self):
        audio = voice.decode_wav(wav(2.0))
        self.assertEqual(len(audio), 32000)

    def test_rejects_wrong_format_length_and_garbage(self):
        for bad in (wav(1.0, rate=44100), wav(1.0, channels=2), wav(1.0, width=1), wav(9.0), b"", b"RIFF" + b"\x00" * 60, os.urandom(4096)):
            with self.assertRaises(voice.AudioRejected):
                voice.decode_wav(bad)

    def test_rejects_oversized_body_before_parsing(self):
        with self.assertRaises(voice.AudioRejected):
            voice.decode_wav(b"\x00" * (voice.MAX_BYTES + 1))

    def test_header_claiming_more_frames_than_present_is_bounded(self):
        data = bytearray(wav(0.5))
        struct.pack_into("<I", data, 40, 10_000_000)  # data chunk boyutu yalan
        with self.assertRaises(voice.AudioRejected):
            voice.decode_wav(bytes(data))


class ServiceTests(unittest.TestCase):
    def test_loading_then_ok(self):
        svc = voice.Service(None)
        self.assertEqual(asyncio.run(svc.stt(wav()))[0], 503)
        svc.engine = FakeEngine()
        status, body = asyncio.run(svc.stt(wav()))
        self.assertEqual(status, 200)
        self.assertEqual(body["text"], "beş koli mal kabul et")
        self.assertEqual(body["seconds"], 1.0)

    def test_bad_audio_never_reaches_engine(self):
        engine = FakeEngine()
        svc = voice.Service(engine)
        self.assertEqual(asyncio.run(svc.stt(b"not audio"))[0], 400)
        self.assertEqual(engine.calls, 0)

    def test_single_worker_and_bounded_queue(self):
        engine = FakeEngine(delay=0.3)

        async def run():
            svc = voice.Service(engine)
            old = (voice.QUEUE_MAX, voice.QUEUE_WAIT)
            voice.QUEUE_MAX, voice.QUEUE_WAIT = 1, 0.1
            try:
                return await asyncio.gather(*(svc.stt(wav()) for _ in range(4)))
            finally:
                voice.QUEUE_MAX, voice.QUEUE_WAIT = old

        results = asyncio.run(run())
        codes = sorted(r[0] for r in results)
        self.assertEqual(codes.count(200), 1)
        self.assertEqual(codes.count(503), 3)
        self.assertEqual(engine.calls, 1)


class FakeVoice:
    def __init__(self, delay=0.0):
        self.delay = delay
        self.calls = 0

    def synthesize(self, text):
        import time

        import numpy as np

        self.calls += 1
        time.sleep(self.delay)
        return np.zeros(voice.TTS_RATE // 2, dtype=np.float32)


class SpeakableTests(unittest.TestCase):
    def test_shelf_codes_halves_and_control_chars(self):
        self.assertEqual(voice.speakable("A-3 rafına koy"), "A 3 rafına koy")
        self.assertEqual(voice.speakable("7,5 kilo"), "7 buçuk kilo")
        self.assertEqual(voice.speakable("3,25 m"), "3,25 m")
        self.assertEqual(voice.speakable("C-12\x07 rafı\u202e  boş"), "C 12 rafı boş")

    def test_length_is_bounded(self):
        self.assertEqual(len(voice.speakable("a" * 5000)), voice.TTS_MAX_CHARS)

    def test_wav_is_mono_16bit_24k(self):
        import numpy as np

        data = voice.encode_wav(np.array([0.0, 2.0, -2.0], dtype=np.float32))
        with wave.open(io.BytesIO(data), "rb") as w:
            self.assertEqual((w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()), (1, 2, 24000, 3))
            self.assertEqual(struct.unpack("<3h", w.readframes(3)), (0, 32767, -32767))


class TtsServiceTests(unittest.TestCase):
    def test_unavailable_until_loaded_and_rejects_bad_text(self):
        svc = voice.Service(FakeEngine())
        self.assertEqual(asyncio.run(svc.tts("merhaba"))[0], 503)
        svc.voice = FakeVoice()
        for bad in (None, 5, ["x"], "", "  123 - ,"):
            self.assertEqual(asyncio.run(svc.tts(bad))[0], 400)
        self.assertEqual(svc.voice.calls, 0)

    def test_same_text_is_cached(self):
        svc = voice.Service(FakeEngine(), FakeVoice())
        first = asyncio.run(svc.tts("Raf A-3 boş"))
        second = asyncio.run(svc.tts("Raf  A-3 boş"))
        self.assertEqual(first[0], 200)
        self.assertTrue(first[1].startswith(b"RIFF"))
        self.assertEqual(first, second)
        self.assertEqual(svc.voice.calls, 1)

    def test_cache_is_bounded(self):
        svc = voice.Service(FakeEngine(), FakeVoice())
        for i in range(voice.TTS_CACHE_MAX + 5):
            asyncio.run(svc.tts(f"cümle {i} tamam"))
        self.assertEqual(len(svc._cache), voice.TTS_CACHE_MAX)

    def test_single_worker_and_bounded_queue(self):
        fake = FakeVoice(delay=0.3)

        async def run():
            svc = voice.Service(FakeEngine(), fake)
            old = (voice.TTS_QUEUE_MAX, voice.QUEUE_WAIT)
            voice.TTS_QUEUE_MAX, voice.QUEUE_WAIT = 1, 0.1
            try:
                return await asyncio.gather(*(svc.tts(f"metin {i} oku") for i in range(4)))
            finally:
                voice.TTS_QUEUE_MAX, voice.QUEUE_WAIT = old

        codes = sorted(r[0] for r in asyncio.run(run()))
        self.assertEqual(codes.count(200), 1)
        self.assertEqual(codes.count(503), 3)
        self.assertEqual(fake.calls, 1)


@unittest.skipUnless(Path(voice.MODEL_DIR, "model.bin").is_file(), "model dizini yok (yalnız imaj içinde koşar)")
class ModelTests(unittest.TestCase):
    def test_sample_wav_to_text(self):
        engine = voice.WhisperEngine(voice.MODEL_DIR, voice.THREADS)
        text, conf = engine.transcribe(voice.decode_wav((HERE / "testdata" / "mal-kabul.wav").read_bytes()))
        norm = text.lower().replace("ı", "i")
        self.assertIn("kabul", norm)
        self.assertGreater(conf, 0.0)


def rss_mib():
    for line in Path("/proc/self/status").read_text().splitlines():
        if line.startswith("VmRSS:"):
            return int(line.split()[1]) / 1024
    return 0.0


@unittest.skipUnless(Path(voice.TTS_DIR, "ema.pt").is_file() and Path(voice.MODEL_DIR, "model.bin").is_file(), "model dizini yok (yalnız imaj içinde koşar)")
class TtsModelTests(unittest.TestCase):
    def test_turkish_speech_round_trips_through_stt_within_memory(self):
        import numpy as np

        tts = voice.EmaEngine(voice.TTS_DIR, voice.THREADS)
        audio = tts.synthesize(voice.speakable("Bugün hava çok güzel."))
        self.assertGreater(len(audio) / voice.TTS_RATE, 0.6)
        self.assertLess(float(np.abs(audio).max()), 1.01)
        data = voice.encode_wav(audio)
        self.assertTrue(data.startswith(b"RIFF"))
        # Yazı → ses → yazı: üretilen ses Türkçe anlaşılır mı (aynı imajdaki Whisper ile; "hava" alan ipucunda yok)?
        n = int(len(audio) * voice.RATE / voice.TTS_RATE)
        heard = np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(np.float32)
        stt = voice.WhisperEngine(voice.MODEL_DIR, voice.THREADS)
        text, _conf = stt.transcribe(heard)
        self.assertIn("hava", text.lower())
        # Kapsayıcı sınırı 1280 MiB (deploy/vps/compose.yml): iki model birlikte payla sığmalı.
        self.assertLess(rss_mib(), 1100)


if __name__ == "__main__":
    unittest.main()
