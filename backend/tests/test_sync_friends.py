"""Sync friends (plan 32, Revision 4): friend codes, requests, the lists, the
card, removal, the request limits, and the cleanup of a profile's rows."""

import hashlib
import json
import re
import sqlite3
import uuid

import pytest

import app.sync.storage as sync_storage
from app.sync import retention
from app.uploads.storage import SHARE_ID_ALPHABET
from tests.sync_helpers import bearer, new_player

HOUR = 3600
DAY = 24 * HOUR
CODE_RE = re.compile(f"^[{SHARE_ID_ALPHABET}]{{8}}$")
JSON = {"Content-Type": "application/json"}
NOT_FOUND = {"detail": "Not Found"}
# Made-up ids for players that do not exist.
UNKNOWN_ID = "0b6f7a52-9d1e-4c3b-8a2f-5e4d3c2b1a09"


# ── Helpers ──────────────────────────────────────────────────────────


async def code_of(client, auth) -> str:
    r = await client.get("/api/sync/friends/code", headers=auth)
    assert r.status_code == 200, r.text
    return r.json()["code"]


async def send(client, auth, code, headers=None):
    return await client.post(
        "/api/sync/friends/requests", json={"code": code}, headers={**auth, **(headers or {})}
    )


async def lists(client, auth) -> dict:
    r = await client.get("/api/sync/friends", headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


async def accept(client, auth, player_id):
    return await client.post(f"/api/sync/friends/requests/{player_id}/accept", headers=auth)


async def decline(client, auth, player_id):
    return await client.post(f"/api/sync/friends/requests/{player_id}/decline", headers=auth)


async def card(client, auth, player_id):
    return await client.get(f"/api/sync/friends/{player_id}", headers=auth)


async def remove(client, auth, player_id):
    return await client.delete(f"/api/sync/friends/{player_id}", headers=auth)


async def player(client, state=None):
    """(player_id, auth) for a new profile."""
    body, auth = await new_player(client, state)
    return body["player_id"], auth


async def request_from(client, sender, addressee):
    """sender (id, auth) asks addressee (id, auth) by addressee's code."""
    r = await send(client, sender[1], await code_of(client, addressee[1]))
    assert r.status_code == 202, r.text


async def befriend(client, a, b):
    await request_from(client, a, b)
    assert (await accept(client, b[1], a[0])).status_code == 204


def rows(db_path) -> set:
    with sqlite3.connect(db_path) as db:
        return set(db.execute(
            "SELECT requester_id, addressee_id, status FROM sync_friendships"
        ).fetchall())


def ids(entries) -> list:
    return [e["player_id"] for e in entries]


def write_state(db_path, player_id, state) -> None:
    """A stored state the routes would refuse (a bad handle), or any other,
    written straight to the file."""
    with sqlite3.connect(db_path) as db:
        db.execute(
            "UPDATE sync_players SET state = ? WHERE id = ?", (json.dumps(state), player_id)
        )


def codes_from(monkeypatch, codes):
    """Make new_friend_code return these codes in turn."""
    pending = list(codes)
    monkeypatch.setattr(sync_storage, "new_friend_code", lambda: pending.pop(0))
    return pending


# ── Friend codes ─────────────────────────────────────────────────────


async def test_a_created_profile_has_its_own_code_of_the_alphabet(client):
    _, a = await player(client)
    _, b = await player(client)
    first, second = await code_of(client, a), await code_of(client, b)
    assert CODE_RE.match(first) and CODE_RE.match(second)
    assert first != second
    r = await client.get("/api/sync/friends/code", headers=a)
    assert r.json() == {"code": first}


async def test_an_admin_created_profile_has_a_code(client, monkeypatch, sync_db):
    admin_id, admin = await player(client)
    monkeypatch.setenv("SYNC_ADMIN_PLAYER_IDS", admin_id)
    r = await client.post(
        "/api/sync/admin/players",
        json={"state": {"schema": 1, "ladder": {}, "lessons": [], "handle": [1, 2]}},
        headers=admin,
    )
    pid = r.json()["player_id"]
    with sqlite3.connect(sync_db) as db:
        stored = db.execute("SELECT friend_code FROM sync_players WHERE id = ?",
                            (pid,)).fetchone()[0]
    assert CODE_RE.match(stored)
    assert stored != await code_of(client, admin)


async def test_two_profiles_cannot_hold_one_code(client, sync_db):
    a_id, a = await player(client)
    b_id, _ = await player(client)
    taken = await code_of(client, a)
    with sqlite3.connect(sync_db) as db, pytest.raises(sqlite3.IntegrityError):
        db.execute("UPDATE sync_players SET friend_code = ? WHERE id = ?", (taken, b_id))


async def test_new_code_replaces_the_old_one_at_once(client, sync_db):
    a_id, a = await player(client)
    _, b = await player(client)
    old = await code_of(client, a)

    r = await client.post("/api/sync/friends/code", headers=a)
    assert r.status_code == 201
    new = r.json()["code"]
    assert set(r.json()) == {"code"}
    assert CODE_RE.match(new) and new != old
    assert await code_of(client, a) == new

    assert (await send(client, b, old)).status_code == 404
    assert (await send(client, b, new)).status_code == 202
    assert ids((await lists(client, a))["incoming"]) != []


async def test_new_code_keeps_requests_received_and_friends(client):
    a = await player(client)
    b = await player(client)
    c = await player(client)
    await befriend(client, b, a)
    await request_from(client, c, a)
    assert (await client.post("/api/sync/friends/code", headers=a[1])).status_code == 201
    listed = await lists(client, a[1])
    assert ids(listed["friends"]) == [b[0]]
    assert ids(listed["incoming"]) == [c[0]]


async def test_code_routes_answer_401_when_the_profile_row_is_gone(client, sync_db):
    a_id, a = await player(client)
    with sqlite3.connect(sync_db) as db:
        db.execute("DELETE FROM sync_players WHERE id = ?", (a_id,))
    assert (await client.get("/api/sync/friends/code", headers=a)).status_code == 401
    assert (await client.post("/api/sync/friends/code", headers=a)).status_code == 401


# ── A code already held is retried ──────────────────────────────────


async def test_a_create_whose_first_code_is_taken_gets_another(client, monkeypatch):
    _, a = await player(client)
    taken = await code_of(client, a)
    left = codes_from(monkeypatch, [taken, "CCCCCCCC"])
    _, b = await player(client)
    assert left == []
    assert await code_of(client, b) == "CCCCCCCC"


async def test_an_admin_create_whose_first_code_is_taken_gets_another(
    client, monkeypatch, sync_db
):
    admin_id, admin = await player(client)
    monkeypatch.setenv("SYNC_ADMIN_PLAYER_IDS", admin_id)
    codes_from(monkeypatch, [await code_of(client, admin), "DDDDDDDD"])
    r = await client.post(
        "/api/sync/admin/players",
        json={"state": {"schema": 1, "ladder": {}, "lessons": [], "handle": [1, 2]}},
        headers=admin,
    )
    assert r.status_code == 201
    with sqlite3.connect(sync_db) as db:
        stored = db.execute("SELECT friend_code FROM sync_players WHERE id = ?",
                            (r.json()["player_id"],)).fetchone()[0]
    assert stored == "DDDDDDDD"


async def test_a_new_code_never_repeats_one_held(client, monkeypatch):
    _, a = await player(client)
    _, b = await player(client)
    own, other = await code_of(client, a), await code_of(client, b)
    codes_from(monkeypatch, [own, other, "EEEEEEEE"])
    r = await client.post("/api/sync/friends/code", headers=a)
    assert r.json() == {"code": "EEEEEEEE"}
    assert await code_of(client, b) == other


async def test_allocation_gives_up_after_five_held_codes(client, monkeypatch, sync_db):
    _, a = await player(client)
    taken = await code_of(client, a)
    codes_from(monkeypatch, [taken] * 5 + ["FFFFFFFF"])
    with pytest.raises(RuntimeError):
        await sync_storage.create_player("{}", 0)
    codes_from(monkeypatch, [taken] * 4 + ["FFFFFFFF"])
    created = await sync_storage.create_player("{}", 0)
    assert await sync_storage.get_friend_code(created.player_id) == "FFFFFFFF"


# ── Start-up on a file from before Revision 4 ────────────────────────

REVISION_3_SCHEMA = """
CREATE TABLE sync_players (
    id TEXT PRIMARY KEY, rev INTEGER NOT NULL, state TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, create_key_hash TEXT,
    no_device_since REAL);
CREATE TABLE sync_devices (
    token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL, created_at TEXT NOT NULL,
    create_key_hash TEXT, device_id TEXT, last_seen_at REAL);
CREATE TABLE sync_games (
    player_id TEXT NOT NULL, game_id TEXT NOT NULL, date TEXT NOT NULL,
    payload TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (player_id, game_id));
CREATE TABLE sync_pairing_codes (
    code TEXT PRIMARY KEY, player_id TEXT NOT NULL, expires_at REAL NOT NULL,
    used INTEGER NOT NULL DEFAULT 0);
"""
OLD_PLAYERS = ("p-old-one", "p-old-two", "p-old-three")
OLD_TOKEN = "old-device-token"


def write_revision_3_file(path):
    with sqlite3.connect(path) as db:
        db.executescript(REVISION_3_SCHEMA)
        for pid in OLD_PLAYERS:
            db.execute(
                "INSERT INTO sync_players VALUES (?, 1, '{}', 't', 't', NULL, NULL)", (pid,)
            )
        db.execute(
            "INSERT INTO sync_devices VALUES (?, 'p-old-one', 't', NULL, 'dev-old', NULL)",
            (hashlib.sha256(OLD_TOKEN.encode()).hexdigest(),),
        )


def stored_codes(path) -> dict:
    with sqlite3.connect(path) as db:
        return dict(db.execute("SELECT id, friend_code FROM sync_players").fetchall())


async def test_startup_gives_older_profiles_codes_and_keeps_them(
    client, clock, tmp_path, monkeypatch
):
    old = tmp_path / "revision3.db"
    write_revision_3_file(old)
    monkeypatch.setattr(sync_storage, "DB_PATH", str(old))

    await sync_storage.init_sync_db(clock.t)
    codes = stored_codes(old)
    assert set(codes) == set(OLD_PLAYERS)
    assert all(CODE_RE.match(c) for c in codes.values())
    assert len(set(codes.values())) == 3
    assert rows(old) == set()

    await sync_storage.init_sync_db(clock.t + 1)
    assert stored_codes(old) == codes

    auth = bearer(OLD_TOKEN)
    assert await code_of(client, auth) == codes["p-old-one"]
    with sqlite3.connect(old) as db, pytest.raises(sqlite3.IntegrityError):
        db.execute("UPDATE sync_players SET friend_code = ? WHERE id = 'p-old-two'",
                   (codes["p-old-one"],))


async def test_the_friendships_table_holds_one_row_per_ordered_pair(client, sync_db):
    a = await player(client)
    b = await player(client)
    await request_from(client, a, b)
    with sqlite3.connect(sync_db) as db:
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("INSERT INTO sync_friendships VALUES (?, ?, 'declined', 1, 1)",
                       (a[0], b[0]))
        db.execute("INSERT INTO sync_friendships VALUES (?, ?, 'pending', 1, 1)",
                   (b[0], a[0]))
        indexed = db.execute(
            "SELECT sql FROM sqlite_master WHERE name = 'sync_friendships_by_addressee'"
        ).fetchone()
    # Requests received and the cleanup look rows up by addressee.
    assert indexed is not None and "addressee_id" in indexed[0]


async def test_startup_retries_a_code_already_held(tmp_path, monkeypatch):
    old = tmp_path / "revision3.db"
    write_revision_3_file(old)
    monkeypatch.setattr(sync_storage, "DB_PATH", str(old))
    left = codes_from(monkeypatch, ["AAAAAAAA", "AAAAAAAA", "CCCCCCCC", "AAAAAAAA", "DDDDDDDD"])
    await sync_storage.init_sync_db(0)
    assert left == []
    assert sorted(stored_codes(old).values()) == ["AAAAAAAA", "CCCCCCCC", "DDDDDDDD"]


# ── Normalisation ────────────────────────────────────────────────────


def spaced(code):
    return f"{code[:4]} {code[4:]}"


def hyphened(code):
    return f"{code[:4]}-{code[4:]}"


ACCEPTED_FORMS = [
    lambda c: c,
    lambda c: c.lower(),
    spaced,
    hyphened,
    lambda c: hyphened(c).lower(),
    lambda c: f"  {spaced(c)}  ",
    lambda c: "-".join(c),
    lambda c: " - ".join(c.lower()),
    lambda c: f"--{c}--",
]


@pytest.mark.parametrize("form", range(len(ACCEPTED_FORMS)))
async def test_a_code_is_found_without_spaces_or_hyphens_in_either_case(
    client, sync_db, form
):
    a = await player(client)
    b = await player(client)
    typed = ACCEPTED_FORMS[form](await code_of(client, b[1]))
    r = await send(client, a[1], typed)
    assert r.status_code == 202, typed
    assert rows(sync_db) == {(a[0], b[0], "pending")}


MALFORMED_FORMS = [
    lambda c: "",
    lambda c: c[:7],
    lambda c: c + c[0],
    lambda c: c[:7] + "O",
    lambda c: c[:7] + "I",
    lambda c: c[:7] + "0",
    lambda c: c[:7] + "1",
    lambda c: c[:7] + "B",
    lambda c: c[:7] + "S",
    lambda c: f"{c[:4]}\t{c[4:]}",
    lambda c: c + "\n",
    lambda c: f"{c[:4]}_{c[4:]}",
    lambda c: f"{c[:4]}.{c[4:]}",
    lambda c: f"{c[:4]} {c[4:]}",
    lambda c: f"{c[:4]}‐{c[4:]}",
    lambda c: "".join(chr(ord(ch) + 0xFEE0) for ch in c),  # full-width forms
]


@pytest.mark.parametrize("form", range(len(MALFORMED_FORMS)))
async def test_anything_else_is_not_a_friend_code(client, sync_db, form):
    _, a = await player(client)
    _, b = await player(client)
    typed = MALFORMED_FORMS[form](await code_of(client, b))
    r = await send(client, a, typed)
    assert r.status_code == 422, repr(typed)
    assert r.json() == {"detail": "That isn't a friend code"}
    assert rows(sync_db) == set()


@pytest.mark.parametrize("raw", [
    b'{"code": 12345678}',
    b'{"code": null}',
    b'{"code": ["AAAAAAAA"]}',
    b'{"code": true}',
    b"{}",
    b'["AAAAAAAA"]',
    b'"AAAAAAAA"',
    b"not json",
    b"",
])
async def test_a_body_without_a_code_string_is_422(client, raw):
    _, a = await player(client)
    r = await client.post("/api/sync/friends/requests", content=raw, headers={**JSON, **a})
    assert r.status_code == 422


async def test_own_code_is_422_in_any_form(client, sync_db):
    _, a = await player(client)
    own = await code_of(client, a)
    for typed in (own, hyphened(own).lower()):
        r = await send(client, a, typed)
        assert r.status_code == 422
        assert r.json() == {"detail": "That's your own code"}
    assert rows(sync_db) == set()


async def test_a_code_nobody_holds_is_404(client, sync_db):
    _, a = await player(client)
    r = await send(client, a, "AAAA-AAAA")
    assert r.status_code == 404
    assert r.json() == {"detail": "No player has that code"}
    assert rows(sync_db) == set()


async def test_a_pairing_code_is_not_a_friend_code_nor_the_reverse(client, sync_db):
    _, a = await player(client)
    _, b = await player(client)
    pairing = (await client.post("/api/sync/pairing-codes", headers=b)).json()["code"]
    assert (await send(client, a, pairing)).status_code == 404
    assert rows(sync_db) == set()

    friend = await code_of(client, b)
    r = await client.post("/api/sync/pairing-codes/redeem", json={"code": friend})
    assert r.status_code == 404
    with sqlite3.connect(sync_db) as db:
        assert db.execute("SELECT COUNT(*) FROM sync_devices").fetchone()[0] == 2


# ── POST /friends/requests: one reply for every case ─────────────────


async def test_every_case_gets_the_same_202(client, clock, sync_db):
    replies = []

    async def ask(sender, addressee):
        r = await send(client, sender[1], await code_of(client, addressee[1]))
        replies.append((r.status_code, r.content, r.headers["content-type"]))

    a, b, c, d, e = [await player(client) for _ in range(5)]
    await ask(a, b)  # a new request
    await ask(a, b)  # a repeat of a pending one
    assert (await decline(client, c[1], a[0])).status_code == 404
    await ask(a, c)
    assert (await decline(client, c[1], a[0])).status_code == 204
    await ask(a, c)  # one the other side declined
    await befriend(client, a, d)
    await ask(a, d)  # already friends, asked by the first requester
    await ask(d, a)  # already friends, asked by the accepter
    await ask(e, a)
    await ask(a, e)  # the other side's request is pending: friends at once

    assert len(replies) == 8
    assert set(replies) == {(202, b"{}", "application/json")}
    assert rows(sync_db) == {
        (a[0], b[0], "pending"),
        (a[0], c[0], "declined"),
        (a[0], d[0], "accepted"),
        (e[0], a[0], "accepted"),
    }


async def test_a_repeat_keeps_the_first_sent_time(client, clock, sync_db):
    a = await player(client)
    b = await player(client)
    sent = clock.t
    await request_from(client, a, b)
    clock.advance(HOUR)
    await request_from(client, a, b)
    [entry] = (await lists(client, b[1]))["incoming"]
    assert entry["sent_at"] == sync_storage.iso_utc(sent)
    with sqlite3.connect(sync_db) as db:
        times = db.execute("SELECT created_at, updated_at FROM sync_friendships").fetchall()
    assert times == [(sent, sent)]


async def test_a_declined_request_stays_declined_when_sent_again(client, sync_db):
    a = await player(client)
    b = await player(client)
    await request_from(client, a, b)
    assert (await decline(client, b[1], a[0])).status_code == 204
    for _ in range(3):
        await request_from(client, a, b)
    assert (await lists(client, b[1]))["incoming"] == []
    assert rows(sync_db) == {(a[0], b[0], "declined")}


async def test_a_mutual_request_makes_friends_at_once(client, clock, sync_db):
    a = await player(client)
    b = await player(client)
    await request_from(client, b, a)
    clock.advance(60)
    await request_from(client, a, b)
    assert rows(sync_db) == {(b[0], a[0], "accepted")}
    for me, other in ((a, b), (b, a)):
        listed = await lists(client, me[1])
        assert ids(listed["friends"]) == [other[0]]
        assert listed["friends"][0]["since"] == sync_storage.iso_utc(clock.t)
        assert listed["incoming"] == []
        assert (await card(client, me[1], other[0])).status_code == 200


async def test_a_mutual_request_clears_an_earlier_declined_one(client, sync_db):
    a = await player(client)
    b = await player(client)
    await request_from(client, a, b)
    assert (await decline(client, b[1], a[0])).status_code == 204
    await request_from(client, b, a)  # b changed its mind
    assert rows(sync_db) == {(a[0], b[0], "declined"), (b[0], a[0], "pending")}
    await request_from(client, a, b)
    assert rows(sync_db) == {(b[0], a[0], "accepted")}


# ── Accept and decline ───────────────────────────────────────────────


async def test_accept_makes_friends_both_ways(client, clock, sync_db):
    a = await player(client)
    b = await player(client)
    await request_from(client, a, b)
    clock.advance(300)
    r = await accept(client, b[1], a[0])
    assert r.status_code == 204 and r.content == b""
    assert rows(sync_db) == {(a[0], b[0], "accepted")}
    for me, other in ((a, b), (b, a)):
        listed = await lists(client, me[1])
        assert listed["friends"] == [{
            "player_id": other[0], "handle": None, "avatar": "comet",
            "since": sync_storage.iso_utc(clock.t),
        }]
        assert listed["incoming"] == []


async def test_accept_deletes_the_other_row_between_the_two(client, sync_db):
    a = await player(client)
    b = await player(client)
    await request_from(client, b, a)
    assert (await decline(client, a[1], b[0])).status_code == 204
    await request_from(client, a, b)  # b's request to a stays declined
    assert rows(sync_db) == {(b[0], a[0], "declined"), (a[0], b[0], "pending")}
    assert (await accept(client, b[1], a[0])).status_code == 204
    assert rows(sync_db) == {(a[0], b[0], "accepted")}


async def test_accept_between_friends_is_204_and_changes_nothing(client, clock, sync_db):
    a = await player(client)
    b = await player(client)
    await befriend(client, a, b)
    since = (await lists(client, a[1]))["friends"][0]["since"]
    clock.advance(DAY)
    assert (await accept(client, b[1], a[0])).status_code == 204
    assert (await accept(client, a[1], b[0])).status_code == 204
    assert rows(sync_db) == {(a[0], b[0], "accepted")}
    assert (await lists(client, a[1]))["friends"][0]["since"] == since


async def test_accept_without_a_request_or_a_friendship_is_404(client, sync_db):
    a = await player(client)
    b = await player(client)
    c = await player(client)
    assert (await accept(client, b[1], a[0])).status_code == 404  # strangers
    await request_from(client, a, b)
    assert (await accept(client, a[1], b[0])).status_code == 404  # own request
    assert (await accept(client, b[1], UNKNOWN_ID)).status_code == 404
    await request_from(client, c, b)
    assert (await decline(client, b[1], c[0])).status_code == 204
    assert (await accept(client, b[1], c[0])).status_code == 404  # declined
    assert rows(sync_db) == {(a[0], b[0], "pending"), (c[0], b[0], "declined")}


async def test_decline_marks_the_request_and_hides_it(client, clock, sync_db):
    a = await player(client)
    b = await player(client)
    await request_from(client, a, b)
    clock.advance(60)
    r = await decline(client, b[1], a[0])
    assert r.status_code == 204 and r.content == b""
    assert rows(sync_db) == {(a[0], b[0], "declined")}
    assert await lists(client, b[1]) == {"friends": [], "incoming": []}
    assert await lists(client, a[1]) == {"friends": [], "incoming": []}
    with sqlite3.connect(sync_db) as db:
        created, updated = db.execute(
            "SELECT created_at, updated_at FROM sync_friendships").fetchone()
    assert (created, updated) == (clock.t - 60, clock.t)

    assert (await decline(client, b[1], a[0])).status_code == 204  # already declined
    assert rows(sync_db) == {(a[0], b[0], "declined")}


async def test_decline_without_a_pending_or_declined_request_is_404(client, sync_db):
    a = await player(client)
    b = await player(client)
    c = await player(client)
    assert (await decline(client, b[1], a[0])).status_code == 404  # strangers
    await request_from(client, a, b)
    assert (await decline(client, a[1], b[0])).status_code == 404  # own request
    assert (await decline(client, b[1], UNKNOWN_ID)).status_code == 404
    await befriend(client, c, b)
    assert (await decline(client, b[1], c[0])).status_code == 404  # friends
    assert (await decline(client, c[1], b[0])).status_code == 404
    assert rows(sync_db) == {(a[0], b[0], "pending"), (c[0], b[0], "accepted")}


# ── GET /friends ─────────────────────────────────────────────────────


async def test_lists_are_newest_first_and_show_only_requests_received(client, clock):
    me = await player(client)
    others = [await player(client, {"schema": 1, "avatar": "nova", "handle": [n, n + 1]})
              for n in range(4)]
    stamps = []
    for other in others:
        clock.advance(60)
        stamps.append(clock.t)
        await request_from(client, other, me)
    # Accepted in the order 2, 0: newest friendship first.
    clock.advance(60)
    await accept(client, me[1], others[2][0])
    accepted_2 = clock.t
    clock.advance(60)
    await accept(client, me[1], others[0][0])
    accepted_0 = clock.t
    stranger = await player(client)
    await request_from(client, me, stranger)  # sent by me: never listed for me

    listed = await lists(client, me[1])
    assert set(listed) == {"friends", "incoming"}
    assert listed["friends"] == [
        {"player_id": others[0][0], "handle": [0, 1], "avatar": "nova",
         "since": sync_storage.iso_utc(accepted_0)},
        {"player_id": others[2][0], "handle": [2, 3], "avatar": "nova",
         "since": sync_storage.iso_utc(accepted_2)},
    ]
    assert listed["incoming"] == [
        {"player_id": others[3][0], "handle": [3, 4], "avatar": "nova",
         "sent_at": sync_storage.iso_utc(stamps[3])},
        {"player_id": others[1][0], "handle": [1, 2], "avatar": "nova",
         "sent_at": sync_storage.iso_utc(stamps[1])},
    ]
    # The friendship is listed for the side that sent the request too.
    assert ids((await lists(client, others[2][1]))["friends"]) == [me[0]]
    assert (await lists(client, stranger[1]))["incoming"][0]["player_id"] == me[0]
    assert (await lists(client, others[3][1]))["incoming"] == []


# ── The card ─────────────────────────────────────────────────────────

T = 1_759_363_200_000


def history_entry(result="win", ts=T, rung="18k", **extra):
    return {"rung": rung, "bot": "bot-a", "handicap": 0, "result": result, "ts": ts, **extra}


async def test_a_friends_card_has_the_planned_shape(client):
    state = {
        "schema": 1,
        "handle": [4, 2],
        "avatar": "nova",
        "avatarPicked": True,
        "lessons": ["intro"],
        "ladder": {
            "byBoardSize": {
                "9x9": {
                    "rungState": {"currentRung": "18k", "winsAtCurrentRung": 2},
                    "history": [history_entry("loss", T, "19k"), history_entry("win", T + 2)],
                    "promotionEvents": [],
                },
                "13x13": {
                    "rungState": {"currentRung": "25k"},
                    "history": [history_entry("win", T + 1, "25k", undosUsed=1)],
                },
            },
            "undoBank": 3,
        },
    }
    a = await player(client)
    b = await player(client, state)
    await befriend(client, a, b)
    r = await card(client, a[1], b[0])
    assert r.status_code == 200
    assert r.json() == {
        "player_id": b[0],
        "handle": [4, 2],
        "avatar": "nova",
        "boards": {"9x9": {"rung": "18k", "games": 2}, "13x13": {"rung": "25k", "games": 1}},
        "games": 3,
        "recent": [
            {"board": "9x9", "result": "win", "rung": "18k", "ts": T + 2},
            {"board": "13x13", "result": "win", "rung": "25k", "ts": T + 1},
            {"board": "9x9", "result": "loss", "rung": "19k", "ts": T},
        ],
    }
    # Both ways.
    r = await card(client, b[1], a[0])
    assert r.status_code == 200
    assert r.json()["player_id"] == a[0]
    assert r.json()["avatar"] == "comet"


async def test_recent_is_the_newest_ten_across_boards(client):
    by_board = {
        "9x9": [history_entry("win", T + n) for n in (0, 3, 6, 9, 12)],
        "13x13": [history_entry("loss", T + n) for n in (1, 4, 7, 10, 13)],
        "19x19": [history_entry("win", T + n, "5d") for n in (2, 5, 8, 11, 14)],
    }
    state = {"ladder": {"byBoardSize": {
        board: {"rungState": {"currentRung": "1d"}, "history": h} for board, h in by_board.items()
    }}}
    a = await player(client)
    b = await player(client, state)
    await befriend(client, a, b)
    body = (await card(client, a[1], b[0])).json()
    assert body["games"] == 15
    assert [e["ts"] for e in body["recent"]] == [T + n for n in range(14, 4, -1)]
    assert body["recent"][0] == {"board": "19x19", "result": "win", "rung": "5d", "ts": T + 14}
    assert body["recent"][1] == {"board": "13x13", "result": "loss", "rung": "18k", "ts": T + 13}


INJECTED = "INJECTED_TEXT"


def injected_state():
    """Every field the card or a list reads, carrying text a tampered client
    could write; only `history[0]` and `history[-1]` of 9x9 pass."""
    return {
        "schema": 1,
        "handle": INJECTED,
        "avatar": INJECTED,
        "ladder": {
            "byBoardSize": {
                INJECTED: {"rungState": {"currentRung": "5k"},
                           "history": [history_entry("win", T + 50)]},
                "9x9": {
                    "rungState": {"currentRung": INJECTED},
                    "history": [
                        history_entry("win", T + 1, rung=INJECTED, bot=INJECTED),
                        history_entry(INJECTED, T + 2),
                        history_entry("loss", INJECTED),
                        history_entry("loss", True),
                        history_entry("loss", float(T + 3)),
                        history_entry("loss", -1),
                        history_entry("loss", 2**53 + 1),
                        history_entry("loss", T + 4, **{INJECTED: INJECTED}),
                        INJECTED,
                        ["win", T + 5],
                    ],
                },
            }
        },
    }


async def test_the_card_and_the_lists_pass_on_only_checked_values(client, sync_db):
    me = await player(client)
    friend = await player(client)
    asker = await player(client)
    await befriend(client, me, friend)
    await request_from(client, asker, me)
    for other in (friend, asker):
        write_state(sync_db, other[0], injected_state())

    r = await card(client, me[1], friend[0])
    assert r.status_code == 200
    assert INJECTED not in r.text and "bot" not in r.text
    assert r.json() == {
        "player_id": friend[0],
        "handle": None,
        "avatar": "blackhole",
        "boards": {"9x9": {"rung": None, "games": 10}},
        "games": 10,
        "recent": [
            {"board": "9x9", "result": "loss", "rung": "18k", "ts": T + 4},
            {"board": "9x9", "result": "win", "rung": None, "ts": T + 1},
        ],
    }

    r = await client.get("/api/sync/friends", headers=me[1])
    assert INJECTED not in r.text
    assert r.json()["friends"][0]["handle"] is None
    assert r.json()["friends"][0]["avatar"] == "blackhole"
    assert r.json()["incoming"][0]["handle"] is None
    assert r.json()["incoming"][0]["avatar"] == "blackhole"


@pytest.mark.parametrize("avatar", ["blackhole", "nova", "nebula", "tide", "eclipse",
                                    "prism", "comet"])
async def test_each_app_avatar_passes(client, sync_db, avatar):
    me = await player(client)
    friend = await player(client)
    asker = await player(client)
    await befriend(client, me, friend)
    await request_from(client, asker, me)
    for other in (friend, asker):
        write_state(sync_db, other[0], {"avatar": avatar})
    assert (await card(client, me[1], friend[0])).json()["avatar"] == avatar
    listed = await lists(client, me[1])
    assert listed["friends"][0]["avatar"] == avatar
    assert listed["incoming"][0]["avatar"] == avatar


@pytest.mark.parametrize("avatar", ["Nova", "nova ", "robot", "", ["nova"], {"nova": 1}, 3,
                                    None, True])
async def test_any_other_avatar_shows_as_blackhole(client, sync_db, avatar):
    me = await player(client)
    friend = await player(client)
    await befriend(client, me, friend)
    write_state(sync_db, friend[0], {"avatar": avatar})
    assert (await card(client, me[1], friend[0])).json()["avatar"] == "blackhole"
    assert (await lists(client, me[1]))["friends"][0]["avatar"] == "blackhole"


@pytest.mark.parametrize("handle,shown", [
    ([0, 63], [0, 63]),
    ([1, 64], None),
    ([True, 1], None),
    ("[1, 2]", None),
    ([1, 2, 3], None),
])
async def test_handle_passes_only_as_revision_2_allows(client, sync_db, handle, shown):
    me = await player(client)
    friend = await player(client)
    asker = await player(client)
    await befriend(client, me, friend)
    await request_from(client, asker, me)
    for other in (friend, asker):
        write_state(sync_db, other[0], {"handle": handle})
    assert (await card(client, me[1], friend[0])).json()["handle"] == shown
    listed = await lists(client, me[1])
    assert listed["friends"][0]["handle"] == shown
    assert listed["incoming"][0]["handle"] == shown


@pytest.mark.parametrize("rung,shown", [
    ("18k", "18k"), ("1d", "1d"), ("9p", "9p"), ("30k", "30k"), ("05k", "05k"),
    ("100k", None), ("k", None), ("18K", None), ("18k\n", None), ("18kk", None),
    (" 18k", None), ("18x", None), ("１８k", None), (18, None), (None, None),
])
async def test_a_rung_passes_only_in_its_shape(client, sync_db, rung, shown):
    me = await player(client)
    friend = await player(client)
    await befriend(client, me, friend)
    write_state(sync_db, friend[0], {"ladder": {"byBoardSize": {
        "19x19": {"rungState": {"currentRung": rung}, "history": [history_entry(rung=rung)]},
    }}})
    body = (await card(client, me[1], friend[0])).json()
    assert body["boards"] == {"19x19": {"rung": shown, "games": 1}}
    assert body["recent"] == [{"board": "19x19", "result": "win", "rung": shown, "ts": T}]


@pytest.mark.parametrize("ts,kept", [
    (0, True), (2**53, True), (T, True),
    (-1, False), (2**53 + 1, False), (True, False), (False, False), (1.0, False),
    ("1", False), (None, False),
])
async def test_ts_is_an_integer_from_0_to_2_to_the_53(client, sync_db, ts, kept):
    me = await player(client)
    friend = await player(client)
    await befriend(client, me, friend)
    write_state(sync_db, friend[0], {"ladder": {"byBoardSize": {
        "9x9": {"history": [history_entry(ts=ts)]},
    }}})
    body = (await card(client, me[1], friend[0])).json()
    assert body["games"] == 1
    assert body["recent"] == ([{"board": "9x9", "result": "win", "rung": "18k", "ts": ts}]
                              if kept else [])


@pytest.mark.parametrize("result,kept", [
    ("win", True), ("loss", True), ("Win", False), ("draw", False), ("", False),
    (None, False), (["win"], False),
])
async def test_result_is_win_or_loss(client, sync_db, result, kept):
    me = await player(client)
    friend = await player(client)
    await befriend(client, me, friend)
    write_state(sync_db, friend[0], {"ladder": {"byBoardSize": {
        "13x13": {"history": [history_entry(result=result)]},
    }}})
    body = (await card(client, me[1], friend[0])).json()
    assert body["recent"] == ([{"board": "13x13", "result": result, "rung": "18k", "ts": T}]
                              if kept else [])


@pytest.mark.parametrize("ladder,boards", [
    (5, {}),
    ([], {}),
    ({"byBoardSize": ["9x9"]}, {}),
    ({"byBoardSize": {"9x9": 3, "13x13": {"rungState": 4, "history": "x"},
                      "19x19": {"rungState": {}, "history": {"0": {}}},
                      "5x5": {"rungState": {"currentRung": "5k"}, "history": [{}]}}},
     {"9x9": {"rung": None, "games": 0}, "13x13": {"rung": None, "games": 0},
      "19x19": {"rung": None, "games": 0}}),
])
async def test_a_malformed_ladder_never_breaks_the_card(client, sync_db, ladder, boards):
    me = await player(client)
    friend = await player(client)
    await befriend(client, me, friend)
    write_state(sync_db, friend[0], {"ladder": ladder})
    r = await card(client, me[1], friend[0])
    assert r.status_code == 200
    assert r.json()["boards"] == boards
    assert r.json()["games"] == 0
    assert r.json()["recent"] == []


async def test_every_card_that_is_not_a_friends_is_the_same_404(client, sync_db):
    me = await player(client)
    stranger, asked, asking, refused, refuser, removed = [await player(client)
                                                          for _ in range(6)]
    await request_from(client, me, asked)
    await request_from(client, asking, me)
    await request_from(client, me, refuser)
    await decline(client, refuser[1], me[0])
    await request_from(client, refused, me)
    await decline(client, me[1], refused[0])
    await befriend(client, me, removed)
    assert (await card(client, me[1], removed[0])).status_code == 200
    assert (await remove(client, me[1], removed[0])).status_code == 204

    replies = []
    for other in (stranger, asked, asking, refused, refuser, removed):
        for viewer, target in ((me, other), (other, me)):
            r = await card(client, viewer[1], target[0])
            replies.append((r.status_code, r.json()))
    for target in (UNKNOWN_ID, me[0], "not-a-uuid"):
        r = await card(client, me[1], target)
        replies.append((r.status_code, r.json()))
    assert len(replies) == 15
    assert set((s, json.dumps(b)) for s, b in replies) == {(404, json.dumps(NOT_FOUND))}


async def test_a_card_id_is_matched_in_either_case(client):
    me = await player(client)
    friend = await player(client)
    await befriend(client, me, friend)
    r = await card(client, me[1], friend[0].upper())
    assert r.status_code == 200
    assert r.json()["player_id"] == friend[0]


# ── Removing a friend ────────────────────────────────────────────────


async def test_remove_ends_the_friendship_both_ways_and_allows_a_new_request(
    client, sync_db
):
    a = await player(client)
    b = await player(client)
    c = await player(client)
    await befriend(client, a, b)
    await befriend(client, c, b)
    r = await remove(client, b[1], a[0])
    assert r.status_code == 204 and r.content == b""
    assert rows(sync_db) == {(c[0], b[0], "accepted")}
    for me, other in ((a, b), (b, a)):
        assert other[0] not in ids((await lists(client, me[1]))["friends"])
        assert (await card(client, me[1], other[0])).status_code == 404
    await request_from(client, b, a)
    assert ids((await lists(client, a[1]))["incoming"]) == [b[0]]


async def test_removing_by_the_requester_also_ends_it(client, sync_db):
    a = await player(client)
    b = await player(client)
    await befriend(client, a, b)
    assert (await remove(client, a[1], b[0])).status_code == 204
    assert rows(sync_db) == set()


async def test_remove_keeps_a_declined_request_declined(client, sync_db):
    a = await player(client)
    b = await player(client)
    await request_from(client, a, b)
    await decline(client, b[1], a[0])
    for me, other in ((a, b), (b, a)):
        assert (await remove(client, me[1], other[0])).status_code == 204
    assert rows(sync_db) == {(a[0], b[0], "declined")}
    await request_from(client, a, b)
    assert (await lists(client, b[1]))["incoming"] == []


async def test_remove_keeps_a_pending_request(client, sync_db):
    a = await player(client)
    b = await player(client)
    await request_from(client, a, b)
    for me, other in ((a, b), (b, a)):
        assert (await remove(client, me[1], other[0])).status_code == 204
    assert rows(sync_db) == {(a[0], b[0], "pending")}


async def test_remove_between_strangers_is_204(client):
    a = await player(client)
    assert (await remove(client, a[1], UNKNOWN_ID)).status_code == 204


# ── Routes: order, the UUID, 401 ─────────────────────────────────────


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/sync/friends/not-a-uuid"),
    ("DELETE", "/api/sync/friends/not-a-uuid"),
    ("DELETE", "/api/sync/friends/requests"),
    ("GET", "/api/sync/friends/requests"),
    ("DELETE", "/api/sync/friends/code"),
    ("PUT", "/api/sync/friends/code"),
    ("POST", f"/api/sync/friends/{UNKNOWN_ID}"),
    ("GET", f"/api/sync/friends/requests/{UNKNOWN_ID}/accept"),
    ("GET", "/api/sync/friends/"),
    ("GET", f"/api/sync/friends/{UNKNOWN_ID}x"),
    ("DELETE", f"/api/sync/friends/{UNKNOWN_ID[:-1]}"),
    ("POST", "/api/sync/friends/requests/not-a-uuid/accept"),
    ("POST", "/api/sync/friends/requests/not-a-uuid/decline"),
    ("POST", f"/api/sync/friends/requests/{UNKNOWN_ID}/other"),
    ("GET", "/api/sync/friends/code/extra"),
    ("GET", f"/api/sync/friends/{UNKNOWN_ID}/card"),
])
async def test_paths_that_are_not_routes_are_404(client, method, path):
    _, a = await player(client)
    r = await client.request(method, path, headers=a)
    assert r.status_code == 404, (method, path, r.status_code)
    assert r.json() == NOT_FOUND


