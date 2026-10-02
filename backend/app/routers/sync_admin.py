"""
Sync admin endpoints (feature plan 32, Revision 3).

GET    /api/sync/admin/players                              every profile
POST   /api/sync/admin/players                              a profile with no device yet
POST   /api/sync/admin/players/{player_id}/pairing-codes    a code with the admin's expiry
DELETE /api/sync/admin/devices/{device_id}                  revoke one device
DELETE /api/sync/admin/players/{player_id}/devices          revoke all of a profile's devices

An admin is a device of a profile listed in SYNC_ADMIN_PLAYER_IDS. A missing,
unknown or revoked token answers 401; any other non-admin answers 403 before
anything else about the request is looked at, its body included (which is
why the two routes with a body parse it themselves). None of these routes is
rate limited.
"""

from __future__ import annotations

import json
import math
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Type, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, StrictStr, ValidationError

from app.sync import storage
from app.routers.sync import (
    Device,
    _checked_state_json,
    _has_non_finite,
    _valid_handle,
    admin_player_ids,
    current_device,
    current_time,
)

router = APIRouter()

_DAY = 24 * 3600.0
# How far ahead an admin's code may expire, plus a minute for clock skew
# between the admin's device and the server.
MAX_ADMIN_CODE_AHEAD_S = _DAY + 60


async def admin_device(device: Device = Depends(current_device)) -> Device:
    if device.player_id not in admin_player_ids():
        raise HTTPException(status_code=403, detail="This profile is not an admin")
    return device


# ── Request bodies ───────────────────────────────────────────────────


class AdminCreatePlayerRequest(BaseModel):
    state: Dict[str, Any]


class AdminMintCodeRequest(BaseModel):
    expires_at: StrictStr


_Body = TypeVar("_Body", bound=BaseModel)


async def _parse_body(request: Request, model: Type[_Body]) -> _Body:
    try:
        raw = await request.json()
    except ValueError:
        raise HTTPException(status_code=422, detail="Request body is not JSON")
    if _has_non_finite(raw):
        raise HTTPException(status_code=422, detail="Request body contains a non-finite number")
    try:
        return model.model_validate(raw)
    except ValidationError as err:
        raise HTTPException(
            status_code=422, detail=json.loads(err.json(include_url=False))
        )


# ISO 8601 date and time with an offset: `Z`, `±HH:MM`, `±HHMM` or `±HH`.
# Seconds and a fraction of a second are optional, so the output of
# Date.prototype.toISOString() parses, as does the same time without
# milliseconds. A time without an offset does not match.
_OFFSET_TIME = re.compile(
    r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?"
    r"(?:(Z)|([+-])(\d{2})(?::?([0-5]\d))?)",
    re.ASCII,
)


def parse_offset_time(value: str) -> Optional[float]:
    """Epoch seconds for an ISO 8601 time with an offset, else None."""
    match = _OFFSET_TIME.fullmatch(value)
    if match is None:
        return None
    year, month, day, hour, minute, second, fraction, _z, sign, off_h, off_m = match.groups()
    try:
        offset = timedelta(hours=int(off_h or 0), minutes=int(off_m or 0))
        if sign == "-":
            offset = -offset
        moment = datetime(
            int(year), int(month), int(day), int(hour), int(minute), int(second or 0),
            tzinfo=timezone(offset),
        )
    except ValueError:  # month 13, an offset of a day or more, and so on
        return None
    return moment.timestamp() + (float(f"0.{fraction}") if fraction else 0.0)


# ── The list ─────────────────────────────────────────────────────────


