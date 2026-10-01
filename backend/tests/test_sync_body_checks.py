"""Sync: request bodies that would otherwise be stored and then break reads.

Python's JSON parser accepts NaN, Infinity and overflowing literals, and
the revision is an integer the client compares exactly. These are sent as
raw bytes, since a well-behaved JSON encoder would refuse to write them.
"""

import pytest

from tests.sync_helpers import DEFAULT_STATE, iso, new_player

JSON = {"Content-Type": "application/json"}

NON_FINITE = ["NaN", "Infinity", "-Infinity", "1e999"]


async def _send(client, method, path, raw: str, headers=None):
    return await client.request(
        method, path, content=raw.encode(), headers={**JSON, **(headers or {})}
    )


# ── Non-finite numbers ───────────────────────────────────────────────


@pytest.mark.parametrize("bad", NON_FINITE)
async def test_create_refuses_non_finite_number(client, bad):
    raw = f'{{"state": {{"schema": 1, "ladder": {{"byBoardSize": {{"9x9": {{"r": {bad}}}}}}}}}}}'
    r = await _send(client, "POST", "/api/sync/players", raw)
    assert r.status_code == 422


@pytest.mark.parametrize("bad", NON_FINITE)
async def test_put_state_refuses_non_finite_number(client, bad):
    _, auth = await new_player(client)
    raw = f'{{"base_rev": 1, "state": {{"schema": 1, "lessons": [1, [2, {bad}]]}}}}'
    r = await _send(client, "PUT", "/api/sync/state", raw, auth)
    assert r.status_code == 422

    r = await client.get("/api/sync/state", headers=auth)
    assert r.status_code == 200
    assert r.json() == {"rev": 1, "state": DEFAULT_STATE}


@pytest.mark.parametrize("bad", NON_FINITE)
async def test_put_game_refuses_non_finite_number(client, bad):
    _, auth = await new_player(client)
    raw = (
        f'{{"date": "{iso(1)}", "payload": {{"sgf": "(;)", '
        f'"scoreHistory": [{{"move": 1, "lead": {bad}}}]}}}}'
    )
    r = await _send(client, "PUT", "/api/sync/games/g1", raw, auth)
    assert r.status_code == 422

    r = await client.get("/api/sync/games/g1", headers=auth)
    assert r.status_code == 404


@pytest.mark.parametrize(
    "raw",
    [
        # Inside a part of the payload that is stripped before storing.
        '{"date": "2026-01-01T00:00:00.000Z", "payload": {"sgf": "(;)", "selectorLog": [NaN]}}',
        # Inside an envelope key the server ignores.
        '{"date": "2026-01-01T00:00:00.000Z", "payload": {"sgf": "(;)"}, "extra": Infinity}',
    ],
)
async def test_non_finite_anywhere_in_the_body_is_refused(client, raw):
    _, auth = await new_player(client)
    r = await _send(client, "PUT", "/api/sync/games/g1", raw, auth)
    assert r.status_code == 422


async def test_finite_floats_are_stored_and_read_back(client):
    _, auth = await new_player(client)
    state = {"schema": 1, "ladder": {"rating": 1512.25, "tiny": -1e-300, "big": 1e300}}
    r = await client.put("/api/sync/state", json={"base_rev": 1, "state": state}, headers=auth)
    assert r.status_code == 200
    r = await client.get("/api/sync/state", headers=auth)
    assert r.json()["state"] == state


async def test_non_finite_body_without_a_token_is_still_401(client):
    raw = '{"base_rev": 1, "state": {"lessons": [NaN]}}'
    r = await _send(client, "PUT", "/api/sync/state", raw)
    assert r.status_code == 401


# ── base_rev ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "raw_rev",
    [
        str(2**70),  # once an unhandled overflow in the database driver
        str(2**53 + 1),
        "-1",
        '"1"',  # a string
        "1.0",  # a float, even one with an integer value
        "true",  # a boolean, which would have coerced to 1
        "null",
    ],
)
async def test_base_rev_must_be_a_json_integer_in_range(client, raw_rev):
    _, auth = await new_player(client)
    raw = f'{{"base_rev": {raw_rev}, "state": {{"schema": 1}}}}'
    r = await _send(client, "PUT", "/api/sync/state", raw, auth)
    assert r.status_code == 422

    r = await client.get("/api/sync/state", headers=auth)
    assert r.json() == {"rev": 1, "state": DEFAULT_STATE}


@pytest.mark.parametrize("raw_rev,status", [("0", 409), ("1", 200), (str(2**53), 409)])
async def test_base_rev_bounds_are_inclusive(client, raw_rev, status):
    _, auth = await new_player(client)
    raw = f'{{"base_rev": {raw_rev}, "state": {{"schema": 1}}}}'
    r = await _send(client, "PUT", "/api/sync/state", raw, auth)
    assert r.status_code == status
