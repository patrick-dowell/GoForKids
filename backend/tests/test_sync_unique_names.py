"""Sync, plan 32 Revision 6: a generated name is unique across profiles.

`sync_players.handle` mirrors the state's handle as "a,n" under a unique
index. A create, a state write or an admin create whose name another profile
holds answers 409 `{"detail": "handle_taken"}`; keeping a profile's own name
is fine. The check and the write share one transaction. At start-up, a file
written before this revision gets the column filled; where two profiles
already share a name, the one created first keeps it.
"""

import asyncio
import hashlib
import json
import sqlite3

import pytest

import app.sync.storage as sync_storage
from tests.sync_helpers import bearer, new_player, rev_and_state

ADMIN = "/api/sync/admin"
TAKEN = {"detail": "handle_taken"}
KEY = "device-made-key_0123456789"


def named(a: int, n: int, **extra) -> dict:
    return {"schema": 1, "ladder": {}, "lessons": [], "avatar": "comet", "handle": [a, n], **extra}


async def create(client, state, key=None):
    body = {"state": state}
    if key is not None:
        body["create_key"] = key
    return await client.post("/api/sync/players", json=body)


async def put(client, auth, base_rev, state):
    return await client.put("/api/sync/state", json={"base_rev": base_rev, "state": state}, headers=auth)


def column(db_path) -> dict:
    with sqlite3.connect(db_path) as db:
        return dict(db.execute("SELECT id, handle FROM sync_players"))


def count_players(db_path) -> int:
    with sqlite3.connect(db_path) as db:
        return db.execute("SELECT COUNT(*) FROM sync_players").fetchone()[0]


# ── POST /players ────────────────────────────────────────────────────


async def test_create_with_a_name_another_profile_holds_is_409_and_makes_nothing(client, sync_db):
    first = await create(client, named(3, 13))
    assert first.status_code == 201
    again = await create(client, named(3, 13, avatar="nova"))
    assert again.status_code == 409
    assert again.json() == TAKEN
    assert count_players(sync_db) == 1
    # Either word alone is no clash: only the pair is the name.
    assert (await create(client, named(3, 14))).status_code == 201
    assert (await create(client, named(4, 13))).status_code == 201


async def test_creates_without_a_name_never_clash(client, sync_db):
    for _ in range(3):
        assert (await create(client, {"schema": 1})).status_code == 201
    assert set(column(sync_db).values()) == {None}


async def test_the_column_mirrors_the_state(client, sync_db):
    body, auth = await new_player(client, named(3, 13))
    assert column(sync_db) == {body["player_id"]: "3,13"}
    assert (await put(client, auth, 1, named(0, 63))).json() == {"rev": 2}
    assert column(sync_db) == {body["player_id"]: "0,63"}
    assert (await put(client, auth, 2, {"schema": 1})).json() == {"rev": 3}
    assert column(sync_db) == {body["player_id"]: None}


async def test_a_refused_name_leaves_the_create_key_unused(client, sync_db):
    """A 409 made nothing, so the device retries under the same key with
    another name, and a repeat of that retry is still the same profile."""
    await create(client, named(3, 13))
    refused = await create(client, named(3, 13), key=KEY)
    assert refused.status_code == 409
    retried = await create(client, named(9, 9), key=KEY)
    assert retried.status_code == 201
    repeat = await create(client, named(9, 9), key=KEY)
    assert repeat.status_code == 200
    assert repeat.json()["player_id"] == retried.json()["player_id"]
    assert count_players(sync_db) == 2


async def test_a_repeat_is_answered_whatever_name_it_carries(client):
    """A repeat ignores its state, so its own name, or one another profile
    took since, never turns it into a 409."""
    made = (await create(client, named(9, 9), key=KEY)).json()
    assert (await create(client, named(9, 9), key=KEY)).status_code == 200
    await create(client, named(3, 13))
    repeat = await create(client, named(3, 13), key=KEY)
    assert repeat.status_code == 200
    assert repeat.json()["player_id"] == made["player_id"]
    assert repeat.json()["state"]["handle"] == [9, 9]


# ── PUT /state ───────────────────────────────────────────────────────


async def test_keeping_its_own_name_is_fine(client):
    _, auth = await new_player(client, named(3, 13))
    r = await put(client, auth, 1, named(3, 13, lessons=["capture"]))
    assert r.status_code == 200
    assert r.json() == {"rev": 2}


