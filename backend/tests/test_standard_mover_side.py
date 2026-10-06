"""
The standard selector's score comparisons, from the mover's side. The engine
reports every lead from Black's side (reportAnalysisWinratesAs = BLACK in
configs/analysis_example.cfg; katago/engine.py passes scoreLead through
unchanged), so a gap between two candidates is the mover's only after the
sign (+1 Black, -1 White). Three comparisons from 5ba869c lacked it: the pass
check, the clarity gate's score gap, and the worse-than-pass filter. As
White, the bot passed where playing on gained points.
"""

import random
from pathlib import Path

import pytest

import app.ai.move_selector as ms
from app.ai import profile_loader
from app.game.engine import Board, Color, Point
from app.katago.engine import gtp_to_point, point_to_gtp

SIZE = 9


class Cand:
    def __init__(self, move, prior=0.1, score_lead=0.0, visits=20):
        self.move = move
        self.prior = prior
        self.score_lead = score_lead
        self.visits = visits
        self.winrate = 0.5


class Analysis:
    def __init__(self, candidates):
        self.candidates = candidates
        self.ownership = None  # the border check finds nothing: a pass stays a pass
        self.score_lead = 0.0
        self.winrate = 0.5


class Engine:
    def __init__(self, candidates):
        self.candidates = candidates

    async def analyze(self, *args, **kwargs):
        return Analysis(list(self.candidates))


def _gtp_cand(gtp, visits, prior, lead):
    move = (-1, -1) if gtp == "pass" else gtp_to_point(gtp, SIZE)
    return Cand(move, prior, lead, visits)


# A standard rung with every random branch closed unless a test opens one.
BASE = {
    "max_point_loss": 30.0, "mistake_freq": 0.0, "policy_weight": 1.0, "randomness": 0.0,
    "random_move_chance": 0.0, "local_bias": 0.0, "first_line_chance": 0.0, "visits": 16,
    "min_candidates": 10, "opening_moves": 0, "pass_threshold": 0.1,
    "clarity_prior": 1.1, "clarity_score_gap": 999.0,
}


async def _select(monkeypatch, profile, cands, color, board=None, **kw):
    monkeypatch.setattr(ms, "get_profile", lambda rank, size=19: profile)
    ms._READ_COOLDOWN.clear()
    return await ms._select_with_katago(
        Engine(cands), board or Board(SIZE), color, "9k", **kw
    )


# --- Real cases: two wrongful White settle passes from 36 recorded 9x9
# human-path vs standard games (the standard 9k White, b20, komi 6.5, after
# Black's pass). Engine answers recorded at the selector's own settle query
# (100 visits); history from move 1, Black first.
REAL = {
    "12-point": (
        "F5 E5 F4 E6 D3 C4 F6 E7 F7 D4 C3 F3 E2 E3 F2 G3 E4 G4 F8 G2 B3 B4 D8 E8 C6 "
        "F9 G9 E9 H8 G7 G6 H7 H6 H5 D5",
        [("J6", 35, 0.4382, 29.45), ("A3", 10, 0.0894, 30.42), ("C8", 9, 0.0990, 32.37),
         ("D7", 7, 0.0520, 31.60), ("F1", 7, 0.0464, 29.79), ("D2", 6, 0.0453, 30.72),
         ("A4", 8, 0.0245, 29.86), ("B2", 6, 0.0340, 31.89), ("pass", 4, 0.0575, 41.22),
         ("B6", 2, 0.0182, 30.65), ("J8", 3, 0.0253, 37.27), ("A2", 2, 0.0118, 32.15)],
        "J6",
    ),
    "1-point": (
        "G7 F4 E5 G5 C3 D7 F3 E4 E3 C4 D4 F6 F5 G4 C5 D3 D2 E6 D5 H7 G6 H6 F8 G8 F7 "
        "F9 E9 H8 G9 D8 D6 E7 G3 B8 H4 H5 C7 B7 C8 C9 C6 D9 B6 B9 A7 H3 A8 H9 A6 F9 "
        "H2 G9 J3",
        [("J5", 67, 0.6844, 7.22), ("E8", 11, 0.0985, 8.23), ("J6", 6, 0.0528, 8.19),
         ("pass", 6, 0.0390, 8.23), ("J2", 7, 0.0309, 7.82), ("J4", 2, 0.0113, 8.88)],
        "J5",
    ),
}


