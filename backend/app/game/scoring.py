"""
How the server counts a finished game: the stones an ownership read gives to
the other side are taken off as prisoners, then the empty regions are
flood-filled, and a region that touches both colours counts for nobody
(Japanese: territory + prisoners). Shared by the scorer
(`GameManager._score_game_async`) and the human path's border check in
`app.ai.move_selector`, so the bot counts a position the way the game will.
"""

from __future__ import annotations

from app.game.engine import Board, Color, Point

# A stone is dead when the ownership read gives its point to the other side
# past this (ownership is +1 Black, -1 White).
DEAD_STONE_OWNERSHIP = 0.3


def dead_stones_from_ownership(
    board: Board, ownership: list[float], threshold: float = DEAD_STONE_OWNERSHIP
) -> list[Point]:
    """The stones on points the ownership read gives to the other side, row-major."""
    size = board.size
    dead: list[Point] = []
    for row in range(size):
        for col in range(size):
            idx = row * size + col
            stone = board.grid[idx]
            own = ownership[idx]
            if stone == Color.BLACK and own < -threshold:
                dead.append(Point(row, col))
            elif stone == Color.WHITE and own > threshold:
                dead.append(Point(row, col))
    return dead


def remove_dead_and_count(
    board: Board, dead_stones: list[Point]
) -> tuple[Board, set[int], set[int], set[int]]:
    """A copy of the board with the dead stones off and added to the other side's
    prisoners, and its (black, white, neutral) territory by flood fill."""
    scoring_board = board.clone()
    for ds in dead_stones:
        stone_color = scoring_board.get(ds)
        scoring_board.grid[ds.index(scoring_board.size)] = Color.EMPTY
        if stone_color == Color.BLACK:
            scoring_board.captures[Color.WHITE] += 1
        elif stone_color == Color.WHITE:
            scoring_board.captures[Color.BLACK] += 1
    black, white, neutral = scoring_board.score_territory()
    return scoring_board, black, white, neutral
