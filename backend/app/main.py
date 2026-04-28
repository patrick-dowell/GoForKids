import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import games, study
from app.game.storage import init_db

# Surface app logger output (logger.info / logger.warning in app.* modules) at
# INFO level. Uvicorn's default config doesn't propagate non-uvicorn loggers,
# so the bot pass-detection diagnostics were invisible without this.
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize SQLite database
    await init_db()
    yield
    # Shutdown: nothing to clean up for now


app = FastAPI(
    title="GoForKids API",
    description="Backend API for GoForKids — a Go teaching app",
    version="0.1.0",
    lifespan=lifespan,
)

_default_origins = "http://localhost:5173,http://localhost:3000"
_allowed_origins = [
    o.strip()
    for o in os.environ.get("CORS_ALLOWED_ORIGINS", _default_origins).split(",")
    if o.strip()
]

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
app.include_router(study.router, prefix="/api/study", tags=["study"])
