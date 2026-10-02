"""Sync admin (plan 32, Revision 3): the admin setting, GET /state's admin
and device_id, and the five routes under /api/sync/admin."""

import hashlib
import re
import sqlite3

import pytest

import app.sync.storage as sync_storage
from app.uploads.storage import SHARE_ID_ALPHABET
from tests.sync_helpers import bearer, iso, new_player, replay

ADMIN = "/api/sync/admin"
DAY = 24 * 3600
CODE_RE = re.compile(f"^[{SHARE_ID_ALPHABET}]{{8}}$")
JSON = {"Content-Type": "application/json"}

FRESH = {
    "schema": 1,
    "ladder": {"byBoardSize": {}},
    "lessons": [],
    "avatar": "blackhole",
    "avatarPicked": False,
    "handle": [4, 2],
}
ENTRY_KEYS = {
    "player_id", "handle", "boards", "devices", "replays", "created_at", "updated_at",
    "no_device_since", "days_left",
}


def at(ts: float) -> str:
    return sync_storage.iso_utc(ts)


def at_ms(base: int, ms_ahead: int) -> str:
    """`base` plus a whole number of milliseconds, as toISOString() writes it."""
    seconds, ms = divmod(ms_ahead, 1000)
    return at(base + seconds)[:-1] + f".{ms:03d}Z"


def set_admins(monkeypatch, value: str) -> None:
    monkeypatch.setenv("SYNC_ADMIN_PLAYER_IDS", value)


@pytest.fixture
async def admin(client, monkeypatch):
    """A profile listed in SYNC_ADMIN_PLAYER_IDS; returns (create body, auth)."""
    body, auth = await new_player(client)
    set_admins(monkeypatch, body["player_id"])
    return body, auth


async def players(client, auth) -> dict:
    r = await client.get(f"{ADMIN}/players", headers=auth)
    assert r.status_code == 200, r.text
    return {p["player_id"]: p for p in r.json()["players"]}


async def device_id(client, auth) -> str:
    return (await client.get("/api/sync/state", headers=auth)).json()["device_id"]


async def link_device(client, auth) -> dict:
    """A second device on the same profile, by a device-minted code."""
    code = (await client.post("/api/sync/pairing-codes", headers=auth)).json()["code"]
    r = await client.post("/api/sync/pairing-codes/redeem", json={"code": code})
    assert r.status_code == 200, r.text
    return bearer(r.json()["device_token"])


async def admin_create(client, auth, state=None) -> str:
    r = await client.post(f"{ADMIN}/players", json={"state": state or FRESH}, headers=auth)
    assert r.status_code == 201, r.text
    return r.json()["player_id"]


async def admin_mint(client, auth, player_id, expires_at):
    return await client.post(
        f"{ADMIN}/players/{player_id}/pairing-codes",
        json={"expires_at": expires_at},
        headers=auth,
    )


async def redeem(client, code):
    return await client.post("/api/sync/pairing-codes/redeem", json={"code": code})


# ── Who is an admin, and 401 / 403 on every route ────────────────────

ADMIN_ROUTES = [
    ("GET", f"{ADMIN}/players"),
    ("POST", f"{ADMIN}/players"),
    ("POST", f"{ADMIN}/players/no-such-player/pairing-codes"),
    ("DELETE", f"{ADMIN}/devices/no-such-device"),
    ("DELETE", f"{ADMIN}/players/no-such-player/devices"),
]


@pytest.mark.parametrize("method,path", ADMIN_ROUTES)
async def test_admin_route_without_a_token_is_401(client, monkeypatch, method, path):
    body, _ = await new_player(client)
    set_admins(monkeypatch, body["player_id"])
    r = await client.request(method, path, content=b"{", headers=JSON)
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize("method,path", ADMIN_ROUTES)
async def test_admin_route_with_an_unknown_or_revoked_token_is_401(
    client, monkeypatch, method, path
):
    body, auth = await new_player(client)
    set_admins(monkeypatch, body["player_id"])
    r = await client.request(method, path, headers=bearer("not-a-real-token"))
    assert r.status_code == 401
    assert (await client.delete("/api/sync/devices/current", headers=auth)).status_code == 204
    r = await client.request(method, path, headers=auth)
    assert r.status_code == 401


@pytest.mark.parametrize("method,path", ADMIN_ROUTES)
async def test_non_admin_gets_403_before_anything_else_is_checked(
    client, monkeypatch, method, path
):
    _, auth = await new_player(client)
    set_admins(monkeypatch, "some-other-profile")
    # A body that is not even JSON, an unknown player or device: still 403.
    r = await client.request(method, path, content=b"{", headers={**JSON, **auth})
    assert r.status_code == 403


