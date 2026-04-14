"""
Server-side Go rules engine (mirrors the frontend TypeScript engine).
Authoritative game state lives here.
"""

from __future__ import annotations
from enum import IntEnum
from dataclasses import dataclass, field
from typing import Optional

BOARD_SIZE = 19


class Color(IntEnum):
    EMPTY = 0
    BLACK = 1
    WHITE = 2

    def opposite(self) -> "Color":
        if self == Color.BLACK:
            return Color.WHITE
        if self == Color.WHITE:
            return Color.BLACK
        return Color.EMPTY


@dataclass(frozen=True)
class Point:
    row: int
    col: int

    def index(self) -> int:
        return self.row * BOARD_SIZE + self.col

    def neighbors(self) -> list["Point"]:
        result = []
        if self.row > 0:
            result.append(Point(self.row - 1, self.col))
        if self.row < BOARD_SIZE - 1:
            result.append(Point(self.row + 1, self.col))
        if self.col > 0:
            result.append(Point(self.row, self.col - 1))
        if self.col < BOARD_SIZE - 1:
            result.append(Point(self.row, self.col + 1))
        return result

    def is_valid(self) -> bool:
        return 0 <= self.row < BOARD_SIZE and 0 <= self.col < BOARD_SIZE


@dataclass
class MoveRecord:
    color: Color
    point: Optional[Point]  # None = pass
    captures: list[Point]
    move_number: int


class Board:
    def __init__(self):
        self.grid: list[int] = [Color.EMPTY] * (BOARD_SIZE * BOARD_SIZE)
        self.captures = {Color.BLACK: 0, Color.WHITE: 0}
        self.ko_point: Optional[Point] = None
        self._position_history: set[str] = set()
        self._position_history.add(self._hash())

    def clone(self) -> "Board":
        b = Board()
        b.grid = self.grid[:]
        b.captures = dict(self.captures)
        b.ko_point = self.ko_point
        b._position_history = set(self._position_history)
        return b

    def get(self, p: Point) -> int:
        return self.grid[p.index()]

    def _set(self, p: Point, c: int):
        self.grid[p.index()] = c

    def _hash(self) -> str:
        return "".join(str(c) for c in self.grid)

    def try_play(self, color: Color, point: Point) -> tuple[str, list[Point]]:
        """Returns (result, captures). Result is 'ok', 'occupied', 'suicide', or 'ko'."""
        if not point.is_valid():
            return ("occupied", [])

        if self.get(point) != Color.EMPTY:
            return ("occupied", [])

        backup = self.clone()
        self._set(point, color)

        opponent = color.opposite()
        captured: list[Point] = []
        for nb in point.neighbors():
            if self.get(nb) == opponent:
                group = self._get_group(nb)
                if self._count_liberties(group) == 0:
                    captured.extend(group)

        for cp in captured:
            self._set(cp, Color.EMPTY)

        own_group = self._get_group(point)
        if self._count_liberties(own_group) == 0:
            self._restore(backup)
            return ("suicide", [])

        new_hash = self._hash()
        if new_hash in self._position_history:
            self._restore(backup)
            return ("ko", [])

        self.captures[color] += len(captured)
        self._position_history.add(new_hash)

        if (
            len(captured) == 1
            and len(own_group) == 1
            and self._count_liberties(own_group) == 1
        ):
            self.ko_point = captured[0]
        else:
            self.ko_point = None

        return ("ok", captured)

    def _restore(self, backup: "Board"):
        self.grid = backup.grid
        self.captures = backup.captures
        self.ko_point = backup.ko_point
        self._position_history = backup._position_history

    def _get_group(self, p: Point) -> list[Point]:
        color = self.get(p)
        if color == Color.EMPTY:
            return []
        visited: set[int] = set()
        group: list[Point] = []
        stack = [p]
        while stack:
            current = stack.pop()
            idx = current.index()
            if idx in visited:
                continue
            if self.get(current) != color:
                continue
            visited.add(idx)
            group.append(current)
            for nb in current.neighbors():
                if nb.index() not in visited:
                    stack.append(nb)
        return group

    def _count_liberties(self, group: list[Point]) -> int:
        liberty_set: set[int] = set()
        for stone in group:
            for nb in stone.neighbors():
                if self.get(nb) == Color.EMPTY:
                    liberty_set.add(nb.index())
        return len(liberty_set)

    def score_territory(self) -> tuple[set[int], set[int], set[int]]:
        """Returns (black_territory, white_territory, neutral) as sets of indices."""
        visited: set[int] = set()
        black_territory: set[int] = set()
        white_territory: set[int] = set()
        neutral: set[int] = set()

        for row in range(BOARD_SIZE):
            for col in range(BOARD_SIZE):
                idx = row * BOARD_SIZE + col
                if idx in visited:
                    continue
                if self.grid[idx] != Color.EMPTY:
                    continue  # skip stones, don't mark visited

                region: list[int] = []
                stack = [Point(row, col)]
                touches_black = False
                touches_white = False

                while stack:
                    current = stack.pop()
                    ci = current.index()
                    c = self.get(current)
                    if c == Color.BLACK:
                        touches_black = True
                        continue
                    if c == Color.WHITE:
                        touches_white = True
                        continue
                    if ci in visited:
                        continue
                    visited.add(ci)
                    region.append(ci)
                    for nb in current.neighbors():
                        if nb.index() not in visited:
                            stack.append(nb)

                if touches_black and not touches_white:
                    target = black_territory
                elif touches_white and not touches_black:
                    target = white_territory
                else:
                    target = neutral

                for ri in region:
                    target.add(ri)

        return black_territory, white_territory, neutral

    def to_2d(self) -> list[list[int]]:
        """Return board as 19x19 2D list for API responses."""
        return [
            self.grid[row * BOARD_SIZE : (row + 1) * BOARD_SIZE]
            for row in range(BOARD_SIZE)
        ]

    def count_stones(self) -> tuple[int, int]:
        black = sum(1 for c in self.grid if c == Color.BLACK)
        white = sum(1 for c in self.grid if c == Color.WHITE)
        return black, white
