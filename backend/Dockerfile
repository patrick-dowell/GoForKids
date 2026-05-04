# GoForKids backend image — FastAPI + KataGo (Eigen / CPU build).
#
# Build context is the repo root (see docker-compose.yml / render.yaml) so
# the image can carry both backend/ and the canonical bot profiles at
# data/profiles/. All COPY paths below are repo-root-relative.
#
# Two-stage build keeps the runtime image slim (~250 MB):
#   1. builder  — downloads + extracts KataGo Eigen release
#   2. runtime  — python:slim with libgomp1, app code, KataGo binary, configs,
#                 the b20 model, and the rank-profile YAML used by
#                 app/ai/profile_loader.py
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
      curl unzip ca-certificates squashfs-tools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/katago

# The KataGo Eigen release ships as an AppImage. Two reasons we don't
# execute it: (1) AppImages self-mount via FUSE, which Render containers
# don't have; (2) the AppImage runtime header refuses to run under Docker
# buildx + QEMU emulation on Apple Silicon (`Exec format error` because
# binfmt_misc doesn't recognize the embedded squashfs).
#
# Solution: extract the squashfs payload directly with unsquashfs. AppImages
# embed a standard squashfs filesystem after the runtime header, and
# unsquashfs auto-detects the offset. This produces the same `squashfs-root/`
# tree we'd get from `--appimage-extract`, but works regardless of the
# build environment.
# `unsquashfs` won't auto-find the squashfs payload inside an AppImage —
# the AppImage runtime is a self-contained ELF prepended to the squashfs.
# We compute the squashfs offset by parsing the ELF header (end of the
# section header table), then unpack from there. (grep'ing for the "hsqs"
# magic is unreliable: the same bytes appear inside the runtime ELF as a
# false positive, e.g. at offset 194134 in the v1.16.0 build.)
RUN set -eu \
    && curl -fL "${KATAGO_RELEASE_URL}" -o katago.zip \
    && unzip katago.zip \
    && rm katago.zip \
    && offset=$(python3 -c "import struct; \
h=open('katago','rb').read(64); \
assert h[:4]==b'\x7fELF'; \
i=h[4]==2; \
e_shoff=struct.unpack('<Q' if i else '<I', h[40:48] if i else h[32:36])[0]; \
e_shes=struct.unpack('<H', h[58:60] if i else h[46:48])[0]; \
e_shnm=struct.unpack('<H', h[60:62] if i else h[48:50])[0]; \
print(e_shoff + e_shes * e_shnm)") \
    && echo "AppImage squashfs offset: $offset" \
    && unsquashfs -d squashfs-root -no-progress -o "$offset" katago > /dev/null \
    && rm katago

# ---------- runtime ----------
FROM python:${PYTHON_VERSION}

# libgomp1 is the only system dep KataGo Eigen needs at runtime;
# AppRun handles its own LD_LIBRARY_PATH for KataGo's bundled libs.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/katago/squashfs-root /opt/katago/squashfs-root
COPY backend/configs/analysis_example.cfg     /opt/katago/configs/analysis_example.cfg

# Both KataGo networks ship in the image so we can flip between them at
# runtime via env vars without rebuilding. b28 is the production-active
# default (set via ENV below); b20 stays bundled as a hot-rollback target.
# Cost: extra ~87 MB of image size.
COPY backend/models/b20.bin.gz                /opt/katago/models/b20.bin.gz
COPY backend/models/b28.bin.gz                /opt/katago/models/b28.bin.gz

# Bot rank profiles. Source of truth lives at data/profiles/ in the repo;
# the image bakes them at /opt/profiles/. b28.yaml is the production-active
# calibration; b20.yaml is also bundled. To roll back: override both
# KATAGO_MODEL=/opt/katago/models/b20.bin.gz AND
# CALIBRATION_PROFILE_PATH=/opt/profiles/b20.yaml in the runtime env.
COPY data/profiles                            /opt/profiles

WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# Production runs b20 by default — the b28 calibration was completed
# (see data/profiles/b28.yaml + AI_CALIBRATION.md "b28 calibration outcome")
# but Render Standard tier (1 vCPU + 2 GB) is too underpowered for b28's
# per-move latency to feel acceptable. Both models ship in the image; to
# switch, override KATAGO_MODEL + CALIBRATION_PROFILE_PATH at runtime
# (e.g. when Render moves to a beefier tier or for local A/B testing).
ENV KATAGO_PATH=/opt/katago/squashfs-root/AppRun \
    KATAGO_MODEL=/opt/katago/models/b20.bin.gz \
    KATAGO_CONFIG=/opt/katago/configs/analysis_example.cfg \
    KATAGO_THREADS=1 \
    KATAGO_VISITS=100 \
    KATAGO_SCORE_VISITS=10 \
    KATAGO_OWNERSHIP_VISITS=50 \
    CALIBRATION_PROFILE_PATH=/opt/profiles/b20.yaml

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