async def test_non_admin_cannot_sign_out_its_own_device_or_profile_with_403(
    client, monkeypatch
):
    body, auth = await new_player(client)
    set_admins(monkeypatch, "some-other-profile")
    own = await device_id(client, auth)
    r = await client.delete(f"{ADMIN}/devices/{own}", headers=auth)
    assert r.status_code == 403
    r = await client.delete(f"{ADMIN}/players/{body['player_id']}/devices", headers=auth)
    assert r.status_code == 403
    assert (await client.get("/api/sync/state", headers=auth)).status_code == 200


@pytest.mark.parametrize("setting", [None, "", " , ,"])
async def test_no_admins_when_the_setting_is_unset_or_empty(client, monkeypatch, setting):
    if setting is None:
        monkeypatch.delenv("SYNC_ADMIN_PLAYER_IDS", raising=False)
    else:
        set_admins(monkeypatch, setting)
    _, auth = await new_player(client)
    assert (await client.get("/api/sync/state", headers=auth)).json()["admin"] is False
    for method, path in ADMIN_ROUTES:
        r = await client.request(method, path, json={}, headers=auth)
        assert r.status_code == 403, (method, path)


async def test_setting_is_comma_separated_with_spaces_ignored(client, monkeypatch):
    a, a_auth = await new_player(client)
    b, b_auth = await new_player(client)
    _, c_auth = await new_player(client)
    set_admins(monkeypatch, f" {a['player_id']} ,\t{b['player_id']} ,")
    for auth in (a_auth, b_auth):
        assert (await client.get("/api/sync/state", headers=auth)).json()["admin"] is True
        assert (await client.get(f"{ADMIN}/players", headers=auth)).status_code == 200
    assert (await client.get("/api/sync/state", headers=c_auth)).json()["admin"] is False
    assert (await client.get(f"{ADMIN}/players", headers=c_auth)).status_code == 403


# ── GET /state: admin and device_id ──────────────────────────────────


async def test_state_reports_admin_and_this_devices_id(client, admin):
    admin_body, admin_auth = admin
    _, other = await new_player(client)
    second = await link_device(client, admin_auth)

    mine = (await client.get("/api/sync/state", headers=admin_auth)).json()
    assert set(mine) == {"rev", "state", "admin", "device_id"}
    assert mine["admin"] is True
    theirs = (await client.get("/api/sync/state", headers=other)).json()
    assert theirs["admin"] is False
    # Every device of an admin profile is an admin.
    linked = (await client.get("/api/sync/state", headers=second)).json()
    assert linked["admin"] is True

    ids = {mine["device_id"], theirs["device_id"], linked["device_id"]}
    assert len(ids) == 3 and all(isinstance(i, str) and i for i in ids)
    assert await device_id(client, admin_auth) == mine["device_id"]  # stable
    listed = (await players(client, admin_auth))[admin_body["player_id"]]["devices"]
    assert [d["device_id"] for d in listed] == [mine["device_id"], linked["device_id"]]


# ── GET /admin/players ───────────────────────────────────────────────


async def test_list_entry_has_the_planned_shape(client, admin, clock):
    _, admin_auth = admin
    t0 = clock.t
    state = {
        "schema": 1,
        "handle": [7, 63],
        "lessons": ["intro"],
        "ladder": {
            "byBoardSize": {
                "9x9": {"rungState": {"currentRung": "15k"}, "history": [{}, {}, {}]},
                "19x19": {"rungState": {"currentRung": "30k"}, "history": []},
            },
            "undoBank": 3,
        },
    }
    created, auth = await new_player(client, state)
    for n in range(2):
        r = await client.put(f"/api/sync/games/g{n}", json={"date": iso(n), "payload": replay()},
                             headers=auth)
        assert r.status_code == 200
    clock.advance(90)
    second = await link_device(client, auth)

    entry = (await players(client, admin_auth))[created["player_id"]]
    assert set(entry) == ENTRY_KEYS
    assert entry["handle"] == [7, 63]
    assert entry["boards"] == {
        "9x9": {"rung": "15k", "games": 3},
        "19x19": {"rung": "30k", "games": 0},
    }
    # Minting the code at t0 + 90 was the first device's latest request.
    assert entry["devices"] == [
        {"device_id": await device_id(client, auth), "created_at": at(t0),
         "last_seen_at": at(t0 + 90), "kind": None},
        {"device_id": await device_id(client, second), "created_at": at(t0 + 90),
         "last_seen_at": at(t0 + 90), "kind": None},
    ]
    assert entry["replays"] == 2
    assert entry["created_at"] == at(t0)
    assert entry["updated_at"] == at(t0)
    assert entry["no_device_since"] is None
    assert entry["days_left"] is None


