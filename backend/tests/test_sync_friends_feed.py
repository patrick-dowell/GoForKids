"""Sync friends, Revision 5 (plan 32): the feed, a friend's replays, their
checks, the same 404 as the card for anyone who is not a friend, and the
read limit kept apart from the request limits."""

import json
import sqlite3

import pytest

from app.routers import sync_friends
from app.sync.friend_replays import checked_replay, rebuild_sgf
from tests.sync_helpers import iso
from tests.test_sync_friends import (
    INJECTED,
    NOT_FOUND,
    T,
    UNKNOWN_ID,
    befriend,
    code_of,
    decline,
    history_entry,
    player,
    remove,
    request_from,
    send,
    write_state,
)

MINUTE = 60


@pytest.fixture(autouse=True)
def fresh_read_limit():
    sync_friends.read_player_limiter.reset()
    yield
    sync_friends.read_player_limiter.reset()


async def feed(client, auth) -> dict:
    r = await client.get("/api/sync/friends/feed", headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


async def games(client, auth, player_id):
    return await client.get(f"/api/sync/friends/{player_id}/games", headers=auth)


async def game(client, auth, player_id, game_id):
    return await client.get(f"/api/sync/friends/{player_id}/games/{game_id}", headers=auth)


async def put_game(client, auth, game_id, date, payload):
    r = await client.put(
        f"/api/sync/games/{game_id}", json={"date": date, "payload": payload}, headers=auth
    )
    assert r.status_code == 200, r.text


def promotion(frm, to, ts):
    return {"from": frm, "to": to, "ts": ts}


def ladder(**boards):
    """A ladder state: board key (9x9 as nine) -> (rung, history, promotions)."""
    keys = {"nine": "9x9", "thirteen": "13x13", "nineteen": "19x19"}
    return {"ladder": {"byBoardSize": {
        keys[k]: {"rungState": {"currentRung": rung}, "history": h, "promotionEvents": p}
        for k, (rung, h, p) in boards.items()
    }}}


def set_last_seen(db_path, player_id, at) -> None:
    with sqlite3.connect(db_path) as db:
        db.execute("UPDATE sync_devices SET last_seen_at = ? WHERE player_id = ?", (at, player_id))


# A replay as the app writes it (gameStore.autoSaveGame, Game.toSGF).
APP_SGF = "(;GM[1]FF[4]CA[UTF-8]SZ[9]KM[6.5]RU[Japanese]RE[B+5.5];B[ee];W[cc];B[gc];W[])"
HANDICAP_SGF = "(;GM[1]FF[4]CA[UTF-8]SZ[19]KM[0.5]RU[Japanese]HA[2]AB[dd][pp];W[qd];B[])"


def app_replay(**extra):
    return {
        "id": "a1b2c3d4",
        "sgf": APP_SGF,
        "date": iso(1),
        "playerColor": "black",
        "opponentRank": "12k",
        "result": "Black wins by 5.5",
        "moveCount": 4,
        "isRanked": True,
        "gameId": "a1b2c3d4",
        "gameType": "human-vs-bot",
        "scoreHistory": [{"move": 0, "lead": -6.5}, {"move": 1, "lead": 2}],
        "deadStones": [{"row": 2, "col": 2, "color": 2}],
        **extra,
    }


# ── The feed ─────────────────────────────────────────────────────────


async def test_the_feed_has_the_planned_shape(client, clock):
    me = await player(client)
    raven = await player(client, {"handle": [4, 2], "avatar": "nova", **ladder(
        nine=("9k", [history_entry("loss", T, "10k", bot="10k"),
                     history_entry("win", T + 2, "10k", bot="12k")],
              [promotion("10k", "9k", T + 2)]),
        nineteen=("25k", [history_entry("win", T + 1, "25k", bot="18k")], []),
    )})
    owl = await player(client, {"handle": [8, 5], "avatar": "comet"})
    await befriend(client, me, raven)
    clock.advance(1)
    await befriend(client, me, owl)
    body = await feed(client, me[1])
    who = {"player_id": raven[0], "handle": [4, 2], "avatar": "nova"}
    assert body == {
        "friends": [
            {"player_id": owl[0], "handle": [8, 5], "avatar": "comet", "active_recently": True,
             "boards": {}},
            {**who, "active_recently": True,
             "boards": {"9x9": {"rung": "9k", "games": 2}, "19x19": {"rung": "25k", "games": 1}}},
        ],
        "events": [
            {"kind": "promotion", **who, "board": "9x9", "from": "10k", "to": "9k", "ts": T + 2},
            {"kind": "game", **who, "board": "9x9", "result": "win", "rung": "10k", "bot": "12k",
             "ts": T + 2},
            {"kind": "game", **who, "board": "19x19", "result": "win", "rung": "25k", "bot": "18k",
             "ts": T + 1},
            {"kind": "game", **who, "board": "9x9", "result": "loss", "rung": "10k", "bot": "10k",
             "ts": T},
        ],
    }


async def test_the_feed_is_the_newest_fifty_across_friends(client):
    me = await player(client)
    a = await player(client, ladder(nine=("18k", [history_entry("win", T + 2 * n) for n in range(40)], [])))
    b = await player(client, ladder(nineteen=("18k", [history_entry("loss", T + 2 * n + 1)
                                                      for n in range(40)], [])))
    await befriend(client, me, a)
    await befriend(client, me, b)
    events = (await feed(client, me[1]))["events"]
    assert len(events) == 50
    assert [e["ts"] for e in events] == [T + n for n in range(79, 29, -1)]
    assert {e["player_id"] for e in events[:2]} == {a[0], b[0]}


async def test_the_feed_with_no_friends_or_no_games_is_empty(client):
    me = await player(client)
    assert await feed(client, me[1]) == {"friends": [], "events": []}
    quiet = await player(client)
    await befriend(client, me, quiet)
    body = await feed(client, me[1])
    assert [f["player_id"] for f in body["friends"]] == [quiet[0]]
    assert body["events"] == []


async def test_only_accepted_friends_reach_the_feed(client, sync_db):
    me = await player(client)
    played = ladder(nine=("18k", [history_entry("win", T)], [promotion("19k", "18k", T)]))
    stranger, asked, asking, refused, removed, friend = [await player(client, played)
                                                         for _ in range(6)]
    await request_from(client, me, asked)
    await request_from(client, asking, me)
    await request_from(client, refused, me)
    await decline(client, me[1], refused[0])
    await befriend(client, me, removed)
    await remove(client, me[1], removed[0])
    await befriend(client, me, friend)
    body = await feed(client, me[1])
    assert [f["player_id"] for f in body["friends"]] == [friend[0]]
    assert {e["player_id"] for e in body["events"]} == {friend[0]}
    assert len(body["events"]) == 2
    # Both ways: the friend sees this player too (who has played nothing).
    assert [f["player_id"] for f in (await feed(client, friend[1]))["friends"]] == [me[0]]
    for other in (stranger, asked, asking, refused, removed):
        assert other[0] not in json.dumps(body)


@pytest.mark.parametrize("seen_ago,active", [
    (0, True), (9 * MINUTE, True), (10 * MINUTE, True), (10 * MINUTE + 1, False), (None, False),
])
async def test_active_recently_is_a_device_seen_in_the_last_ten_minutes(
    client, clock, sync_db, seen_ago, active
):
    me = await player(client)
    friend = await player(client)
    await befriend(client, me, friend)
    set_last_seen(sync_db, friend[0], None if seen_ago is None else clock.t - seen_ago)
    assert (await feed(client, me[1]))["friends"][0]["active_recently"] is active


async def test_the_newest_of_a_friends_devices_counts(client, clock, sync_db):
    me = await player(client)
    friend = await player(client)
    await befriend(client, me, friend)
    r = await client.post("/api/sync/pairing-codes", headers=friend[1])
    r = await client.post("/api/sync/pairing-codes/redeem", json={"code": r.json()["code"]})
    assert r.status_code == 200
    clock.advance(30 * MINUTE)
    # Only the second device is used again.
    await client.get("/api/sync/state", headers={"Authorization": f"Bearer {r.json()['device_token']}"})
    assert (await feed(client, me[1]))["friends"][0]["active_recently"] is True
    clock.advance(11 * MINUTE)
    assert (await feed(client, me[1]))["friends"][0]["active_recently"] is False


async def test_a_friend_with_no_device_is_not_active(client, sync_db):
    me = await player(client)
    friend = await player(client)
    await befriend(client, me, friend)
    assert (await client.delete("/api/sync/devices/current", headers=friend[1])).status_code == 204
    assert (await feed(client, me[1]))["friends"][0]["active_recently"] is False


def injected_feed_state():
    return {
        "handle": INJECTED,
        "avatar": INJECTED,
        "ladder": {"byBoardSize": {
            INJECTED: {"rungState": {"currentRung": "5k"}, "history": [history_entry("win", T + 50)],
                       "promotionEvents": [promotion("6k", "5k", T + 50)]},
            "9x9": {
                "rungState": {"currentRung": INJECTED},
                "history": [
                    history_entry("win", T + 1, rung=INJECTED, bot=INJECTED),
                    history_entry(INJECTED, T + 2),
                    history_entry("loss", INJECTED),
                    history_entry("loss", True),
                    history_entry("loss", T + 4, **{INJECTED: INJECTED}),
                    INJECTED,
                ],
                "promotionEvents": [
                    promotion(INJECTED, "9k", T + 5),
                    promotion("10k", INJECTED, T + 6),
                    promotion("10k", "9k", INJECTED),
                    promotion("10k", "9k", 1.5),
                    {"from": "10k", "to": "9k", "ts": T + 7, INJECTED: INJECTED},
                    INJECTED,
                ],
            },
        }},
    }


async def test_the_feed_passes_on_only_checked_values(client, sync_db):
    me = await player(client)
    friend = await player(client)
    await befriend(client, me, friend)
    write_state(sync_db, friend[0], injected_feed_state())
    r = await client.get("/api/sync/friends/feed", headers=me[1])
    assert r.status_code == 200
    assert INJECTED not in r.text
    who = {"player_id": friend[0], "handle": None, "avatar": "blackhole"}
    assert r.json() == {
        "friends": [{**who, "active_recently": True, "boards": {"9x9": {"rung": None, "games": 6}}}],
        "events": [
            {"kind": "promotion", **who, "board": "9x9", "from": "10k", "to": "9k", "ts": T + 7},
            {"kind": "promotion", **who, "board": "9x9", "from": None, "to": "9k", "ts": T + 5},
            {"kind": "game", **who, "board": "9x9", "result": "loss", "rung": "18k", "bot": None,
             "ts": T + 4},
            {"kind": "game", **who, "board": "9x9", "result": "win", "rung": None, "bot": None,
             "ts": T + 1},
        ],
    }


@pytest.mark.parametrize("ladder_value", [5, [], {"byBoardSize": ["9x9"]},
                                          {"byBoardSize": {"9x9": {"promotionEvents": "x"}}}])
async def test_a_malformed_ladder_never_breaks_the_feed(client, sync_db, ladder_value):
    me = await player(client)
    friend = await player(client)
    await befriend(client, me, friend)
    write_state(sync_db, friend[0], {"ladder": ladder_value})
    assert (await feed(client, me[1]))["events"] == []


# ── A friend's replays ───────────────────────────────────────────────


async def test_a_friends_replays_newest_twenty_with_what_each_was(client):
    me = await player(client)
    friend = await player(client)
    await befriend(client, me, friend)
    for n in range(25):
        await put_game(client, friend[1], f"g{n:02d}", iso(n), app_replay())
    await put_game(client, friend[1], "lost", iso(30), app_replay(result="White wins (resignation)"))
    await put_game(client, friend[1], "watched", iso(31), app_replay(
        gameType="bot-vs-bot", opponentRank="12k vs 9k", blackRank="12k", whiteRank="9k"))
    await put_game(client, friend[1], "small", iso(32), {"sgf": "(;SZ[7];B[dd])"})
    r = await games(client, me[1], friend[0])
    assert r.status_code == 200
    listed = r.json()["games"]
    assert len(listed) == 20
    assert listed[:4] == [
        {"id": "small", "date": iso(32), "board": None, "outcome": None, "opponent": None},
        {"id": "watched", "date": iso(31), "board": "9x9", "outcome": "watched", "opponent": None},
        {"id": "lost", "date": iso(30), "board": "9x9", "outcome": "loss", "opponent": "12k"},
        {"id": "g24", "date": iso(24), "board": "9x9", "outcome": "win", "opponent": "12k"},
    ]
    assert listed[-1]["id"] == "g08"


async def test_a_friend_with_no_replays_lists_none(client):
    me = await player(client)
    friend = await player(client)
    await befriend(client, me, friend)
    r = await games(client, me[1], friend[0])
    assert r.status_code == 200
    assert r.json() == {"games": []}


async def test_a_replay_as_the_app_wrote_it_is_served_whole_but_for_what_stays_home(client):
    me = await player(client)
    friend = await player(client)
    await befriend(client, me, friend)
    await put_game(client, friend[1], "a1b2c3d4", iso(1),
                   app_replay(selectorLog=["pass: x"], sharedId="K7QX2MPD"))
    r = await game(client, me[1], friend[0], "a1b2c3d4")
    assert r.status_code == 200
    expected = app_replay()
    for key in ("id", "date", "gameId"):
        del expected[key]
    assert r.json() == {"id": "a1b2c3d4", "date": iso(1), "payload": expected}
    assert "K7QX2MPD" not in r.text and "selectorLog" not in r.text


async def test_a_handicap_replay_keeps_its_stones():
    assert rebuild_sgf(HANDICAP_SGF) == HANDICAP_SGF
    assert rebuild_sgf(APP_SGF) == APP_SGF


def injected_replay():
    return {
        "sgf": (f"(;GM[1]FF[4]CA[UTF-8]SZ[9]KM[{INJECTED}]PB[{INJECTED}]PW[{INJECTED}]"
                f"GN[{INJECTED}]RU[Japanese]RE[{INJECTED}]C[{INJECTED}];B[ee]C[{INJECTED}];W[cc])"),
        "playerColor": INJECTED,
        "opponentRank": INJECTED,
        "blackRank": INJECTED,
        "whiteRank": "12k\n",
        "result": f"Black wins by 5.5 {INJECTED}",
        "moveCount": INJECTED,
        "isRanked": INJECTED,
        "gameId": INJECTED,
        "gameType": INJECTED,
        "sharedId": INJECTED,
        "scoreHistory": [{"move": 1, "lead": 2.5}, {"move": INJECTED, "lead": 1},
                         {"move": 2, "lead": INJECTED}, {"move": 3, "lead": True},
                         {"move": True, "lead": 1}, INJECTED],
        "deadStones": [{"row": 1, "col": 1, "color": 1}, {"row": 9, "col": 1, "color": 1},
                       {"row": 1, "col": 1, "color": 3}, {"row": "1", "col": 1, "color": 1},
                       {"row": 1, "col": 1, "color": 1, INJECTED: INJECTED}, INJECTED],
        INJECTED: INJECTED,
    }


async def test_a_replay_passes_on_only_checked_values(client):
    me = await player(client)
    friend = await player(client)
    await befriend(client, me, friend)
    await put_game(client, friend[1], "tampered", iso(1), injected_replay())
    r = await game(client, me[1], friend[0], "tampered")
    assert r.status_code == 200
    assert INJECTED not in r.text
    assert r.json()["payload"] == {
        "sgf": "(;GM[1]FF[4]CA[UTF-8]SZ[9]RU[Japanese];B[ee];W[cc])",
        "playerColor": "black",
        "isRanked": False,
        "scoreHistory": [{"move": 1, "lead": 2.5}],
        "deadStones": [{"row": 1, "col": 1, "color": 1}, {"row": 1, "col": 1, "color": 1}],
    }
    r = await games(client, me[1], friend[0])
    assert INJECTED not in r.text
    assert r.json()["games"] == [
        {"id": "tampered", "date": iso(1), "board": "9x9", "outcome": None, "opponent": None},
    ]


@pytest.mark.parametrize("sgf", [
    "(;SZ[9];B[jj])",            # off a 9x9 board
    "(;SZ[9]AB[aa][zz];W[cc])",  # a setup stone off the board
    "(;SZ[25];B[aa])",           # a board the app has no letters for
    "(;SZ[1];B[aa])",
    "",
    5,
    "(;SZ[9]" + ";B[]" * 1001 + ")",  # more moves than any game
])
async def test_a_replay_the_app_could_not_have_written_is_not_served(client, sgf):
    me = await player(client)
    friend = await player(client)
    await befriend(client, me, friend)
    await put_game(client, friend[1], "fine", iso(1), app_replay())
    # The owner's own PUT takes it: only a friend's read checks the board.
    r = await client.put("/api/sync/games/odd", json={"date": iso(2), "payload": {"sgf": sgf}},
                         headers=friend[1])
    if r.status_code != 200:
        assert not isinstance(sgf, str) or not sgf
        return
    r = await game(client, me[1], friend[0], "odd")
    assert (r.status_code, r.json()) == (404, NOT_FOUND)
    assert [g["id"] for g in (await games(client, me[1], friend[0])).json()["games"]] == ["fine"]


@pytest.mark.parametrize("game_id,date", [
    ("bad id", iso(2)), ("x" * 129, iso(2)), ("ok-id", INJECTED), ("ok-id", "2026-10-01"),
])
async def test_an_id_or_date_out_of_shape_is_left_out(client, sync_db, game_id, date):
    me = await player(client)
    friend = await player(client)
    await befriend(client, me, friend)
    await put_game(client, friend[1], "fine", iso(1), app_replay())
    with sqlite3.connect(sync_db) as db:
        db.execute(
            """INSERT INTO sync_games (player_id, game_id, date, payload, updated_at)
               VALUES (?, ?, ?, ?, ?)""",
            (friend[0], game_id, date, json.dumps(app_replay()), iso(0)),
        )
    r = await games(client, me[1], friend[0])
    assert [g["id"] for g in r.json()["games"]] == ["fine"]
    assert INJECTED not in r.text
    r = await client.get(f"/api/sync/friends/{friend[0]}/games/{game_id}", headers=me[1])
    assert (r.status_code, r.json()) == (404, NOT_FOUND)


async def test_every_replay_read_that_is_not_a_friends_is_the_cards_404(client, sync_db):
    me = await player(client)
    stranger, asked, asking, refused, removed = [await player(client) for _ in range(5)]
    friend = await player(client)
    await request_from(client, me, asked)
    await request_from(client, asking, me)
    await request_from(client, refused, me)
    await decline(client, me[1], refused[0])
    await befriend(client, me, removed)
    await befriend(client, me, friend)
    for other in (stranger, asked, asking, refused, removed, friend):
        await put_game(client, other[1], "g1", iso(1), app_replay())
    assert (await game(client, me[1], removed[0], "g1")).status_code == 200
    await remove(client, me[1], removed[0])

    replies = []
    for other in (stranger, asked, asking, refused, removed):
        for viewer, target in ((me, other), (other, me)):
            replies.append(await games(client, viewer[1], target[0]))
            replies.append(await game(client, viewer[1], target[0], "g1"))
    for target in (UNKNOWN_ID, me[0]):
        replies.append(await games(client, me[1], target))
        replies.append(await game(client, me[1], target, "g1"))
    # A friend's game that does not exist looks the same.
    replies.append(await game(client, me[1], friend[0], "never-was"))
    for target in ("not-a-uuid", "feed"):
        replies.append(await games(client, me[1], target))
    assert len(replies) == 27
    assert {(r.status_code, r.text) for r in replies} == {(404, json.dumps(NOT_FOUND, separators=(",", ":")))}


async def test_a_friend_removed_while_their_games_are_open(client):
    me = await player(client)
    friend = await player(client)
    await befriend(client, me, friend)
    await put_game(client, friend[1], "g1", iso(1), app_replay())
    assert (await games(client, me[1], friend[0])).status_code == 200
    await remove(client, friend[1], me[0])  # removed from the other side
    assert (await games(client, me[1], friend[0])).status_code == 404
    assert (await game(client, me[1], friend[0], "g1")).status_code == 404


async def test_a_friends_id_is_matched_in_either_case(client):
    me = await player(client)
    friend = await player(client)
    await befriend(client, me, friend)
    await put_game(client, friend[1], "g1", iso(1), app_replay())
    assert (await games(client, me[1], friend[0].upper())).status_code == 200
    assert (await game(client, me[1], friend[0].upper(), "g1")).status_code == 200


# ── Auth and limits ──────────────────────────────────────────────────


@pytest.mark.parametrize("path", ["/feed", f"/{UNKNOWN_ID}/games", f"/{UNKNOWN_ID}/games/g1"])
async def test_the_reads_need_a_device_token(client, path):
    for headers in ({}, {"Authorization": "Bearer nope"}):
        r = await client.get(f"/api/sync/friends{path}", headers=headers)
        assert r.status_code == 401


async def test_reads_have_their_own_limit_shared_by_the_three_routes(client, clock):
    me = await player(client)
    friend = await player(client)
    await befriend(client, me, friend)
    await put_game(client, friend[1], "g1", iso(1), app_replay())
    limit = sync_friends.read_player_limiter.limit
    for n in range(limit):
        path = ("/feed", f"/{friend[0]}/games", f"/{friend[0]}/games/g1")[n % 3]
        assert (await client.get(f"/api/sync/friends{path}", headers=me[1])).status_code == 200
    for path in ("/feed", f"/{friend[0]}/games", f"/{friend[0]}/games/g1"):
        r = await client.get(f"/api/sync/friends{path}", headers=me[1])
        assert r.status_code == 429
        assert int(r.headers["Retry-After"]) >= 1
    # Another player reads on; sending a request is untouched by reading.
    assert (await client.get("/api/sync/friends/feed", headers=friend[1])).status_code == 200
    stranger = await player(client)
    assert (await send(client, me[1], await code_of(client, stranger[1]))).status_code == 202
    # The lists and the card are not counted.
    assert (await client.get("/api/sync/friends", headers=me[1])).status_code == 200
    assert (await client.get(f"/api/sync/friends/{friend[0]}", headers=me[1])).status_code == 200
    clock.advance(3600)
    assert (await client.get("/api/sync/friends/feed", headers=me[1])).status_code == 200


async def test_sending_requests_never_uses_up_reads(client):
    me = await player(client)
    for _ in range(sync_friends.request_player_limiter.limit):
        await send(client, me[1], "ZZZZZZZZ")
    assert (await send(client, me[1], "ZZZZZZZZ")).status_code == 429
    assert (await client.get("/api/sync/friends/feed", headers=me[1])).status_code == 200


def test_checked_replay_refuses_what_is_not_an_object():
    for payload in (None, [], "x", 5, {"sgf": None}, {}):
        assert checked_replay(payload) is None
