# syntax=docker/dockerfile:1
# Etkin ses servisi (T-1002, B-62): yerel konuşma → yazı. Ayrı imaj `etkinwms-voice:<SHA>`; yayın arşivine uygulama imajlarıyla birlikte
# girer (deploy-vps.yml), aynı revision/schema etiketlerini taşır ve `node` (uid 1000) kullanıcısıyla çalışır (release.py denetimi).
# Taban imaj etiket + digest ile sabit (mirror.gcr.io, Docker Hub 429 sınırı yok). Python paketleri sürüm + SHA-256 ile sabit
# (`--require-hashes`, yalnız tekerlek). Modeller derlemede sabit revizyondan indirilir ve SHA-256 ile doğrulanır; çalışırken ağ yok.
# T-1106: yazı → ses için EMA Lightning + PyTorch'un yalnız CPU yapısı (`+cpu`, download.pytorch.org; CUDA paketleri gelmez).
# T-1114: bellek makinenin çekirdek sayısına bağlı kalmasın — OpenMP/BLAS iş parçacığı havuzu ve glibc bellek arenası sayısı sabit
# (çok çekirdekli CI makinesinde aynı imaj 1100 MiB sınırını 1600 MiB'a aşıyordu; kapsayıcı sınırı 1280 MiB).
ARG PY_IMAGE=mirror.gcr.io/library/python:3.12-slim-trixie@sha256:cb33f7f771ecec2ef1225cf39b159591a040391bd73e4c01f00fdfc4c47611d2

FROM ${PY_IMAGE} AS model
COPY fetch_model.py /fetch_model.py
RUN python -I /fetch_model.py whisper /models/whisper-small \
    && python -I /fetch_model.py ema /models/ema-lightning

FROM ${PY_IMAGE} AS build
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    VOICE_MODEL_DIR=/models/whisper-small \
    VOICE_TTS_DIR=/models/ema-lightning \
    VOICE_THREADS=2 \
    OMP_NUM_THREADS=2 \
    OPENBLAS_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    MALLOC_ARENA_MAX=2
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --disable-pip-version-check --require-hashes --only-binary=:all: \
        --extra-index-url https://download.pytorch.org/whl/cpu -r /tmp/requirements.txt \
    && rm /tmp/requirements.txt \
    && useradd --uid 1000 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin node
COPY --from=model /models /models
WORKDIR /srv
COPY app.py test_app.py ./
COPY testdata ./testdata

# T-1004: tek katmana düzleştirilir. Yayın alıcısı (release.py) arşivdeki manifest.json'u en çok 10 000 bayt kabul eder; ses imajının
# 10 katmanı (her biri LayerSources kaydıyla) üç imajlı arşivde sınırı aşıyordu (10 063 bayt → BAD_MANIFEST). İçerik aynı; taban imajın
# ortam değişkenleri burada yeniden verilir (scratch hiçbirini taşımaz).
FROM scratch AS runtime
COPY --from=build / /
ENV PATH=/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C.UTF-8 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    VOICE_MODEL_DIR=/models/whisper-small \
    VOICE_TTS_DIR=/models/ema-lightning \
    VOICE_THREADS=2 \
    OMP_NUM_THREADS=2 \
    OPENBLAS_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    MALLOC_ARENA_MAX=2
WORKDIR /srv
USER node
EXPOSE 8000
# Erişim günlüğü kapalı (istek gövdesi zaten loglanmaz; yol/IP de yazılmaz). Eşzamanlı bağlantı sınırı aşılırsa uvicorn 503 döner.
CMD ["python", "-I", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--workers", "1", "--limit-concurrency", "16", "--timeout-keep-alive", "5", "--no-server-header"]
