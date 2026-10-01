"""Sync: pairing codes that link a second device to a record."""

import re
from datetime import datetime, timezone

import pytest

from app.uploads.storage import SHARE_ID_ALPHABET
from tests.sync_helpers import DEFAULT_STATE, bearer, new_player

CODE_RE = re.compile(f"^[{SHARE_ID_ALPHABET}]{{8}}$")


async def _mint(client, auth):
    r = await client.post("/api/sync/pairing-codes", headers=auth)
    assert r.status_code == 201, r.text
    return r.json()


async def _redeem(client, code):
    return await client.post("/api/sync/pairing-codes/redeem", json={"code": code})


async def test_mint_returns_share_alphabet_code_expiring_in_ten_minutes(client, clock):
    _, auth = await new_player(client)
    body = await _mint(client, auth)
    assert set(body) == {"code", "expires_at"}
    assert CODE_RE.match(body["code"]), body["code"]
    expires = datetime.strptime(body["expires_at"], "%Y-%m-%dT%H:%M:%SZ").replace(
        tzinfo=timezone.utc
    )
    assert expires.timestamp() == clock.t + 600


async def test_redeem_links_a_device_to_the_same_record(client):
    created, first = await new_player(client)
    await client.put(
        "/api/sync/state", json={"base_rev": 1, "state": {"lessons": ["x"]}}, headers=first
    )
    code = (await _mint(client, first))["code"]

    r = await _redeem(client, code)
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"player_id", "device_token", "rev", "state"}
    assert body["player_id"] == created["player_id"]
    assert body["device_token"] != created["device_token"]
    assert body["rev"] == 2
    assert body["state"] == {"lessons": ["x"]}

    # Both devices now read and write the one record.
    second = bearer(body["device_token"])
    r = await client.put(
        "/api/sync/state", json={"base_rev": 2, "state": {"lessons": ["x", "y"]}}, headers=second
    )
    assert r.json() == {"rev": 3}
    r = await client.get("/api/sync/state", headers=first)
    assert r.json() == {"rev": 3, "state": {"lessons": ["x", "y"]}}


async def test_redeemed_code_is_refused_the_second_time(client):
    _, auth = await new_player(client)
    code = (await _mint(client, auth))["code"]
    assert (await _redeem(client, code)).status_code == 200
    r = await _redeem(client, code)
    assert r.status_code == 404


async def test_expired_code_is_refused(client, clock):
    _, auth = await new_player(client)
    code = (await _mint(client, auth))["code"]
    clock.advance(600)
    r = await _redeem(client, code)
    assert r.status_code == 404


async def test_code_still_works_just_before_expiry(client, clock):
    _, auth = await new_player(client)
    code = (await _mint(client, auth))["code"]
    clock.advance(599)
    assert (await _redeem(client, code)).status_code == 200


async def test_minting_cancels_the_earlier_unused_code(client):
    _, auth = await new_player(client)
    first = (await _mint(client, auth))["code"]
    second = (await _mint(client, auth))["code"]
    assert first != second
    assert (await _redeem(client, first)).status_code == 404
    assert (await _redeem(client, second)).status_code == 200


async def test_minting_leaves_other_players_codes_alone(client):
    _, a = await new_player(client)
    _, b = await new_player(client)
    a_code = (await _mint(client, a))["code"]
    await _mint(client, b)
    assert (await _redeem(client, a_code)).status_code == 200


async def test_lookup_normalises_case_and_surrounding_space(client):
    created, auth = await new_player(client)
    code = (await _mint(client, auth))["code"]
    r = await _redeem(client, f"  {code.lower()}\n")
    assert r.status_code == 200
    assert r.json()["player_id"] == created["player_id"]


@pytest.mark.parametrize("code", ["", "AAAAAAAA", "TOO-LONG-CODE-123", "abc"])
async def test_unknown_code_is_404(client, code):
    _, auth = await new_player(client)
    await _mint(client, auth)
    r = await _redeem(client, code)
    assert r.status_code == 404


async def test_redeem_returns_current_state_of_the_record(client):
    _, auth = await new_player(client)
    code = (await _mint(client, auth))["code"]
    r = await _redeem(client, code)
    assert r.json()["state"] == DEFAULT_STATE
    assert r.json()["rev"] == 1