async def test_code_and_requests_are_not_taken_for_a_player_id(client, sync_db):
    a = await player(client)
    b = await player(client)
    assert set((await client.get("/api/sync/friends/code", headers=a[1])).json()) == {"code"}
    r = await client.post("/api/sync/friends/requests",
                          json={"code": await code_of(client, b[1])}, headers=a[1])
    assert r.status_code == 202
    assert rows(sync_db) == {(a[0], b[0], "pending")}


FRIEND_ROUTES = [
    ("GET", "/api/sync/friends/code"),
    ("POST", "/api/sync/friends/code"),
    ("POST", "/api/sync/friends/requests"),
    ("GET", "/api/sync/friends"),
    ("POST", f"/api/sync/friends/requests/{UNKNOWN_ID}/accept"),
    ("POST", f"/api/sync/friends/requests/{UNKNOWN_ID}/decline"),
    ("GET", f"/api/sync/friends/{UNKNOWN_ID}"),
    ("DELETE", f"/api/sync/friends/{UNKNOWN_ID}"),
]


@pytest.mark.parametrize("method,path", FRIEND_ROUTES)
async def test_every_friend_route_needs_a_live_token(client, method, path):
    _, auth = await player(client)
    body = b'{"code": "AAAAAAAA"}'
    for headers in ({}, bearer("not-a-real-token"), {"Authorization": "Basic abc"}):
        r = await client.request(method, path, content=body, headers={**JSON, **headers})
        assert r.status_code == 401
        assert r.headers["www-authenticate"] == "Bearer"
    assert (await client.delete("/api/sync/devices/current", headers=auth)).status_code == 204
    r = await client.request(method, path, content=body, headers={**JSON, **auth})
    assert r.status_code == 401


