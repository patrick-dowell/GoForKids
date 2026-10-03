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

Revision 5 adds three reads:

GET    /api/sync/friends/feed                          what friends did lately
GET    /api/sync/friends/{player_id}/games             a friend's replays, newest 20
GET    /api/sync/friends/{player_id}/games/{game_id}   one of them

Revision 8: each result in the feed carries `game_id`, the friend's replay
of that game (app.sync.feed_games), or null.

Every route needs a device token (401 otherwise). `/friends/code`,
`/friends/requests...` and `/friends/feed` are registered before
`/friends/{player_id}`, and `{player_id}` matches only a UUID; anything else
under /friends/ is 404.

Nothing about another player reaches the client unchecked: the card, the
lists, the feed and a friend's replays pass on only values that match the
shapes below (replays: app.sync.friend_replays), so text a tampered client
wrote into its own state or replays never reaches another player.
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
from app.sync import feed_games, storage
from app.sync.friend_replays import checked_replay, summary
from app.sync.ratelimit import RateLimiter
from app.uploads.storage import SHARE_ID_ALPHABET

router = APIRouter()

_HOUR = 3600.0
# On POST /friends/requests every attempt counts, a 404 and a 422 included,
# so a code cannot be guessed by trying many: 20 an hour per player, and 60
# an hour per client address (keyed as the create and redeem limits are).
request_player_limiter = RateLimiter(limit=20, window_s=_HOUR)
request_address_limiter = RateLimiter(limit=60, window_s=_HOUR)
# The feed and a friend's replays (Revision 5) are reads, counted apart from
# the requests above: 600 an hour per player, shared by the three routes. The
# Friends section reads the feed every 30 seconds while it is open (120 an
# hour a device), so a player on a few devices opening games stays well under.
read_player_limiter = RateLimiter(limit=600, window_s=_HOUR)

FEED_LIMIT = 50
# A friend is active recently when one of their devices was seen this
# recently (a device's last-seen time is written at most once a minute).
ACTIVE_WINDOW_S = 10 * 60
FRIEND_GAMES_LIMIT = 20
# A replay id the app writes (8 hex digits, or "local-" and a time), and a
# replay's date as the app writes it (`toISOString()`).
_GAME_ID = feed_games.GAME_ID
_GAME_DATE = feed_games.GAME_DATE

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


def _history(slot: Dict[str, Any], key: str = "history") -> list:
    entries = slot.get(key)
    return entries if isinstance(entries, list) else []


