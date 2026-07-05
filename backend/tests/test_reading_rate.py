"""
Python parity for the §3 out-of-pool mechanism (2026-07-05):
reading_rate / policy_temp sampling + wide_root_noise plumbing.
Mirrors moveSelector.readingRate.test.ts.
"""

import app.ai.move_selector as ms
from app.ai.move_selector import _sample_by_prior
from app.game.engine import Board, Color, Point


class FakeCand:
    def __init__(self, row, col, prior, score_lead):
        self.move = (row, col)
        self.prior = prior
        self.score_lead = score_lead
        self.visits = 10
        self.winrate = 0.5


class FakeAnalysis:
    def __init__(self, candidates):
        self.candidates = candidates


class FakeEngine:
    def __init__(self, candidates):
        self._candidates = candidates
        self.analyze_kwargs = []

    async def analyze(self, *args, **kwargs):
        self.analyze_kwargs.append(kwargs)
        return FakeAnalysis(list(self._candidates))


BASE_PROFILE = {
    "max_point_loss": 28.0,
    "mistake_freq": 0.72,
    "policy_weight": 0.12,
    "randomness": 0.78,
    "random_move_chance": 0.0,
    "local_bias": 0.0,
    "first_line_chance": 0.0,
    "visits": 16,
    "min_candidates": 10,
    "opening_moves": 0,
    "pass_threshold": 0.1,
    "clarity_prior": 1.1,
    "clarity_score_gap": 999.0,
}


async def _select(engine, profile, monkeypatch, **kwargs):
    monkeypatch.setattr(ms, "get_profile", lambda rank, size=19: profile)
    return await ms._select_with_katago(
        engine, Board(9), Color.WHITE, "15k", **kwargs
    )


def test_sample_by_prior_cold_is_prior_argmax():
    pool = [FakeCand(0, 0, 0.2, 10.0), FakeCand(4, 4, 0.7, 2.0)]
    for _ in range(25):
        assert _sample_by_prior(pool, 0.1).move == (4, 4)


def test_sample_by_prior_hot_reaches_tail():
    pool = [FakeCand(4, 4, 0.85, 5.0), FakeCand(0, 8, 0.03, -6.0)]
    picks = {_sample_by_prior(pool, 3.0).move for _ in range(80)}
    assert (0, 8) in picks


async def test_no_reading_plays_shape_move_ignoring_scores(monkeypatch):
    profile = dict(BASE_PROFILE, reading_rate=0.0, policy_temp=0.1)
    engine = FakeEngine([FakeCand(0, 0, 0.2, 10.0), FakeCand(4, 4, 0.7, 2.0)])
    for _ in range(25):
        assert await _select(engine, profile, monkeypatch) == Point(4, 4)


async def test_full_reading_never_samples(monkeypatch):
    # Sampling would overwhelmingly pick the prior-0.9 disaster; the reading
    # path's max_point_loss filter drops it.
    profile = dict(BASE_PROFILE, reading_rate=1.0, policy_temp=3.0)
    engine = FakeEngine([FakeCand(0, 0, 0.05, 10.0), FakeCand(4, 4, 0.9, -50.0)])
    for _ in range(25):
        assert await _select(engine, profile, monkeypatch) == Point(0, 0)


async def test_wide_root_noise_rides_analysis_but_not_settle(monkeypatch):
    profile = dict(BASE_PROFILE, reading_rate=0.5, policy_temp=1.2, wide_root_noise=0.6)
    engine = FakeEngine([FakeCand(4, 4, 0.8, 5.0)])
    await _select(engine, profile, monkeypatch)
    assert engine.analyze_kwargs[-1]["override_settings"] == {"wideRootNoise": 0.6}

    await _select(engine, profile, monkeypatch, opponent_passed=True)
    assert engine.analyze_kwargs[-1]["override_settings"] is None