# ── The request limits ───────────────────────────────────────────────

PLAYER_LIMIT = 20
ADDRESS_LIMIT = 60


def _from(address: str) -> dict:
    return {"X-Forwarded-For": address}


async def attempts(client, auth, n, headers=None, expect=None):
    """n requests that each fail differently (404, 422 malformed, 422 bad
    body, 422 own code); every one counts."""
    own = await code_of(client, auth)
    statuses = []
    for i in range(n):
        kind = i % 4
        if kind == 0:
            r = await send(client, auth, "AAAAAAAA", headers)
        elif kind == 1:
            r = await send(client, auth, "nope", headers)
        elif kind == 2:
            r = await client.post("/api/sync/friends/requests", content=b"{",
                                  headers={**JSON, **auth, **(headers or {})})
        else:
            r = await send(client, auth, own, headers)
        statuses.append(r.status_code)
    if expect is not None:
        assert set(statuses) <= expect, statuses
    return statuses


COUNTED = {404, 422}


async def test_20_attempts_an_hour_per_player_then_429(client, clock):
    a = await player(client)
    b = await player(client)
    await attempts(client, a[1], PLAYER_LIMIT - 1, expect=COUNTED)
    await request_from(client, a, b)  # the 20th, a success
    r = await send(client, a[1], await code_of(client, b[1]))
    assert r.status_code == 429
    assert r.headers["retry-after"] == str(HOUR)
    # Another player at the same address is not affected.
    c = await player(client)
    await request_from(client, c, b)

    clock.advance(HOUR - 1)
    assert (await send(client, a[1], "AAAAAAAA")).status_code == 429
    clock.advance(1)
    assert (await send(client, a[1], "AAAAAAAA")).status_code == 404