async def test_list_is_most_recently_updated_first(client, admin, clock):
    admin_body, admin_auth = admin
    clock.advance(10)
    a, a_auth = await new_player(client)
    clock.advance(10)
    b, _ = await new_player(client)
    clock.advance(10)
    c = await admin_create(client, admin_auth)
    clock.advance(10)
    r = await client.put("/api/sync/state", json={"base_rev": 1, "state": {}}, headers=a_auth)
    assert r.status_code == 200

    r = await client.get(f"{ADMIN}/players", headers=admin_auth)
    order = [p["player_id"] for p in r.json()["players"]]
    assert order == [a["player_id"], c, b["player_id"], admin_body["player_id"]]


async def test_handle_is_null_when_absent_or_not_a_valid_handle(client, admin, sync_db):
    _, admin_auth = admin
    plain, _ = await new_player(client, {"schema": 1})
    odd, _ = await new_player(client, {"schema": 1})
    # Not reachable through the API (the handle is checked on write), but a
    # stored oddity must not reach the client as a name.
    with sqlite3.connect(sync_db) as db:
        db.execute(
            "UPDATE sync_players SET state = ? WHERE id = ?",
            ('{"handle":[1,99]}', odd["player_id"]),
        )
    listed = await players(client, admin_auth)
    assert listed[plain["player_id"]]["handle"] is None
    assert listed[odd["player_id"]]["handle"] is None


MALFORMED_LADDERS = [
    (5, {}),
    ([], {}),
    ({}, {}),
    ({"byBoardSize": []}, {}),
    ({"byBoardSize": "9x9"}, {}),
    (
        {
            "byBoardSize": {
                "9x9": 3,
                "13x13": {"rungState": 4, "history": "not a list"},
                "19x19": {"rungState": {"currentRung": 7}, "history": [1, 2]},
                "5x5": {},
                "7x7": {"rungState": {}, "history": {"0": {}}},
                "11x11": {"rungState": {"currentRung": "12k"}, "history": None},
            }
        },
        {
            "9x9": {"rung": None, "games": 0},
            "13x13": {"rung": None, "games": 0},
            "19x19": {"rung": None, "games": 2},
            "5x5": {"rung": None, "games": 0},
            "7x7": {"rung": None, "games": 0},
            "11x11": {"rung": "12k", "games": 0},
        },
    ),
]


@pytest.mark.parametrize("ladder,boards", MALFORMED_LADDERS)
async def test_a_malformed_ladder_never_breaks_the_list(client, admin, ladder, boards):
    _, admin_auth = admin
    odd, auth = await new_player(client)
    r = await client.put(
        "/api/sync/state", json={"base_rev": 1, "state": {"ladder": ladder}}, headers=auth
    )
    assert r.status_code == 200
    healthy, _ = await new_player(client)
    listed = await players(client, admin_auth)
    assert listed[odd["player_id"]]["boards"] == boards
    assert listed[healthy["player_id"]]["boards"] == {}


async def test_days_left_counts_down_in_whole_days_rounded_up_never_below_0(
    client, admin, clock
):
    _, admin_auth = admin
    t0 = clock.t
    pid = await admin_create(client, admin_auth)

    async def entry():
        return (await players(client, admin_auth))[pid]

    first = await entry()
    assert first["devices"] == []
    assert first["no_device_since"] == at(t0)
    assert first["days_left"] == 30
    for elapsed, left in [
        (3600, 30),
        (DAY, 29),
        (DAY + 1, 29),
        (29 * DAY + 23 * 3600, 1),
        (30 * DAY - 1, 1),
        (30 * DAY, 0),
        (45 * DAY, 0),  # the list does not run the cleanup
    ]:
        clock.t = t0 + elapsed
        assert (await entry())["days_left"] == left, elapsed
    assert (await entry())["no_device_since"] == at(t0)


