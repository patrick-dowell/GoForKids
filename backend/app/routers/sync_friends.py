"""
Friends by friend code (feature plan 32, Revision 4).

GET    /api/sync/friends/code                          this profile's friend code
POST   /api/sync/friends/code                          a new code; the old one stops working
POST   /api/sync/friends/requests                      ask the profile holding a code
GET    /api/sync/friends                               friends and requests received
POST   /api/sync/friends/requests/{player_id}/accept   accept that player's request
POST   /api/sync/friends/requests/{player_id}/decline  decline that player's request
GET    /api/sync/friends/{player_id}                   a friend's card
DELETE /api/sync/friends/{player_id}                   remove a friend

Every route needs a device token (401 otherwise). `/friends/code` and
`/friends/requests...` are registered before `/friends/{player_id}`, and
`{player_id}` matches only a UUID; anything else under /friends/ is 404.

Nothing about another player reaches the client unchecked: the card and the
lists pass on only values that match the shapes below, so text a tampered
client wrote into its own state never reaches another player.
"""

from __future__ import annotations

import json
import math
import re
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, StrictStr

from app.routers.sync import (
    Device,
    _unauthorized,
    _valid_handle,
    client_address,
    current_device,
    current_time,
)
from app.routers.sync_admin import _parse_body
from app.sync import storage
from app.sync.ratelimit import RateLimiter
from app.uploads.storage import SHARE_ID_ALPHABET

router = APIRouter()

_HOUR = 3600.0
# On POST /friends/requests every attempt counts, a 404 and a 422 included,
# so a code cannot be guessed by trying many: 20 an hour per player, and 60
# an hour per client address (keyed as the create and redeem limits are).
request_player_limiter = RateLimiter(limit=20, window_s=_HOUR)
request_address_limiter = RateLimiter(limit=60, window_s=_HOUR)

_FRIEND_CODE = re.compile(f"[{SHARE_ID_ALPHABET}]{{{storage.FRIEND_CODE_LENGTH}}}")

# The app's player avatars; anything else shows as the default.
PLAYER_AVATARS = frozenset({"blackhole", "nova", "nebula", "tide", "eclipse", "prism", "comet"})
DEFAULT_AVATAR = "blackhole"
BOARD_KEYS = ("9x9", "13x13", "19x19")
_RUNG = re.compile(r"[0-9]{1,2}[kdp]")
RESULTS = ("win", "loss")
MAX_TS = 2**53
RECENT_RESULTS = 10


def normalise_friend_code(raw: str) -> Optional[str]:
    """Remove every space and hyphen, then uppercase (the client's field does
    the same). None unless the result is exactly a code of the alphabet."""
    code = raw.replace(" ", "").replace("-", "").upper()
    return code if _FRIEND_CODE.fullmatch(code) else None


def _not_found() -> HTTPException:
    # The same body as a path no route matches.
    return HTTPException(status_code=404, detail="Not Found")


# ── Checked values ───────────────────────────────────────────────────


def _handle(state: Dict[str, Any]) -> Optional[list]:
    handle = state.get("handle")
    return handle if _valid_handle(handle) else None


def _avatar(state: Dict[str, Any]) -> str:
    avatar = state.get("avatar")
    return avatar if isinstance(avatar, str) and avatar in PLAYER_AVATARS else DEFAULT_AVATAR


def _rung(value: Any) -> Optional[str]:
    # fullmatch: `$` would also let a trailing newline through.
    return value if isinstance(value, str) and _RUNG.fullmatch(value) else None


def _ts(value: Any) -> bool:
    # type() rather than isinstance(): a bool is an int to Python, not to JSON.
    return type(value) is int and 0 <= value <= MAX_TS


