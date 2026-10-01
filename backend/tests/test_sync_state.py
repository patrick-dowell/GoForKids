"""Sync: creating a record, reading and writing its state, and device auth."""

import asyncio

import pytest

from tests.sync_helpers import DEFAULT_STATE, bearer, new_player

LADDER = {"byBoardSize": {"9x9": {"rungState": {"rung": 3}, "history": []}}, "undoBank": 3}


# ── POST /players ────────────────────────────────────────────────────


async def test_create_player_returns_record_at_rev_1(client):
    state = {"schema": 1, "ladder": LADDER, "lessons": ["a", "b"], "avatar": "comet",
             "avatarPicked": True}
    r = await client.post("/api/sync/players", json={"state": state})
    assert r.status_code == 201
    body = r.json()
    assert set(body) == {"player_id", "device_token", "rev", "state"}
    assert body["rev"] == 1
    assert body["state"] == state
    assert body["player_id"] and body["device_token"]

    r = await client.get("/api/sync/state", headers=bearer(body["device_token"]))
    assert r.status_code == 200
    assert r.json() == {"rev": 1, "state": state}


async def test_two_creates_get_distinct_records_and_tokens(client):
    a, _ = await new_player(client)
    b, _ = await new_player(client)
    assert a["player_id"] != b["player_id"]
    assert a["device_token"] != b["device_token"]


@pytest.mark.parametrize("key", ["displayName", "name", "settings"])
async def test_create_refuses_key_outside_allowlist(client, key):
    r = await client.post(
        "/api/sync/players", json={"state": {"schema": 1, key: "anything"}}
    )
    assert r.status_code == 422


async def test_create_refuses_oversized_state(client):
    big = {"schema": 1, "lessons": ["x" * (512 * 1024)]}
    r = await client.post("/api/sync/players", json={"state": big})
    assert r.status_code == 413


async def test_size_limit_is_512_kb_of_compact_json(client):
    wrapper = len('{"lessons":[""]}')
    at_limit = {"lessons": ["x" * (512 * 1024 - wrapper)]}
    r = await client.post("/api/sync/players", json={"state": at_limit})
    assert r.status_code == 201
    over = {"lessons": ["x" * (512 * 1024 - wrapper + 1)]}
    r = await client.post("/api/sync/players", json={"state": over})
    assert r.status_code == 413


async def test_create_refuses_non_object_state(client):
    r = await client.post("/api/sync/players", json={"state": ["schema"]})
    assert r.status_code == 422


# ── PUT /state ───────────────────────────────────────────────────────


async def test_put_state_advances_revision(client):
    _, auth = await new_player(client)
    new_state = {"schema": 1, "ladder": LADDER, "lessons": ["intro", "capture"]}
    r = await client.put("/api/sync/state", json={"base_rev": 1, "state": new_state}, headers=auth)
    assert r.status_code == 200
    assert r.json() == {"rev": 2}

    r = await client.put(
        "/api/sync/state", json={"base_rev": 2, "state": {"schema": 1}}, headers=auth
    )
    assert r.json() == {"rev": 3}

    r = await client.get("/api/sync/state", headers=auth)
    assert r.json() == {"rev": 3, "state": {"schema": 1}}


@pytest.mark.parametrize("stale", [0, 1, 5])
async def test_put_state_with_wrong_base_rev_returns_servers_copy(client, stale):
    _, auth = await new_player(client)
    current = {"schema": 1, "lessons": ["intro", "atari"]}
    await client.put("/api/sync/state", json={"base_rev": 1, "state": current}, headers=auth)

    r = await client.put(
        "/api/sync/state", json={"base_rev": stale, "state": {"lessons": []}}, headers=auth
    )
    assert r.status_code == 409
    assert r.json() == {"rev": 2, "state": current}

    r = await client.get("/api/sync/state", headers=auth)
    assert r.json() == {"rev": 2, "state": current}


async def test_concurrent_writes_on_same_base_rev_exactly_one_wins(client):
    _, auth = await new_player(client)
    a = {"schema": 1, "lessons": ["from-a"]}
    b = {"schema": 1, "lessons": ["from-b"]}
    ra, rb = await asyncio.gather(
        client.put("/api/sync/state", json={"base_rev": 1, "state": a}, headers=auth),
        client.put("/api/sync/state", json={"base_rev": 1, "state": b}, headers=auth),
    )
    assert sorted([ra.status_code, rb.status_code]) == [200, 409]
    winner, loser = (ra, rb) if ra.status_code == 200 else (rb, ra)
    winning_state = a if winner is ra else b
    assert winner.json() == {"rev": 2}
    assert loser.json() == {"rev": 2, "state": winning_state}

    r = await client.get("/api/sync/state", headers=auth)
    assert r.json() == {"rev": 2, "state": winning_state}