async def test_days_left_is_null_while_a_device_remains_or_with_no_timestamp(
    client, admin, clock, sync_db
):
    _, admin_auth = admin
    with_device, _ = await new_player(client)
    unstamped = await admin_create(client, admin_auth)
    # Neither is reachable through the routes; the list must still not
    # count down a profile someone can reach, nor fail on a missing stamp.
    with sqlite3.connect(sync_db) as db:
        db.execute("UPDATE sync_players SET no_device_since = ? WHERE id = ?",
                   (clock.t - DAY, with_device["player_id"]))
        db.execute("UPDATE sync_players SET no_device_since = NULL WHERE id = ?", (unstamped,))
    listed = await players(client, admin_auth)
    assert listed[with_device["player_id"]]["days_left"] is None
    assert listed[unstamped]["days_left"] is None
    assert listed[unstamped]["no_device_since"] is None


async def test_last_seen_is_written_at_most_once_a_minute(client, admin, clock):
    _, admin_auth = admin
    t0 = clock.t
    created, auth = await new_player(client)

    async def last_seen():
        return (await players(client, admin_auth))[created["player_id"]]["devices"][0][
            "last_seen_at"
        ]

    assert await last_seen() == at(t0)  # set when the device is created
    clock.advance(59)
    assert (await client.get("/api/sync/games", headers=auth)).status_code == 200
    assert await last_seen() == at(t0)
    clock.advance(1)
    assert (await client.get("/api/sync/games", headers=auth)).status_code == 200
    assert await last_seen() == at(t0 + 60)
    clock.advance(30)
    await client.get("/api/sync/games", headers=auth)
    assert await last_seen() == at(t0 + 60)


# ── POST /admin/players ──────────────────────────────────────────────


async def test_create_makes_a_profile_with_no_device_and_a_running_clock(
    client, admin, clock
):
    _, admin_auth = admin
    r = await client.post(f"{ADMIN}/players", json={"state": FRESH}, headers=admin_auth)
    assert r.status_code == 201
    body = r.json()
    assert set(body) == {"player_id", "rev"}
    assert body["rev"] == 1

    entry = (await players(client, admin_auth))[body["player_id"]]
    assert entry["handle"] == FRESH["handle"]
    assert entry["boards"] == {}
    assert entry["devices"] == []
    assert entry["replays"] == 0
    assert entry["created_at"] == entry["updated_at"] == at(clock.t)
    assert entry["no_device_since"] == at(clock.t)
    assert entry["days_left"] == 30


async def test_logging_into_an_admin_created_profile_gets_its_fresh_state(
    client, admin, clock
):
    _, admin_auth = admin
    pid = await admin_create(client, admin_auth)
    r = await admin_mint(client, admin_auth, pid, at(clock.t + 3600))
    assert r.status_code == 201
    code = r.json()["code"]

    r = await redeem(client, f" {code.lower()} ")
    assert r.status_code == 200
    linked = r.json()
    assert linked["player_id"] == pid
    assert linked["rev"] == 1
    assert linked["state"] == FRESH
    auth = bearer(linked["device_token"])
    state = (await client.get("/api/sync/state", headers=auth)).json()
    assert (state["rev"], state["state"], state["admin"]) == (1, FRESH, False)

    entry = (await players(client, admin_auth))[pid]
    assert [d["device_id"] for d in entry["devices"]] == [state["device_id"]]
    assert entry["no_device_since"] is None
    assert entry["days_left"] is None
    assert (await redeem(client, code)).status_code == 404  # usable once


@pytest.mark.parametrize(
    "state",
    [
        {**FRESH, "displayName": "typed"},
        {k: v for k, v in FRESH.items() if k != "handle"},
        {**FRESH, "handle": [1, 64]},
        {**FRESH, "handle": None},
        {k: v for k, v in FRESH.items() if k != "ladder"},
        {**FRESH, "ladder": []},
        {**FRESH, "ladder": None},
        {k: v for k, v in FRESH.items() if k != "lessons"},
        {**FRESH, "lessons": {}},
        {**FRESH, "lessons": "intro"},
        ["schema"],
    ],
)
async def test_create_refuses_a_state_that_is_not_a_complete_allowed_profile(
    client, admin, state
):
    _, admin_auth = admin
    before = await players(client, admin_auth)
    r = await client.post(f"{ADMIN}/players", json={"state": state}, headers=admin_auth)
    assert r.status_code == 422
    assert await players(client, admin_auth) == before


@pytest.mark.parametrize(
    "raw",
    [
        "{",
        "",
        "[]",
        '{"state": {"schema": 1}, "extra": 1}',  # the state is still incomplete
        '{"state": {"schema": 1, "ladder": {"r": NaN}, "lessons": [], "handle": [1, 2]}}',
        '{"state": {"schema": 1, "ladder": {}, "lessons": [1e999], "handle": [1, 2]}}',
    ],
)
async def test_create_refuses_a_body_that_is_not_a_state(client, admin, raw):
    _, admin_auth = admin
    before = await players(client, admin_auth)
    r = await client.post(
        f"{ADMIN}/players", content=raw.encode(), headers={**JSON, **admin_auth}
    )
    assert r.status_code == 422
    assert await players(client, admin_auth) == before


