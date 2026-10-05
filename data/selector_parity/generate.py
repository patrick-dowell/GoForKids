"""Regenerates the selector parity cases: data/selector_parity/{standard,human}.json.gz.

Run from the repository root with the backend's interpreter:

    backend/venv/bin/python data/selector_parity/generate.py

Seeded, so the same selectors give the same files byte for byte. Each case is
one move decision, recorded by running the Python selector (the spec) on a
generated position with a seeded feed of engine answers and random draws; the
harness (backend/tests/selector_parity_harness.py) says how the draws are fed.
backend/tests/test_selector_parity.py replays every case against the Python,
frontend/src/ai/__tests__/selectorParity.test.ts against the TypeScript.

Standard path: every rung of data/profiles/b28.yaml on 9x9, 13x13 and 19x19.
Human path: every rung of data/profiles/b28_human.yaml, as written and with the
lean (`human_tilt`) set to 0, +inf and -inf, and with no loss cap.
"""

from __future__ import annotations

import asyncio
import gzip
import json
import math
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import yaml  # noqa: E402

import app.ai.move_selector as ms  # noqa: E402
from app.game.engine import Board, Color, Point  # noqa: E402
from tests.selector_parity_harness import (  # noqa: E402
    OWN_LEVELS, Answers, Feed, board_of, run_human, run_standard,
)

SEED = 20261004
WORK = None  # set by main
STANDARD_PER_RUNG = {9: 240, 13: 80, 19: 40}
HUMAN_PER_RUNG = 520
OUT = Path(__file__).resolve().parent
CH = {Color.EMPTY: ".", Color.BLACK: "X", Color.WHITE: "O"}


def _r(x: float, d: int = 2) -> float:
    return round(x, d)


def encode(board: Board) -> str:
    return "".join(CH[Color(c)] for c in board.grid)


def jsonable_profile(p: dict) -> dict:
    out = {}
    for k, v in p.items():
        if isinstance(v, float) and math.isinf(v):
            v = "Infinity" if v > 0 else "-Infinity"
        out[k] = v
    return out


# --- Positions -------------------------------------------------------------------

def random_board(rng: random.Random, size: int, n_moves: int):
    """Random legal play from the empty board; returns the board and the last
    stone of each colour."""
    b = Board(size)
    color = Color.BLACK
    last = {Color.BLACK: None, Color.WHITE: None}
    for _ in range(n_moves):
        for _ in range(12):
            p = Point(rng.randrange(size), rng.randrange(size))
            if b.clone().try_play(color, p)[0] == "ok":
                b.try_play(color, p)
                last[color] = p
                break
        color = Color.WHITE if color == Color.BLACK else Color.BLACK
    return b, last


def split_board(rng: random.Random, size: int):
    """An endgame: Black's wall on the left, White's on the right, an open
    column between them, walls dented so some dame close a pocket (a border
    move that gains). Returns the board, its ownership and the last stones."""
    k = rng.randrange(2, size - 2)
    b = Board(size)
    own = [4] * (size * size)
    last = {Color.BLACK: None, Color.WHITE: None}
    for r in range(size):
        bw = k - 1 if rng.random() < 0.7 else k - 2
        ww = k + 1 if rng.random() < 0.7 else k + 2
        if ww >= size:
            ww = k + 1
        b.grid[r * size + bw] = Color.BLACK
        b.grid[r * size + ww] = Color.WHITE
        last[Color.BLACK] = Point(r, bw)
        last[Color.WHITE] = Point(r, ww)
        if rng.random() < 0.12:
            b.grid[r * size + k] = rng.choice([Color.BLACK, Color.WHITE])
        for c in range(size):
            if c < k:
                own[r * size + c] = rng.choice([8, 8, 8, 7])
            elif c > k:
                own[r * size + c] = rng.choice([0, 0, 0, 1])
            else:
                own[r * size + c] = rng.choice([4, 4, 3, 5])
    # A stone inside the other side's area, sometimes read dead, sometimes not.
    if rng.random() < 0.4:
        r, c = rng.randrange(size), rng.randrange(0, max(1, k - 2))
        if b.grid[r * size + c] == Color.EMPTY:
            b.grid[r * size + c] = Color.WHITE
            own[r * size + c] = rng.choice([8, 7, 6, 2])
    return b, "".join(str(x) for x in own), last


