"""
Python parity for sampler v2 (lapse + loss cap), round 2, 2026-07-05.
Mirrors moveSelector.samplerV2.test.ts.
"""

from app.ai.move_selector import _sample_by_prior


class FakeCand:
    def __init__(self, row, col, prior, score_lead):
        self.move = (row, col)
        self.prior = prior
        self.score_lead = score_lead
        self.visits = 10
        self.winrate = 0.5


VITAL = FakeCand(4, 4, 0.98, 5.0)
SIDE_A = FakeCand(2, 2, 0.001, 4.0)
SIDE_B = FakeCand(6, 6, 0.001, 3.5)
POOL = [VITAL, SIDE_A, SIDE_B]


def _count_vital(lapse, runs=40):
    return sum(1 for _ in range(runs) if _sample_by_prior(POOL, 1.0, lapse) is VITAL)


def test_lapse_zero_vital_dominates():
    assert _count_vital(0.0) >= 34


def test_lapse_misses_vital_regularly():
    assert _count_vital(0.6) <= 30


def test_lapse_one_is_uniform():
    picks = {id(_sample_by_prior(POOL, 1.0, 1.0)) for _ in range(80)}
    assert len(picks) == 3  # every candidate reachable despite the 0.98 prior