async def test_create_refuses_an_oversized_state_with_413(client, admin):
    _, admin_auth = admin
    big = {**FRESH, "lessons": ["x" * (512 * 1024)]}
    r = await client.post(f"{ADMIN}/players", json={"state": big}, headers=admin_auth)
    assert r.status_code == 413


async def test_create_is_not_rate_limited(client, admin):
    _, admin_auth = admin
    for n in range(61):  # each its own name: names are unique (Revision 6)
        await admin_create(client, admin_auth, {**FRESH, "handle": [n, 0]})
    assert (await new_player(client))[0]["rev"] == 1  # nor counted toward the public limit


# ── POST /admin/players/{id}/pairing-codes ───────────────────────────

T = 1_800_000_000  # the FakeClock's start: 2027-01-15T08:00:00Z


@pytest.mark.parametrize(
    "expires_at,ahead",
    [
        ("2027-01-15T09:00:00.000Z", 3600),  # Date.prototype.toISOString()
        ("2027-01-15T09:00:00Z", 3600),
        ("2027-01-15T09:00Z", 3600),
        ("2027-01-15T09:00:00.5Z", 3600.5),
        ("2027-01-15T09:00:00,25Z", 3600.25),
        ("2027-01-15T14:30:00+05:30", 3600),
        ("2027-01-15T14:30:00+0530", 3600),
        ("2027-01-15T02:00:00.000-07:00", 3600),
        ("2027-01-15T11:00:00+01", 7200),
        ("2027-01-15T09:00:00-00:00", 3600),
    ],
)
async def test_mint_accepts_iso_8601_with_an_offset(client, admin, clock, expires_at, ahead):
    _, admin_auth = admin
    assert clock.t == T
    pid = await admin_create(client, admin_auth)
    r = await admin_mint(client, admin_auth, pid, expires_at)
    assert r.status_code == 201, r.text
    body = r.json()
    assert set(body) == {"code", "expires_at"}
    assert CODE_RE.match(body["code"])
    assert body["expires_at"] == at(T + ahead)
    # The code lives exactly until the admin's expiry.
    clock.t = T + ahead - 0.001
    assert (await redeem(client, body["code"])).status_code == 200


async def test_admin_code_expires_at_the_admins_time_not_in_ten_minutes(client, admin, clock):
    _, admin_auth = admin
    pid = await admin_create(client, admin_auth)
    code = (await admin_mint(client, admin_auth, pid, at(T + 2 * 3600))).json()["code"]
    clock.t = T + 2 * 3600
    assert (await redeem(client, code)).status_code == 404


# Each would fall an hour or so ahead if it were read, so only the parser
# can refuse it, not the bounds.
@pytest.mark.parametrize(
    "expires_at",
    [
        "2027-01-15T09:00:00",  # no offset
        "2027-01-15T09:00:00.000",
        "2027-01-15",
        "2027-01-15 09:00:00Z",
        "2027-01-15T09Z",
        "2027-01-15T09:00:00.Z",
        "2027-01-15T14:30:00+5:30",
        "2027-01-15T15:00:00+05:60",
        "2027-01-16T09:00:00+24:00",
        "2027-13-15T09:00:00Z",
        "2027-01-15T25:00:00Z",
        "2027-01-15T09:00:00Z ",
        "tomorrow at 9",
        "",
        "２０２７-01-15T09:00:00Z",  # full-width digits
    ],
)
async def test_mint_refuses_a_time_without_a_valid_offset(client, admin, expires_at):
    _, admin_auth = admin
    pid = await admin_create(client, admin_auth)
    r = await admin_mint(client, admin_auth, pid, expires_at)
    assert r.status_code == 422


@pytest.mark.parametrize("raw", ['{"expires_at": 1800003600}', '{"expires_at": null}', "{}", "{"])
async def test_mint_refuses_a_body_without_an_expiry_string(client, admin, raw):
    _, admin_auth = admin
    pid = await admin_create(client, admin_auth)
    r = await client.post(
        f"{ADMIN}/players/{pid}/pairing-codes", content=raw.encode(),
        headers={**JSON, **admin_auth},
    )
    assert r.status_code == 422


