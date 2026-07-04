"""
Undo must preserve handicap setup — backend mirror of the frontend engine
fix for TestFlight beta bug #8 (2026-05-14). Before the fix, undo replayed
move_history onto a bare board with current_color reset to BLACK, silently
dropping the handicap stones and desyncing the backend from the frontend
engine (suspected seed of the ko-fight silent-pass bug, repro 888P9NXK).
"""

import pytest

import app.game.state as state
import app.game.storage as storage
from app.game.engine import Color, Point
from app.game.state import GameManager, _handicap_positions
from app.models.schemas import CreateGameRequest, GameMode


@pytest.fixture
def manager(tmp_path, monkeypatch):
    """GameManager backed by a throwaway SQLite file, with KataGo disabled
    so play_move doesn't try to spawn an engine for score estimates."""
    monkeypatch.setattr(storage, "DB_PATH", str(tmp_path / "test.db"))

    async def no_engine():
        return None

    monkeypatch.setattr(state, "get_engine", no_engine)
    return GameManager()


def _stones(board, points):
    return [board.grid[r * board.size + c] for r, c in points]


async def _init(manager):
    await storage.init_db()


async def test_undo_preserves_handicap_stones_and_turn(manager):
    await _init(manager)
    req = CreateGameRequest(
        mode=GameMode.casual, handicap=2, board_size=9, target_rank="15k"
    )
    await manager.create_game("g1", req)
    game = manager.games["g1"]

    handi = _handicap_positions(9, 2)
    assert _stones(game.board, handi) == [Color.BLACK, Color.BLACK]
    assert game.current_color == Color.WHITE  # White moves first with handicap

    # Two moves: White then Black
    resp = await manager.play_move("g1", 4, 4)
    assert not isinstance(resp, str), resp
    resp = await manager.play_move("g1", 4, 2)
    assert not isinstance(resp, str), resp

    resp = await manager.undo("g1")
    assert not isinstance(resp, str), resp
    game = manager.games["g1"]

    # Handicap stones survive the undo replay
    assert _stones(game.board, handi) == [Color.BLACK, Color.BLACK]
    # White's move was replayed, Black's was undone → Black to move
    assert game.current_color == Color.BLACK
    assert game.board.get(Point(4, 4)) == Color.WHITE
    assert game.board.get(Point(4, 2)) == Color.EMPTY
    assert len(game.move_history) == 1


async def test_undo_to_empty_history_restores_handicap_start(manager):
    await _init(manager)
    req = CreateGameRequest(
        mode=GameMode.casual, handicap=3, board_size=9, target_rank="15k"
    )
    await manager.create_game("g2", req)

    resp = await manager.play_move("g2", 4, 4)
    assert not isinstance(resp, str), resp
    resp = await manager.undo("g2")
    assert not isinstance(resp, str), resp
    game = manager.games["g2"]

    handi = _handicap_positions(9, 3)
    assert _stones(game.board, handi) == [Color.BLACK] * 3
    assert game.current_color == Color.WHITE  # back to the handicap start
    assert game.move_history == []


async def test_undo_without_handicap_still_starts_black(manager):
    await _init(manager)
    req = CreateGameRequest(mode=GameMode.casual, board_size=9, target_rank="15k")
    await manager.create_game("g3", req)

    resp = await manager.play_move("g3", 4, 4)  # Black
    assert not isinstance(resp, str), resp
    resp = await manager.play_move("g3", 2, 2)  # White
    assert not isinstance(resp, str), resp

    resp = await manager.undo("g3")
    assert not isinstance(resp, str), resp
    game = manager.games["g3"]

    assert game.current_color == Color.WHITE  # Black's move replayed
    assert game.board.get(Point(4, 4)) == Color.BLACK
    assert game.board.get(Point(2, 2)) == Color.EMPTY
