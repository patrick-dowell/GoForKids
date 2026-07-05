"""
Python parity for the GN5R6K9G no-pass fixes (2026-07-05).
Mirrors moveSelector.settlePass.test.ts.
"""

import app.ai.move_selector as ms
from app.ai.move_selector import _is_opponent_enclosed_fill
from app.game.engine import Board, Color, Point


def _board_with(stones):
    b = Board(9)
    for color, r, c in stones:
        b.grid[r * 9 + c] = color
    return b


def _settled_board():
    """White wall col 4, Black wall col 5; cols 0-3 White territory,
    cols 6-8 Black territory. No dame."""
    stones = []
    for r in range(9):
        stones.append((Color.WHITE, r, 4))
        stones.append((Color.BLACK, r, 5))
    return _board_with(stones)


class FakeCand:
    def __init__(self, row, col, prior, score_lead, visits=12):
        self.move = (row, col)
        self.prior = prior
        self.score_lead = score_lead
        self.visits = visits
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


async def _select(engine, board, monkeypatch, **kwargs):
    monkeypatch.setattr(ms, "get_profile", lambda rank, size=19: PROFILE)
    return await ms._select_with_katago(engine, board, Color.WHITE, "18k", **kwargs)


def test_flags_drop_inside_black_territory():
    assert _is_opponent_enclosed_fill(_settled_board(), Color.WHITE, Point(4, 7)) is True


def test_never_flags_ko_recapture():
    board = _board_with([
        (Color.WHITE, 3, 4), (Color.WHITE, 5, 4), (Color.WHITE, 4, 3),
        (Color.BLACK, 4, 5),
    ])
    assert _is_opponent_enclosed_fill(board, Color.WHITE, Point(4, 4)) is False
    assert _is_opponent_enclosed_fill(board, Color.BLACK, Point(4, 4)) is False


async def test_settle_passes_when_top_is_a_fill(monkeypatch):
    # Territory/enclosure passing is SETTLE-ONLY (opponent_passed). The honest
    # top is an own-territory fill → the bot passes back.
    engine = FakeEngine([
        FakeCand(4, 2, 0.6, 1.0),  # own-territory fill
        FakeCand(4, 7, 0.3, 0.5),  # junk inside Black territory
    ])
    for _ in range(10):
        assert await _select(engine, _settled_board(), monkeypatch, opponent_passed=True) is None


async def test_active_play_does_NOT_pass_on_territory_fills(monkeypatch):
    # DX4QAWTT regression guard: during active play (no opponent_passed) the
    # bot must PLAY, never pass just because candidates sit in a region that
    # borders one color — mid-game those are open areas, not sealed territory.
    engine = FakeEngine([
        FakeCand(4, 2, 0.6, 1.0),
        FakeCand(4, 7, 0.3, 0.5),
    ])
    for _ in range(10):
        move = await _select(engine, _settled_board(), monkeypatch)
        assert move is not None, "bot passed mid-game on a territory-fill candidate"


async def test_settle_passes_under_075_margin(monkeypatch):
    engine = FakeEngine([
        FakeCand(4, 4, 0.5, 5.4, visits=60),
        FakeCand(-1, -1, 0.1, 5.0, visits=30),  # pass candidate
    ])
    board = Board(9)
    for _ in range(10):
        assert await _select(engine, board, monkeypatch, opponent_passed=True) is None


async def test_settle_still_plays_two_point_move(monkeypatch):
    engine = FakeEngine([
        FakeCand(4, 4, 0.5, 7.0, visits=60),
        FakeCand(-1, -1, 0.1, 5.0, visits=30),
    ])
    board = Board(9)
    for _ in range(10):
        assert await _select(engine, board, monkeypatch, opponent_passed=True) == Point(4, 4)


async def test_settle_passes_on_unplayable_honest_top(monkeypatch):
    engine = FakeEngine([
        FakeCand(4, 2, 0.7, 9.0, visits=60),  # own-territory fill "beats pass"
        FakeCand(-1, -1, 0.1, 5.0, visits=30),
    ])
    for _ in range(10):
        assert await _select(engine, _settled_board(), monkeypatch, opponent_passed=True) is None
