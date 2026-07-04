"""
The web-path half of the 888P9NXK ko-pass fix (2026-07-03).

Two behaviors pinned here:
1. get_ai_move must never mutate a commit-rejected selector pick into a
   pass while legal moves remain — it plays a legal fallback instead
   (server twin of the client.ts commit-retry).
2. _engine_history builds the (setup, moves) KataGo query parts from the
   real game record — handicap as setup stones, passes included — so the
   Render path's KataGo finally sees ko bans (it got `"moves": []` before).
"""

import pytest

import app.game.state as state
import app.game.storage as storage
from app.game.engine import Color, Point
from app.game.state import GameManager, _engine_history
from app.models.schemas import CreateGameRequest, GameMode


@pytest.fixture
def manager(tmp_path, monkeypatch):
    """GameManager on a throwaway SQLite file, KataGo disabled."""
    monkeypatch.setattr(storage, "DB_PATH", str(tmp_path / "test.db"))

    async def no_engine():
        return None

    monkeypatch.setattr(state, "get_engine", no_engine)
    return GameManager()


async def test_rejected_pick_plays_fallback_not_pass(manager, monkeypatch):
    await storage.init_db()
    req = CreateGameRequest(mode=GameMode.casual, board_size=9, target_rank="15k")
    await manager.create_game("g1", req)

    # Black (the "player") takes (4,4); now it's White's (bot's) turn.
    resp = await manager.play_move("g1", 4, 4)
    assert not isinstance(resp, str), resp

    # Selector proposes the occupied point — commit must reject it, and the
    # old code passed here. The fix plays a legal fallback instead.
    async def bad_selector(*args, **kwargs):
        return Point(4, 4)

    monkeypatch.setattr(state, "select_ai_move", bad_selector)

    resp = await manager.get_ai_move("g1")
    assert not isinstance(resp, str), resp
    assert resp.point.row >= 0, "bot passed instead of playing a legal fallback"
    assert (resp.point.row, resp.point.col) != (4, 4)

    game = manager.games["g1"]
    assert game.consecutive_passes == 0
    assert game.move_history[-1].point is not None


async def test_engine_history_carries_handicap_and_passes(manager):
    await storage.init_db()
    req = CreateGameRequest(
        mode=GameMode.casual, handicap=2, board_size=9, target_rank="15k"
    )
    await manager.create_game("g2", req)

    # White (moves first in handicap games) plays E5, then Black passes.
    resp = await manager.play_move("g2", 4, 4)
    assert not isinstance(resp, str), resp
    await manager.pass_move("g2")

    game = manager.games["g2"]
    setup, moves = _engine_history(game)

    # Handicap stones ride as setup, not moves — matching undo's rebuild
    # and the frontend's buildBridgeMovesFromGame.
    assert len(setup) == 2
    assert all(color == "B" for color, _ in setup)
    assert moves == [["W", "E5"], ["B", "pass"]]


async def test_engine_history_no_handicap(manager):
    await storage.init_db()
    req = CreateGameRequest(mode=GameMode.casual, board_size=9, target_rank="15k")
    await manager.create_game("g3", req)
    resp = await manager.play_move("g3", 2, 6)  # Black G7
    assert not isinstance(resp, str), resp

    setup, moves = _engine_history(manager.games["g3"])
    assert setup == []
    assert moves == [["B", "G7"]]
