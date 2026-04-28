# GoForKids backend image — FastAPI + KataGo (Eigen / CPU build).
#
# Two-stage build keeps the runtime image slim (~250 MB):
#   1. builder  — downloads KataGo Eigen release + b20c256 model
#   2. runtime  — python:slim with libgomp1, app code, KataGo + model copied in
#
# The b20 model matches what we run locally on Mac Metal, so all bot-rank
# calibration carries over unchanged. Eigen backend is single-instance, no GPU.

ARG PYTHON_VERSION=3.12-slim

# ---------- builder ----------
FROM python:${PYTHON_VERSION} AS builder

# Pinned versions. Bump when KataGo releases a new stable.
ARG KATAGO_VERSION=1.16.0
ARG KATAGO_RELEASE_URL=https://github.com/lightvector/KataGo/releases/download/v${KATAGO_VERSION}/katago-v${KATAGO_VERSION}-eigen-linux-x64.zip
ARG MODEL_URL=https://media.katagotraining.org/uploaded/networks/models/g170/g170e-b20c256x2-s5303129600-d1228401921.bin.gz

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/katago

RUN curl -fL "${KATAGO_RELEASE_URL}" -o katago.zip \
    && unzip katago.zip \
    && rm katago.zip \
    && chmod +x katago

RUN mkdir -p models \
    && curl -fL "${MODEL_URL}" -o models/b20.bin.gz

# ---------- runtime ----------
FROM python:${PYTHON_VERSION}

# libgomp1 is the only system dep KataGo Eigen needs at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/katago/katago        /usr/local/bin/katago
COPY --from=builder /opt/katago/configs       /opt/katago/configs
COPY --from=builder /opt/katago/models/b20.bin.gz /opt/katago/models/b20.bin.gz

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV KATAGO_PATH=/usr/local/bin/katago \
    KATAGO_MODEL=/opt/katago/models/b20.bin.gz \
    KATAGO_CONFIG=/opt/katago/configs/analysis_example.cfg \
    KATAGO_THREADS=2 \
    KATAGO_VISITS=100

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
