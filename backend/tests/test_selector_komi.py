"""
The selector asks the engine at the game's komi (2026-10-04). Before, no
query in move_selector passed one, so engine.analyze's default of 7.5 read
every position whatever the game's komi (6.5 even, 0.5 with a handicap).
Every engine call of both paths carries it; None keeps the old default.
"""

import pytest

import app.ai.move_selector as ms
import app.game.state as state
import app.game.storage as storage
from app.game.engine import Board, Color, Point
from app.game.state import GameManager
from app.models.schemas import CreateGameRequest, GameMode
from tests.test_human_net_border import (
    DEAD_12K, GAME_12K, HUMAN_12K, PROFILE_12K, FakeAnalysis, _ownership, _pt, _replay,
)


class RecordingHumanEngine:
    """The 12k's pass position: the candidates gain inside the second look's
    band, the second look says pass, and the border check scores A8 to A6."""

    has_human_model = True
    is_running = True

    def __init__(self, board):
        self.own = _ownership(board, DEAD_12K)
        self.calls = []

    async def analyze(self, *args, **kwargs):
        self.calls.append(kwargs)
        if kwargs.get("include_policy"):
            return FakeAnalysis(1.5, HUMAN_12K, [0.001] * 82, self.own)
        last = kwargs["moves"][-1][1]
        if kwargs["max_visits"] == 4:
            return FakeAnalysis(-27.0 if last == "D4" else -26.0)
        return FakeAnalysis(-26.0)


class Cand:
    def __init__(self, row, col, prior, score_lead, visits=20):
        self.move = (row, col)
        self.prior = prior
        self.score_lead = score_lead
        self.visits = visits
        self.winrate = 0.5


class RecordingStandardEngine:
    """The standard path's single query: its top move fills Black's own eye
    at A1 until the fifth re-pick, so select_ai_move asks several times."""

    def __init__(self):
        self.calls = []

    async def analyze(self, *args, **kwargs):
        self.calls.append(kwargs)
        a = FakeAnalysis()
        a.candidates = [Cand(8, 0, 0.9, 5.0), Cand(2, 6, 0.05, 4.0), Cand(-1, -1, 0.01, 0.0, visits=2)]
        return a


STANDARD = {
    "max_point_loss": 10.0, "mistake_freq": 0.0, "policy_weight": 1.0, "randomness": 0.0,
    "random_move_chance": 0.0, "local_bias": 0.0, "first_line_chance": 0.0, "visits": 8,
    "min_candidates": 5, "opening_moves": 0, "clarity_prior": 0.5,
}


def _eye_board():
    """A1 is Black's eye (B2 A2 B1 Black); some stones elsewhere."""
    b = Board(9)
    for r, c in ((7, 0), (7, 1), (8, 1), (0, 8), (4, 4)):
        b.grid[r * 9 + c] = Color.BLACK
    b.grid[2 * 9 + 2] = Color.WHITE
    return b


def _patch(monkeypatch, engine, profile):
    async def fake_get_engine():
        return engine

    monkeypatch.setattr(ms, "get_engine", fake_get_engine)
    monkeypatch.setattr(ms, "get_profile", lambda rank, size: profile)


@pytest.mark.parametrize("komi", [6.5, 0.5])
async def test_every_human_path_query_carries_the_games_komi(monkeypatch, komi):
    board, moves = _replay(GAME_12K)
    engine = RecordingHumanEngine(board)
    _patch(monkeypatch, engine, PROFILE_12K)
    move = await ms.select_ai_move(board, Color.WHITE, "12k", engine_moves=moves, engine_setup=[], komi=komi)
    assert move == _pt("A8")
    kinds = {("policy" if c.get("include_policy") else c["max_visits"]) for c in engine.calls}
    assert kinds == {"policy", 4, 12}  # the human query, the scoring, the second look
    assert any(c["moves"][-1][1] == "A8" for c in engine.calls if c.get("max_visits") == 4)  # the border check's
    assert [c.get("komi") for c in engine.calls] == [komi] * len(engine.calls)


@pytest.mark.parametrize("opponent_passed", [False, True])
async def test_every_standard_path_query_carries_the_games_komi(monkeypatch, opponent_passed):
    engine = RecordingStandardEngine()
    _patch(monkeypatch, engine, STANDARD)
    await ms.select_ai_move(_eye_board(), Color.BLACK, "9k", opponent_passed=opponent_passed, komi=0.5)
    assert len(engine.calls) >= (1 if opponent_passed else 2)  # in play the eye-fill re-picks query again
    assert [c.get("komi") for c in engine.calls] == [0.5] * len(engine.calls)


async def test_a_human_rung_that_falls_back_asks_the_standard_path_at_the_same_komi(monkeypatch):
    engine = RecordingStandardEngine()
    engine.has_human_model = True  # its answer has no human policy: the standard selector takes over
    _patch(monkeypatch, engine, dict(STANDARD, human_sl_profile="rank_20k"))
    await ms.select_ai_move(_eye_board(), Color.BLACK, "18k", engine_moves=[], komi=6.5)
    assert engine.calls[0].get("include_policy") and not engine.calls[1].get("include_policy")
    assert [c.get("komi") for c in engine.calls] == [6.5] * len(engine.calls)


async def test_without_a_komi_no_query_names_one(monkeypatch):
    board, moves = _replay(GAME_12K)
    human = RecordingHumanEngine(board)
    _patch(monkeypatch, human, PROFILE_12K)
    await ms.select_ai_move(board, Color.WHITE, "12k", engine_moves=moves, engine_setup=[])
    standard = RecordingStandardEngine()
    _patch(monkeypatch, standard, STANDARD)
    await ms.select_ai_move(_eye_board(), Color.BLACK, "9k")
    assert all("komi" not in c for c in human.calls + standard.calls)


@pytest.mark.parametrize("handicap,komi", [(0, None), (2, None), (0, 3.5)])
async def test_the_server_hands_the_selector_the_games_komi(tmp_path, monkeypatch, handicap, komi):
    monkeypatch.setattr(storage, "DB_PATH", str(tmp_path / "test.db"))

    async def no_engine():
        return None

    monkeypatch.setattr(state, "get_engine", no_engine)
    seen = {}

    async def selector(*args, **kwargs):
        seen.update(kwargs)
        return Point(0, 0)

    monkeypatch.setattr(state, "select_ai_move", selector)
    await storage.init_db()
    manager = GameManager()
    req = CreateGameRequest(
        mode=GameMode.casual, board_size=9, target_rank="15k", handicap=handicap, komi=komi,
    )
    await manager.create_game("g1", req)
    game = manager.games["g1"]
    if game.current_color == Color.BLACK:
        await manager.play_move("g1", 4, 4)
    await manager.get_ai_move("g1")
    assert seen["komi"] == game.komi == (komi if komi is not None else (0.5 if handicap else 7.5))
