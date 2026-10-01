"""Shared fixtures for the sync tests (test_sync_*.py)."""

import httpx
import pytest

import app.sync.storage as sync_storage
from app.main import app
from app.routers import sync as sync_router
from tests.sync_helpers import FakeClock


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
async def sync_db(tmp_path, monkeypatch):
    path = tmp_path / "sync.db"
    monkeypatch.setattr(sync_storage, "DB_PATH", str(path))
    await sync_storage.init_sync_db()
    return path


@pytest.fixture
async def client(sync_db, clock, monkeypatch):
    """An HTTP client on the real app, with the sync clock faked, no trusted
    proxy hops unless a test sets them, and the rate-limit counters cleared
    before and after."""
    monkeypatch.delenv("SYNC_TRUSTED_PROXY_HOPS", raising=False)
    sync_router.create_limiter.reset()
    sync_router.redeem_limiter.reset()
    app.dependency_overrides[sync_router.current_time] = clock
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.pop(sync_router.current_time, None)
    sync_router.create_limiter.reset()
    sync_router.redeem_limiter.reset()
