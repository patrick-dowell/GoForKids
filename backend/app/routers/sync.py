"""
Sync endpoints (feature plan 32): a player record with no account.

POST   /api/sync/players                 create a record, returns the first device token
POST   /api/sync/pairing-codes           mint a one-use code for adding a device
POST   /api/sync/pairing-codes/redeem    spend a code, returns a new device token
GET    /api/sync/state                   the record's revision and state document
PUT    /api/sync/state                   compare-and-write on the revision
GET    /api/sync/games                   replay ids and dates, newest first
GET    /api/sync/games/{id}              one replay
PUT    /api/sync/games/{id}              store or replace a replay (library capped)
DELETE /api/sync/games/{id}              remove a replay
DELETE /api/sync/devices/current         revoke this device's token

A linked device sends `Authorization: Bearer <device_token>`. Every query a
token reaches is scoped to that token's player.
"""

from __future__ import annotations

import json
import logging
import math
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, StrictInt

from app.sync import storage
from app.sync.ratelimit import RateLimiter

router = APIRouter()
_log = logging.getLogger(__name__)

# The state document is opaque except for its top-level keys: anything not
# listed is refused, which is what keeps free text such as a typed name out
# of the record. The one key the server also checks inside is `handle`.
ALLOWED_STATE_KEYS = frozenset(
    {"schema", "ladder", "lessons", "avatar", "avatarPicked", "handle"}
)
# A generated name: one position in each of two 64-word lists.
HANDLE_WORDS = 64
MAX_STATE_BYTES = 512 * 1024
MAX_GAME_BYTES = 1024 * 1024
MAX_GAME_ID_LENGTH = 128
# Revisions stay exact in a JavaScript number.
MAX_REV = 2**53

_HOUR = 3600.0
# 60, not 10: every device creates a profile at first launch, and a room of
# devices can do that at once from behind one address.
create_limiter = RateLimiter(limit=60, window_s=_HOUR)
redeem_limiter = RateLimiter(limit=20, window_s=_HOUR)


def current_time() -> float:
    """Epoch seconds. Tests override this dependency to move time."""
    return time.time()


# ── Auth ─────────────────────────────────────────────────────────────


@dataclass
class Device:
    player_id: str
    token: str


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail="Missing or invalid device token",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def current_device(authorization: Optional[str] = Header(None)) -> Device:
    scheme, _, token = (authorization or "").partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized()
    player_id = await storage.player_for_token(token)
    if player_id is None:
        raise _unauthorized()
    return Device(player_id=player_id, token=token)


# ── Helpers ──────────────────────────────────────────────────────────


def trusted_proxy_hops() -> int:
    """SYNC_TRUSTED_PROXY_HOPS: how many proxies in front of this server
    append to X-Forwarded-For. Read per request so tests can change it. An
    unset, malformed or negative value means none, which ignores the header."""
    raw = os.environ.get("SYNC_TRUSTED_PROXY_HOPS", "").strip()
    try:
        hops = int(raw) if raw else 0
    except ValueError:
        _log.warning("SYNC_TRUSTED_PROXY_HOPS=%r is not an integer; trusting no proxy", raw)
        return 0
    return max(hops, 0)


def client_address(request: Request) -> str:
    """The rate-limit key: the client as seen through the trusted proxies.

    Everything left of the entries our own proxies appended is written by
    the caller, so with N trusted hops the key is the Nth entry from the
    right of X-Forwarded-For (all copies of the header joined). With no
    trusted hops, or a header shorter than N, it is the socket peer.
    """
    peer = request.client.host if request.client else "unknown"
    hops = trusted_proxy_hops()
    if hops == 0:
        return peer
    entries = [
        entry.strip()
        for value in request.headers.getlist("x-forwarded-for")
        for entry in value.split(",")
        if entry.strip()
    ]
    if len(entries) < hops:
        return peer
    return entries[-hops]


def _enforce(limiter: RateLimiter, request: Request, now: float) -> None:
    retry_after = limiter.hit(client_address(request), now)
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail="Too many requests from this address",
            headers={"Retry-After": str(max(1, math.ceil(retry_after)))},
        )


def _compact_json(value: Any) -> str:
    # allow_nan=False: finite_body() has already refused NaN and Infinity.
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def _has_non_finite(value: Any) -> bool:
    stack = [value]
    while stack:
        item = stack.pop()
        if isinstance(item, float):
            if not math.isfinite(item):
                return True
        elif isinstance(item, dict):
            stack.extend(item.values())
        elif isinstance(item, list):
            stack.extend(item)
    return False


async def finite_body(request: Request) -> None:
    """Refuse a JSON body holding NaN or Infinity anywhere.

    Python's parser accepts the NaN / Infinity literals, and an overflowing
    number such as 1e999 parses to Infinity. Stored, either would make every
    later read of the row fail to serialise.
    """
    try:
        body = await request.json()
    except ValueError:
        return  # not JSON at all; FastAPI's own validation answers that
    if _has_non_finite(body):
        raise HTTPException(status_code=422, detail="Request body contains a non-finite number")


def _valid_handle(value: Any) -> bool:
    # type() rather than isinstance(): a bool is an int to Python, not to JSON.
    return (
        isinstance(value, list)
        and len(value) == 2
        and all(type(v) is int and 0 <= v < HANDLE_WORDS for v in value)
    )


