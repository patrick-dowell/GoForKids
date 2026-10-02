"""
What a friend sees of a replay (feature plan 32, Revision 5).

A replay is stored as its owner's device sent it (`PUT /api/sync/games/{id}`),
checked for little beyond an `sgf` string. Before one reaches a friend it is
rebuilt here from values that pass a check, the way the card is (Revision 4),
so nothing a tampered client wrote reaches another player as text.

A SavedGame (frontend/src/store/libraryStore.ts) holds no text a player
typed: the app writes the SGF from the board alone (size, komi, handicap
stones, result, moves; no names, no comments), and every string field is
built from fixed values (`"Black wins by 5.5"`, a bot's rung). Each field is
checked anyway, and only these pass:

  sgf           rebuilt from what the app's own reader takes from it (board
                size, komi, handicap stones, moves) plus the result; anything
                else in it is left out. A stone off the board, or more than
                MAX_MOVES moves, and the replay is not served at all.
  result        "Black wins by 5.5" or "White wins (resignation)" in shape
  playerColor   "black" or "white" (anything else reads as "black")
  opponentRank  a rung, or "<rung> vs <rung>" for a watched bot game
  blackRank, whiteRank   a rung
  moveCount     an integer from 0 to MAX_MOVES
  isRanked      a boolean (anything else reads as false)
  gameType      "human-vs-bot" or "bot-vs-bot"
  scoreHistory  [{move, lead}]: an integer move, a finite lead
  deadStones    [{row, col, color}] on the board, color 1 (black) or 2 (white)

Always left out: `selectorLog` (never stored), `sharedId` (the owner's share
code), `gameId` (a backend game id), `id` and `date` (the row's own are
served), and any other key.
"""

from __future__ import annotations

import math
import re
from typing import Any, Dict, List, Optional

MAX_MOVES = 1000
MAX_BOARD = 19  # SGF letters a..s
MAX_LEAD = 1000
APP_BOARDS = (9, 13, 19)

# The app's reader (Game.fromSGF) takes the first SZ, KM and AB it finds and
# every move; these match exactly what it matches.
_SIZE = re.compile(r"SZ\[([^\]]*)\]")
_SIZE_DIGITS = re.compile(r"\d{1,2}")  # the app writes two digits at most; int() on thousands raises on 3.11+
_KOMI = re.compile(r"KM\[([^\]]+)\]")
_SETUP = re.compile(r"AB((?:\[[a-z]{2}\])+)")
_SETUP_POINT = re.compile(r"\[([a-z]{2})\]")
_MOVE = re.compile(r";([BW])\[([a-z]{0,2})\]")
_RESULT_PROP = re.compile(r"RE\[([^\]]*)\]")

_KOMI_VALUE = re.compile(r"-?[0-9]{1,3}(?:\.[0-9]{1,2})?")
_RESULT_VALUE = re.compile(r"[BW]\+[0-9]{1,4}(?:\.[0-9]{1,3})?")
_RESULT_TEXT = re.compile(r"(Black|White) wins (?:by [0-9]{1,4}(?:\.[0-9]{1,2})?|\(resignation\))")
_RUNG = re.compile(r"[0-9]{1,2}[kdp]")
_MATCHUP = re.compile(r"(?:[0-9]{1,2}[kdp]|\?) vs (?:[0-9]{1,2}[kdp]|\?)")
GAME_TYPES = ("human-vs-bot", "bot-vs-bot")
COLORS = ("black", "white")
STONE_COLORS = (1, 2)


def _is_int(value: Any) -> bool:
    # type() rather than isinstance(): a bool is an int to Python, not to JSON.
    return type(value) is int


def _point(coords: str, size: int) -> Optional[str]:
    """Two letters for a point on the board, else None."""
    col, row = ord(coords[0]) - 97, ord(coords[1]) - 97
    return coords if 0 <= col < size and 0 <= row < size else None


