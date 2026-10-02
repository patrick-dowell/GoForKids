"""Sync: per-address rate limits on record creation and code redemption."""

import sqlite3

import pytest

from app.sync.ratelimit import RateLimiter
from tests.sync_helpers import bearer, new_player

HOUR = 3600
CREATE_LIMIT = 60
REDEEM_LIMIT = 60


def _from(address: str) -> dict:
    return {"X-Forwarded-For": address}


async def _create(client, headers=None):
    return await client.post(
        "/api/sync/players", json={"state": {"schema": 1}}, headers=headers or {}
    )


async def test_create_allows_60_an_hour_then_429_until_the_clock_moves(client, clock):
    for _ in range(CREATE_LIMIT - 1):
        assert (await _create(client)).status_code == 201
    assert (await _create(client)).status_code == 201  # the 60th

    r = await _create(client)  # the 61st
    assert r.status_code == 429
    assert r.headers["retry-after"] == str(HOUR)

    clock.advance(HOUR - 1)
    assert (await _create(client)).status_code == 429

    clock.advance(1)
    assert (await _create(client)).status_code == 201


async def test_create_window_slides(client, clock):
    half = CREATE_LIMIT // 2
    for _ in range(half):
        assert (await _create(client)).status_code == 201
    clock.advance(HOUR / 2)
    for _ in range(half):
        assert (await _create(client)).status_code == 201
    assert (await _create(client)).status_code == 429
    clock.advance(HOUR / 2)
    # The first half have left the window; the second half have not.
    for _ in range(half):
        assert (await _create(client)).status_code == 201
    assert (await _create(client)).status_code == 429


async def test_refused_create_makes_no_record(client, sync_db):
    for _ in range(CREATE_LIMIT):
        await _create(client)
    assert (await _create(client)).status_code == 429
    with sqlite3.connect(sync_db) as db:
        assert db.execute("SELECT COUNT(*) FROM sync_players").fetchone()[0] == CREATE_LIMIT


async def test_redeem_allows_60_an_hour_then_429_until_the_clock_moves(client, clock):
    _, auth = await new_player(client)
    for _ in range(REDEEM_LIMIT):
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
    for _ in range(REDEEM_LIMIT):
        await client.post("/api/sync/pairing-codes/redeem", json={"code": "AAAAAAAA"})
    assert (await _create(client)).status_code == 201


# ── Which address is the key (SYNC_TRUSTED_PROXY_HOPS) ───────────────


def _hops(monkeypatch, n):
    monkeypatch.setenv("SYNC_TRUSTED_PROXY_HOPS", str(n))


async def _redeem(client, headers):
    return await client.post(
        "/api/sync/pairing-codes/redeem", json={"code": "AAAAAAAA"}, headers=headers
    )


async def test_by_default_a_rotating_forwarded_header_does_not_dodge_create(client):
    for i in range(CREATE_LIMIT):
        assert (await _create(client, _from(f"203.0.113.{i}"))).status_code == 201
    assert (await _create(client, _from("203.0.113.99"))).status_code == 429
    assert (await _create(client, _from("203.0.113.98, 198.51.100.1"))).status_code == 429
    assert (await _create(client)).status_code == 429


async def test_by_default_a_rotating_forwarded_header_does_not_dodge_redeem(client):
    for i in range(REDEEM_LIMIT):
        assert (await _redeem(client, _from(f"203.0.113.{i}"))).status_code == 404
    assert (await _redeem(client, _from("203.0.113.99"))).status_code == 429


async def test_malformed_hop_setting_trusts_no_proxy(client, monkeypatch):
    monkeypatch.setenv("SYNC_TRUSTED_PROXY_HOPS", "one")
    for i in range(CREATE_LIMIT):
        assert (await _create(client, _from(f"203.0.113.{i}"))).status_code == 201
    assert (await _create(client, _from("203.0.113.99"))).status_code == 429


async def test_one_hop_a_spoofed_prefix_does_not_dodge_either_limit(client, monkeypatch):
    _hops(monkeypatch, 1)
    for i in range(CREATE_LIMIT):
        r = await _create(client, _from(f"203.0.113.{i}, 198.51.100.7"))
        assert r.status_code == 201
    assert (await _create(client, _from("203.0.113.99, 198.51.100.7"))).status_code == 429
    for i in range(REDEEM_LIMIT):
        r = await _redeem(client, _from(f"203.0.113.{i}, 198.51.100.7"))
        assert r.status_code == 404
    assert (await _redeem(client, _from("203.0.113.99, 198.51.100.7"))).status_code == 429


async def test_one_hop_different_rightmost_addresses_get_separate_buckets(client, monkeypatch):
    _hops(monkeypatch, 1)
    for _ in range(CREATE_LIMIT):
        assert (await _create(client, _from("198.51.100.7"))).status_code == 201
    assert (await _create(client, _from("198.51.100.7"))).status_code == 429
    assert (await _create(client, _from("198.51.100.7, 198.51.100.8"))).status_code == 201


async def test_one_hop_reads_all_copies_of_the_header_as_one_list(client, monkeypatch):
    _hops(monkeypatch, 1)
    for i in range(CREATE_LIMIT):
        headers = [("X-Forwarded-For", f"203.0.113.{i}"), ("X-Forwarded-For", "198.51.100.7")]
        assert (await _create(client, headers)).status_code == 201
    assert (await _create(client, _from("198.51.100.7"))).status_code == 429


async def test_two_hops_key_on_the_second_entry_from_the_right(client, monkeypatch):
    _hops(monkeypatch, 2)
    for i in range(CREATE_LIMIT):
        r = await _create(client, _from(f"203.0.113.{i}, 198.51.100.7, 10.0.0.{i}"))
        assert r.status_code == 201
    assert (await _create(client, _from("198.51.100.7, 10.0.0.50"))).status_code == 429
    assert (await _create(client, _from("198.51.100.8, 10.0.0.1"))).status_code == 201


async def test_header_shorter_than_the_hops_falls_back_to_the_peer(client, monkeypatch):
    _hops(monkeypatch, 2)
    for i in range(CREATE_LIMIT):
        assert (await _create(client, _from(f"203.0.113.{i}"))).status_code == 201
    # All ten were keyed on the socket peer, as is a request with no header.
    assert (await _create(client)).status_code == 429
    assert (await _create(client, _from("198.51.100.7, 10.0.0.1"))).status_code == 201


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