def _replay(history: str) -> Board:
    board = Board(SIZE)
    for i, gtp in enumerate(history.split()):
        color = Color.BLACK if i % 2 == 0 else Color.WHITE
        assert board.try_play(color, Point(*gtp_to_point(gtp, SIZE)))[0] == "ok"
    return board


@pytest.mark.parametrize("name", sorted(REAL))
async def test_real_white_settle_pass_plays_on(monkeypatch, name):
    history, cands, top = REAL[name]
    board = _replay(history)
    profile = dict(BASE, pass_threshold=0.1)  # the 9k's: 0.75 on the settle path
    move = await _select(
        monkeypatch, profile, [_gtp_cand(*c) for c in cands], Color.WHITE, board,
        opponent_passed=True,
    )
    assert move is not None, "White passed though its top move gains on the pass"
    assert point_to_gtp(move.row, move.col, SIZE) == top


# --- The pass check (both directions).

async def test_white_passes_when_the_pass_is_better_for_white(monkeypatch):
    # Black-side leads: top 5.0, pass 3.0 -> the pass is 2 points better for White.
    cands = [Cand((4, 4), 0.5, 5.0, 60), Cand((-1, -1), 0.1, 3.0, 30)]
    for _ in range(5):
        assert await _select(monkeypatch, BASE, cands, Color.WHITE, opponent_passed=True) is None


async def test_white_plays_on_when_its_move_beats_the_pass(monkeypatch):
    cands = [Cand((4, 4), 0.5, 3.0, 60), Cand((-1, -1), 0.1, 5.0, 30)]
    for _ in range(5):
        assert await _select(monkeypatch, BASE, cands, Color.WHITE, opponent_passed=True) == Point(4, 4)


# --- The clarity gate's score gap.

async def test_white_clarity_gap_plays_the_forced_move(monkeypatch):
    # White's top is 10 points better for White than the next move: forced.
    # With the gate shut the profile plays a random legal move.
    profile = dict(BASE, clarity_score_gap=5.0, random_move_chance=1.0)
    cands = [Cand((2, 2), 0.3, -10.0, 40), Cand((6, 6), 0.3, 0.0, 30), Cand((2, 6), 0.2, 0.5, 20)]
    random.seed(7)
    picks = [await _select(monkeypatch, profile, cands, Color.WHITE) for _ in range(20)]
    assert picks == [Point(2, 2)] * 20


async def test_white_clarity_gap_does_not_fire_on_a_worse_top(monkeypatch):
    # The engine's first move is 10 points WORSE for White than the second:
    # no forced move, so the gate must not play it every time.
    profile = dict(BASE, clarity_score_gap=5.0, random_move_chance=1.0)
    cands = [Cand((2, 2), 0.3, 10.0, 40), Cand((6, 6), 0.3, 0.0, 30), Cand((2, 6), 0.2, 0.5, 20)]
    random.seed(7)
    picks = [await _select(monkeypatch, profile, cands, Color.WHITE) for _ in range(20)]
    assert picks != [Point(2, 2)] * 20


# --- The worse-than-pass filter.

async def test_white_never_picks_a_move_worse_than_its_pass(monkeypatch):
    # For White: (2,2) gains 4 on the pass, (6,6) gains 2, (2,6) loses 5.
    profile = dict(BASE, mistake_freq=1.0, policy_weight=0.0, randomness=1.0)
    cands = [
        Cand((2, 2), 0.4, -6.0, 40), Cand((-1, -1), 0.1, -2.0, 30),
        Cand((6, 6), 0.2, -4.0, 20), Cand((2, 6), 0.3, 3.0, 20),
    ]
    random.seed(11)
    picks = [await _select(monkeypatch, profile, cands, Color.WHITE) for _ in range(40)]
    assert None not in picks
    assert Point(2, 6) not in picks
    assert {Point(2, 2), Point(6, 6)} <= set(picks)


# --- Property: colour symmetry. A generated position, engine answer and
# profile, decided for Black, then for the colour-swapped mirror (stones
# swapped, leads negated, the bot White), on the same random draws: the
# decision must be the same. Profiles start from a live 9x9 rung (b20 or
# b28) and have the knobs these branches read redrawn. score_noise is left
# out: no live profile sets it, and _pick_noisy_best maximises the
# Black-side lead (a separate, dormant asymmetry).

_PROFILE_DIR = Path(profile_loader.__file__).resolve().parents[3] / "data" / "profiles"
_LIVE = [
    p for f in ("b20.yaml", "b28.yaml")
    for p in profile_loader._load_from_path(_PROFILE_DIR / f)[SIZE].values()
    if p.get("use_katago", True)
]


