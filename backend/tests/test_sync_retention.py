"""Sync retention (plan 32, Revision 3): logging out never deletes a profile;
a profile left with no device is deleted 30 days later unless a device logs
in; the cleanup runs at start-up and every 24 hours."""

import asyncio
import hashlib
import sqlite3

import pytest

import app.game.storage as game_storage
import app.sync.storage as sync_storage
import app.uploads.storage as uploads_storage
from app.main import app, lifespan
from app.routers import sync as sync_router
from app.sync import retention
from tests.sync_helpers import FakeClock, bearer, iso, new_player, replay

DAY = 24 * 3600
KEY = "retention-test-key-0123456789"


def _row(db_path, player_id):
    with sqlite3.connect(db_path) as db:
        return db.execute(
            "SELECT no_device_since FROM sync_players WHERE id = ?", (player_id,)
        ).fetchone()


def no_device_since(db_path, player_id):
    row = _row(db_path, player_id)
    assert row is not None, "profile is gone"
    return row[0]


def exists(db_path, player_id) -> bool:
    return _row(db_path, player_id) is not None


def count(db_path, table, player_id) -> int:
    with sqlite3.connect(db_path) as db:
        return db.execute(
            f"SELECT COUNT(*) FROM {table} WHERE player_id = ?", (player_id,)
        ).fetchone()[0]


async def log_out(client, auth):
    assert (await client.delete("/api/sync/devices/current", headers=auth)).status_code == 204


async def keyed_create(client):
    r = await client.post(
        "/api/sync/players", json={"state": {"schema": 1}, "create_key": KEY}
    )
    assert r.status_code in (200, 201), r.text
    return r.json()


# ── Log out, log in ──────────────────────────────────────────────────


async def test_logging_out_of_the_last_device_keeps_the_profile_and_starts_the_clock(
    client, clock, sync_db
):
    created, first = await new_player(client)
    pid = created["player_id"]
    second_code = (await client.post("/api/sync/pairing-codes", headers=first)).json()["code"]
    second = bearer(
        (await client.post("/api/sync/pairing-codes/redeem", json={"code": second_code}))
        .json()["device_token"]
    )
    await client.put("/api/sync/games/g1", json={"date": iso(1), "payload": replay()},
                     headers=first)

    clock.advance(100)
    await log_out(client, first)
    assert no_device_since(sync_db, pid) is None  # one device left

    clock.advance(100)
    await log_out(client, second)
    assert no_device_since(sync_db, pid) == clock.t
    assert count(sync_db, "sync_games", pid) == 1


async def test_a_repeated_create_logs_in_and_clears_the_clock(client, clock, sync_db):
    created = await keyed_create(client)
    pid = created["player_id"]
    await log_out(client, bearer(created["device_token"]))
    assert no_device_since(sync_db, pid) == clock.t

    clock.advance(DAY)
    again = await keyed_create(client)
    assert again["player_id"] == pid
    assert no_device_since(sync_db, pid) is None


async def test_a_redeemed_code_logs_in_and_clears_the_clock(client, clock, sync_db):
    created, auth = await new_player(client)
    pid = created["player_id"]
    code = (await client.post("/api/sync/pairing-codes", headers=auth)).json()["code"]
    await log_out(client, auth)
    assert no_device_since(sync_db, pid) == clock.t

    clock.advance(60)
    r = await client.post("/api/sync/pairing-codes/redeem", json={"code": code})
    assert r.status_code == 200
    assert no_device_since(sync_db, pid) is None


async def test_the_clock_restarts_from_the_latest_time_the_last_device_went(
    client, clock, sync_db
):
    t0 = clock.t
    created = await keyed_create(client)
    pid = created["player_id"]
    await log_out(client, bearer(created["device_token"]))
    clock.t = t0 + 20 * DAY
    again = await keyed_create(client)
    clock.t = t0 + 25 * DAY
    await log_out(client, bearer(again["device_token"]))
    assert no_device_since(sync_db, pid) == t0 + 25 * DAY

    assert await retention.run_cleanup(t0 + 31 * DAY) == 0
    assert exists(sync_db, pid)
    assert await retention.run_cleanup(t0 + 55 * DAY) == 1
    assert not exists(sync_db, pid)


async def test_revoking_an_unknown_token_changes_nothing(sync_db):
    created = await sync_storage.create_player("{}", 0)
    await sync_storage.revoke_device("not-a-real-token", 5)
    assert no_device_since(sync_db, created.player_id) is None


# ── The cleanup ──────────────────────────────────────────────────────


