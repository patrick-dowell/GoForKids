"""Sync friends, Revision 8 (plan 32): a feed result names the friend's
replay of that game (`game_id`), by the id the app now records on the
history entry, or for older results by time: same friend, same board, same
outcome, the replay's date within a minute of the result, nearest first,
each replay once."""

from datetime import datetime, timezone

import pytest

from app.routers import sync_friends
from app.sync.feed_games import MATCH_WINDOW_MS, date_ms
from tests.test_sync_friends import INJECTED, NOT_FOUND, T, befriend, history_entry, player, remove
from tests.test_sync_friends_feed import APP_SGF, app_replay, feed, game, ladder, promotion, put_game

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
    await put_game(client, friend[1], "g1", at(T + offset), won())
    assert await links(client, me) == {T: "g1" if linked else None}


async def test_the_nearest_replay_wins(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[history_entry("win", T)])
    await put_game(client, friend[1], "far", at(T - 40 * SECOND), won())
    await put_game(client, friend[1], "near", at(T - 30), won())
    await put_game(client, friend[1], "later", at(T + 50 * SECOND), won())
    assert await links(client, me) == {T: "near"}


async def test_the_nearest_pair_goes_first_so_neighbouring_games_keep_their_own(client):
    # Two games a few seconds apart: each result is milliseconds from its own
    # replay and seconds from the other's.
    me = await player(client)
    friend = await friend_with(client, me, nine=[
        history_entry("win", T), history_entry("win", T + 40 * SECOND),
    ])
    await put_game(client, friend[1], "first", at(T - 20), won())
    await put_game(client, friend[1], "second", at(T + 35 * SECOND), won())
    assert await links(client, me) == {T: "first", T + 40 * SECOND: "second"}


async def test_each_replay_opens_one_result_at_most(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[
        history_entry("win", T), history_entry("win", T + 10 * SECOND),
    ])
    await put_game(client, friend[1], "only", at(T + 6 * SECOND), won())
    assert await links(client, me) == {T: None, T + 10 * SECOND: "only"}


async def test_a_result_whose_replay_is_missing_opens_nothing(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[history_entry("win", T)], nineteen=[
        history_entry("loss", T + 2 * 60 * SECOND),
    ])
    await put_game(client, friend[1], "old", at(T - 3600 * SECOND), won())
    assert await links(client, me) == {T: None, T + 2 * 60 * SECOND: None}


async def test_only_a_replay_of_the_same_board_and_outcome_matches(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[history_entry("win", T)])
    await put_game(client, friend[1], "on-19", at(T), won(sgf=SGF_19))
    await put_game(client, friend[1], "a-loss", at(T + 1), lost())
    await put_game(client, friend[1], "watched", at(T + 2), won(
        gameType="bot-vs-bot", opponentRank="12k vs 9k"))
    await put_game(client, friend[1], "unservable", at(T + 3), won(sgf="(;SZ[9];B[jj])"))
    await put_game(client, friend[1], "no-result", at(T + 4), won(sgf=APP_SGF, result=None))
    assert await links(client, me) == {T: None}
    await put_game(client, friend[1], "this-one", at(T + 30 * SECOND), won())
    assert await links(client, me) == {T: "this-one"}


async def test_a_loss_opens_the_lost_game(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[history_entry("loss", T)])
    await put_game(client, friend[1], "won", at(T), won())
    await put_game(client, friend[1], "lost", at(T + 9), lost())
    assert await links(client, me) == {T: "lost"}


async def test_a_result_past_the_cut_keeps_its_own_replay(client):
    # The friend's older result is not shown (49 newer results from another
    # friend fill the feed), yet its replay is still its own.
    me = await player(client)
    friend = await friend_with(client, me, nine=[
        history_entry("win", T), history_entry("win", T + 20 * SECOND),
    ])
    await put_game(client, friend[1], "the-older-game", at(T + 5), won())
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
        history_entry("win", T, gameId="linked"),
        history_entry("win", T + 3600 * SECOND),
    ])
    # Named: found by id however far its date is. Then it is used, so the
    # result an hour later (no id, its own replay missing) does not take it.
    await put_game(client, friend[1], "linked", at(T + 3600 * SECOND + 5), won())
    assert await links(client, me) == {T: "linked", T + 3600 * SECOND: None}


async def test_a_named_replay_that_is_gone_opens_nothing_and_never_falls_back_to_time(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[history_entry("win", T, gameId="deleted")])
    await put_game(client, friend[1], "same-time", at(T), won())
    assert await links(client, me) == {T: None}


async def test_a_named_replay_that_fails_its_check_opens_nothing(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[history_entry("win", T, gameId="odd")])
    await put_game(client, friend[1], "odd", at(T), won(sgf="(;SZ[9];B[jj])"))
    assert await links(client, me) == {T: None}


async def test_a_replay_named_twice_opens_the_newer_result(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[
        history_entry("win", T, gameId="twice"), history_entry("win", T + 9, gameId="twice"),
    ])
    await put_game(client, friend[1], "twice", at(T), won())
    assert await links(client, me) == {T: None, T + 9: "twice"}


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


# ── Only friends ─────────────────────────────────────────────────────


async def test_another_players_replay_is_never_matched(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[history_entry("win", T)])
    stranger = await player(client)
    await put_game(client, stranger[1], "strangers", at(T), won())
    assert await links(client, me) == {T: None}


async def test_a_game_from_the_feed_is_the_cards_404_once_they_are_not_friends(client):
    me = await player(client)
    friend = await friend_with(client, me, nine=[history_entry("win", T)])
    await put_game(client, friend[1], "g1", at(T), won())
    assert await links(client, me) == {T: "g1"}
    await remove(client, friend[1], me[0])  # removed from the other side
    assert (await feed(client, me[1]))["events"] == []
    r = await game(client, me[1], friend[0], "g1")
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