def ownership_for(rng: random.Random, board: Board) -> str:
    """A rough read: each point leans to the colour with more stones within
    two steps; a tenth of the points get any level."""
    size = board.size
    out = []
    for r in range(size):
        for c in range(size):
            if rng.random() < 0.1:
                out.append(str(rng.randrange(len(OWN_LEVELS))))
                continue
            d = 0
            for dr in range(-2, 3):
                for dc in range(-2, 3):
                    rr, cc = r + dr, c + dc
                    if abs(dr) + abs(dc) <= 2 and 0 <= rr < size and 0 <= cc < size:
                        s = board.grid[rr * size + cc]
                        d += 1 if s == Color.BLACK else -1 if s == Color.WHITE else 0
            lvl = 4 + max(-4, min(4, d * 2))
            out.append(str(lvl))
    return "".join(out)


# --- Engine answers ------------------------------------------------------------------

def standard_candidates(rng, board: Board, color: Color, profile: dict, scenario: str):
    size = board.size
    sign = 1 if color == Color.BLACK else -1
    empties = [i for i, s in enumerate(board.grid) if s == Color.EMPTY]
    occupied = [i for i, s in enumerate(board.grid) if s != Color.EMPTY]
    if scenario == "empty" or not empties:
        return []
    k = rng.randint(1, min(len(empties), rng.choice([5, 10, 15, 25])))
    pts = rng.sample(empties, k)
    if occupied and rng.random() < 0.12:
        pts.insert(rng.randrange(len(pts) + 1), rng.choice(occupied))  # illegal: KataGo's ko/superko gap
    base = rng.uniform(-30, 30)
    spread = rng.choice([0.3, 0.6, 1.0, 2.0, 3.0, 8.0])
    vals = [base]
    for _ in pts[1:]:
        vals.append(vals[-1] - abs(rng.gauss(0, spread)) + rng.gauss(0, spread * 0.3))
    if len(vals) > 1 and rng.random() < 0.08:
        gap = rng.uniform(5, 40)
        vals = [vals[0]] + [v - gap for v in vals[1:]]
    raw = [rng.expovariate(1.0) for _ in pts]
    tot = sum(raw)
    priors = [x / tot * rng.uniform(0.3, 0.8) for x in raw]
    if rng.random() < 0.08:
        priors[0] = rng.uniform(0.5, 0.99)
    top_visits = max(1, int(profile["visits"] * rng.uniform(0.3, 1.2)))
    rows = []
    for j, (i, v, p) in enumerate(zip(pts, vals, priors)):
        visits = top_visits if j == 0 else rng.randint(1, max(1, top_visits))
        rows.append([i // size, i % size, visits, 0.5, _r(sign * v), _r(p, 4)])
    has_pass = scenario == "top-pass" or rng.random() < 0.4
    if has_pass:
        pv = base - rng.uniform(-0.6, 2.0)
        pvis = rng.choice([1, 3, 4, 6, 10, top_visits, max(1, top_visits // 5)])
        row = [-1, -1, pvis, 0.5, _r(sign * pv), _r(rng.uniform(0.0, 0.2), 4)]
        at = 0 if scenario == "top-pass" else rng.randrange(len(rows) + 1)
        rows.insert(at, row)
    return rows


def make_standard_answers(rng, board: Board, color: Color, profile: dict, scenario: str, own: str):
    cands = standard_candidates(rng, board, color, profile, scenario)
    sign = 1 if color == Color.BLACK else -1
    pass_val = rng.uniform(-20, 20)

    def make(kind, req):
        if kind == "analysis":
            return {"cands": cands}
        if kind == "ownership":
            return {"own": own}
        v = pass_val if req["move"] == "pass" else pass_val + rng.uniform(-3.0, 2.0)
        return {"lead": _r(sign * v)}

    return make


def make_human_answers(rng, board: Board, color: Color, own: str):
    size = board.size
    n = size * size
    sign = 1 if color == Color.BLACK else -1
    empties = [i for i, s in enumerate(board.grid) if s == Color.EMPTY]
    occupied = [i for i, s in enumerate(board.grid) if s != Color.EMPTY]
    m = rng.randint(1, min(max(1, len(empties)), rng.choice([2, 6, 12, 20])))
    pts = rng.sample(empties, m) if empties else []
    if occupied and rng.random() < 0.15:
        pts.append(rng.choice(occupied))
    raw = [rng.expovariate(1.0) ** rng.choice([1, 2, 3]) for _ in pts]
    tot = sum(raw) or 1.0
    scale = rng.choice([1.0, 1.0, 0.9, 0.1])  # 0.1: every move under human_cand_min
    probs = [_r(x / tot * scale, 4) for x in raw]
    if probs and rng.random() < 0.1:
        probs[rng.randrange(len(probs))] = 0.03  # human_cand_min exactly
    human = [[i, p] for i, p in zip(pts, probs)]
    main_pass = rng.choice([0.0, 0.01, 0.2, 0.5, 0.51, 0.9]) if rng.random() < 0.25 else _r(rng.uniform(0, 0.1), 3)
    pass_val = rng.uniform(-20, 20)
    regime = rng.choice(["clear", "small", "flat", "mixed"])

    def make(kind, req):
        if kind == "human":
            return {"human": human, "main_pass": main_pass, "own": own, "lead": _r(sign * pass_val)}
        if req["move"] == "pass":
            v = pass_val + (rng.uniform(-0.3, 0.3) if req["visits"] > 4 else 0.0)
        elif regime == "clear":
            v = pass_val + rng.uniform(-12, 8)
        elif regime == "small":
            v = pass_val + rng.uniform(0.0, 2.5)
        elif regime == "flat":
            v = pass_val + rng.uniform(-1.0, 0.8)
        else:
            v = pass_val + rng.uniform(-6, 4)
        return {"lead": _r(sign * v), "winrate": 0.5}

    return make


# --- Cases ---------------------------------------------------------------------------

def standard_cases(rng, loop) -> list[dict]:
    table = yaml.safe_load((ROOT / "data/profiles/b28.yaml").read_text())["profiles"]
    cases: list[dict] = []
    closed = []

    real_close = ms._close_border

    async def spy(*a, **kw):
        pick = await real_close(*a, **kw)
        if pick is not None:
            closed.append(pick)
        return pick

    ms._close_border = spy
    try:
        for size in (9, 13, 19):
            for rank, base in table[f"{size}x{size}"].items():
                for _ in range(STANDARD_PER_RUNG[size]):
                    scenario = rng.choices(
                        ["normal", "top-pass", "split", "empty"], weights=[70, 10, 18, 2])[0]
                    # Off 9x9 the passes go to the endgame boards: on an open 19x19 the
                    # border check counts the board once per open point, which would
                    # make these cases most of the replay's time.
                    if size > 9 and scenario in ("top-pass", "empty"):
                        board, own, last = split_board(rng, size)
                    elif scenario == "split":
                        board, own, last = split_board(rng, size)
                    else:
                        board, last = random_board(rng, size, rng.randint(0, int(size * size * 0.55)))
                        own = ownership_for(rng, board)
                    color = rng.choice([Color.BLACK, Color.WHITE])
                    opp = Color.WHITE if color == Color.BLACK else Color.BLACK
                    # The selector's knobs no b28 rung sets yet, so their code is held equal too.
                    variant = "as-written" if rng.random() < 0.85 else "extra-knobs"
                    profile = dict(base)
                    if variant == "extra-knobs":
                        profile["score_noise"] = rng.choice([0.5, 2.0, 6.0])
                        profile["local_bias"] = rng.choice([profile["local_bias"], 0.5, 0.9])
                        profile["local_bias_from_candidates"] = rng.random() < 0.6
                        profile["read_cooldown"] = rng.choice([1, 2])
                        profile["sample_min_loss"] = rng.choice([0.5, 2.0])
                    case = {
                        "id": f"s{len(cases):05d}",
                        "rung": rank, "file": "data/profiles/b28.yaml", "variant": variant,
                        "profile": jsonable_profile(profile),
                        "size": size, "board": encode(board),
                        "color": "B" if color == Color.BLACK else "W",
                        "stones": sum(1 for s in board.grid if s != Color.EMPTY),
                        "komi": rng.choice([6.5, 7.5, 0.5]),
                        "last_opp": None if (last[opp] is None or rng.random() < 0.2)
                        else [last[opp].row, last[opp].col],
                        "opponent_passed": rng.random() < (0.5 if scenario == "split" else 0.15),
                        "cooldown": rng.choice([0, 0, 0, 1, 2]) if "reading_rate" in profile else 0,
                        "scenario": scenario,
                    }
                    pboard = board_of(case)
                    answers = Answers(make=make_standard_answers(rng, pboard, color, profile, scenario, own))
                    u = Feed(make=lambda: min(round(rng.random(), 6), 0.999999))
                    g = Feed(make=lambda: round(rng.gauss(0.0, 1.0), 6))
                    closed.clear()
                    WORK.take()
                    case["pick"] = run_standard(ms, case, u, g, answers, loop)
                    case["work"] = WORK.take() * size * size
                    case["answers"], case["u"], case["g"] = answers.items, u.values, g.values
                    trace = []
                    if closed and case["pick"] == [closed[-1][1] // size, closed[-1][1] % size]:
                        trace.append("border-closed")
                    first = answers.items[0]["cands"] if answers.items else []
                    legal = [c for c in first if c[0] < 0 or pboard.clone().try_play(
                        color, Point(c[0], c[1]))[0] == "ok"]
                    if not first:
                        trace.append("no-candidates")
                    elif legal and legal[0][0] < 0 and case["stones"] >= profile.get("opening_moves", 20):
                        trace.append("top-pass")
                    case["trace"] = trace
                    cases.append(case)
    finally:
        ms._close_border = real_close
    return cases


def human_cases(rng, loop) -> list[dict]:
    table = yaml.safe_load((ROOT / "data/profiles/b28_human.yaml").read_text())["profiles"]
    cases: list[dict] = []
    for size_key, rungs in table.items():
        size = int(size_key.split("x")[0])
        for rank, written in rungs.items():
            for _ in range(HUMAN_PER_RUNG):
                variant = rng.choices(
                    ["as-written", "tilt-0", "tilt-inf", "tilt-neg-inf", "no-loss-cap"],
                    weights=[40, 15, 15, 15, 15])[0]
                profile = dict(written)
                if variant == "tilt-0":
                    profile["human_tilt"] = 0.0
                elif variant == "tilt-inf":
                    profile["human_tilt"] = math.inf
                elif variant == "tilt-neg-inf":
                    profile["human_tilt"] = -math.inf
                elif variant == "no-loss-cap":
                    profile.pop("human_loss_cap", None)
                if rng.random() < 0.3:
                    board, own, _ = split_board(rng, size)
                    scenario = "split"
                else:
                    board, _ = random_board(rng, size, rng.randint(0, int(size * size * 0.6)))
                    own = ownership_for(rng, board)
                    scenario = "random"
                color = rng.choice([Color.BLACK, Color.WHITE])
                case = {
                    "id": f"h{len(cases):05d}",
                    "rung": rank, "file": "data/profiles/b28_human.yaml", "variant": variant,
                    "profile": jsonable_profile(profile),
                    "size": size, "board": encode(board),
                    "color": "B" if color == Color.BLACK else "W",
                    "moves_played": rng.randint(0, 40),
                    "komi": rng.choice([6.5, 7.5, 0.5]),
                    "opponent_passed": rng.random() < 0.2,
                    "scenario": scenario,
                }
                pboard = board_of(case)
                answers = Answers(make=make_human_answers(rng, pboard, color, own))
                u = Feed(make=lambda: min(round(rng.random(), 6), 0.999999))
                WORK.take()
                handled, pick = run_human(ms, case, u, answers, loop)
                case["work"] = WORK.take() * size * size
                case["handled"], case["pick"] = handled, pick
                case["answers"], case["u"] = answers.items, u.values
                cases.append(case)
    return cases


class Work:
    """Counts the board copies and counts a case's Python run makes: the
    replay's cost, so the default pytest run can take the cheap cases whole."""

    def __init__(self):
        self.n = 0
        self.clone, self.count = Board.clone, Board.score_territory
        work = self

        def clone(b):
            work.n += 1
            return work.clone(b)

        def count(b):
            work.n += b.size
            return work.count(b)

        Board.clone, Board.score_territory = clone, count

    def take(self) -> int:
        n, self.n = self.n, 0
        return n

    def close(self):
        Board.clone, Board.score_territory = self.clone, self.count


def write(name: str, cases: list[dict]) -> None:
    body = json.dumps({
        "about": "Selector parity cases; see data/selector_parity/generate.py.",
        "seed": SEED, "cases": cases,
    }, separators=(",", ":"), allow_nan=False).encode()
    with open(OUT / f"{name}.json.gz", "wb") as f:
        with gzip.GzipFile(filename="", mode="wb", fileobj=f, mtime=0, compresslevel=9) as z:
            z.write(body)


def main() -> None:
    import logging
    logging.disable(logging.CRITICAL)
    loop = asyncio.new_event_loop()
    rng = random.Random(SEED)
    global WORK
    WORK = Work()
    try:
        std = standard_cases(rng, loop)
        hum = human_cases(rng, loop)
    finally:
        WORK.close()
    write("standard", std)
    write("human", hum)
    print(f"standard {len(std)} cases, human {len(hum)} cases")


if __name__ == "__main__":
    main()