async def test_29_days_23_hours_is_kept_and_30_days_deletes_replays_and_codes(
    client, clock, sync_db, monkeypatch
):
    t0 = clock.t
    admin_body, admin_auth = await new_player(client)
    monkeypatch.setenv("SYNC_ADMIN_PLAYER_IDS", admin_body["player_id"])
    created, auth = await new_player(client)
    pid = created["player_id"]
    for n in range(3):
        await client.put(f"/api/sync/games/g{n}", json={"date": iso(n), "payload": replay()},
                         headers=auth)
    await log_out(client, auth)
    _, keeper = await new_player(client)  # a profile with a device, for contrast

    clock.t = t0 + 29 * DAY + 23 * 3600
    for _ in range(2):  # a cancelled code and a live one
        r = await client.post(
            f"/api/sync/admin/players/{pid}/pairing-codes",
            json={"expires_at": sync_storage.iso_utc(clock.t + 12 * 3600)},
            headers=admin_auth,
        )
        assert r.status_code == 201
    assert await retention.run_cleanup(clock.t) == 0
    assert exists(sync_db, pid)
    assert count(sync_db, "sync_games", pid) == 3
    assert count(sync_db, "sync_pairing_codes", pid) == 2

    clock.t = t0 + 30 * DAY
    assert await retention.run_cleanup(clock.t) == 1
    assert not exists(sync_db, pid)
    assert count(sync_db, "sync_games", pid) == 0
    assert count(sync_db, "sync_pairing_codes", pid) == 0
    assert (await client.get("/api/sync/state", headers=keeper)).status_code == 200
    assert (await client.get("/api/sync/state", headers=admin_auth)).status_code == 200


async def test_the_cleanup_spares_a_profile_with_a_device_whatever_its_timestamp(
    client, clock, sync_db
):
    created, auth = await new_player(client)
    pid = created["player_id"]
    # Not reachable through the routes (a login clears the timestamp in the
    # same transaction), so written by hand: the device row alone must keep
    # the profile.
    with sqlite3.connect(sync_db) as db:
        db.execute("UPDATE sync_players SET no_device_since = ? WHERE id = ?",
                   (clock.t - 90 * DAY, pid))
    assert await retention.run_cleanup(clock.t) == 0
    assert (await client.get("/api/sync/state", headers=auth)).status_code == 200


async def test_an_admin_created_profile_is_deleted_after_30_unused_days(client, clock, sync_db,
                                                                        monkeypatch):
    admin_body, admin_auth = await new_player(client)
    monkeypatch.setenv("SYNC_ADMIN_PLAYER_IDS", admin_body["player_id"])
    r = await client.post(
        "/api/sync/admin/players",
        json={"state": {"schema": 1, "ladder": {}, "lessons": [], "handle": [0, 0]}},
        headers=admin_auth,
    )
    pid = r.json()["player_id"]
    assert await retention.run_cleanup(clock.t + 30 * DAY - 1) == 0
    assert await retention.run_cleanup(clock.t + 30 * DAY) == 1
    assert not exists(sync_db, pid)


async def test_a_login_racing_the_cleanup_never_leaves_a_device_without_a_profile(sync_db):
    for _ in range(10):
        pid = await sync_storage.admin_create_player("{}", 0)
        code, _ = await sync_storage.mint_admin_pairing_code(pid, 0, 10**12)
        linked, deleted = await asyncio.gather(
            sync_storage.redeem_pairing_code(code, 31 * DAY),
            sync_storage.delete_abandoned_players(31 * DAY),
        )
        # Whichever ran first, the other saw its result whole.
        assert (linked is None) == (deleted == 1)
        with sqlite3.connect(sync_db) as db:
            orphans = db.execute(
                """SELECT COUNT(*) FROM sync_devices d WHERE NOT EXISTS
                   (SELECT 1 FROM sync_players p WHERE p.id = d.player_id)"""
            ).fetchone()[0]
        assert orphans == 0
        assert exists(sync_db, pid) == (linked is not None)


# ── Start-up: the migration and the stamp ────────────────────────────

# The schema as Revision 2.1 left it, before device ids and retention.
REVISION_2_SCHEMA = """
CREATE TABLE sync_players (
    id TEXT PRIMARY KEY, rev INTEGER NOT NULL, state TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, create_key_hash TEXT);
CREATE TABLE sync_devices (
    token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL, created_at TEXT NOT NULL,
    create_key_hash TEXT);
CREATE TABLE sync_games (
    player_id TEXT NOT NULL, game_id TEXT NOT NULL, date TEXT NOT NULL,
    payload TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (player_id, game_id));
CREATE TABLE sync_pairing_codes (
    code TEXT PRIMARY KEY, player_id TEXT NOT NULL, expires_at REAL NOT NULL,
    used INTEGER NOT NULL DEFAULT 0);
"""
OLD_TOKENS = ("old-token-one", "old-token-two")


def write_revision_2_file(path):
    with sqlite3.connect(path) as db:
        db.executescript(REVISION_2_SCHEMA)
        for pid in ("p-with-devices", "p-without"):
            db.execute(
                "INSERT INTO sync_players VALUES (?, 1, '{}', '2026-01-01T00:00:00Z', "
                "'2026-01-01T00:00:00Z', NULL)",
                (pid,),
            )
        for token in OLD_TOKENS:
            db.execute(
                "INSERT INTO sync_devices VALUES (?, 'p-with-devices', "
                "'2026-01-01T00:00:00Z', NULL)",
                (hashlib.sha256(token.encode()).hexdigest(),),
            )