async def test_taking_another_profiles_name_is_409_and_writes_nothing(client):
    await new_player(client, named(3, 13))
    _, auth = await new_player(client, named(5, 5))
    r = await put(client, auth, 1, named(3, 13, lessons=["capture"]))
    assert r.status_code == 409
    assert r.json() == TAKEN
    r = await client.get("/api/sync/state", headers=auth)
    assert rev_and_state(r) == {"rev": 1, "state": named(5, 5)}
    # A free name lands on the same revision.
    assert (await put(client, auth, 1, named(6, 6))).json() == {"rev": 2}


async def test_a_stale_revision_is_the_revision_conflict_whatever_the_name(client):
    await new_player(client, named(3, 13))
    _, auth = await new_player(client, named(5, 5))
    await put(client, auth, 1, named(5, 5, lessons=["capture"]))
    r = await put(client, auth, 1, named(3, 13))
    assert r.status_code == 409
    assert r.json() == {"rev": 2, "state": named(5, 5, lessons=["capture"])}


async def test_a_name_given_up_is_free_again(client):
    _, a = await new_player(client, named(3, 13))
    _, b = await new_player(client, named(5, 5))
    assert (await put(client, b, 1, named(3, 13))).status_code == 409
    assert (await put(client, a, 1, named(8, 8))).status_code == 200  # renamed
    assert (await put(client, b, 1, named(3, 13))).status_code == 200
    # A state without a name frees it too.
    assert (await put(client, b, 2, {"schema": 1})).status_code == 200
    assert (await create(client, named(3, 13))).status_code == 201


# ── POST /admin/players ──────────────────────────────────────────────


@pytest.fixture
async def admin(client, monkeypatch):
    body, auth = await new_player(client, named(0, 0))
    monkeypatch.setenv("SYNC_ADMIN_PLAYER_IDS", body["player_id"])
    return auth


def fresh(a: int, n: int) -> dict:
    return {"schema": 1, "ladder": {"byBoardSize": {}}, "lessons": [], "avatar": "blackhole",
            "avatarPicked": False, "handle": [a, n]}


async def test_admin_create_with_a_taken_name_is_409_and_makes_nothing(client, admin, sync_db):
    await new_player(client, named(3, 13))
    before = count_players(sync_db)
    r = await client.post(f"{ADMIN}/players", json={"state": fresh(3, 13)}, headers=admin)
    assert r.status_code == 409
    assert r.json() == TAKEN
    # The admin's own profile's name is another profile's name too.
    r = await client.post(f"{ADMIN}/players", json={"state": fresh(0, 0)}, headers=admin)
    assert r.json() == TAKEN
    assert count_players(sync_db) == before
    r = await client.post(f"{ADMIN}/players", json={"state": fresh(3, 14)}, headers=admin)
    assert r.status_code == 201


async def test_a_name_an_admin_gave_is_taken_for_everyone_else(client, admin):
    r = await client.post(f"{ADMIN}/players", json={"state": fresh(12, 21)}, headers=admin)
    assert r.status_code == 201
    assert (await create(client, named(12, 21))).json() == TAKEN
    r = await client.post(f"{ADMIN}/players", json={"state": fresh(12, 21)}, headers=admin)
    assert r.json() == TAKEN


async def test_the_403_still_comes_before_the_name(client, admin):
    await new_player(client, named(3, 13))
    _, stranger = await new_player(client, named(1, 1))
    r = await client.post(f"{ADMIN}/players", json={"state": fresh(3, 13)}, headers=stranger)
    assert r.status_code == 403


# ── Concurrency: the check and the write are one transaction ─────────


def outcomes(results) -> tuple[list, list]:
    """(successes, refusals); anything else (an IntegrityError from the
    index, say) fails the test, since it means the check raced the write."""
    wins = [r for r in results if not isinstance(r, BaseException)]
    losses = [r for r in results if isinstance(r, BaseException)]
    for loss in losses:
        assert isinstance(loss, sync_storage.HandleTaken), repr(loss)
    return wins, losses


async def test_concurrent_creates_with_one_name_make_one_player(sync_db):
    state = json.dumps(named(3, 13))
    results = await asyncio.gather(
        *(sync_storage.create_player(state, 0) for _ in range(8)), return_exceptions=True
    )
    wins, losses = outcomes(results)
    assert (len(wins), len(losses)) == (1, 7)
    assert count_players(sync_db) == 1