def rebuild_sgf(sgf: Any) -> Optional[str]:
    """The SGF as the app would have written it, from the parts its reader
    uses; None when it is not one the app could have written."""
    if not isinstance(sgf, str) or not sgf:
        return None
    m = _SIZE.search(sgf)
    if m and not _SIZE_DIGITS.fullmatch(m.group(1)):
        return None
    size = int(m.group(1)) if m else MAX_BOARD
    if not 2 <= size <= MAX_BOARD:
        return None
    out = f"(;GM[1]FF[4]CA[UTF-8]SZ[{size}]"
    m = _KOMI.search(sgf)
    if m and _KOMI_VALUE.fullmatch(m.group(1)):
        out += f"KM[{m.group(1)}]"
    out += "RU[Japanese]"
    m = _SETUP.search(sgf)
    if m:
        stones = [_point(p, size) for p in _SETUP_POINT.findall(m.group(1))]
        if None in stones:
            return None
        out += f"HA[{len(stones)}]AB" + "".join(f"[{p}]" for p in stones)
    m = _RESULT_PROP.search(sgf)
    if m and _RESULT_VALUE.fullmatch(m.group(1)):
        out += f"RE[{m.group(1)}]"
    moves = _MOVE.findall(sgf)
    if len(moves) > MAX_MOVES:
        return None
    for color, coords in moves:
        if len(coords) == 2:
            point = _point(coords, size)
            if point is None:
                return None
            out += f";{color}[{point}]"
        else:
            out += f";{color}[]"  # a pass, as the reader reads one
    return out + ")"


def _board_size(sgf: str) -> int:
    m = _SIZE.search(sgf)
    return int(m.group(1)) if m and _SIZE_DIGITS.fullmatch(m.group(1)) else MAX_BOARD


def _score_history(value: Any) -> Optional[List[Dict[str, Any]]]:
    if not isinstance(value, list):
        return None
    points = []
    for p in value[: MAX_MOVES + 1]:
        if not isinstance(p, dict):
            continue
        move, lead = p.get("move"), p.get("lead")
        lead_ok = (_is_int(lead) or type(lead) is float) and math.isfinite(lead) and abs(lead) <= MAX_LEAD
        if _is_int(move) and 0 <= move <= MAX_MOVES and lead_ok:
            points.append({"move": move, "lead": lead})
    return points


def _dead_stones(value: Any, size: int) -> Optional[List[Dict[str, int]]]:
    if not isinstance(value, list):
        return None
    stones = []
    for s in value[: size * size]:
        if not isinstance(s, dict):
            continue
        row, col, color = s.get("row"), s.get("col"), s.get("color")
        if (
            _is_int(row) and _is_int(col) and _is_int(color)
            and 0 <= row < size and 0 <= col < size and color in STONE_COLORS
        ):
            stones.append({"row": row, "col": col, "color": color})
    return stones


def checked_replay(payload: Any) -> Optional[Dict[str, Any]]:
    """A friend's replay as it may be served, or None when its SGF is not one
    the app could have written (the replay is then not served)."""
    if not isinstance(payload, dict):
        return None
    sgf = rebuild_sgf(payload.get("sgf"))
    if sgf is None:
        return None
    size = _board_size(sgf)
    out: Dict[str, Any] = {"sgf": sgf}
    result = payload.get("result")
    if isinstance(result, str) and _RESULT_TEXT.fullmatch(result):
        out["result"] = result
    color = payload.get("playerColor")
    out["playerColor"] = color if color in COLORS else "black"
    opponent = payload.get("opponentRank")
    if isinstance(opponent, str) and (_RUNG.fullmatch(opponent) or _MATCHUP.fullmatch(opponent)):
        out["opponentRank"] = opponent
    for key in ("blackRank", "whiteRank"):
        rung = payload.get(key)
        if isinstance(rung, str) and _RUNG.fullmatch(rung):
            out[key] = rung
    moves = payload.get("moveCount")
    if _is_int(moves) and 0 <= moves <= MAX_MOVES:
        out["moveCount"] = moves
    out["isRanked"] = payload.get("isRanked") is True
    game_type = payload.get("gameType")
    if game_type in GAME_TYPES:
        out["gameType"] = game_type
    history = _score_history(payload.get("scoreHistory"))
    if history:
        out["scoreHistory"] = history
    dead = _dead_stones(payload.get("deadStones"), size)
    if dead:
        out["deadStones"] = dead
    return out


def summary(replay: Dict[str, Any]) -> Dict[str, Any]:
    """What a friend's replay list says about one checked replay: the board
    (a key of the card's, or null for another size), the outcome for its
    owner (`win`, `loss`, `watched` for a bot game they watched, or null when
    the result is missing) and the bot they played (a rung, or null)."""
    size = _board_size(replay["sgf"])
    watched = replay.get("gameType") == "bot-vs-bot"
    outcome: Optional[str] = None
    if watched:
        outcome = "watched"
    elif "result" in replay:
        winner = replay["result"].split(" ", 1)[0].lower()
        outcome = "win" if winner == replay["playerColor"] else "loss"
    opponent = replay.get("opponentRank")
    return {
        "board": f"{size}x{size}" if size in APP_BOARDS else None,
        "outcome": outcome,
        "opponent": opponent if not watched and opponent and _RUNG.fullmatch(opponent) else None,
    }