async def test_startup_gives_old_devices_ids_and_stamps_old_deviceless_profiles(
    client, clock, tmp_path, monkeypatch
):
    old = tmp_path / "revision2.db"
    write_revision_2_file(old)
    monkeypatch.setattr(sync_storage, "DB_PATH", str(old))

    await sync_storage.init_sync_db(clock.t)
    with sqlite3.connect(old) as db:
        devices = db.execute(
            "SELECT device_id, last_seen_at FROM sync_devices ORDER BY rowid"
        ).fetchall()
    assert all(d for d, _ in devices) and len({d for d, _ in devices}) == 2
    assert [seen for _, seen in devices] == [None, None]
    assert no_device_since(old, "p-without") == clock.t
    assert no_device_since(old, "p-with-devices") is None

    # Running start-up again keeps the first stamp and the ids.
    await sync_storage.init_sync_db(clock.t + 1000)
    assert no_device_since(old, "p-without") == clock.t
    with sqlite3.connect(old) as db:
        again = db.execute(
            "SELECT device_id, last_seen_at FROM sync_devices ORDER BY rowid"
        ).fetchall()
    assert again == devices

    # An old token still works, reports its new id, and is seen from now on.
    auth = bearer(OLD_TOKENS[0])
    r = await client.get("/api/sync/state", headers=auth)
    assert r.status_code == 200
    assert r.json()["device_id"] == devices[0][0]
    with sqlite3.connect(old) as db:
        seen = db.execute("SELECT last_seen_at FROM sync_devices ORDER BY rowid").fetchall()
    assert seen == [(clock.t,), (None,)]


@pytest.fixture
def startup(tmp_path, monkeypatch):
    """Every store in one temp file, and the routes' clock faked, so the
    lifespan's start-up stamp and cleanup run on the test's clock."""
    shared = tmp_path / "goforkids.db"
    for module in (game_storage, uploads_storage, sync_storage):
        monkeypatch.setattr(module, "DB_PATH", str(shared))
    clock = FakeClock()
    app.dependency_overrides[sync_router.current_time] = clock
    yield shared, clock
    app.dependency_overrides.pop(sync_router.current_time, None)


async def test_the_cleanup_runs_at_startup_on_the_routes_clock(startup):
    db_path, clock = startup
    t0 = clock.t
    await sync_storage.init_sync_db(t0)
    abandoned = await sync_storage.admin_create_player("{}", t0 - 30 * DAY)
    recent = await sync_storage.admin_create_player("{}", t0 - 29 * DAY)
    with sqlite3.connect(db_path) as db:
        db.execute("INSERT INTO sync_players (id, rev, state, created_at, updated_at) "
                   "VALUES ('p-unstamped', 1, '{}', 't', 't')")

    async with lifespan(app):
        assert not exists(db_path, abandoned)
        assert exists(db_path, recent)
        assert no_device_since(db_path, "p-unstamped") == t0

    clock.t = t0 + 30 * DAY
    async with lifespan(app):
        assert not exists(db_path, "p-unstamped")


async def test_the_cleanup_runs_every_24_hours_until_shutdown(startup, monkeypatch):
    db_path, clock = startup
    t0 = clock.t
    await sync_storage.init_sync_db(t0)
    tomorrow = await sync_storage.admin_create_player("{}", t0 - 29 * DAY)
    day_after = await sync_storage.admin_create_player("{}", t0 - 28 * DAY)

    sleeps = []
    third_sleep = asyncio.Event()
    cancelled = asyncio.Event()

    async def fake_sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) < 3:
            clock.advance(seconds)
            return
        third_sleep.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    runs = []
    real_cleanup = sync_storage.delete_abandoned_players

    async def recorded(now):
        runs.append(now)
        return await real_cleanup(now)

    monkeypatch.setattr(retention, "_sleep", fake_sleep)
    monkeypatch.setattr(sync_storage, "delete_abandoned_players", recorded)
    async with lifespan(app):
        assert exists(db_path, tomorrow)
        await asyncio.wait_for(third_sleep.wait(), 5)
        assert sleeps == [DAY, DAY, DAY]
        # Once at start-up, then once after each day.
        assert runs == [t0, t0 + DAY, t0 + 2 * DAY]
        assert not exists(db_path, tomorrow)
        assert not exists(db_path, day_after)
        assert not cancelled.is_set()
    assert cancelled.is_set()


async def test_a_failed_daily_cleanup_is_logged_and_tried_again(monkeypatch, caplog):
    runs = []

    async def flaky(now):
        runs.append(now)
        if len(runs) == 1:
            raise RuntimeError("database is locked")
        return 0

    done = asyncio.Event()

    async def fake_sleep(seconds):
        if len(runs) == 2:
            done.set()
            await asyncio.Event().wait()

    monkeypatch.setattr(sync_storage, "delete_abandoned_players", flaky)
    monkeypatch.setattr(retention, "_sleep", fake_sleep)
    task = asyncio.create_task(retention.cleanup_daily(lambda: 42.0))
    await asyncio.wait_for(done.wait(), 5)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert runs == [42.0, 42.0]
    assert "Sync cleanup failed" in caplog.text