def _checked_state_json(state: Dict[str, Any]) -> str:
    extra = sorted(set(state) - ALLOWED_STATE_KEYS)
    if extra:
        raise HTTPException(
            status_code=422,
            detail=f"State has top-level keys outside the allowlist: {extra}",
        )
    if "handle" in state and not _valid_handle(state["handle"]):
        raise HTTPException(
            status_code=422,
            detail=f"handle must be an array of two integers from 0 to {HANDLE_WORDS - 1}",
        )
    state_json = _compact_json(state)
    if len(state_json.encode("utf-8")) > MAX_STATE_BYTES:
        raise HTTPException(status_code=413, detail="State document too large")
    return state_json


# ── Request bodies ───────────────────────────────────────────────────


class CreatePlayerRequest(BaseModel):
    state: Dict[str, Any]


class RedeemRequest(BaseModel):
    code: str


class PutStateRequest(BaseModel):
    # Strict: "2", 2.0 and true are refused rather than coerced.
    base_rev: StrictInt = Field(ge=0, le=MAX_REV)
    state: Dict[str, Any]


class PutGameRequest(BaseModel):
    date: str = Field(min_length=1, max_length=64)
    payload: Dict[str, Any]


# ── Players and devices ──────────────────────────────────────────────


@router.post("/players", status_code=201)
async def create_player(
    body: CreatePlayerRequest,
    request: Request,
    _finite: None = Depends(finite_body),
    now: float = Depends(current_time),
):
    state_json = _checked_state_json(body.state)
    _enforce(create_limiter, request, now)
    player_id, token = await storage.create_player(state_json, now)
    return {"player_id": player_id, "device_token": token, "rev": 1, "state": body.state}


@router.post("/pairing-codes", status_code=201)
async def mint_pairing_code(
    device: Device = Depends(current_device), now: float = Depends(current_time)
):
    code, expires_at = await storage.mint_pairing_code(device.player_id, now)
    return {"code": code, "expires_at": storage.iso_utc(expires_at)}


@router.post("/pairing-codes/redeem")
async def redeem_pairing_code(
    body: RedeemRequest, request: Request, now: float = Depends(current_time)
):
    _enforce(redeem_limiter, request, now)
    code = body.code.strip().upper()
    linked = None
    if len(code) == storage.PAIRING_CODE_LENGTH:
        linked = await storage.redeem_pairing_code(code, now)
    if linked is None:
        # Unknown, expired and used look the same from outside.
        raise HTTPException(status_code=404, detail="Pairing code not found")
    player_id, token, rev, state_json = linked
    return {
        "player_id": player_id,
        "device_token": token,
        "rev": rev,
        "state": json.loads(state_json),
    }


@router.delete("/devices/current", status_code=204)
async def revoke_current_device(device: Device = Depends(current_device)):
    await storage.revoke_device(device.token)
    return Response(status_code=204)


# ── State document ───────────────────────────────────────────────────


@router.get("/state")
async def get_state(device: Device = Depends(current_device)):
    found = await storage.get_state(device.player_id)
    if found is None:
        # A token whose player row is gone is as good as revoked.
        raise _unauthorized()
    rev, state_json = found
    return {"rev": rev, "state": json.loads(state_json)}


@router.put("/state")
async def put_state(
    body: PutStateRequest,
    device: Device = Depends(current_device),
    _finite: None = Depends(finite_body),
    now: float = Depends(current_time),
):
    state_json = _checked_state_json(body.state)
    written, rev, current_json = await storage.put_state(
        device.player_id, body.base_rev, state_json, now
    )
    if not written:
        return JSONResponse(
            status_code=409, content={"rev": rev, "state": json.loads(current_json)}
        )
    return {"rev": rev}


# ── Replay library ───────────────────────────────────────────────────


@router.get("/games")
async def list_games(device: Device = Depends(current_device)):
    games = await storage.list_games(device.player_id)
    return {"games": [{"id": game_id, "date": date} for game_id, date in games]}


@router.get("/games/{game_id}")
async def get_game(
    game_id: str = Path(min_length=1, max_length=MAX_GAME_ID_LENGTH),
    device: Device = Depends(current_device),
):
    found = await storage.get_game(device.player_id, game_id)
    if found is None:
        raise HTTPException(status_code=404, detail="Game not found")
    date, payload_json = found
    return {"id": game_id, "date": date, "payload": json.loads(payload_json)}


@router.put("/games/{game_id}")
async def put_game(
    body: PutGameRequest,
    game_id: str = Path(min_length=1, max_length=MAX_GAME_ID_LENGTH),
    device: Device = Depends(current_device),
    _finite: None = Depends(finite_body),
    now: float = Depends(current_time),
):
    payload = dict(body.payload)
    # The bot's diagnostic log stays on the device.
    payload.pop("selectorLog", None)
    sgf = payload.get("sgf")
    if not isinstance(sgf, str) or not sgf:
        raise HTTPException(status_code=422, detail="Replay payload missing sgf")
    payload_json = _compact_json(payload)
    if len(payload_json.encode("utf-8")) > MAX_GAME_BYTES:
        raise HTTPException(status_code=413, detail="Replay payload too large")
    kept = await storage.put_game(device.player_id, game_id, body.date, payload_json, now)
    return {"kept": kept}


@router.delete("/games/{game_id}", status_code=204)
async def delete_game(
    game_id: str = Path(min_length=1, max_length=MAX_GAME_ID_LENGTH),
    device: Device = Depends(current_device),
):
    await storage.delete_game(device.player_id, game_id)
    return Response(status_code=204)
