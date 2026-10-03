"""
Which of a friend's replays a feed result opens (feature plan 32, Revision 8).

A ranked result in a friend's ladder history becomes a button in the feed
when the friend's synced replay of that game is found:

- A result the app recorded from Revision 8 on names its replay (`gameId` on
  the history entry): that replay, when the friend has it and it passes the
  replay check; otherwise none. A named result never falls back to time.
- A result with no `gameId` (every result recorded before Revision 8) is
  matched by time: a replay of the same friend, on the same board, whose
  outcome for its owner is the result's, and whose `date` is within
  MATCH_WINDOW_MS of the result's `ts`. The nearest pair wins, and each
  replay opens at most one result (a named one first).

How the app stamps the two (frontend gameStore.autoSaveGame, then
autoPlayStore.recordResult from App's game-end effect): the replay's `date`
is `new Date().toISOString()` when the finished game is saved, and the
result's `ts` is `Date.now()` when it is recorded, which follows in the same
tick or the render after it, on the same device's clock: milliseconds
apart. The window allows a minute, room for a game-end render the system
held back (an app sent to the background as a game ends). A neighbouring
game inside that minute does not steal the link: its own replay is nearer
to its own result, the nearest pair goes first, and a replay whose outcome
differs (or a game the friend only watched) never matches.

Nothing here reaches the client but a replay id that is the friend's and
passes its check, or null.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from app.sync.friend_replays import checked_replay, summary

MATCH_WINDOW_MS = 60_000

# A replay id the app writes: 8 hex digits, or "local-" and a time.
GAME_ID = re.compile(r"[A-Za-z0-9_-]{1,128}")
# A replay's date as the app writes it: `toISOString()`.
GAME_DATE = re.compile(
    r"([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,6}))?Z"
)


def claimed_id(value: Any) -> Optional[str]:
    """The `gameId` a history entry names, when it is an id in the app's shape."""
    return value if isinstance(value, str) and GAME_ID.fullmatch(value) else None


def date_ms(date: Any) -> Optional[int]:
    """A `toISOString()` date as epoch milliseconds; None for anything else."""
    m = GAME_DATE.fullmatch(date) if isinstance(date, str) else None
    if not m:
        return None
    try:
        at = datetime(*(int(g) for g in m.groups()[:6]), tzinfo=timezone.utc)
    except ValueError:  # a 13th month, a 30th of February
        return None
    fraction = (m.group(7) or "").ljust(3, "0")[:3]
    return int(at.timestamp()) * 1000 + int(fraction)


class _Replays:
    """A friend's replays by id, each checked once and only when asked."""

    def __init__(self, rows: Iterable[Tuple[str, str, str]]):
        self.at: Dict[str, int] = {}
        self._payload: Dict[str, str] = {}
        self._summary: Dict[str, Optional[Dict[str, Any]]] = {}
        for game_id, date, payload_json in rows:
            ms = date_ms(date)
            if GAME_ID.fullmatch(game_id) and ms is not None:
                self.at[game_id] = ms
                self._payload[game_id] = payload_json

    def summary(self, game_id: str) -> Optional[Dict[str, Any]]:
        """What the friend's replay list says of it, or None when it would
        not be served (it fails the replay check)."""
        if game_id not in self._summary:
            try:
                replay = checked_replay(json.loads(self._payload[game_id]))
            except ValueError:
                replay = None
            self._summary[game_id] = summary(replay) if replay is not None else None
        return self._summary[game_id]


def link_games(
    results: List[Dict[str, Any]],
    claims: List[Optional[str]],
    rows: Iterable[Tuple[str, str, str]],
    window_ms: int = MATCH_WINDOW_MS,
) -> None:
    """Set `game_id` on each of one friend's feed results (`board`, `result`,
    `ts`): the replay it opens, or None. `claims[i]` is the id results[i]'s
    history entry names (None for none); `rows` are the friend's replays as
    (game_id, date, payload_json)."""
    replays = _Replays(rows)
    used: set = set()
    for result in results:
        result["game_id"] = None

    # Named results first, newest first: a replay named twice opens the newer.
    named = sorted(
        (i for i, claim in enumerate(claims) if claim is not None),
        key=lambda i: -results[i]["ts"],
    )
    for i in named:
        claim = claims[i]
        if claim in replays.at and claim not in used and replays.summary(claim) is not None:
            results[i]["game_id"] = claim
            used.add(claim)

    # The rest by time: every fitting pair in the window, nearest first.
    pairs = []
    for i, result in enumerate(results):
        if claims[i] is not None:
            continue
        for game_id, ms in replays.at.items():
            gap = abs(ms - result["ts"])
            if gap > window_ms or game_id in used:
                continue
            found = replays.summary(game_id)
            if found and found["board"] == result["board"] and found["outcome"] == result["result"]:
                pairs.append((gap, -result["ts"], game_id, i))
    taken: set = set()
    for _, _, game_id, i in sorted(pairs):
        if i in taken or game_id in used:
            continue
        results[i]["game_id"] = game_id
        used.add(game_id)
        taken.add(i)
