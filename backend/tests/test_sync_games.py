"""Sync: the replay library (list, fetch, store, delete, the 100-game cap)."""

import sqlite3

import pytest

from tests.sync_helpers import iso, new_player, replay


async def _put(client, auth, game_id, date, payload=None):
    return await client.put(
        f"/api/sync/games/{game_id}",
        json={"date": date, "payload": payload if payload is not None else replay()},
        headers=auth,
    )


async def _ids(client, auth):
    r = await client.get("/api/sync/games", headers=auth)
    assert r.status_code == 200
    return [g["id"] for g in r.json()["games"]]


async def test_put_get_list_delete_round_trip(client):
    _, auth = await new_player(client)
    payload = replay(moveCount=1, playerColor="black")
    r = await _put(client, auth, "g1", iso(1), payload)
    assert r.status_code == 200
    assert r.json() == {"kept": True}

    r = await client.get("/api/sync/games/g1", headers=auth)
    assert r.status_code == 200
    assert r.json() == {"id": "g1", "date": iso(1), "payload": payload}

    r = await client.get("/api/sync/games", headers=auth)
    assert r.json() == {"games": [{"id": "g1", "date": iso(1)}]}

    r = await client.delete("/api/sync/games/g1", headers=auth)
    assert r.status_code == 204
    assert (await client.get("/api/sync/games/g1", headers=auth)).status_code == 404
    assert await _ids(client, auth) == []


async def test_delete_of_missing_game_is_204(client):
    _, auth = await new_player(client)
    r = await client.delete("/api/sync/games/never-was", headers=auth)
    assert r.status_code == 204


async def test_get_missing_game_is_404(client):
    _, auth = await new_player(client)
    r = await client.get("/api/sync/games/nope", headers=auth)
    assert r.status_code == 404


async def test_list_is_newest_first_with_ties_broken_by_id(client):
    _, auth = await new_player(client)
    await _put(client, auth, "old", iso(1))
    await _put(client, auth, "tie-a", iso(5))
    await _put(client, auth, "new", iso(9))
    await _put(client, auth, "tie-b", iso(5))
    assert await _ids(client, auth) == ["new", "tie-b", "tie-a", "old"]


async def test_second_put_of_same_id_replaces_the_first(client):
    _, auth = await new_player(client)
    await _put(client, auth, "g1", iso(1), replay(sgf="(;first)"))
    r = await _put(client, auth, "g1", iso(2), replay(sgf="(;second)"))
    assert r.json() == {"kept": True}

    r = await client.get("/api/sync/games/g1", headers=auth)
    assert r.json()["date"] == iso(2)
    assert r.json()["payload"]["sgf"] == "(;second)"
    assert await _ids(client, auth) == ["g1"]


async def test_cap_keeps_the_newest_100(client):
    _, auth = await new_player(client)
    for n in range(101):
        r = await _put(client, auth, f"g{n:03d}", iso(n))
        assert r.json() == {"kept": True}, n

    ids = await _ids(client, auth)
    assert len(ids) == 100
    assert ids == [f"g{n:03d}" for n in range(100, 0, -1)]
    assert (await client.get("/api/sync/games/g000", headers=auth)).status_code == 404

    # Re-sending the evicted oldest game is accepted but not kept, and
    # nothing newer is pushed out to make room for it.
    r = await _put(client, auth, "g000", iso(0))
    assert r.status_code == 200
    assert r.json() == {"kept": False}
    assert await _ids(client, auth) == ids


async def test_replacing_a_game_at_the_cap_evicts_nothing(client):
    _, auth = await new_player(client)
    for n in range(1, 101):
        await _put(client, auth, f"g{n:03d}", iso(n))
    r = await _put(client, auth, "g050", iso(0))
    assert r.json() == {"kept": True}
    ids = await _ids(client, auth)
    assert len(ids) == 100
    assert ids[-1] == "g050"


async def test_cap_counts_each_player_separately(client):
    _, a = await new_player(client)
    _, b = await new_player(client)
    for n in range(100):
        await _put(client, a, f"a{n:03d}", iso(n))
    r = await _put(client, b, "b-old", iso(0))
    assert r.json() == {"kept": True}
    assert len(await _ids(client, a)) == 100


async def test_selector_log_is_stripped_before_storing(client, sync_db):
    _, auth = await new_player(client)
    payload = replay(selectorLog=["diagnostic-line-one", "diagnostic-line-two"])
    r = await _put(client, auth, "g1", iso(1), payload)
    assert r.status_code == 200

    fetched = (await client.get("/api/sync/games/g1", headers=auth)).json()["payload"]
    assert "selectorLog" not in fetched
    assert fetched["sgf"] == payload["sgf"]

    with sqlite3.connect(sync_db) as db:
        stored = db.execute("SELECT payload FROM sync_games").fetchone()[0]
    assert "diagnostic-line" not in stored


async def test_selector_log_does_not_count_toward_the_size_limit(client):
    _, auth = await new_player(client)
    payload = replay(selectorLog=["x" * (2 * 1024 * 1024)])
    r = await _put(client, auth, "g1", iso(1), payload)
    assert r.status_code == 200


async def test_oversized_replay_is_413(client):
    _, auth = await new_player(client)
    r = await _put(client, auth, "g1", iso(1), replay(scoreHistory="x" * (1024 * 1024)))
    assert r.status_code == 413
    assert await _ids(client, auth) == []


@pytest.mark.parametrize("payload", [{}, {"sgf": ""}, {"sgf": None}, {"sgf": 7},
                                     {"selectorLog": [], "result": "B+R"}])
async def test_replay_without_sgf_is_422(client, payload):
    _, auth = await new_player(client)
    r = await _put(client, auth, "g1", iso(1), payload)
    assert r.status_code == 422
    assert await _ids(client, auth) == []


async def test_replay_without_date_is_422(client):
    _, auth = await new_player(client)
    r = await client.put("/api/sync/games/g1", json={"payload": replay()}, headers=auth)
    assert r.status_code == 422


async def test_one_player_cannot_read_or_delete_anothers_game(client):
    _, a = await new_player(client)
    _, b = await new_player(client)
    await _put(client, a, "shared-id", iso(1), replay(sgf="(;a)"))

    assert await _ids(client, b) == []
    assert (await client.get("/api/sync/games/shared-id", headers=b)).status_code == 404
    assert (await client.delete("/api/sync/games/shared-id", headers=b)).status_code == 204
    r = await client.get("/api/sync/games/shared-id", headers=a)
    assert r.status_code == 200
    assert r.json()["payload"]["sgf"] == "(;a)"

    # The same id written by the other player is a separate row.
    await _put(client, b, "shared-id", iso(2), replay(sgf="(;b)"))
    r = await client.get("/api/sync/games/shared-id", headers=a)
    assert r.json()["payload"]["sgf"] == "(;a)"
    r = await client.get("/api/sync/games/shared-id", headers=b)
    assert r.json()["payload"]["sgf"] == "(;b)"
