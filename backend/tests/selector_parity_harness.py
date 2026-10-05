"""The harness behind the selector parity cases (data/selector_parity/).

One case is one move decision: a profile's knobs, a position, the engine's
answers in the order the selector asks for them, the random draws in the order
it consumes them, and the move the Python picks. The generator
(data/selector_parity/generate.py) records a case by running the Python with a
seeded feed; test_selector_parity.py replays it against the Python and
frontend/src/ai/__tests__/selectorParity.test.ts against the TypeScript.

The draws are fed at the level both languages consume the same numbers:
  - `u`: uniforms in [0, 1), one per random.random() call. random.choices is
    the stdlib's own (bisect over random() * total, the TS weightedChoice and
    choiceIndex); random.choice is floor(random() * n), the TS
    Math.floor(Math.random() * n).
  - `g`: standard normals, one per random.gauss call (mu + z * sigma). Python's
    gauss makes two normals from two uniforms and caches the second; the TS
    Box-Muller spends two uniforms on each normal and drops the twin. Uniforms
    cannot map one to one between the two, so a case records the normal itself.
"""

from __future__ import annotations

import gzip
import json
import math
import random
from pathlib import Path
from types import SimpleNamespace
from typing import Callable, Optional

from app.game.engine import Board, Color, Point
from app.katago.engine import MoveCandidate

PARITY_DIR = Path(__file__).resolve().parents[2] / "data" / "selector_parity"

# Ownership is stored one character a point: a digit indexing these levels
# (Black +). ±0.3 is the dead-stone threshold itself, so both sides' strict
# comparison is exercised.
OWN_LEVELS = (-1.0, -0.6, -0.3, -0.1, 0.0, 0.1, 0.3, 0.6, 1.0)
STONES = {".": Color.EMPTY, "X": Color.BLACK, "O": Color.WHITE}


def load_cases(name: str) -> list[dict]:
    with gzip.open(PARITY_DIR / f"{name}.json.gz", "rt") as f:
        return json.load(f)["cases"]


def num(x):
    """JSON has no infinities; a case writes them as strings."""
    if x == "Infinity":
        return math.inf
    if x == "-Infinity":
        return -math.inf
    return x


def profile_of(case: dict) -> dict:
    return {k: num(v) for k, v in case["profile"].items()}


def board_of(case: dict) -> Board:
    size = case["size"]
    b = Board(size)
    for i, ch in enumerate(case["board"]):
        b.grid[i] = STONES[ch]
    b._position_history = {b._hash()}
    return b


def ownership_of(s: str) -> list[float]:
    return [OWN_LEVELS[int(ch)] for ch in s]


def color_of(case: dict) -> Color:
    return Color.BLACK if case["color"] == "B" else Color.WHITE


class Feed:
    """A draw source: `record` pulls fresh values from `make` and keeps them;
    replay pops the recorded ones. Past the end it returns `spare` and counts
    the overrun, so the selector finishes and the case reports it."""

    def __init__(self, recorded: Optional[list] = None, make: Optional[Callable[[], float]] = None,
                 spare: float = 0.5):
        self.values = [] if recorded is None else list(recorded)
        self.make = make
        self.used = 0
        self.overrun = 0
        self.spare = spare

    def __call__(self) -> float:
        if self.make is not None:
            v = self.make()
            self.values.append(v)
            self.used += 1
            return v
        if self.used >= len(self.values):
            self.overrun += 1
            return self.spare
        v = self.values[self.used]
        self.used += 1
        return v


class FedRandom(random.Random):
    """Stands in for the `random` module inside move_selector."""

    def __init__(self, u: Feed, g: Feed):
        self.u = u
        self.g = g
        super().__init__(0)

    def random(self) -> float:  # noqa: D102
        return self.u()

    def gauss(self, mu: float = 0.0, sigma: float = 1.0) -> float:  # noqa: D102
        return mu + self.g() * sigma

    def _randbelow(self, n: int) -> int:
        return math.floor(self.random() * n)


async def _ready(v):
    return v


class Answers:
    """The engine's answers in the order asked. Recording, `make(kind, req)`
    supplies each; replaying, each request must match the recorded one."""

    def __init__(self, recorded: Optional[list] = None, make=None):
        self.items: list[dict] = [] if recorded is None else recorded
        self.make = make
        self.used = 0
        self.errors: list[str] = []

    def ask(self, kind: str, **req) -> dict:
        if self.make is not None:
            a = {"kind": kind, **req, **self.make(kind, req)}
            self.items.append(a)
            self.used += 1
            return a
        if self.used >= len(self.items):
            self.errors.append(f"asked {kind} {req} past the recorded answers")
            raise LookupError(self.errors[-1])
        a = self.items[self.used]
        got = {"kind": kind, **req}
        want = {k: a.get(k) for k in got}
        if got != want:
            self.errors.append(f"asked {got}, recorded {want}")
            raise LookupError(self.errors[-1])
        self.used += 1
        return a


