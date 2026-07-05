"""
Python parity for the endgame territory safety net (2026-07-05).
Mirrors moveSelector.territoryNet.test.ts.
"""

import app.ai.move_selector as ms
from app.ai.move_selector import _is_own_territory_fill
from app.game.engine import Board, Color, Point


def _board_with(stones):
    b = Board(9)
    for color, r, c in stones:
        b.grid[r * 9 + c] = color
    return b


def _corner_territory_board():
    """White corner territory at (0,0) plus a Black stone so the open board
    isn't classified as anyone's territory."""
    return _board_with([
        (Color.WHITE, 0, 1), (Color.WHITE, 1, 0), (Color.WHITE, 1, 1),
        (Color.BLACK, 8, 8),
    ])


def _ko_board():
    return _board_with([
        (Color.WHITE, 3, 4), (Color.WHITE, 5, 4), (Color.WHITE, 4, 3),
        (Color.BLACK, 4, 5),
    ])


def test_flags_point_enclosed_by_own_stones():
    assert _is_own_territory_fill(_corner_territory_board(), Color.WHITE, Point(0, 0)) is True


def test_not_flagged_for_opponent():
    assert _is_own_territory_fill(_corner_territory_board(), Color.BLACK, Point(0, 0)) is False


def test_open_board_region_not_flagged():
    assert _is_own_territory_fill(_corner_territory_board(), Color.WHITE, Point(5, 5)) is False


def test_empty_board_not_flagged():
    assert _is_own_territory_fill(Board(9), Color.WHITE, Point(4, 4)) is False


def test_ko_recapture_point_never_flagged():
    assert _is_own_territory_fill(_ko_board(), Color.WHITE, Point(4, 4)) is False


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

    async def analyze(self, *args, **kwargs):
        return FakeAnalysis(list(self._candidates))


PROFILE = {
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
    "reading_rate": 0.0,
    "policy_temp": 1.0,
}


async def _select(engine, board, monkeypatch):
    monkeypatch.setattr(ms, "get_profile", lambda rank, size=19: PROFILE)
    return await ms._select_with_katago(engine, board, Color.WHITE, "15k")


async def test_sampler_never_picks_territory_fill(monkeypatch):
    board = _corner_territory_board()
    engine = FakeEngine([FakeCand(0, 0, 0.9, 5.0), FakeCand(5, 5, 0.05, 4.0)])
    for _ in range(25):
        assert await _select(engine, board, monkeypatch) == Point(5, 5)


async def test_rescues_when_candidates_degenerate_but_board_live(monkeypatch):
    board = _corner_territory_board()  # mostly open — plenty to play
    engine = FakeEngine([FakeCand(0, 0, 0.9, 5.0)])  # only a fill offered
    for _ in range(10):
        move = await _select(engine, board, monkeypatch)
        assert move is not None
        assert move != Point(0, 0)


async def test_passes_when_whole_board_is_own_fills(monkeypatch):
    # White wall on column 4, Black solid on columns 5-8, columns 0-3 all
    # White territory: every legal White move is a self-fill.
    stones = []
    for r in range(9):
        stones.append((Color.WHITE, r, 4))
        for c in range(5, 9):
            stones.append((Color.BLACK, r, c))
    board = _board_with(stones)
    engine = FakeEngine([FakeCand(4, 2, 0.9, 5.0)])
    for _ in range(10):
        assert await _select(engine, board, monkeypatch) is None


async def test_still_plays_ko_recapture_as_only_candidate(monkeypatch):
    board = _ko_board()
    engine = FakeEngine([FakeCand(4, 4, 0.9, 5.0)])
    for _ in range(10):
        assert await _select(engine, board, monkeypatch) == Point(4, 4)
