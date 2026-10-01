"""Sync storage: database location, startup, token hashing, atomic writes."""

import asyncio
import hashlib
import sqlite3

import app.game.storage as game_storage
import app.sync.storage as sync_storage
import app.uploads.storage as uploads_storage
from app.main import app, lifespan
from tests.sync_helpers import new_player

SYNC_TABLES = {"sync_players", "sync_devices", "sync_games", "sync_pairing_codes"}


def _tables(path):
    with sqlite3.connect(path) as db:
        return {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


def test_db_path_prefers_sync_db_then_main_db_then_default():
    resolve = sync_storage.resolve_db_path
    assert resolve({"GOFORKIDS_SYNC_DB": "/a.db", "GOFORKIDS_DB": "/b.db"}) == "/a.db"
    assert resolve({"GOFORKIDS_SYNC_DB": "", "GOFORKIDS_DB": "/b.db"}) == "/b.db"
    assert resolve({"GOFORKIDS_DB": "/b.db"}) == "/b.db"
    assert resolve({}) == "goforkids.db"


async def test_startup_creates_sync_tables_beside_the_legacy_ones(tmp_path, monkeypatch):
    shared = str(tmp_path / "goforkids.db")
    monkeypatch.setattr(game_storage, "DB_PATH", shared)
    monkeypatch.setattr(uploads_storage, "DB_PATH", shared)
    monkeypatch.setattr(sync_storage, "DB_PATH", shared)

    async with lifespan(app):
        pass

    tables = _tables(shared)
    assert SYNC_TABLES <= tables
    assert {"players", "games", "active_games", "uploaded_games"} <= tables
    with sqlite3.connect(shared) as db:
        legacy_players = [r[1] for r in db.execute("PRAGMA table_info(players)")]
    assert legacy_players == [
        "id", "name", "rating_mu", "rating_phi", "rating_sigma", "games_played", "created_at"
    ]

    # Running startup again on an existing file is harmless.
    async with lifespan(app):
        pass


async def test_tokens_are_stored_only_as_sha256(client, sync_db):
    body, auth = await new_player(client)
    code = (await client.post("/api/sync/pairing-codes", headers=auth)).json()["code"]
    second = (
        await client.post("/api/sync/pairing-codes/redeem", json={"code": code})
    ).json()["device_token"]

    raw = sync_db.read_bytes()
    for token in (body["device_token"], second):
        assert token.encode() not in raw
    with sqlite3.connect(sync_db) as db:
        hashes = {r[0] for r in db.execute("SELECT token_hash FROM sync_devices")}
    assert hashes == {
        hashlib.sha256(t.encode()).hexdigest() for t in (body["device_token"], second)
    }


async def test_compare_and_write_admits_one_of_many_concurrent_writers(sync_db):
    player_id, _ = await sync_storage.create_player("{}", 0)
    results = await asyncio.gather(
        *(sync_storage.put_state(player_id, 1, f'{{"n":{i}}}', 1) for i in range(8))
    )
    winners = [r for r in results if r[0]]
    assert len(winners) == 1
    assert all(rev == 2 for _, rev, _ in results)
    # Every loser saw the winner's state, not its own.
    assert {state for _, _, state in results} == {winners[0][2]}


async def test_concurrent_redeems_of_one_code_link_one_device(sync_db):
    player_id, _ = await sync_storage.create_player("{}", 0)
    code, _ = await sync_storage.mint_pairing_code(player_id, 0)
    results = await asyncio.gather(
        *(sync_storage.redeem_pairing_code(code, 1) for _ in range(6))
    )
    assert sum(r is not None for r in results) == 1
    with sqlite3.connect(sync_db) as db:
        assert db.execute("SELECT COUNT(*) FROM sync_devices").fetchone()[0] == 2


async def test_minting_clears_expired_codes(sync_db):
    player_id, _ = await sync_storage.create_player("{}", 0)
    await sync_storage.mint_pairing_code(player_id, 0)
    await sync_storage.mint_pairing_code(player_id, 10_000)
    with sqlite3.connect(sync_db) as db:
        rows = db.execute("SELECT used FROM sync_pairing_codes").fetchall()
    assert rows == [(0,)]