@pytest.mark.parametrize(
    "ms_ahead,status",
    [
        (-3600_000, 422),
        (-1, 422),
        (0, 422),  # not after now
        (1, 201),
        (DAY * 1000, 201),
        ((DAY + 60) * 1000, 201),  # the minute of slack
        ((DAY + 60) * 1000 + 1, 422),
        ((DAY + 61) * 1000, 422),
        (2 * DAY * 1000, 422),
    ],
)
async def test_mint_expiry_is_after_now_and_at_most_24_hours_and_a_minute_ahead(
    client, admin, clock, ms_ahead, status
):
    _, admin_auth = admin
    assert clock.t == T
    pid = await admin_create(client, admin_auth)
    expires_at = at_ms(T, ms_ahead)
    r = await admin_mint(client, admin_auth, pid, expires_at)
    assert r.status_code == status, (ms_ahead, expires_at, r.text)


async def test_a_refused_mint_leaves_the_live_code_alone(client, admin):
    _, admin_auth = admin
    pid = await admin_create(client, admin_auth)
    code = (await admin_mint(client, admin_auth, pid, at(T + 3600))).json()["code"]
    assert (await admin_mint(client, admin_auth, pid, at(T + 2 * DAY))).status_code == 422
    assert (await redeem(client, code)).status_code == 200


async def test_mint_for_an_unknown_player_is_404(client, admin):
    _, admin_auth = admin
    r = await admin_mint(client, admin_auth, "no-such-player", at(T + 3600))
    assert r.status_code == 404


async def test_minting_cancels_earlier_codes_whoever_minted_them(client, admin):
    _, admin_auth = admin
    created, auth = await new_player(client)
    pid = created["player_id"]

    # An admin's code cancels the device's.
    device_code = (await client.post("/api/sync/pairing-codes", headers=auth)).json()["code"]
    admin_code = (await admin_mint(client, admin_auth, pid, at(T + 3600))).json()["code"]
    assert (await redeem(client, device_code)).status_code == 404

    # A device's code cancels the admin's.
    device_code = (await client.post("/api/sync/pairing-codes", headers=auth)).json()["code"]
    assert (await redeem(client, admin_code)).status_code == 404

    # An admin's code cancels the admin's earlier one.
    first = (await admin_mint(client, admin_auth, pid, at(T + 3600))).json()["code"]
    second = (await admin_mint(client, admin_auth, pid, at(T + 3600))).json()["code"]
    assert (await redeem(client, device_code)).status_code == 404
    assert (await redeem(client, first)).status_code == 404
    assert (await redeem(client, second)).status_code == 200


async def test_an_admin_code_cancels_only_that_profiles_codes(client, admin):
    _, admin_auth = admin
    _, a_auth = await new_player(client)
    b, _ = await new_player(client)
    a_code = (await client.post("/api/sync/pairing-codes", headers=a_auth)).json()["code"]
    await admin_mint(client, admin_auth, b["player_id"], at(T + 3600))
    assert (await redeem(client, a_code)).status_code == 200


async def test_a_device_code_still_lasts_ten_minutes(client, admin, clock):
    _, auth = admin
    r = await client.post("/api/sync/pairing-codes", headers=auth)
    assert r.json()["expires_at"] == at(clock.t + 600)


# ── DELETE /admin/devices/{device_id} ────────────────────────────────


async def test_remove_device_revokes_it_and_starts_the_clock_only_after_the_last(
    client, admin, clock
):
    _, admin_auth = admin
    created, first = await new_player(client)
    pid = created["player_id"]
    second = await link_device(client, first)
    first_id, second_id = await device_id(client, first), await device_id(client, second)

    clock.advance(100)
    r = await client.delete(f"{ADMIN}/devices/{first_id}", headers=admin_auth)
    assert r.status_code == 204
    assert (await client.get("/api/sync/state", headers=first)).status_code == 401
    assert (await client.get("/api/sync/state", headers=second)).status_code == 200
    entry = (await players(client, admin_auth))[pid]
    assert [d["device_id"] for d in entry["devices"]] == [second_id]
    assert entry["no_device_since"] is None

    clock.advance(100)
    r = await client.delete(f"{ADMIN}/devices/{second_id}", headers=admin_auth)
    assert r.status_code == 204
    assert (await client.get("/api/sync/state", headers=second)).status_code == 401
    entry = (await players(client, admin_auth))[pid]
    assert entry["devices"] == []
    assert entry["no_device_since"] == at(clock.t)
    assert entry["days_left"] == 30


