"""Etkin ses servisi birim testleri (T-1002). Model gerektiren tek test, model dizini yoksa atlanır (CI'da imaj içinde koşar).

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


@unittest.skipUnless(Path(voice.MODEL_DIR, "model.bin").is_file(), "model dizini yok (yalnız imaj içinde koşar)")
class ModelTests(unittest.TestCase):
    def test_sample_wav_to_text(self):
        engine = voice.WhisperEngine(voice.MODEL_DIR, voice.THREADS)
        text, conf = engine.transcribe(voice.decode_wav((HERE / "testdata" / "mal-kabul.wav").read_bytes()))
        norm = text.lower().replace("ı", "i")
        self.assertIn("kabul", norm)
        self.assertGreater(conf, 0.0)


if __name__ == "__main__":
    unittest.main()
