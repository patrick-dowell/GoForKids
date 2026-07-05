"""
Python parity for the §3 9×9 retune (2026-07-04): the
`local_bias_from_candidates` myopic mode must behave exactly like the TS
selector's (moveSelector.myopicLocal.test.ts) — strongest KataGo candidate
near the anchor, fall-through when nothing is local, legacy random-nearby
untouched when the knob is absent.
"""

import app.ai.move_selector as ms
from app.game.engine import Board, Color, Point


class FakeCand:
    def __init__(self, row, col, visits, prior, score_lead):
        self.move = (row, col)
        self.visits = visits
        self.prior = prior
        self.winrate = 0.5
        self.score_lead = score_lead


class FakeAnalysis:
    def __init__(self, candidates):
        self.candidates = candidates


class FakeEngine:
    def __init__(self, candidates):
        self._candidates = candidates

    async def analyze(self, *args, **kwargs):
        # Fresh list per call — _select_with_katago filters it in place.
        return FakeAnalysis(list(self._candidates))


# KataGo path, no opening phase, dice branches pinned off unless a test
# turns them on. Clarity gates disabled the way 30k disables them.
BASE_PROFILE = {
    "max_point_loss": 28.0,
    "mistake_freq": 0.72,
    "policy_weight": 0.12,
    "randomness": 0.78,
    "random_move_chance": 0.0,
    "local_bias": 1.0,
    "first_line_chance": 0.0,
    "visits": 16,
    "min_candidates": 10,
    "opening_moves": 0,
    "pass_threshold": 0.1,
    "clarity_prior": 1.1,
    "clarity_score_gap": 999.0,
}

ANCHOR = Point(4, 4)


def _patch_profile(monkeypatch, profile):
    monkeypatch.setattr(ms, "get_profile", lambda rank, size=19: profile)


async def _select(engine, profile, monkeypatch):
    _patch_profile(monkeypatch, profile)
    return await ms._select_with_katago(
        engine, Board(9), Color.WHITE, "15k", last_opponent_move=ANCHOR
    )


async def test_myopic_plays_strongest_local_candidate(monkeypatch):
    profile = dict(BASE_PROFILE, local_bias_from_candidates=True)
    engine = FakeEngine([
        FakeCand(0, 0, 16, 0.4, 5.0),  # global best, far from the anchor
        FakeCand(4, 5, 12, 0.3, 3.0),  # weaker but adjacent to the anchor
        FakeCand(8, 8, 8, 0.2, 2.0),
    ])
    for _ in range(25):
        move = await _select(engine, profile, monkeypatch)
        assert move == Point(4, 5)


async def test_myopic_falls_through_when_nothing_local(monkeypatch):
    profile = dict(BASE_PROFILE, local_bias_from_candidates=True)
    engine = FakeEngine([
        FakeCand(0, 0, 16, 0.4, 5.0),
        FakeCand(8, 8, 12, 0.3, 4.0),
    ])
    for _ in range(25):
        move = await _select(engine, profile, monkeypatch)
        # Must come from the candidate pool — never an invented nearby point.
        assert move in (Point(0, 0), Point(8, 8))


async def test_legacy_local_bias_unchanged_without_knob(monkeypatch):
    engine = FakeEngine([FakeCand(0, 0, 16, 0.4, 5.0)])
    for _ in range(25):
        move = await _select(engine, dict(BASE_PROFILE), monkeypatch)
        assert move is not None
        assert max(abs(move.row - ANCHOR.row), abs(move.col - ANCHOR.col)) <= 2


async def test_explicit_clarity_prior_gates_only_obvious_moves(monkeypatch):
    profile = dict(BASE_PROFILE, local_bias_from_candidates=True, clarity_prior=0.87)
    obvious = FakeEngine([
        FakeCand(0, 0, 16, 0.95, 5.0),  # forced — policy near-certain
        FakeCand(4, 5, 12, 0.02, 3.0),
    ])
    merely_good = FakeEngine([
        FakeCand(0, 0, 16, 0.7, 5.0),  # would clear the old 0.5 default
        FakeCand(4, 5, 12, 0.2, 3.0),
    ])
    for _ in range(25):
        assert await _select(obvious, profile, monkeypatch) == Point(0, 0)
        assert await _select(merely_good, profile, monkeypatch) == Point(4, 5)