async def test_concurrent_admin_creates_with_one_name_make_one_player(sync_db):
    state = json.dumps(fresh(3, 13))
    results = await asyncio.gather(
        *(sync_storage.admin_create_player(state, 0) for _ in range(8)), return_exceptions=True
    )
    wins, losses = outcomes(results)
    assert (len(wins), len(losses)) == (1, 7)
    assert count_players(sync_db) == 1


async def test_concurrent_renames_to_one_name_admit_one(sync_db):
    ids = [
        (await sync_storage.create_player(json.dumps(named(n, 0)), 0)).player_id
        for n in range(8)
    ]
    target = json.dumps(named(3, 13))
    results = await asyncio.gather(
        *(sync_storage.put_state(pid, 1, target, 1) for pid in ids), return_exceptions=True
    )
    wins, losses = outcomes(results)
    assert (len(wins), len(losses)) == (1, 7)
    assert all(written for written, _, _ in wins)
    assert list(column(sync_db).values()).count("3,13") == 1


async def test_concurrent_http_creates_with_one_name(client, sync_db):
    replies = await asyncio.gather(*(create(client, named(3, 13)) for _ in range(5)))
    assert sorted(r.status_code for r in replies) == [201, 409, 409, 409, 409]
    assert [r.json() for r in replies if r.status_code == 409] == [TAKEN] * 4
    assert count_players(sync_db) == 1


# ── Start-up on a file written before this revision ──────────────────

# The schema the build before Revision 6 wrote (dumped from its start-up).
SCHEMA_BEFORE = """
CREATE TABLE sync_players (
    id TEXT PRIMARY KEY, rev INTEGER NOT NULL, state TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    create_key_hash TEXT, no_device_since REAL, friend_code TEXT);
CREATE TABLE sync_devices (
    token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL, created_at TEXT NOT NULL,
    create_key_hash TEXT, device_id TEXT, last_seen_at REAL, kind TEXT);
CREATE TABLE sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sync_games (
    player_id TEXT NOT NULL, game_id TEXT NOT NULL, date TEXT NOT NULL,
    payload TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (player_id, game_id));
CREATE INDEX sync_games_by_date ON sync_games (player_id, date DESC, game_id DESC);
CREATE TABLE sync_pairing_codes (
    code TEXT PRIMARY KEY, player_id TEXT NOT NULL, expires_at REAL NOT NULL,
    used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sync_friendships (
    requester_id TEXT NOT NULL, addressee_id TEXT NOT NULL, status TEXT NOT NULL,
    created_at REAL NOT NULL, updated_at REAL NOT NULL,
    PRIMARY KEY (requester_id, addressee_id));
CREATE INDEX sync_friendships_by_addressee ON sync_friendships (addressee_id, status);
CREATE UNIQUE INDEX sync_players_by_create_key ON sync_players (create_key_hash);
CREATE INDEX sync_devices_by_create_key ON sync_devices (create_key_hash);
CREATE UNIQUE INDEX sync_devices_by_device_id ON sync_devices (device_id);
CREATE UNIQUE INDEX sync_players_by_friend_code ON sync_players (friend_code);
"""

STARTUP = 1_800_000_000.0
OLD_STAMP = "2026-09-20T00:00:00Z"