async def test_a_limited_request_changes_nothing(client, sync_db):
    a = await player(client)
    b = await player(client)
    await attempts(client, a[1], PLAYER_LIMIT, expect=COUNTED)
    assert (await send(client, a[1], await code_of(client, b[1]))).status_code == 429
    assert rows(sync_db) == set()


async def test_60_an_hour_per_address_across_players(client, clock):
    players = [await player(client) for _ in range(4)]
    for p in players[:3]:
        await attempts(client, p[1], PLAYER_LIMIT, expect=COUNTED)
    r = await send(client, players[3][1], "AAAAAAAA")
    assert r.status_code == 429
    assert r.headers["retry-after"] == str(HOUR)
    clock.advance(HOUR)
    assert (await send(client, players[3][1], "AAAAAAAA")).status_code == 404


async def test_a_request_refused_by_one_limit_counts_toward_neither(client, clock):
    a, b, c, d = [await player(client) for _ in range(4)]
    # a over its own limit does not use up the address.
    await attempts(client, a[1], PLAYER_LIMIT, expect=COUNTED)
    await attempts(client, a[1], 40, expect={429})
    await attempts(client, b[1], PLAYER_LIMIT, expect=COUNTED)
    await attempts(client, c[1], PLAYER_LIMIT, expect=COUNTED)
    # Now the address is full: d's refused attempts do not count for d.
    clock.advance(HOUR / 2)
    await attempts(client, d[1], PLAYER_LIMIT, expect={429})
    clock.advance(HOUR / 2)
    await attempts(client, d[1], PLAYER_LIMIT, expect=COUNTED)


