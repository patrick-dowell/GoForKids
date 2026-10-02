"""Sync: a create that can be repeated safely (POST /players with create_key)."""

import asyncio
import hashlib
import sqlite3

import pytest

import app.sync.storage as sync_storage
from tests.sync_helpers import DEFAULT_STATE, bearer, new_player

KEY = "device-made-key_0123456789"
OTHER_KEY = "another-device-key-ABCDEFGH"


async def _create(client, key=KEY, state=None):
    body = {"state": DEFAULT_STATE if state is None else state}
    if key is not None:
        body["create_key"] = key
    return await client.post("/api/sync/players", json=body)


def _count(db_path, table):
    with sqlite3.connect(db_path) as db:
        return db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


async def _works(client, token):
    r = await client.get("/api/sync/state", headers=bearer(token))
    assert r.status_code in (200, 401), r.text
    return r.status_code == 200


async def test_repeat_returns_the_same_player_with_200_and_makes_no_second(client, sync_db):
    first = await _create(client)
    assert first.status_code == 201
    repeat = await _create(client)
    assert repeat.status_code == 200
    body = repeat.json()
    assert set(body) == {"player_id", "device_token", "rev", "state"}
    assert body["player_id"] == first.json()["player_id"]
    assert _count(sync_db, "sync_players") == 1


async def test_repeat_revokes_the_first_token_and_issues_a_working_one(client):
    first = (await _create(client)).json()
    repeat = (await _create(client)).json()
    assert repeat["device_token"] != first["device_token"]
    assert not await _works(client, first["device_token"])
    assert await _works(client, repeat["device_token"])


async def test_three_repeats_leave_one_player_and_one_working_token(client, sync_db):
    tokens = [(await _create(client)).json()["device_token"] for _ in range(4)]
    assert _count(sync_db, "sync_players") == 1
    assert [await _works(client, t) for t in tokens] == [False, False, False, True]
    assert _count(sync_db, "sync_devices") == 1


async def test_repeat_returns_current_rev_and_state_and_ignores_the_sent_state(client):
    first = (await _create(client)).json()
    auth = bearer(first["device_token"])
    moved = {"schema": 1, "lessons": ["intro", "capture"], "handle": [4, 9]}
    r = await client.put("/api/sync/state", json={"base_rev": 1, "state": moved}, headers=auth)
    assert r.json() == {"rev": 2}

    repeat = await _create(client, state={"schema": 1, "lessons": ["stale-device-copy"]})
    assert repeat.status_code == 200
    assert repeat.json()["rev"] == 2
    assert repeat.json()["state"] == moved
    r = await client.get("/api/sync/state", headers=bearer(repeat.json()["device_token"]))
    assert r.json() == {"rev": 2, "state": moved}


async def test_concurrent_creates_with_one_key_make_one_player(client, sync_db):
    replies = await asyncio.gather(*(_create(client) for _ in range(5)))
    assert sorted(r.status_code for r in replies) == [200, 200, 200, 200, 201]
    assert len({r.json()["player_id"] for r in replies}) == 1
    assert _count(sync_db, "sync_players") == 1
    working = [await _works(client, r.json()["device_token"]) for r in replies]
    assert working.count(True) == 1


async def test_repeat_leaves_tokens_from_pairing_codes_alone(client):
    first = (await _create(client)).json()
    code = (
        await client.post("/api/sync/pairing-codes", headers=bearer(first["device_token"]))
    ).json()["code"]
    linked = (await client.post("/api/sync/pairing-codes/redeem", json={"code": code})).json()

    await _create(client)
    assert await _works(client, linked["device_token"])
    assert not await _works(client, first["device_token"])


async def test_different_keys_make_different_players(client, sync_db):
    a = (await _create(client, KEY)).json()
    b = (await _create(client, OTHER_KEY)).json()
    assert a["player_id"] != b["player_id"]
    assert await _works(client, a["device_token"])
    assert _count(sync_db, "sync_players") == 2