def _slots(state: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """The ladder's slot per allowed board key; a malformed slot is {}."""
    ladder = state.get("ladder")
    by_size = ladder.get("byBoardSize") if isinstance(ladder, dict) else None
    if not isinstance(by_size, dict):
        return {}
    return {
        board: by_size[board] if isinstance(by_size[board], dict) else {}
        for board in BOARD_KEYS
        if board in by_size
    }


def card(player_id: str, state: Dict[str, Any]) -> Dict[str, Any]:
    """A friend's card from the friend's stored state. `games` counts the
    history entries as stored; `recent` is the newest ten that pass every
    check, a rung that fails its check passing as null."""
    boards: Dict[str, Dict[str, Any]] = {}
    games = 0
    recent = []
    for board, slot in _slots(state).items():
        rung_state = slot.get("rungState")
        history = slot.get("history")
        history = history if isinstance(history, list) else []
        boards[board] = {
            "rung": _rung(rung_state.get("currentRung") if isinstance(rung_state, dict) else None),
            "games": len(history),
        }
        games += len(history)
        for entry in history:
            if not isinstance(entry, dict):
                continue
            result, ts = entry.get("result"), entry.get("ts")
            if result not in RESULTS or not _ts(ts):
                continue
            recent.append(
                {"board": board, "result": result, "rung": _rung(entry.get("rung")), "ts": ts}
            )
    recent.sort(key=lambda r: r["ts"], reverse=True)
    return {
        "player_id": player_id,
        "handle": _handle(state),
        "avatar": _avatar(state),
        "boards": boards,
        "games": games,
        "recent": recent[:RECENT_RESULTS],
    }


def _list_entry(row: storage.FriendRow, time_key: str) -> Dict[str, Any]:
    state = json.loads(row.state_json)  # always an object: checked on write
    return {
        "player_id": row.player_id,
        "handle": _handle(state),
        "avatar": _avatar(state),
        time_key: storage.iso_utc(row.at),
    }


# ── The friend code ──────────────────────────────────────────────────


@router.get("/friends/code")
async def get_friend_code(device: Device = Depends(current_device)):
    code = await storage.get_friend_code(device.player_id)
    if code is None:
        raise _unauthorized()  # a token whose player row is gone
    return {"code": code}


@router.post("/friends/code", status_code=201)
async def replace_friend_code(device: Device = Depends(current_device)):
    code = await storage.replace_friend_code(device.player_id)
    if code is None:
        raise _unauthorized()
    return {"code": code}


# ── Requests ─────────────────────────────────────────────────────────


class FriendRequestBody(BaseModel):
    code: StrictStr


def _enforce_request_limits(request: Request, device: Device, now: float) -> None:
    """Both limits, or a 429. A refused request counts toward neither, so one
    player over its own limit does not use up its address's."""
    checks = (
        (request_player_limiter, device.player_id),
        (request_address_limiter, client_address(request)),
    )
    waits = [w for w in (limiter.check(key, now) for limiter, key in checks) if w is not None]
    if waits:
        raise HTTPException(
            status_code=429,
            detail="Too many friend requests; try again later",
            headers={"Retry-After": str(max(1, math.ceil(max(waits))))},
        )
    for limiter, key in checks:
        limiter.hit(key, now)


@router.post("/friends/requests", status_code=202)
async def send_friend_request(
    request: Request,
    device: Device = Depends(current_device),
    now: float = Depends(current_time),
):
    # Counted before the body is read, so a malformed one counts too.
    _enforce_request_limits(request, device, now)
    body = await _parse_body(request, FriendRequestBody)
    code = normalise_friend_code(body.code)
    if code is None:
        raise HTTPException(status_code=422, detail="That isn't a friend code")
    outcome = await storage.send_friend_request(device.player_id, code, now)
    if outcome == storage.NO_SUCH_CODE:
        raise HTTPException(status_code=404, detail="No player has that code")
    if outcome == storage.OWN_CODE:
        raise HTTPException(status_code=422, detail="That's your own code")
    # The same reply for a new request, a repeat, a declined one, friends
    # already, and a mutual request that made the two friends.
    return JSONResponse(status_code=202, content={})


@router.post("/friends/requests/{player_id:uuid}/accept", status_code=204)
async def accept_friend_request(
    player_id: uuid.UUID,
    device: Device = Depends(current_device),
    now: float = Depends(current_time),
):
    if not await storage.accept_friend_request(device.player_id, str(player_id), now):
        raise HTTPException(status_code=404, detail="No request from that player")
    return Response(status_code=204)


@router.post("/friends/requests/{player_id:uuid}/decline", status_code=204)
async def decline_friend_request(
    player_id: uuid.UUID,
    device: Device = Depends(current_device),
    now: float = Depends(current_time),
):
    if not await storage.decline_friend_request(device.player_id, str(player_id), now):
        raise HTTPException(status_code=404, detail="No request from that player")
    return Response(status_code=204)


# ── Friends ──────────────────────────────────────────────────────────


@router.get("/friends")
async def list_friends(device: Device = Depends(current_device)):
    friends, incoming = await storage.list_friends(device.player_id)
    return {
        "friends": [_list_entry(row, "since") for row in friends],
        "incoming": [_list_entry(row, "sent_at") for row in incoming],
    }


@router.get("/friends/{player_id:uuid}")
async def get_friend_card(player_id: uuid.UUID, device: Device = Depends(current_device)):
    state_json = await storage.friend_state(device.player_id, str(player_id))
    if state_json is None:
        # A stranger, a pending or declined request either way, an unknown
        # id and the requester's own id all look the same.
        raise _not_found()
    return card(str(player_id), json.loads(state_json))


@router.delete("/friends/{player_id:uuid}", status_code=204)
async def remove_friend(player_id: uuid.UUID, device: Device = Depends(current_device)):
    await storage.remove_friend(device.player_id, str(player_id))
    return Response(status_code=204)


# Registered last: whatever the routes above do not match under /friends/,
# a method they do not serve included (DELETE /friends/code, say), is 404
# rather than the router's 405.
@router.api_route(
    "/friends/{rest:path}",
    methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    include_in_schema=False,
)
async def not_a_friend_route(rest: str):
    raise _not_found()
