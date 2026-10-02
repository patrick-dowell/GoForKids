"""Sync: the generated-name `handle` key in the state document.

A handle is two list positions, [adjective, noun], each from 0 to 63.
Invalid shapes are sent as raw JSON so floats and booleans reach the server
exactly as written.
"""

import pytest

from tests.sync_helpers import DEFAULT_STATE, new_player, rev_and_state

JSON = {"Content-Type": "application/json"}

INVALID_HANDLES = [
    "[]",
    "[1]",
    "[1, 2, 3]",
    "[-1, 0]",
    "[0, -1]",
    "[64, 0]",
    "[0, 64]",
    str([2**70, 0]),
    "[1.0, 2]",
    "[1, 2.5]",
    "[true, 2]",
    "[1, false]",
    '["1", 2]',
    '"1,2"',
    '{"a": 1, "n": 2}',
    "[[1], [2]]",
    "7",
    "null",
]


async def _send(client, method, path, raw, headers=None):
    return await client.request(
        method, path, content=raw.encode(), headers={**JSON, **(headers or {})}
    )


async def test_valid_handle_round_trips_through_create_get_put_and_409(client):
    state = {"schema": 1, "avatar": "comet", "handle": [0, 63]}
    created, auth = await new_player(client, state)
    assert created["state"]["handle"] == [0, 63]

    r = await client.get("/api/sync/state", headers=auth)
    assert rev_and_state(r) == {"rev": 1, "state": state}

    renamed = {**state, "handle": [63, 0]}
    r = await client.put("/api/sync/state", json={"base_rev": 1, "state": renamed}, headers=auth)
    assert r.json() == {"rev": 2}
    r = await client.get("/api/sync/state", headers=auth)
    assert r.json()["state"]["handle"] == [63, 0]

    stale = {**state, "handle": [5, 5]}
    r = await client.put("/api/sync/state", json={"base_rev": 1, "state": stale}, headers=auth)
    assert r.status_code == 409
    assert r.json() == {"rev": 2, "state": renamed}


async def test_handle_may_be_absent(client):
    created, auth = await new_player(client, {"schema": 1})
    assert "handle" not in created["state"]
    r = await client.put("/api/sync/state", json={"base_rev": 1, "state": {}}, headers=auth)
    assert r.status_code == 200


# Each refusal is paired with an acceptance on the same route, so a server
# that refused every handle would fail these too.


@pytest.mark.parametrize("handle", INVALID_HANDLES)
async def test_create_refuses_invalid_handle(client, handle):
    ok = await _send(client, "POST", "/api/sync/players", '{"state": {"handle": [1, 2]}}')
    assert ok.status_code == 201
    raw = f'{{"state": {{"schema": 1, "handle": {handle}}}}}'
    r = await _send(client, "POST", "/api/sync/players", raw)
    assert r.status_code == 422


@pytest.mark.parametrize("handle", INVALID_HANDLES)
async def test_put_state_refuses_invalid_handle(client, handle):
    _, auth = await new_player(client)
    named = {**DEFAULT_STATE, "handle": [1, 2]}
    ok = await client.put("/api/sync/state", json={"base_rev": 1, "state": named}, headers=auth)
    assert ok.status_code == 200
    raw = f'{{"base_rev": 2, "state": {{"schema": 1, "handle": {handle}}}}}'
    r = await _send(client, "PUT", "/api/sync/state", raw, auth)
    assert r.status_code == 422

    r = await client.get("/api/sync/state", headers=auth)
    assert rev_and_state(r) == {"rev": 2, "state": named}


async def test_display_name_is_still_refused_beside_a_valid_handle(client):
    r = await client.post(
        "/api/sync/players",
        json={"state": {"schema": 1, "handle": [3, 4], "displayName": "typed"}},
    )
    assert r.status_code == 422
