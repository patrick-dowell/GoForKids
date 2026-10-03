"""Sync friends, Revision 8 (plan 32): a feed result names the friend's
replay of that game (`game_id`), by the id the app now records on the
history entry, or for older results by time: same friend, same board, same
outcome, the replay's date within a minute of the result, nearest first,
each replay once."""

import json
import sqlite3
from datetime import datetime, timezone
from urllib.parse import quote

import pytest

from app.routers import sync_friends
from app.sync.feed_games import MATCH_WINDOW_MS, claimed_id, date_ms
from tests.test_sync_friends import INJECTED, NOT_FOUND, T, befriend, history_entry, player, remove
from tests.test_sync_friends_feed import (
    APP_SGF, app_id, app_replay, feed, game, games, ladder, promotion, put_game,
)

SECOND = 1000
LOST_SGF = APP_SGF.replace("RE[B+5.5]", "RE[W+R]")
SGF_19 = APP_SGF.replace("SZ[9]", "SZ[19]")


@pytest.fixture(autouse=True)
def fresh_read_limit():
    sync_friends.read_player_limiter.reset()
    yield
    sync_friends.read_player_limiter.reset()


def at(ms: int) -> str:
    """A replay date as the app writes it (`toISOString()`) for epoch ms."""
    stamp = datetime.fromtimestamp(ms // 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    return f"{stamp}.{ms % 1000:03d}Z"


def won(**extra):
    return app_replay(**extra)


def lost(**extra):
    return app_replay(sgf=LOST_SGF, result="White wins (resignation)", **extra)


async def friend_with(client, me, nine=(), nineteen=(), promotions=()):
    """A friend whose 9x9 and 19x19 histories are these entries."""
    boards = {"nine": ("18k", list(nine), list(promotions))}
    if nineteen:
        boards["nineteen"] = ("20k", list(nineteen), [])
    friend = await player(client, ladder(**boards))
    await befriend(client, me, friend)
    return friend


async def links(client, me) -> dict:
    """Each game event's ts -> game_id, for one friend's feed."""
    return {e["ts"]: e["game_id"] for e in (await feed(client, me[1]))["events"] if e["kind"] == "game"}


# ── Matching by time ─────────────────────────────────────────────────


async def test_a_result_with_no_id_opens_the_replay_saved_with_it(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[history_entry("win", T + 5)])
    await put_game(client, friend[1], "a1b2c3d4", at(T), won())  # saved, then recorded
    assert await links(client, me) == {T + 5: "a1b2c3d4"}
    r = await game(client, me[1], friend[0], "a1b2c3d4")
    assert r.status_code == 200


@pytest.mark.parametrize("offset,linked", [
    (0, True), (-MATCH_WINDOW_MS, True), (MATCH_WINDOW_MS, True),
    (-MATCH_WINDOW_MS - 1, False), (MATCH_WINDOW_MS + 1, False),
])
async def test_the_window_is_a_minute_either_side(client, offset, linked):
    assert MATCH_WINDOW_MS == 60 * SECOND
    me = await player(client)
    friend = await friend_with(client, me, nine=[history_entry("win", T)])
    await put_game(client, friend[1], app_id("g1"), at(T + offset), won())
    assert await links(client, me) == {T: app_id("g1") if linked else None}


async def test_the_nearest_replay_wins(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[history_entry("win", T)])
    await put_game(client, friend[1], app_id("far"), at(T - 40 * SECOND), won())
    await put_game(client, friend[1], app_id("near"), at(T - 30), won())
    await put_game(client, friend[1], app_id("later"), at(T + 50 * SECOND), won())
    assert await links(client, me) == {T: app_id("near")}


async def test_the_nearest_pair_goes_first_so_neighbouring_games_keep_their_own(client):
    # Two games a few seconds apart: each result is milliseconds from its own
    # replay and seconds from the other's.
    me = await player(client)
    friend = await friend_with(client, me, nine=[
        history_entry("win", T), history_entry("win", T + 40 * SECOND),
    ])
    await put_game(client, friend[1], app_id("first"), at(T - 20), won())
    await put_game(client, friend[1], app_id("second"), at(T + 35 * SECOND), won())
    assert await links(client, me) == {T: app_id("first"), T + 40 * SECOND: app_id("second")}


async def test_each_replay_opens_one_result_at_most(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[
        history_entry("win", T), history_entry("win", T + 10 * SECOND),
    ])
    await put_game(client, friend[1], app_id("only"), at(T + 6 * SECOND), won())
    assert await links(client, me) == {T: None, T + 10 * SECOND: app_id("only")}


async def test_a_result_whose_replay_is_missing_opens_nothing(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[history_entry("win", T)], nineteen=[
        history_entry("loss", T + 2 * 60 * SECOND),
    ])
    await put_game(client, friend[1], app_id("old"), at(T - 3600 * SECOND), won())
    assert await links(client, me) == {T: None, T + 2 * 60 * SECOND: None}


async def test_only_a_replay_of_the_same_board_and_outcome_matches(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[history_entry("win", T)])
    await put_game(client, friend[1], app_id("on-19"), at(T), won(sgf=SGF_19))
    await put_game(client, friend[1], app_id("a-loss"), at(T + 1), lost())
    await put_game(client, friend[1], app_id("watched"), at(T + 2), won(
        gameType="bot-vs-bot", opponentRank="12k vs 9k"))
    await put_game(client, friend[1], app_id("unservable"), at(T + 3), won(sgf="(;SZ[9];B[jj])"))
    await put_game(client, friend[1], app_id("no-result"), at(T + 4), won(sgf=APP_SGF, result=None))
    assert await links(client, me) == {T: None}
    await put_game(client, friend[1], app_id("this-one"), at(T + 30 * SECOND), won())
    assert await links(client, me) == {T: app_id("this-one")}


async def test_a_loss_opens_the_lost_game(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[history_entry("loss", T)])
    await put_game(client, friend[1], app_id("won"), at(T), won())
    await put_game(client, friend[1], app_id("lost"), at(T + 9), lost())
    assert await links(client, me) == {T: app_id("lost")}


async def test_a_result_past_the_cut_keeps_its_own_replay(client):
    # The friend's older result is not shown (49 newer results from another
    # friend fill the feed), yet its replay is still its own.
    me = await player(client)
    friend = await friend_with(client, me, nine=[
        history_entry("win", T), history_entry("win", T + 20 * SECOND),
    ])
    await put_game(client, friend[1], app_id("the-older-game"), at(T + 5), won())
    await friend_with(client, me, nine=[
        history_entry("loss", T + 3600 * SECOND + n) for n in range(sync_friends.FEED_LIMIT - 1)
    ])
    events = (await feed(client, me[1]))["events"]
    assert len(events) == sync_friends.FEED_LIMIT
    mine = [e for e in events if e["player_id"] == friend[0]]
    assert [(e["ts"], e["game_id"]) for e in mine] == [(T + 20 * SECOND, None)]


# ── A result that names its replay ───────────────────────────────────


async def test_a_result_with_an_id_opens_that_replay_whenever_it_was_saved(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[
        history_entry("win", T, gameId=app_id("linked")),
        history_entry("win", T + 3600 * SECOND),
    ])
    # Named: found by id however far its date is. Then it is used, so the
    # result an hour later (no id, its own replay missing) does not take it.
    await put_game(client, friend[1], app_id("linked"), at(T + 3600 * SECOND + 5), won())
    assert await links(client, me) == {T: app_id("linked"), T + 3600 * SECOND: None}


async def test_a_named_replay_that_is_gone_opens_nothing_and_never_falls_back_to_time(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[history_entry("win", T, gameId=app_id("deleted"))])
    await put_game(client, friend[1], app_id("same-time"), at(T), won())
    assert await links(client, me) == {T: None}


async def test_a_named_replay_that_fails_its_check_opens_nothing(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[history_entry("win", T, gameId=app_id("odd"))])
    await put_game(client, friend[1], app_id("odd"), at(T), won(sgf="(;SZ[9];B[jj])"))
    assert await links(client, me) == {T: None}


async def test_a_replay_named_twice_opens_the_newer_result(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[
        history_entry("win", T, gameId=app_id("twice")), history_entry("win", T + 9, gameId=app_id("twice")),
    ])
    await put_game(client, friend[1], app_id("twice"), at(T), won())
    assert await links(client, me) == {T: None, T + 9: app_id("twice")}


async def test_an_id_out_of_shape_or_naming_nothing_never_reaches_the_feed(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[
        history_entry("win", T, gameId=INJECTED),
        history_entry("win", T + 1, gameId=f"{INJECTED} with spaces"),
        history_entry("win", T + 2, gameId=5),
    ], promotions=[promotion("19k", "18k", T + 2)])
    r = await client.get("/api/sync/friends/feed", headers=me[1])
    assert INJECTED not in r.text
    assert "_claim" not in r.text
    events = r.json()["events"]
    # Out of shape counts as no id at all: matched by time (nothing here).
    assert [e.get("game_id", "absent") for e in events] == ["absent", None, None, None]
    assert events[0]["kind"] == "promotion"


# ── The two shapes of id the app writes ──────────────────────────────
#
# A replay's id is its Library id (gameStore.autoSaveGame): the game's
# backend id, which is 8 lowercase hex digits whether the server made it
# (`str(uuid.uuid4())[:8]`) or the device did (localGameRouter.newGameId, 4
# random bytes each padded to two hex digits); or, when the backend was out
# of reach, "local-" and Date.now() in decimal. No build has written another
# shape, so a friend's replay is read only under one of these two.

APP_IDS = ["a1b2c3d4", "00000000", "ffffffff", "0f1e2d3c", "local-1759363200000", "local-0"]
NOT_APP_IDS = [
    "linked", "g1", "a-loss", "watched",                                # words
    "a1b2c3d", "a1b2c3d4e", "a1b2c3d4a1b2c3d4", "",                     # wrong length
    "abcdefgh", "a1b2c3dz", "A1B2C3D4", "a1b2C3d4",                     # not lowercase hex
    "remote-1759363200000", "Local-1759363200000", "local_1759363200000",
    "1759363200000", "game-a1b2c3d4",                                   # other prefixes
    "local-", "local-17593632000x", "local--1759363200000", "local-1.5",
    "local-١٢٣",                                         # not ASCII digits
    "a1b2c3d4\n", "local-1759363200000\n", " a1b2c3d4", "a1b2c3d4 ",   # a newline, a space
    "x" * 128,
]


def test_an_id_is_read_only_in_a_shape_the_app_writes():
    for good in APP_IDS:
        assert claimed_id(good) == good
    for bad in NOT_APP_IDS:
        assert claimed_id(bad) is None, repr(bad)


@pytest.mark.parametrize("good", ["0f1e2d3c", "local-1759363200000"])
async def test_a_replay_under_either_shape_is_listed_opens_and_is_named(client, good):
    me = await player(client)
    friend = await friend_with(client, me, nine=[history_entry("win", T, gameId=good)])
    await put_game(client, friend[1], good, at(T + 3600 * SECOND), won())
    r = await games(client, me[1], friend[0])
    assert [g["id"] for g in r.json()["games"]] == [good]
    assert (await game(client, me[1], friend[0], good)).status_code == 200
    assert await links(client, me) == {T: good}


@pytest.mark.parametrize("bad", ["linked", "A1B2C3D4", "a1b2c3d", "remote-1759363200000",
                                 "local-1759363200000\n"])
async def test_a_replay_under_any_other_id_is_never_a_friends(client, sync_db, bad):
    # Stored as an older server might hold it, named by one result and in the
    # time window of another: neither links it, and it is neither listed nor
    # opened.
    me = await player(client)
    friend = await friend_with(client, me, nine=[
        history_entry("win", T, gameId=bad), history_entry("win", T + 10 * SECOND),
    ])
    with sqlite3.connect(sync_db) as db:
        db.execute(
            """INSERT INTO sync_games (player_id, game_id, date, payload, updated_at)
               VALUES (?, ?, ?, ?, ?)""",
            (friend[0], bad, at(T + 5 * SECOND), json.dumps(won()), at(T)),
        )
    assert (await games(client, me[1], friend[0])).json() == {"games": []}
    r = await game(client, me[1], friend[0], quote(bad, safe=""))
    assert (r.status_code, r.json()) == (404, NOT_FOUND)
    assert await links(client, me) == {T: None, T + 10 * SECOND: None}


# ── Only friends ─────────────────────────────────────────────────────


async def test_another_players_replay_is_never_matched(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[history_entry("win", T)])
    stranger = await player(client)
    await put_game(client, stranger[1], app_id("strangers"), at(T), won())
    assert await links(client, me) == {T: None}


async def test_a_game_from_the_feed_is_the_cards_404_once_they_are_not_friends(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[history_entry("win", T)])
    await put_game(client, friend[1], app_id("g1"), at(T), won())
    assert await links(client, me) == {T: app_id("g1")}
    await remove(client, friend[1], me[0])  # removed from the other side
    assert (await feed(client, me[1]))["events"] == []
    r = await game(client, me[1], friend[0], app_id("g1"))
    assert (r.status_code, r.json()) == (404, NOT_FOUND)


# ── Dates ────────────────────────────────────────────────────────────


def test_a_date_is_read_only_in_the_apps_shape():
    assert date_ms("2025-10-02T00:00:00.000Z") == T
    assert date_ms("2025-10-02T00:00:00.5Z") == T + 500
    assert date_ms("2025-10-02T00:00:00.123456Z") == T + 123
    assert date_ms("2025-10-02T00:00:00Z") == T
    for bad in ("2025-02-30T00:00:00.000Z", "2025-10-02", "2025-10-02T00:00:00.000+00:00",
                "2025-10-02T00:00:00.000Z\n", None, 5, INJECTED):
        assert date_ms(bad) is None