async def test_put_state_refuses_display_name_and_leaves_record_alone(client):
    _, auth = await new_player(client)
    r = await client.put(
        "/api/sync/state",
        json={"base_rev": 1, "state": {"schema": 1, "displayName": "someone"}},
        headers=auth,
    )
    assert r.status_code == 422
    r = await client.get("/api/sync/state", headers=auth)
    assert r.json() == {"rev": 1, "state": DEFAULT_STATE}


async def test_put_state_refuses_oversized_state(client):
    _, auth = await new_player(client)
    big = {"schema": 1, "ladder": {"blob": "x" * (600 * 1024)}}
    r = await client.put("/api/sync/state", json={"base_rev": 1, "state": big}, headers=auth)
    assert r.status_code == 413
    r = await client.get("/api/sync/state", headers=auth)
    assert r.json()["rev"] == 1


async def test_put_state_requires_base_rev(client):
    _, auth = await new_player(client)
    r = await client.put("/api/sync/state", json={"state": {"schema": 1}}, headers=auth)
    assert r.status_code == 422


# ── Isolation ────────────────────────────────────────────────────────


async def test_each_token_reads_and_writes_only_its_own_record(client):
    a_state = {"schema": 1, "lessons": ["a-only"]}
    b_state = {"schema": 1, "lessons": ["b-only"]}
    _, a = await new_player(client, a_state)
    _, b = await new_player(client, b_state)

    r = await client.put(
        "/api/sync/state", json={"base_rev": 1, "state": {"lessons": ["b2"]}}, headers=b
    )
    assert r.json() == {"rev": 2}

    r = await client.get("/api/sync/state", headers=a)
    assert r.json() == {"rev": 1, "state": a_state}
    r = await client.get("/api/sync/state", headers=b)
    assert r.json() == {"rev": 2, "state": {"lessons": ["b2"]}}


# ── Auth on every token route ────────────────────────────────────────

TOKEN_ROUTES = [
    ("POST", "/api/sync/pairing-codes", None),
    ("GET", "/api/sync/state", None),
    ("PUT", "/api/sync/state", {"base_rev": 1, "state": {"schema": 1}}),
    ("GET", "/api/sync/games", None),
    ("GET", "/api/sync/games/g1", None),
    ("PUT", "/api/sync/games/g1", {"date": "2026-01-01T00:00:00.000Z",
                                   "payload": {"sgf": "(;)"}}),
    ("DELETE", "/api/sync/games/g1", None),
    ("DELETE", "/api/sync/devices/current", None),
]


async def _call(client, method, path, body, headers):
    return await client.request(method, path, json=body, headers=headers)


@pytest.mark.parametrize("method,path,body", TOKEN_ROUTES)
async def test_missing_token_is_401(client, method, path, body):
    r = await _call(client, method, path, body, {})
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize("method,path,body", TOKEN_ROUTES)
@pytest.mark.parametrize("header", ["Bearer not-a-real-token", "Basic dXNlcjpwYXNz", "Bearer"])
async def test_unknown_or_malformed_token_is_401(client, method, path, body, header):
    await new_player(client)
    r = await _call(client, method, path, body, {"Authorization": header})
    assert r.status_code == 401


@pytest.mark.parametrize("method,path,body", TOKEN_ROUTES)
async def test_revoked_token_is_401(client, method, path, body):
    _, auth = await new_player(client)
    r = await client.delete("/api/sync/devices/current", headers=auth)
    assert r.status_code == 204
    r = await _call(client, method, path, body, auth)
    assert r.status_code == 401


async def test_revoking_one_device_leaves_the_others_working(client):
    _, first = await new_player(client)
    r = await client.post("/api/sync/pairing-codes", headers=first)
    r = await client.post("/api/sync/pairing-codes/redeem", json={"code": r.json()["code"]})
    second = bearer(r.json()["device_token"])

    assert (await client.delete("/api/sync/devices/current", headers=first)).status_code == 204
    assert (await client.get("/api/sync/state", headers=first)).status_code == 401
    r = await client.get("/api/sync/state", headers=second)
    assert r.status_code == 200
    assert r.json()["state"] == DEFAULT_STATE
