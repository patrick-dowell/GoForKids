# GoForKids backend image — FastAPI + KataGo (Eigen / CPU build).
#
# Two-stage build keeps the runtime image slim (~250 MB):
#   1. builder  — downloads + extracts KataGo Eigen release
#   2. runtime  — python:slim with libgomp1, app code, KataGo binary, configs,
#                 and the b20 model copied from the build context
#
# The b20 model is committed at backend/models/b20.bin.gz (83 MB) so builds
# are reproducible and don't depend on KataGo's archive URLs (which 403'd).
# Same model we run locally on Mac Metal — bot-rank calibration carries over.

ARG PYTHON_VERSION=3.12-slim

# ---------- builder ----------
FROM python:${PYTHON_VERSION} AS builder

ARG KATAGO_VERSION=1.16.0
ARG KATAGO_RELEASE_URL=https://github.com/lightvector/KataGo/releases/download/v${KATAGO_VERSION}/katago-v${KATAGO_VERSION}-eigen-linux-x64.zip

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/katago

RUN curl -fL "${KATAGO_RELEASE_URL}" -o katago.zip \
    && unzip katago.zip \
    && rm katago.zip \
    && chmod +x katago

# ---------- runtime ----------
FROM python:${PYTHON_VERSION}

# libgomp1 is the only system dep KataGo Eigen needs at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/katago/katago  /usr/local/bin/katago
COPY --from=builder /opt/katago/configs /opt/katago/configs
COPY models/b20.bin.gz                  /opt/katago/models/b20.bin.gz

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