async def test_retry_after_is_the_longer_wait_when_both_limits_refuse(client, clock):
    a, b, c = [await player(client) for _ in range(3)]
    await attempts(client, b[1], PLAYER_LIMIT, expect=COUNTED)
    await attempts(client, c[1], PLAYER_LIMIT, expect=COUNTED)
    clock.advance(100)
    await attempts(client, a[1], PLAYER_LIMIT, expect=COUNTED)
    clock.advance(100)
    r = await send(client, a[1], "AAAAAAAA")
    assert r.status_code == 429
    assert r.headers["retry-after"] == str(HOUR - 100)  # a's own window, the longer
    d = await player(client)
    r = await send(client, d[1], "AAAAAAAA")
    assert r.headers["retry-after"] == str(HOUR - 200)  # the address's only
    clock.advance(0.5)
    r = await send(client, d[1], "AAAAAAAA")
    assert r.headers["retry-after"] == str(HOUR - 200)  # whole seconds, rounded up


async def test_by_default_a_rotating_forwarded_header_does_not_dodge_the_address_limit(client):
    players = [await player(client) for _ in range(4)]
    n = 0
    for p in players[:3]:
        for _ in range(PLAYER_LIMIT):
            n += 1
            r = await send(client, p[1], "AAAAAAAA", _from(f"203.0.113.{n}"))
            assert r.status_code == 404
    for spoof in ("203.0.113.99", "203.0.113.98, 198.51.100.1", None):
        r = await send(client, players[3][1], "AAAAAAAA", _from(spoof) if spoof else None)
        assert r.status_code == 429


