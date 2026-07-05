"""
Python parity for the JEA338QQ fixes + score_noise (§3 iter 2, 2026-07-04).
Mirrors moveSelector.eyeFillNoise.test.ts.
"""

import app.ai.move_selector as ms
from app.ai.move_selector import _is_eye_fill, _pick_noisy_best
from app.game.engine import Board, Color, Point


def _board_with(stones):
    b = Board(9)
    for color, r, c in stones:
        b.grid[r * 9 + c] = color
    return b


def test_edge_false_eye_is_playable():
    # JEA338QQ move 36: White orthogonals (7,4),(8,3),(8,5), White diagonal
    # (7,3), BLACK diagonal (7,5). (8,4) is the atari-saving connection.
    board = _board_with([
        (Color.WHITE, 7, 3), (Color.WHITE, 7, 4), (Color.WHITE, 8, 3),
        (Color.WHITE, 8, 5), (Color.BLACK, 7, 5),
    ])
    assert _is_eye_fill(board, Color.WHITE, Point(8, 4)) is False


def test_edge_real_eye_still_flagged():
    board = _board_with([
        (Color.WHITE, 7, 3), (Color.WHITE, 7, 4), (Color.WHITE, 7, 5),
        (Color.WHITE, 8, 3), (Color.WHITE, 8, 5),
    ])
    assert _is_eye_fill(board, Color.WHITE, Point(8, 4)) is True


def test_center_eye_tolerates_one_enemy_diagonal():
    board = _board_with([
        (Color.WHITE, 3, 4), (Color.WHITE, 5, 4), (Color.WHITE, 4, 3),
        (Color.WHITE, 4, 5), (Color.WHITE, 3, 3), (Color.WHITE, 3, 5),
        (Color.WHITE, 5, 3), (Color.BLACK, 5, 5),
    ])
    assert _is_eye_fill(board, Color.WHITE, Point(4, 4)) is True


class _Cand:
    def __init__(self, row, col, score_lead):
        self.move = (row, col)
        self.score_lead = score_lead
        self.visits = 10
        self.prior = 0.3
        self.winrate = 0.5


def test_noisy_best_tiny_sigma_is_argmax():
    pool = [_Cand(0, 0, 10.0), _Cand(8, 8, 0.0)]
    for _ in range(25):
        assert _pick_noisy_best(pool, 0.001).move == (0, 0)


def test_noisy_best_large_sigma_flips_close_calls():
    pool = [_Cand(0, 0, 10.0), _Cand(8, 8, 0.0)]
    picks = {_pick_noisy_best(pool, 50.0).move for _ in range(60)}
    assert (8, 8) in picks
