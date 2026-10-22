# syntax=docker/dockerfile:1
# Etkin ses servisi (T-1002, B-62): yerel konuşma → yazı. Ayrı imaj `etkinwms-voice:<SHA>`; yayın arşivine uygulama imajlarıyla birlikte
# girer (deploy-vps.yml), aynı revision/schema etiketlerini taşır ve `node` (uid 1000) kullanıcısıyla çalışır (release.py denetimi).
# Taban imaj etiket + digest ile sabit (mirror.gcr.io, Docker Hub 429 sınırı yok). Python paketleri sürüm + SHA-256 ile sabit
# (`--require-hashes`, yalnız tekerlek). Model derlemede sabit revizyondan indirilir ve SHA-256 ile doğrulanır; çalışırken ağ yok.
ARG PY_IMAGE=mirror.gcr.io/library/python:3.12-slim-trixie@sha256:cb33f7f771ecec2ef1225cf39b159591a040391bd73e4c01f00fdfc4c47611d2

FROM ${PY_IMAGE} AS model
COPY fetch_model.py /fetch_model.py
RUN python -I /fetch_model.py /models/whisper-small

FROM ${PY_IMAGE} AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    VOICE_MODEL_DIR=/models/whisper-small \
    VOICE_THREADS=2
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --disable-pip-version-check --require-hashes --only-binary=:all: -r /tmp/requirements.txt \
    && rm /tmp/requirements.txt \
    && useradd --uid 1000 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin node
COPY --from=model /models /models
WORKDIR /srv
COPY app.py test_app.py ./
COPY testdata ./testdata
USER node
EXPOSE 8000
# Erişim günlüğü kapalı (istek gövdesi zaten loglanmaz; yol/IP de yazılmaz). Eşzamanlı bağlantı sınırı aşılırsa uvicorn 503 döner.
CMD ["python", "-I", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--workers", "1", "--limit-concurrency", "16", "--timeout-keep-alive", "5", "--no-server-header"]