def _boards(state: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Each allowed board's current rung (null when it fails its check) and
    how many ranked games its history holds as stored."""
    boards = {}
    for board, slot in _slots(state).items():
        rung_state = slot.get("rungState")
        boards[board] = {
            "rung": _rung(rung_state.get("currentRung") if isinstance(rung_state, dict) else None),
            "games": len(_history(slot)),
        }
    return boards


def card(player_id: str, state: Dict[str, Any]) -> Dict[str, Any]:
    """A friend's card from the friend's stored state. `games` counts the
    history entries as stored; `recent` is the newest ten that pass every
    check, a rung that fails its check passing as null."""
    boards = _boards(state)
    games = sum(b["games"] for b in boards.values())
    recent = []
    for board, slot in _slots(state).items():
        for entry in _history(slot):
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


def feed_events(player_id: str, state: Dict[str, Any]) -> list:
    """A friend's ranked results and promotions as feed events, each tagged
    with who it was. A result passes as the card's recent results do, with
    the bot played (`bot`, a rung or null); a promotion needs a `to` rung and
    a `ts` that pass their checks, and `from` passes as a rung or null.

    A result's `game_id` (Revision 8) starts null; `_claim` holds the replay
    id its history entry names, for `link_feed_games`, which sets `game_id`
    and drops `_claim` before anything is sent."""
    who = {"player_id": player_id, "handle": _handle(state), "avatar": _avatar(state)}
    events = []
    for board, slot in _slots(state).items():
        for entry in _history(slot):
            if not isinstance(entry, dict):
                continue
            result, ts = entry.get("result"), entry.get("ts")
            if result not in RESULTS or not _ts(ts):
                continue
            events.append({
                "kind": "game", **who, "board": board, "result": result,
                "rung": _rung(entry.get("rung")), "bot": _rung(entry.get("bot")), "ts": ts,
                "game_id": None, "_claim": feed_games.claimed_id(entry.get("gameId")),
            })
        for entry in _history(slot, "promotionEvents"):
            if not isinstance(entry, dict):
                continue
            to, ts = _rung(entry.get("to")), entry.get("ts")
            if to is None or not _ts(ts):
                continue
            events.append({
                "kind": "promotion", **who, "board": board,
                "from": _rung(entry.get("from")), "to": to, "ts": ts,
            })
    return events


def _feed_order(event: Dict[str, Any]) -> tuple:
    # Newest first; a promotion before the game that earned it (same ts).
    return (-event["ts"], event["kind"] != "promotion", event["player_id"], event["board"])


async def link_feed_games(viewer_id: str, events: list, shown: list) -> None:
    """Revision 8: set `game_id` on every result shown (the friend's replay
    it opens, or null; see app.sync.feed_games) and drop every `_claim`.
    Each friend with a result shown is matched across all their results, so
    one past the cut keeps its own replay."""
    by_friend: Dict[str, list] = {}
    for event in events:
        if event["kind"] == "game":
            by_friend.setdefault(event["player_id"], []).append(event)
    for friend_id in {e["player_id"] for e in shown if e["kind"] == "game"}:
        results = by_friend[friend_id]
        # Read through the friendship, as a friend's replay list is.
        rows = await storage.friend_games(viewer_id, friend_id, storage.REPLAY_CAP) or []
        feed_games.link_games(results, [r["_claim"] for r in results], rows)
    for event in events:
        event.pop("_claim", None)


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


def _enforce_read_limit(device: Device, now: float) -> None:
    """The feed and replay reads' own per-player limit, or a 429. Separate
    from the request limits: reading never uses up a player's requests."""
    wait = read_player_limiter.hit(device.player_id, now)
    if wait is not None:
        raise HTTPException(
            status_code=429,
            detail="Too many requests; try again later",
            headers={"Retry-After": str(max(1, math.ceil(wait)))},
        )


@router.get("/friends/feed")
async def get_feed(device: Device = Depends(current_device), now: float = Depends(current_time)):
    """Every accepted friend (newest friendship first) with their boards and
    whether one of their devices was seen in the last ACTIVE_WINDOW_S, and
    the newest FEED_LIMIT results and promotions across them."""
    _enforce_read_limit(device, now)
    friends, events = [], []
    for row in await storage.friends_for_feed(device.player_id):
        state = json.loads(row.state_json)  # always an object: checked on write
        friends.append({
            "player_id": row.player_id,
            "handle": _handle(state),
            "avatar": _avatar(state),
            "active_recently": row.last_seen_at is not None and now - row.last_seen_at <= ACTIVE_WINDOW_S,
            "boards": _boards(state),
        })
        events.extend(feed_events(row.player_id, state))
    events.sort(key=_feed_order)
    shown = events[:FEED_LIMIT]
    await link_feed_games(device.player_id, events, shown)
    return {"friends": friends, "events": shown}


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


# ── A friend's replays (Revision 5) ──────────────────────────────────


@router.get("/friends/{player_id:uuid}/games")
async def list_friend_games(
    player_id: uuid.UUID,
    device: Device = Depends(current_device),
    now: float = Depends(current_time),
):
    """The friend's newest FRIEND_GAMES_LIMIT replays, each with what the
    list says about it. A replay whose id, date or SGF fails its check is
    left out. The same 404 as the card for anyone who is not a friend."""
    _enforce_read_limit(device, now)
    rows = await storage.friend_games(device.player_id, str(player_id), FRIEND_GAMES_LIMIT)
    if rows is None:
        raise _not_found()
    games = []
    for game_id, date, payload_json in rows:
        if not (_GAME_ID.fullmatch(game_id) and _GAME_DATE.fullmatch(date)):
            continue
        replay = checked_replay(json.loads(payload_json))
        if replay is not None:
            games.append({"id": game_id, "date": date, **summary(replay)})
    return {"games": games}


@router.get("/friends/{player_id:uuid}/games/{game_id}")
async def get_friend_game(
    player_id: uuid.UUID,
    game_id: str,
    device: Device = Depends(current_device),
    now: float = Depends(current_time),
):
    """One of the friend's replays, rebuilt from checked values. A stranger,
    an unknown game and a replay that fails its check all get the card's 404."""
    _enforce_read_limit(device, now)
    found = None
    if _GAME_ID.fullmatch(game_id):
        found = await storage.friend_game(device.player_id, str(player_id), game_id)
    if found is None:
        raise _not_found()
    date, payload_json = found
    replay = checked_replay(json.loads(payload_json))
    if replay is None or not _GAME_DATE.fullmatch(date):
        raise _not_found()
    return {"id": game_id, "date": date, "payload": replay}


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