async def test_keyless_create_makes_a_new_player_each_time(client, sync_db):
    keyed = (await _create(client)).json()
    replies = [await _create(client, key=None) for _ in range(3)]
    assert [r.status_code for r in replies] == [201, 201, 201]
    ids = {r.json()["player_id"] for r in replies} | {keyed["player_id"]}
    assert len(ids) == 4
    assert _count(sync_db, "sync_players") == 4
    assert await _works(client, keyed["device_token"])


@pytest.mark.parametrize(
    "key",
    [
        "a" * 15,
        "a" * 65,
        "",
        "has space in the key",
        "has!punctuation!here",
        "accented-key-éééé",
        "a" * 16 + "\n",
        1234567890123456789,
        None,
        ["a" * 16],
        {"key": "a" * 16},
    ],
)
async def test_bad_key_shape_is_422(client, sync_db, key):
    r = await client.post("/api/sync/players", json={"state": DEFAULT_STATE, "create_key": key})
    assert r.status_code == 422
    assert _count(sync_db, "sync_players") == 0


@pytest.mark.parametrize("key", ["A" * 16, "z" * 64, "0123456789-_abCD"])
async def test_key_length_and_alphabet_bounds_are_accepted(client, key):
    assert (await _create(client, key)).status_code == 201
    assert (await _create(client, key)).status_code == 200


async def test_key_is_stored_only_as_sha256(client, sync_db):
    first = (await _create(client)).json()
    await _create(client)
    assert KEY.encode() not in sync_db.read_bytes()
    digest = hashlib.sha256(KEY.encode()).hexdigest()
    with sqlite3.connect(sync_db) as db:
        players = db.execute("SELECT id, create_key_hash FROM sync_players").fetchall()
        devices = db.execute("SELECT create_key_hash FROM sync_devices").fetchall()
    assert players == [(first["player_id"], digest)]
    assert devices == [(digest,)]


async def test_a_repeat_with_an_invalid_state_is_still_refused(client):
    await _create(client)
    r = await _create(client, state={"schema": 1, "displayName": "typed"})
    assert r.status_code == 422


async def test_repeats_count_toward_the_create_limit(client):
    for _ in range(60):
        assert (await _create(client)).status_code in (200, 201)
    assert (await _create(client)).status_code == 429
    assert (await _create(client, key=None)).status_code == 429


# ── A file written by the earlier schema ─────────────────────────────

PREVIOUS_SCHEMA = """
CREATE TABLE sync_players (
    id TEXT PRIMARY KEY, rev INTEGER NOT NULL, state TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE sync_devices (
    token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE sync_games (
    player_id TEXT NOT NULL, game_id TEXT NOT NULL, date TEXT NOT NULL,
    payload TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (player_id, game_id));
CREATE INDEX sync_games_by_date ON sync_games (player_id, date DESC, game_id DESC);
CREATE TABLE sync_pairing_codes (
    code TEXT PRIMARY KEY, player_id TEXT NOT NULL, expires_at REAL NOT NULL,
    used INTEGER NOT NULL DEFAULT 0);
"""


async def test_startup_upgrades_a_file_from_the_previous_schema(client, tmp_path, monkeypatch):
    old = tmp_path / "previous.db"
    old_token = "token-issued-by-the-previous-build"
    with sqlite3.connect(old) as db:
        db.executescript(PREVIOUS_SCHEMA)
        db.execute(
            "INSERT INTO sync_players VALUES ('p-old', 3, '{\"lessons\":[\"kept\"]}', 't', 't')"
        )
        db.execute(
            "INSERT INTO sync_devices VALUES (?, 'p-old', 't')",
            (hashlib.sha256(old_token.encode()).hexdigest(),),
        )
    monkeypatch.setattr(sync_storage, "DB_PATH", str(old))

    await sync_storage.init_sync_db()
    await sync_storage.init_sync_db()  # and again, on the upgraded file

    r = await client.get("/api/sync/state", headers=bearer(old_token))
    assert r.json() == {"rev": 3, "state": {"lessons": ["kept"]}}

    first = await _create(client)
    repeat = await _create(client)
    assert (first.status_code, repeat.status_code) == (201, 200)
    assert repeat.json()["player_id"] == first.json()["player_id"]
    _, auth = await new_player(client)
    assert (await client.get("/api/sync/state", headers=auth)).status_code == 200
    assert await _works(client, old_token)