def _gen_profile(rng):
    p = dict(rng.choice(_LIVE))
    p.pop("score_noise", None)
    p["clarity_score_gap"] = rng.choice([rng.uniform(0.5, 25.0), 999.0])
    p["clarity_prior"] = rng.choice([rng.uniform(0.2, 1.0), 1.1])
    p["pass_threshold"] = rng.choice([0.1, 0.3, rng.uniform(0.0, 2.0)])
    p["opening_moves"] = rng.randint(0, 8)
    p["random_move_chance"] = rng.choice([0.0, rng.uniform(0.0, 0.3)])
    p["local_bias"] = rng.choice([0.0, rng.uniform(0.0, 1.0)])
    p["local_bias_in_opening"] = rng.random() < 0.5
    p["local_bias_from_candidates"] = rng.random() < 0.5
    p["mistake_freq"] = rng.uniform(0.0, 1.0)
    p["max_point_loss"] = rng.uniform(1.0, 30.0)
    p["min_candidates"] = rng.randint(1, 12)
    if rng.random() < 0.5:
        p["reading_rate"] = rng.uniform(0.0, 1.0)
        p["read_cooldown"] = rng.randint(0, 2)
        for k, lo, hi in (("sample_loss_cap", 0.5, 10.0), ("sample_min_loss", 0.0, 3.0)):
            if rng.random() < 0.5:
                p[k] = rng.uniform(lo, hi)
            else:
                p.pop(k, None)
    else:
        p.pop("reading_rate", None)
    return p


def gen_case(rng):
    """(stone sequence, candidates as (move, prior, Black-side lead, visits),
    profile, opponent_passed, last move index or None)."""
    board = Board(SIZE)
    seq = []
    for _ in range(rng.choice([0, 3, 10, 25, 45, 60])):
        color = rng.choice([Color.BLACK, Color.WHITE])
        pt = Point(rng.randrange(SIZE), rng.randrange(SIZE))
        if board.try_play(color, pt)[0] == "ok":
            seq.append((color, pt))
    empty = [Point(r, c) for r in range(SIZE) for c in range(SIZE) if board.get(Point(r, c)) == Color.EMPTY]
    n = rng.randint(1, min(12, len(empty))) if empty else 0
    base = rng.uniform(-40.0, 40.0)
    spread = rng.choice([0.2, 1.0, 4.0, 12.0])
    cands = [
        ((p.row, p.col), rng.random(), base + rng.gauss(0.0, spread), rng.randint(1, 80))
        for p in rng.sample(empty, n)
    ]
    if rng.random() < 0.7 or not cands:
        cands.insert(rng.randint(0, len(cands)),
                     ((-1, -1), rng.random() * 0.2, base + rng.gauss(0.0, spread), rng.randint(0, 40)))
    last = rng.randrange(len(seq)) if seq and rng.random() < 0.7 else None
    return seq, cands, _gen_profile(rng), rng.random() < 0.4, last


async def decide(selector, case, mirror: bool, seed: int, monkeypatch):
    """The standard selector's decision on a generated case, as Black or
    (mirror) as White on the colour-swapped board with leads negated."""
    seq, cands, profile, opp_passed, last = case
    swap = {Color.BLACK: Color.WHITE, Color.WHITE: Color.BLACK}
    board = Board(SIZE)
    for color, pt in seq:
        assert board.try_play(swap[color] if mirror else color, pt)[0] == "ok"
    sign = -1.0 if mirror else 1.0
    engine = Engine([Cand(m, pr, sign * lead, v) for m, pr, lead, v in cands])
    monkeypatch.setattr(selector, "get_profile", lambda rank, size=19: profile)
    selector._READ_COOLDOWN.clear()
    random.seed(seed)
    return await selector._select_with_katago(
        engine, board, Color.WHITE if mirror else Color.BLACK, "9k",
        last_opponent_move=None if last is None else seq[last][1],
        opponent_passed=opp_passed,
    )


async def test_colour_mirror_gives_the_same_decision(monkeypatch):
    rng = random.Random(20261005)
    for i in range(400):
        case = gen_case(rng)
        as_black = await decide(ms, case, False, 1000 + i, monkeypatch)
        as_white = await decide(ms, case, True, 1000 + i, monkeypatch)
        assert as_black == as_white, f"case {i}: Black {as_black}, mirrored White {as_white}"