def _boards(state: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Rung and game count per board from a stored state. Below the top
    level every field is optional here: a missing or malformed one gives a
    null rung or 0 games, never an error."""
    ladder = state.get("ladder")
    by_size = ladder.get("byBoardSize") if isinstance(ladder, dict) else None
    if not isinstance(by_size, dict):
        return {}
    boards = {}
    for size, slot in by_size.items():
        slot = slot if isinstance(slot, dict) else {}
        rung_state = slot.get("rungState")
        rung = rung_state.get("currentRung") if isinstance(rung_state, dict) else None
        history = slot.get("history")
        boards[size] = {
            "rung": rung if isinstance(rung, str) else None,
            "games": len(history) if isinstance(history, list) else 0,
        }
    return boards


def _days_left(summary: storage.PlayerSummary, now: float) -> Optional[int]:
    if summary.devices or summary.no_device_since is None:
        return None
    remaining = summary.no_device_since + storage.RETENTION_S - now
    return max(0, math.ceil(remaining / _DAY))


def _iso_or_none(ts: Optional[float]) -> Optional[str]:
    return None if ts is None else storage.iso_utc(ts)


def _entry(summary: storage.PlayerSummary, now: float) -> Dict[str, Any]:
    state = json.loads(summary.state_json)  # always an object: checked on write
    handle = state.get("handle")
    return {
        "player_id": summary.player_id,
        "handle": handle if _valid_handle(handle) else None,
        "boards": _boards(state),
        "devices": [
            {
                "device_id": d.device_id,
                "created_at": d.created_at,
                "last_seen_at": _iso_or_none(d.last_seen_at),
                "kind": d.kind,
            }
            for d in summary.devices
        ],
        "replays": summary.replays,
        "created_at": summary.created_at,
        "updated_at": summary.updated_at,
        "no_device_since": _iso_or_none(summary.no_device_since),
        "days_left": _days_left(summary, now),
    }


@router.get("/players")
async def list_players(
    _admin: Device = Depends(admin_device), now: float = Depends(current_time)
):
    return {
        "players": [_entry(s, now) for s in await storage.list_players()],
        # A device row with no `last_seen_at` created before this was last
        # used before it, not never (the stamp arrived with Revision 3).
        "last_seen_since": await storage.last_seen_since(),
    }


# ── A new profile and a code for it ──────────────────────────────────


@router.post("/players", status_code=201)
async def create_player(
    request: Request,
    _admin: Device = Depends(admin_device),
    now: float = Depends(current_time),
):
    body = await _parse_body(request, AdminCreatePlayerRequest)
    state = body.state
    if not (
        "handle" in state
        and isinstance(state.get("ladder"), dict)
        and isinstance(state.get("lessons"), list)
    ):
        raise HTTPException(
            status_code=422,
            detail="A new profile's state needs a handle, a ladder object and a lessons array",
        )
    state_json = _checked_state_json(state)
    player_id = await storage.admin_create_player(state_json, now)
    return {"player_id": player_id, "rev": 1}


@router.post("/players/{player_id}/pairing-codes", status_code=201)
async def mint_pairing_code(
    player_id: str,
    request: Request,
    _admin: Device = Depends(admin_device),
    now: float = Depends(current_time),
):
    body = await _parse_body(request, AdminMintCodeRequest)
    expires_at = parse_offset_time(body.expires_at)
    if expires_at is None:
        raise HTTPException(
            status_code=422, detail="expires_at must be an ISO 8601 time with an offset"
        )
    if not now < expires_at <= now + MAX_ADMIN_CODE_AHEAD_S:
        raise HTTPException(
            status_code=422, detail="expires_at must be after now and at most 24 hours ahead"
        )
    minted = await storage.mint_admin_pairing_code(player_id, now, expires_at)
    if minted is None:
        raise HTTPException(status_code=404, detail="Player not found")
    code, expires_at = minted
    return {"code": code, "expires_at": storage.iso_utc(expires_at)}


# ── Signing devices out ──────────────────────────────────────────────


@router.delete("/devices/{device_id}", status_code=204)
async def remove_device(
    device_id: str,
    admin: Device = Depends(admin_device),
    now: float = Depends(current_time),
):
    if device_id == admin.device_id:
        raise HTTPException(status_code=409, detail="Use Log out to sign out this device")
    if not await storage.remove_device(device_id, now):
        raise HTTPException(status_code=404, detail="Device not found")
    return Response(status_code=204)


@router.delete("/players/{player_id}/devices", status_code=204)
async def remove_player_devices(
    player_id: str,
    admin: Device = Depends(admin_device),
    now: float = Depends(current_time),
):
    if player_id == admin.player_id:
        raise HTTPException(
            status_code=409, detail="This device's own profile cannot be signed out here"
        )
    if not await storage.remove_player_devices(player_id, now):
        raise HTTPException(status_code=404, detail="Player not found")
    return Response(status_code=204)