async def test_remove_an_unknown_or_already_removed_device_is_404(client, admin):
    _, admin_auth = admin
    _, auth = await new_player(client)
    target = await device_id(client, auth)
    assert (await client.delete(f"{ADMIN}/devices/{target}", headers=admin_auth)).status_code == 204
    assert (await client.delete(f"{ADMIN}/devices/{target}", headers=admin_auth)).status_code == 404
    r = await client.delete(f"{ADMIN}/devices/no-such-device", headers=admin_auth)
    assert r.status_code == 404


async def test_an_admin_cannot_remove_the_device_making_the_request(client, admin):
    _, admin_auth = admin
    own = await device_id(client, admin_auth)
    r = await client.delete(f"{ADMIN}/devices/{own}", headers=admin_auth)
    assert r.status_code == 409
    assert (await client.get("/api/sync/state", headers=admin_auth)).status_code == 200


async def test_an_admin_can_remove_another_device_of_its_own_profile(client, admin):
    _, admin_auth = admin
    other = await link_device(client, admin_auth)
    r = await client.delete(f"{ADMIN}/devices/{await device_id(client, other)}",
                            headers=admin_auth)
    assert r.status_code == 204
    assert (await client.get("/api/sync/state", headers=other)).status_code == 401
    assert (await client.get("/api/sync/state", headers=admin_auth)).status_code == 200


# ── DELETE /admin/players/{player_id}/devices ────────────────────────


async def test_sign_out_a_profiles_devices_keeps_the_profile(client, admin, clock):
    _, admin_auth = admin
    created, first = await new_player(client)
    pid = created["player_id"]
    second = await link_device(client, first)
    await client.put("/api/sync/games/g1", json={"date": iso(1), "payload": replay()},
                     headers=first)
    _, bystander = await new_player(client)

    clock.advance(500)
    r = await client.delete(f"{ADMIN}/players/{pid}/devices", headers=admin_auth)
    assert r.status_code == 204
    for auth in (first, second):
        assert (await client.get("/api/sync/state", headers=auth)).status_code == 401
    assert (await client.get("/api/sync/state", headers=bystander)).status_code == 200
    entry = (await players(client, admin_auth))[pid]
    assert entry["devices"] == []
    assert entry["replays"] == 1
    assert entry["no_device_since"] == at(clock.t)
    assert entry["days_left"] == 30


async def test_sign_out_a_profile_with_no_device_is_204_and_keeps_its_clock(
    client, admin, clock
):
    _, admin_auth = admin
    t0 = clock.t
    pid = await admin_create(client, admin_auth)
    clock.advance(10 * DAY)
    r = await client.delete(f"{ADMIN}/players/{pid}/devices", headers=admin_auth)
    assert r.status_code == 204
    entry = (await players(client, admin_auth))[pid]
    assert entry["no_device_since"] == at(t0)
    assert entry["days_left"] == 20


async def test_sign_out_an_unknown_profile_is_404(client, admin):
    _, admin_auth = admin
    r = await client.delete(f"{ADMIN}/players/no-such-player/devices", headers=admin_auth)
    assert r.status_code == 404


async def test_an_admin_cannot_sign_out_its_own_profile(client, admin):
    admin_body, admin_auth = admin
    other = await link_device(client, admin_auth)
    r = await client.delete(f"{ADMIN}/players/{admin_body['player_id']}/devices",
                            headers=admin_auth)
    assert r.status_code == 409
    for auth in (admin_auth, other):
        assert (await client.get("/api/sync/state", headers=auth)).status_code == 200


# ── No token hash, and no token, in any reply ────────────────────────


async def test_no_reply_carries_a_token_hash(client, admin, sync_db):
    admin_body, admin_auth = admin
    texts = []
    created, auth = await new_player(client)
    second = await link_device(client, auth)
    pid = await admin_create(client, admin_auth)
    code = (await admin_mint(client, admin_auth, pid, at(T + 3600))).json()["code"]
    third = bearer((await redeem(client, code)).json()["device_token"])
    for auth_ in (admin_auth, auth, second, third):
        texts.append((await client.get("/api/sync/state", headers=auth_)).text)
    texts.append((await client.get(f"{ADMIN}/players", headers=admin_auth)).text)
    texts.append((await admin_mint(client, admin_auth, pid, at(T + 60))).text)
    texts.append((await client.post(f"{ADMIN}/players", json={"state": FRESH},
                                    headers=admin_auth)).text)
    target = await device_id(client, second)
    texts.append((await client.delete(f"{ADMIN}/devices/{target}", headers=admin_auth)).text)
    texts.append((await client.delete(f"{ADMIN}/players/{pid}/devices",
                                      headers=admin_auth)).text)
    texts.append((await client.get(f"{ADMIN}/players", headers=admin_auth)).text)

    with sqlite3.connect(sync_db) as db:
        hashes = {r[0] for r in db.execute("SELECT token_hash FROM sync_devices")}
    tokens = [admin_auth, auth, second, third]
    hashes |= {
        hashlib.sha256(a["Authorization"].split()[1].encode()).hexdigest() for a in tokens
    }
    assert len(hashes) == 4
    for text in texts:
        for h in hashes:
            assert h not in text
        for a in tokens:
            assert a["Authorization"].split()[1] not in text