async def test_one_trusted_hop_keys_on_the_proxys_entry(client, monkeypatch):
    monkeypatch.setenv("SYNC_TRUSTED_PROXY_HOPS", "1")
    players = [await player(client) for _ in range(5)]
    for i, p in enumerate(players[:3]):
        for j in range(PLAYER_LIMIT):
            spoofed = _from(f"203.0.113.{i * 20 + j}, 198.51.100.7")
            assert (await send(client, p[1], "AAAAAAAA", spoofed)).status_code == 404
    # A rotating spoofed prefix moves nothing; a different client address does.
    r = await send(client, players[3][1], "AAAAAAAA", _from("203.0.113.250, 198.51.100.7"))
    assert r.status_code == 429
    r = await send(client, players[3][1], "AAAAAAAA", _from("198.51.100.7"))
    assert r.status_code == 429
    r = await send(client, players[3][1], "AAAAAAAA", _from("198.51.100.7, 198.51.100.8"))
    assert r.status_code == 404
    # Without the header the key is the socket peer, a separate bucket.
    assert (await send(client, players[4][1], "AAAAAAAA")).status_code == 404


async def test_a_rotating_address_does_not_dodge_the_player_limit(client, monkeypatch):
    monkeypatch.setenv("SYNC_TRUSTED_PROXY_HOPS", "1")
    _, a = await player(client)
    for i in range(PLAYER_LIMIT):
        assert (await send(client, a, "AAAAAAAA", _from(f"198.51.100.{i}"))).status_code == 404
    assert (await send(client, a, "AAAAAAAA", _from("198.51.100.250"))).status_code == 429