def old_file(path, players, devices=()):
    """players: (id, rev, state or None, created_at), inserted in this order."""
    with sqlite3.connect(path) as db:
        db.executescript(SCHEMA_BEFORE)
        for i, (pid, rev, state, created_at) in enumerate(players):
            state_json = json.dumps(state, separators=(",", ":"))
            db.execute(
                """INSERT INTO sync_players
                   (id, rev, state, created_at, updated_at, friend_code)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (pid, rev, state_json, created_at, OLD_STAMP, f"FC{i:06d}"),
            )
        for i, (token, pid) in enumerate(devices):
            db.execute(
                """INSERT INTO sync_devices (token_hash, player_id, created_at, device_id)
                   VALUES (?, ?, ?, ?)""",
                (hashlib.sha256(token.encode()).hexdigest(), pid, OLD_STAMP, f"dev-{i}"),
            )


def rows(path) -> dict:
    """Each player's rev, state, updated_at and (once the column exists)
    handle column."""
    with sqlite3.connect(path) as db:
        columns = {r[1] for r in db.execute("PRAGMA table_info(sync_players)")}
        handle = "handle" if "handle" in columns else "NULL"
        return {
            r[0]: {"rev": r[1], "state": r[2], "updated_at": r[3], "handle": r[4]}
            for r in db.execute(f"SELECT id, rev, state, updated_at, {handle} FROM sync_players")
        }


async def test_startup_on_an_older_file_with_shared_names(client, tmp_path, monkeypatch):
    old = tmp_path / "before-revision-6.db"
    old_file(
        old,
        [
            # Inserted out of creation order: the earliest-created keeps a name.
            ("p-late", 4, named(3, 13, lessons=["late"]), "2026-09-03T00:00:00Z"),
            ("p-early", 2, named(3, 13, lessons=["early"]), "2026-09-01T00:00:00Z"),
            # Created in the same second: the first inserted keeps it.
            ("p-tie-a", 1, named(7, 7), "2026-09-02T00:00:00Z"),
            ("p-tie-b", 9, named(7, 7, avatar="nova"), "2026-09-02T00:00:00Z"),
            ("p-solo", 3, named(5, 5), "2026-09-04T00:00:00Z"),
            ("p-nameless", 1, {"schema": 1, "lessons": []}, "2026-09-05T00:00:00Z"),
        ],
        devices=[("token-of-a-late-device", "p-late")],
    )
    before = rows(old)
    monkeypatch.setattr(sync_storage, "DB_PATH", str(old))

    await sync_storage.init_sync_db(STARTUP)
    after = rows(old)

    kept = {"p-early": "3,13", "p-tie-a": "7,7", "p-solo": "5,5", "p-nameless": None}
    for pid, handle in kept.items():
        assert after[pid]["handle"] == handle
        assert {k: after[pid][k] for k in ("rev", "state", "updated_at")} == {
            k: before[pid][k] for k in ("rev", "state", "updated_at")
        }
    renamed = {pid: after[pid] for pid in ("p-late", "p-tie-b")}
    new_names = {r["handle"] for r in renamed.values()}
    assert len(new_names) == 2
    assert not new_names & {"3,13", "7,7", "5,5"}
    for pid, row in renamed.items():
        state, old_state = json.loads(row["state"]), json.loads(before[pid]["state"])
        assert row["handle"] == "{},{}".format(*state["handle"])
        assert {k: v for k, v in state.items() if k != "handle"} == {
            k: v for k, v in old_state.items() if k != "handle"
        }
        assert row["rev"] == before[pid]["rev"] + 1
        assert row["updated_at"] == sync_storage.iso_utc(STARTUP)

    # The renamed profile's device finds the server ahead, with the new name.
    r = await client.get("/api/sync/state", headers=bearer("token-of-a-late-device"))
    assert rev_and_state(r) == {"rev": 5, "state": json.loads(renamed["p-late"]["state"])}

    # Start-up again changes nothing, and the index now holds the rule.
    await sync_storage.init_sync_db(STARTUP + 60)
    assert rows(old) == after
    with sqlite3.connect(old) as db, pytest.raises(sqlite3.IntegrityError):
        db.execute("UPDATE sync_players SET handle = '3,13' WHERE id = 'p-solo'")
    assert (await create(client, named(7, 7))).json() == TAKEN
    assert (await create(client, named(2, 2))).status_code == 201


async def test_startup_on_an_older_file_without_shared_names_changes_no_state(
    client, tmp_path, monkeypatch
):
    old = tmp_path / "before-revision-6.db"
    old_file(
        old,
        [
            ("p-a", 3, named(3, 13), "2026-09-01T00:00:00Z"),
            ("p-b", 1, named(13, 3), "2026-09-01T00:00:00Z"),
            ("p-c", 7, named(0, 63, avatar="nova"), "2026-09-02T00:00:00Z"),
            ("p-nameless", 2, {"schema": 1}, "2026-09-03T00:00:00Z"),
        ],
    )
    before = rows(old)
    monkeypatch.setattr(sync_storage, "DB_PATH", str(old))

    await sync_storage.init_sync_db(STARTUP)
    after = rows(old)

    assert {pid: r["handle"] for pid, r in after.items()} == {
        "p-a": "3,13", "p-b": "13,3", "p-c": "0,63", "p-nameless": None,
    }
    for pid in before:
        assert {k: after[pid][k] for k in ("rev", "state", "updated_at")} == {
            k: before[pid][k] for k in ("rev", "state", "updated_at")
        }
    assert (await create(client, named(3, 13))).json() == TAKEN