# ── Device kinds and the last-seen-since stamp (the device lines) ─────


async def test_a_device_reports_its_kind_on_create_and_on_redeem(client, admin, clock):
    _, admin_auth = admin
    created, auth = await new_player(client, headers={"X-Device-Kind": "iPad"})
    code = (await client.post("/api/sync/pairing-codes", headers=auth)).json()["code"]
    r = await client.post("/api/sync/pairing-codes/redeem", json={"code": code},
                          headers={"X-Device-Kind": "web"})
    assert r.status_code == 200, r.text
    entry = (await players(client, admin_auth))[created["player_id"]]
    assert [d["kind"] for d in entry["devices"]] == ["iPad", "web"]


async def test_an_unknown_kind_is_ignored_and_never_stored(client, admin, clock):
    _, admin_auth = admin
    created, auth = await new_player(client, headers={"X-Device-Kind": "Fridge; drop table"})
    entry = (await players(client, admin_auth))[created["player_id"]]
    assert [d["kind"] for d in entry["devices"]] == [None]


async def test_a_device_from_before_kinds_picks_its_kind_up_on_its_next_request(client, admin, clock):
    """Rows written by an older app have no kind; the first valid header
    fills it, and a later different header does not change it."""
    _, admin_auth = admin
    created, auth = await new_player(client)
    entry = (await players(client, admin_auth))[created["player_id"]]
    assert entry["devices"][0]["kind"] is None
    r = await client.get("/api/sync/state", headers={**auth, "X-Device-Kind": "iPhone"})
    assert r.status_code == 200
    r = await client.get("/api/sync/state", headers={**auth, "X-Device-Kind": "web"})
    assert r.status_code == 200
    entry = (await players(client, admin_auth))[created["player_id"]]
    assert entry["devices"][0]["kind"] == "iPhone"


async def test_the_list_says_when_last_seen_began(client, admin, clock):
    """`last_seen_since` is the start-up that first knew the stamp, so the
    app can say "last used before <then>" for an older row with no stamp."""
    _, admin_auth = admin
    r = await client.get(f"{ADMIN}/players", headers=admin_auth)
    assert r.status_code == 200
    since = r.json()["last_seen_since"]
    assert since is not None and since.endswith("Z")
    clock.advance(3600)
    r = await client.get(f"{ADMIN}/players", headers=admin_auth)
    assert r.json()["last_seen_since"] == since  # written once, never moved


async def test_last_seen_since_is_the_first_start_up_and_never_moves(tmp_path, monkeypatch):
    """A later start-up (a redeploy) keeps the first stamp, and the stamp is
    the start-up time it was given, not the wall clock. On a fresh file: the
    shared fixture has already started its own database once."""
    from app.sync import storage

    monkeypatch.setattr(storage, "DB_PATH", str(tmp_path / "fresh.db"))
    t0 = 1_900_000_000.0
    await storage.init_sync_db(t0)
    await storage.init_sync_db(t0 + 86400)
    assert await storage.last_seen_since() == storage.iso_utc(t0)


async def test_a_bad_kind_on_a_later_request_leaves_the_row_as_it_was(client, admin, clock):
    """The fill-in on authenticated requests is validated like create is."""
    _, admin_auth = admin
    created, auth = await new_player(client)
    r = await client.get("/api/sync/state", headers={**auth, "X-Device-Kind": "Fridge; drop table"})
    assert r.status_code == 200
    entry = (await players(client, admin_auth))[created["player_id"]]
    assert entry["devices"][0]["kind"] is None
    r = await client.get("/api/sync/state", headers={**auth, "X-Device-Kind": "iPad"})
    assert r.status_code == 200
    entry = (await players(client, admin_auth))[created["player_id"]]
    assert entry["devices"][0]["kind"] == "iPad"
