from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import games, study
from app.game.storage import init_db


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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


app.include_router(games.router, prefix="/api/games", tags=["games"])
app.include_router(study.router, prefix="/api/study", tags=["study"])