def candidates_of(rows: list, ) -> list[MoveCandidate]:
    return [
        MoveCandidate(move=(r, c), visits=v, winrate=w, score_lead=s, prior=p, pv=[], order=j)
        for j, (r, c, v, w, s, p) in enumerate(rows)
    ]


class StandardEngine:
    """The standard path's engine: its own analysis (the case's candidates),
    the border check's ownership read, and the border check's scoring reads."""

    has_human_model = False

    def __init__(self, mover: str, answers: Answers):
        self.mover = mover
        self.answers = answers

    def analyze(self, board_2d, player, max_visits=0, size=19, moves=None, initial_stones=None,
                override_settings=None, include_ownership=False, include_policy=False,
                priority=0, komi=None, **_):
        if player != self.mover:
            a = self.answers.ask("score", move=moves[-1][1], visits=max_visits)
            return _ready(SimpleNamespace(score_lead=a["lead"], winrate=0.5))
        if include_ownership:
            a = self.answers.ask("ownership")
            return _ready(SimpleNamespace(
                ownership=ownership_of(a["own"]), score_lead=0.0, winrate=0.5, candidates=[],
            ))
        wrn = (override_settings or {}).get("wideRootNoise")
        a = self.answers.ask("analysis", visits=max_visits, wrn=wrn)
        return _ready(SimpleNamespace(
            candidates=candidates_of(a["cands"]), score_lead=0.0, winrate=0.5, ownership=None,
        ))


class HumanEngine:
    """The human path's engine: one read with the human profile set (both
    policies, the ownership, the root lead), then the main net's scoring reads."""

    has_human_model = True

    def __init__(self, size: int, answers: Answers):
        self.size = size
        self.answers = answers

    def analyze(self, board_2d, player, max_visits=0, size=19, moves=None, initial_stones=None,
                override_settings=None, include_ownership=False, include_policy=False,
                priority=0, komi=None, **_):
        if override_settings and "humanSLProfile" in override_settings:
            a = self.answers.ask("human", name=override_settings["humanSLProfile"], visits=max_visits)
            return _ready(human_answer(a, self.size))
        a = self.answers.ask("score", move=moves[-1][1], visits=max_visits)
        return _ready(SimpleNamespace(score_lead=a["lead"], winrate=a["winrate"]))


def human_answer(a: dict, size: int) -> SimpleNamespace:
    n = size * size
    human = [0.0] * (n + 1)
    for idx, p in a["human"]:
        human[idx] = p
    main = [0.0] * (n + 1)
    main[n] = a["main_pass"]
    return SimpleNamespace(
        human_policy=human, policy=main, ownership=ownership_of(a["own"]),
        score_lead=a["lead"], winrate=0.5, candidates=[],
    )


def pick_of(move: Optional[Point]):
    return None if move is None else [move.row, move.col]


# --- Running one case through the Python ---------------------------------------

def run_standard(ms, case: dict, u: Feed, g: Feed, answers: Answers, loop):
    """select_ai_move (the eye-fill wrapper around _select_with_katago) on the
    case, with the module's profile lookup, engine and random source swapped
    for the case's. Returns the pick: [row, col], or None for a pass."""
    profile = profile_of(case)
    board = board_of(case)
    color = color_of(case)
    engine = StandardEngine(case["color"], answers)

    async def _get_engine():
        return engine

    saved = (ms.random, ms.get_profile, ms.get_engine)
    ms.random = FedRandom(u, g)
    ms.get_profile = lambda rank, size: profile
    ms.get_engine = _get_engine
    ms._READ_COOLDOWN.clear()
    if case["cooldown"]:
        ms._READ_COOLDOWN[color] = case["cooldown"]
    try:
        last = case["last_opp"]
        move = loop.run_until_complete(ms.select_ai_move(
            board, color, case["rung"], Point(*last) if last else None,
            opponent_passed=case["opponent_passed"], engine_moves=[], komi=case["komi"],
        ))
    finally:
        ms.random, ms.get_profile, ms.get_engine = saved
        ms._READ_COOLDOWN.clear()
    return pick_of(move)


def run_human(ms, case: dict, u: Feed, answers: Answers, loop):
    """_select_with_human_net on the case. Returns (handled, pick)."""
    profile = profile_of(case)
    board = board_of(case)
    color = color_of(case)
    engine = HumanEngine(case["size"], answers)
    saved = ms.random
    ms.random = FedRandom(u, Feed([]))
    try:
        handled, move = loop.run_until_complete(ms._select_with_human_net(
            engine, board, color, case["rung"], profile,
            [["B", "pass"]] * case["moves_played"], None, None,
            case["opponent_passed"], case["komi"],
        ))
    finally:
        ms.random = saved
    return handled, pick_of(move)
