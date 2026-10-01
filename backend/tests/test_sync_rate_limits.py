"""Sync: per-address rate limits on record creation and code redemption."""

import sqlite3

import pytest

from app.sync.ratelimit import RateLimiter
from tests.sync_helpers import bearer, new_player

HOUR = 3600


def _from(address: str) -> dict:
    return {"X-Forwarded-For": address}


async def _create(client, headers=None):
    return await client.post(
        "/api/sync/players", json={"state": {"schema": 1}}, headers=headers or {}
    )


async def test_create_allows_10_an_hour_then_429_until_the_clock_moves(client, clock):
    for _ in range(10):
        assert (await _create(client)).status_code == 201

    r = await _create(client)
    assert r.status_code == 429
    assert r.headers["retry-after"] == str(HOUR)

    clock.advance(HOUR - 1)
    assert (await _create(client)).status_code == 429

    clock.advance(1)
    assert (await _create(client)).status_code == 201


async def test_create_window_slides(client, clock):
    for _ in range(5):
        assert (await _create(client)).status_code == 201
    clock.advance(HOUR / 2)
    for _ in range(5):
        assert (await _create(client)).status_code == 201
    assert (await _create(client)).status_code == 429
    clock.advance(HOUR / 2)
    # The first five have left the window; the second five have not.
    for _ in range(5):
        assert (await _create(client)).status_code == 201
    assert (await _create(client)).status_code == 429


async def test_refused_create_makes_no_record(client, sync_db):
    for _ in range(10):
        await _create(client)
    assert (await _create(client)).status_code == 429
    with sqlite3.connect(sync_db) as db:
        assert db.execute("SELECT COUNT(*) FROM sync_players").fetchone()[0] == 10


async def test_redeem_allows_20_an_hour_then_429_until_the_clock_moves(client, clock):
    _, auth = await new_player(client)
    for _ in range(20):
        r = await client.post("/api/sync/pairing-codes/redeem", json={"code": "AAAAAAAA"})
        assert r.status_code == 404

    code = (await client.post("/api/sync/pairing-codes", headers=auth)).json()["code"]
    r = await client.post("/api/sync/pairing-codes/redeem", json={"code": code})
    assert r.status_code == 429

    clock.advance(HOUR)
    code = (await client.post("/api/sync/pairing-codes", headers=auth)).json()["code"]
    r = await client.post("/api/sync/pairing-codes/redeem", json={"code": code})
    assert r.status_code == 200
    linked = bearer(r.json()["device_token"])
    assert (await client.get("/api/sync/state", headers=linked)).status_code == 200


async def test_the_two_limits_are_counted_separately(client):
    for _ in range(20):
        await client.post("/api/sync/pairing-codes/redeem", json={"code": "AAAAAAAA"})
    assert (await _create(client)).status_code == 201


async def test_limit_is_per_address_using_first_forwarded_hop(client):
    for _ in range(10):
        assert (await _create(client, _from("198.51.100.7, 10.0.0.1"))).status_code == 201
    # Same first hop behind a different proxy: same bucket.
    assert (await _create(client, _from("198.51.100.7, 10.0.0.2"))).status_code == 429
    # A different first hop, or no header (the socket peer), has its own.
    assert (await _create(client, _from("198.51.100.8, 10.0.0.1"))).status_code == 201
    assert (await _create(client)).status_code == 201


async def test_without_forwarded_header_the_socket_peer_is_the_key(client):
    for _ in range(10):
        assert (await _create(client)).status_code == 201
    assert (await _create(client)).status_code == 429
    assert (await _create(client, _from("203.0.113.9"))).status_code == 201


# ── The limiter on its own ───────────────────────────────────────────


def test_limiter_counts_per_key_and_recovers():
    rl = RateLimiter(limit=2, window_s=100)
    assert rl.hit("a", 0) is None
    assert rl.hit("a", 10) is None
    assert rl.hit("a", 20) == pytest.approx(80)
    assert rl.hit("b", 20) is None
    # A refused hit is not counted, so recovery comes when the oldest leaves.
    assert rl.hit("a", 99) == pytest.approx(1)
    assert rl.hit("a", 100) is None
    assert rl.hit("a", 105) == pytest.approx(5)


def test_limiter_forgets_idle_addresses_once_many_are_tracked():
    rl = RateLimiter(limit=1, window_s=10)
    for i in range(5000):
        rl.hit(f"addr-{i}", 0)
    rl.hit("late", 50)
    assert len(rl._hits) < 5000
    assert rl.hit("late", 51) is not None
