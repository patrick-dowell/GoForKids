import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import games, uploads
from app.game.storage import init_db
from app.uploads.storage import init_uploads_db

# Surface app logger output (logger.info / logger.warning in app.* modules) at
# INFO level. Uvicorn's default config doesn't propagate non-uvicorn loggers,
# so the bot pass-detection diagnostics were invisible without this.
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize SQLite database
    await init_db()
    await init_uploads_db()
    yield
    # Shutdown: nothing to clean up for now


app = FastAPI(
    title="GoForKids API",
    description="Backend API for GoForKids — a Go teaching app",
    version="0.1.0",
    # NOTE: request-latency middleware is added below the app definition —
    # one compact line per request so a hosted deployment's log stream is
    # enough to reconstruct an incident (the 2026-07-15 stall left no
    # forensics because nothing durable was logged per-request).
    lifespan=lifespan,
)

_req_logger = logging.getLogger("app.request")


@app.middleware("http")
async def log_request_latency(request, call_next):
    """One compact line per request: method path -> status in N ms.

    This is the forensic record the 2026-07-15 incident lacked: with a log
    drain attached to the hosting platform, these lines alone reconstruct
    arrival rate, latency distribution, and error clustering for any window.
    """
    import time as _time

    t0 = _time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        _req_logger.warning(
            "%s %s -> EXC in %dms",
            request.method,
            request.url.path,
            int((_time.perf_counter() - t0) * 1000),
        )
        raise
    _req_logger.info(
        "%s %s -> %d in %dms",
        request.method,
        request.url.path,
        response.status_code,
        int((_time.perf_counter() - t0) * 1000),
    )
    return response


# Always-allowed origins for the iPad app's bundled React frontend:
#   - `app://localhost` is what WKWebView sends when the page is loaded via
#     our custom `app://` URL scheme handler (the standard fix for serving
#     ES-module bundles to a hybrid iOS app)
#   - `null` is the historical file:// fallback; harmless to keep
# Both are appended unconditionally so production keeps working without an
# env-var update on Render.
_IOS_ORIGINS = ("app://localhost", "null")
_default_origins = "http://localhost:5173,http://localhost:3000," + ",".join(_IOS_ORIGINS)
_allowed_origins = [
    o.strip()
    for o in os.environ.get("CORS_ALLOWED_ORIGINS", _default_origins).split(",")
    if o.strip()
]
for o in _IOS_ORIGINS:
    if o not in _allowed_origins:
        _allowed_origins.append(o)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


app.include_router(games.router, prefix="/api/games", tags=["games"])
app.include_router(uploads.router, prefix="/api/uploads", tags=["uploads"])