async def test_the_request_limits_are_separate_from_create_and_redeem(client):
    _, a = await player(client)
    await attempts(client, a, PLAYER_LIMIT, expect=COUNTED)
    for _ in range(3):
        await client.post("/api/sync/pairing-codes/redeem", json={"code": "AAAAAAAA"})
    assert (await client.post("/api/sync/players", json={"state": {}})).status_code == 201
    r = await client.post("/api/sync/pairing-codes/redeem", json={"code": "AAAAAAAA"})
    assert r.status_code == 404


async def test_other_friend_routes_are_not_limited(client):
    a = await player(client)
    b = await player(client)
    await attempts(client, a[1], PLAYER_LIMIT, expect=COUNTED)
    assert (await send(client, a[1], "AAAAAAAA")).status_code == 429
    await request_from(client, b, a)
    for _ in range(30):
        assert (await client.get("/api/sync/friends", headers=a[1])).status_code == 200
        assert (await decline(client, a[1], b[0])).status_code == 204
    assert (await client.post("/api/sync/friends/code", headers=a[1])).status_code == 201


# ── The cleanup ──────────────────────────────────────────────────────


async def test_the_cleanup_deletes_a_profiles_friendships_both_ways(client, clock, sync_db):
    t0 = clock.t
    gone = await player(client)
    a, b, c, d = [await player(client) for _ in range(4)]
    await request_from(client, gone, a)
    await request_from(client, b, gone)
    await befriend(client, gone, c)
    await request_from(client, d, gone)
    await decline(client, gone[1], d[0])
    await request_from(client, a, b)  # between two others: kept
    assert (await client.delete("/api/sync/devices/current", headers=gone[1])).status_code == 204

    assert await retention.run_cleanup(t0 + 30 * DAY - 1) == 0
    assert len(rows(sync_db)) == 5
    assert await retention.run_cleanup(t0 + 30 * DAY) == 1
    assert rows(sync_db) == {(a[0], b[0], "pending")}
    assert await lists(client, a[1]) == {"friends": [], "incoming": []}
    assert await lists(client, c[1]) == {"friends": [], "incoming": []}
    assert (await card(client, c[1], gone[0])).status_code == 404


# ── No token hash and no other player's friend code in any reply ─────


async def test_no_reply_carries_a_token_hash_or_another_players_code(
    client, monkeypatch, sync_db
):
    a = await player(client)
    b = await player(client)
    c = await player(client)
    monkeypatch.setenv("SYNC_ADMIN_PLAYER_IDS", a[0])
    texts = {a[0]: [], b[0]: [], c[0]: []}

    async def note(who, r):
        assert r.status_code < 400, r.text
        texts[who[0]].append(r.text)
        return r

    for who in (a, b, c):
        await note(who, await client.get("/api/sync/friends/code", headers=who[1]))
    await note(a, await send(client, a[1], await code_of(client, b[1])))
    await note(c, await send(client, c[1], await code_of(client, a[1])))
    await note(b, await client.get("/api/sync/friends", headers=b[1]))
    await note(b, await accept(client, b[1], a[0]))
    await note(a, await decline(client, a[1], c[0]))
    for who, other in ((a, b), (b, a)):
        await note(who, await card(client, who[1], other[0]))
    for who in (a, b, c):
        await note(who, await client.get("/api/sync/friends", headers=who[1]))
        await note(who, await client.get("/api/sync/state", headers=who[1]))
    texts[c[0]].append((await card(client, c[1], a[0])).text)  # a 404
    await note(a, await client.get("/api/sync/admin/players", headers=a[1]))
    await note(a, await remove(client, a[1], b[0]))
    await note(b, await client.post("/api/sync/friends/code", headers=b[1]))

    with sqlite3.connect(sync_db) as db:
        hashes = {r[0] for r in db.execute("SELECT token_hash FROM sync_devices")}
        codes = dict(db.execute("SELECT id, friend_code FROM sync_players").fetchall())
    tokens = {who[1]["Authorization"].split()[1] for who in (a, b, c)}
    old_b_code = json.loads(texts[b[0]][0])["code"]
    assert len(hashes) == 3 and old_b_code != codes[b[0]]
    assert [len(texts[p[0]]) for p in (a, b, c)] == [8, 7, 5]
    for who, replies in texts.items():
        others = {code for pid, code in codes.items() if pid != who}
        if who != b[0]:
            others.add(old_b_code)
        for text in replies:
            for secret in hashes | tokens | others:
                assert secret not in text, (who, text)
