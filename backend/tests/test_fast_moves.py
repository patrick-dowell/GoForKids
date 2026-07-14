"""
GOFORKIDS_FAST_MOVES (2026-07-14): human /move must return without touching
KataGo, and the score graph is refreshed once per exchange from the bot's own
move-selection analysis instead — the server twin of the on-device S45 fix
(client.ts getAIMoveViaBridge: `score_lead_before` = eval of the analyzed
position, `score_lead` = the chosen candidate's own eval, visits >= 2).

Default-off behavior must stay identical so the change is A/B-able by env
flip alone (Render dashboard). Query counts are the contract: flag OFF =
two engine queries per exchange (one per endpoint), flag ON = one (the
bot's own; a dedicated eval only when the selector never analyzed, e.g.
the 30k heuristic profile).
"""

import pytest

import app.ai.move_selector as ms
import app.game.state as state
import app.game.storage as storage
from app.ai.move_selector import SelectorEval, select_ai_move
from app.game.engine import Board, Color, Point
from app.game.state import GameManager
from app.katago.engine import MoveCandidate, PositionAnalysis
from app.models.schemas import CreateGameRequest, GameMode


@pytest.fixture
def manager(tmp_path, monkeypatch):
    """GameManager on a throwaway SQLite file."""
    monkeypatch.setattr(storage, "DB_PATH", str(tmp_path / "test.db"))
    return GameManager()


class CountingEngine:
    """Fake KataGo engine: canned root eval, counts queries."""

    def __init__(self, score_lead=3.25, candidates=None):
        self.calls = 0
        self._score_lead = score_lead
        self._candidates = candidates or []

    async def analyze(self, *args, **kwargs):
        self.calls += 1
        return PositionAnalysis(
            root_visits=30,
            winrate=0.5,
            score_lead=self._score_lead,
            candidates=list(self._candidates),
        )


def _cand(row, col, score_lead, visits=10, prior=0.3, order=0):
    return MoveCandidate(
        move=(row, col), visits=visits, winrate=0.5,
        score_lead=score_lead, prior=prior, pv=[], order=order,
    )


def _forbid_engine(monkeypatch, why):
    async def forbidden():
        raise AssertionError(why)

    monkeypatch.setattr(state, "get_engine", forbidden)


def _use_engine(monkeypatch, engine):
    async def fake():
        return engine

    monkeypatch.setattr(state, "get_engine", fake)


async def _new_game(manager, game_id):
    await storage.init_db()
    req = CreateGameRequest(mode=GameMode.casual, board_size=9, target_rank="15k")
    await manager.create_game(game_id, req)


def test_flag_parsing(monkeypatch):
    monkeypatch.delenv("GOFORKIDS_FAST_MOVES", raising=False)
    assert state._fast_moves_enabled() is False
    for on in ("1", "true", "yes"):
        monkeypatch.setenv("GOFORKIDS_FAST_MOVES", on)
        assert state._fast_moves_enabled() is True
    monkeypatch.setenv("GOFORKIDS_FAST_MOVES", "0")
    assert state._fast_moves_enabled() is False


# --- human /move -----------------------------------------------------------

async def test_flag_on_human_move_never_touches_engine(manager, monkeypatch):
    monkeypatch.setenv("GOFORKIDS_FAST_MOVES", "1")
    _forbid_engine(monkeypatch, "play_move must not touch KataGo with fast moves on")
    await _new_game(manager, "g1")

    resp = await manager.play_move("g1", 4, 4)
    assert not isinstance(resp, str), resp
    # No eval ran, and none ever had: the estimate is still unset.
    assert resp.score_lead is None


async def test_flag_off_human_move_still_evals(manager, monkeypatch):
    monkeypatch.delenv("GOFORKIDS_FAST_MOVES", raising=False)
    engine = CountingEngine(score_lead=3.25)
    _use_engine(monkeypatch, engine)
    await _new_game(manager, "g2")

    resp = await manager.play_move("g2", 4, 4)
    assert not isinstance(resp, str), resp
    assert engine.calls == 1
    assert resp.score_lead == 3.25


# --- /ai-move --------------------------------------------------------------

async def test_flag_on_ai_move_uses_selector_eval(manager, monkeypatch):
    monkeypatch.setenv("GOFORKIDS_FAST_MOVES", "1")
    _forbid_engine(monkeypatch, "ai-move must reuse the selector's analysis, not re-query")

    async def fake_selector(board, color, rank, eval_out=None, **kwargs):
        eval_out.score_lead_before = 2.5
        eval_out.candidates = [
            _cand(2, 2, score_lead=-1.5, visits=10, order=0),
            _cand(3, 3, score_lead=-2.0, visits=8, order=1),
        ]
        return Point(2, 2)

    monkeypatch.setattr(state, "select_ai_move", fake_selector)
    await _new_game(manager, "g3")
    assert not isinstance(await manager.play_move("g3", 4, 4), str)

    resp = await manager.get_ai_move("g3")
    assert not isinstance(resp, str), resp
    assert (resp.point.row, resp.point.col) == (2, 2)
    # Chosen candidate's own eval lands on the bot's move...
    assert resp.score_lead == -1.5
    # ...and the analyzed-position eval rides along for the player's move.
    assert resp.score_lead_before == 2.5
    assert manager.games["g3"].score_lead == -1.5


async def test_flag_on_low_visit_candidate_falls_back_to_before(manager, monkeypatch):
    """A 1-visit candidate's scoreLead is single-playout noise — carry the
    pre-move eval instead (same visits >= 2 gate as client.ts chosenMoveLead)."""
    monkeypatch.setenv("GOFORKIDS_FAST_MOVES", "1")
    _forbid_engine(monkeypatch, "low-visit fallback must not re-query")

    async def fake_selector(board, color, rank, eval_out=None, **kwargs):
        eval_out.score_lead_before = 2.5
        eval_out.candidates = [_cand(2, 2, score_lead=-9.9, visits=1)]
        return Point(2, 2)

    monkeypatch.setattr(state, "select_ai_move", fake_selector)
    await _new_game(manager, "g4")
    assert not isinstance(await manager.play_move("g4", 4, 4), str)

    resp = await manager.get_ai_move("g4")
    assert not isinstance(resp, str), resp
    assert resp.score_lead == 2.5
    assert resp.score_lead_before == 2.5


async def test_flag_on_chosen_move_outside_candidates_falls_back(manager, monkeypatch):
    """Local-bias / random-injection picks aren't in the candidate list —
    the pre-move eval stands in for them."""
    monkeypatch.setenv("GOFORKIDS_FAST_MOVES", "1")
    _forbid_engine(monkeypatch, "off-candidate fallback must not re-query")

    async def fake_selector(board, color, rank, eval_out=None, **kwargs):
        eval_out.score_lead_before = -0.75
        eval_out.candidates = [_cand(5, 5, score_lead=4.0, visits=12)]
        return Point(2, 2)  # not in the list

    monkeypatch.setattr(state, "select_ai_move", fake_selector)
    await _new_game(manager, "g5")
    assert not isinstance(await manager.play_move("g5", 4, 4), str)

    resp = await manager.get_ai_move("g5")
    assert not isinstance(resp, str), resp
    assert resp.score_lead == -0.75
    assert resp.score_lead_before == -0.75


async def test_flag_on_selectorless_profile_gets_single_eval(manager, monkeypatch):
    """30k-style path: the selector never queries KataGo, so the graph keeps
    its one point per exchange via a single dedicated eval at the bot move."""
    monkeypatch.setenv("GOFORKIDS_FAST_MOVES", "1")
    engine = CountingEngine(score_lead=1.75)
    _use_engine(monkeypatch, engine)

    async def heuristic_selector(board, color, rank, eval_out=None, **kwargs):
        return Point(2, 2)  # eval_out untouched, like _select_beginner_move

    monkeypatch.setattr(state, "select_ai_move", heuristic_selector)
    await _new_game(manager, "g6")
    assert not isinstance(await manager.play_move("g6", 4, 4), str)
    assert engine.calls == 0  # human move: no eval

    resp = await manager.get_ai_move("g6")
    assert not isinstance(resp, str), resp
    assert engine.calls == 1  # ONE query for the whole exchange
    assert resp.score_lead == 1.75
    assert resp.score_lead_before is None


async def test_flag_off_ai_move_old_behavior(manager, monkeypatch):
    """Baseline pin: flag off = two engine queries per exchange, score from
    the dedicated post-move eval, no score_lead_before."""
    monkeypatch.delenv("GOFORKIDS_FAST_MOVES", raising=False)
    engine = CountingEngine(score_lead=4.0)
    _use_engine(monkeypatch, engine)

    async def fake_selector(board, color, rank, eval_out=None, **kwargs):
        assert eval_out is None  # flag off: no capture requested
        return Point(2, 2)

    monkeypatch.setattr(state, "select_ai_move", fake_selector)
    await _new_game(manager, "g7")
    assert not isinstance(await manager.play_move("g7", 4, 4), str)
    assert engine.calls == 1  # human move evaluated, as before

    resp = await manager.get_ai_move("g7")
    assert not isinstance(resp, str), resp
    assert engine.calls == 2  # bot move evaluated separately, as before
    assert resp.score_lead == 4.0
    assert resp.score_lead_before is None


async def test_flag_on_ai_pass_carries_before(manager, monkeypatch):
    """Bot pass: board unchanged, so the analyzed-position eval is also the
    best 'after' value (client.ts: cachedScoreLead ?? passState.score_lead)."""
    monkeypatch.setenv("GOFORKIDS_FAST_MOVES", "1")
    _forbid_engine(monkeypatch, "pass path must not re-query")

    async def passing_selector(board, color, rank, eval_out=None, **kwargs):
        eval_out.score_lead_before = 1.25
        eval_out.candidates = [_cand(-1, -1, score_lead=1.2, visits=20)]
        return None

    monkeypatch.setattr(state, "select_ai_move", passing_selector)
    await _new_game(manager, "g8")
    assert not isinstance(await manager.play_move("g8", 4, 4), str)

    resp = await manager.get_ai_move("g8")
    assert not isinstance(resp, str), resp
    assert resp.point.row == -1
    assert resp.score_lead == 1.25
    assert resp.score_lead_before == 1.25
    assert resp.final_state is None  # single pass doesn't end the game


# --- selector plumbing (real select_ai_move, fake engine) -------------------

SELECTOR_PROFILE = {
    "use_katago": True,
    "visits": 16,
    "opening_moves": 0,       # never "opening" → deterministic path
    "clarity_prior": 0.0,     # every top candidate clears the gate → plays it
    "clarity_score_gap": 999.0,
    "pass_threshold": 0.1,
}


async def test_select_ai_move_populates_eval_out(monkeypatch):
    candidates = [
        _cand(4, 4, score_lead=5.5, visits=12, prior=0.5, order=0),
        _cand(2, 2, score_lead=3.0, visits=6, prior=0.2, order=1),
    ]
    engine = CountingEngine(score_lead=9.9, candidates=candidates)

    async def fake_engine():
        return engine

    monkeypatch.setattr(ms, "get_engine", fake_engine)
    monkeypatch.setattr(ms, "get_profile", lambda rank, size=19: SELECTOR_PROFILE)

    out = SelectorEval()
    move = await select_ai_move(Board(9), Color.BLACK, "15k", eval_out=out)

    assert move == Point(4, 4)
    # Best non-pass candidate's eval, NOT the (wideRootNoise-diluted) root.
    assert out.score_lead_before == 5.5
    assert out.candidates is not None and len(out.candidates) == 2
    assert engine.calls == 1


async def test_select_ai_move_before_skips_pass_candidate(monkeypatch):
    """When pass tops the list, score_lead_before still reads the best real
    move's eval (TS: candidates.find(c => c.move.row >= 0))."""
    candidates = [
        _cand(-1, -1, score_lead=4.0, visits=10, prior=0.6, order=0),  # pass
        _cand(4, 4, score_lead=3.5, visits=8, prior=0.2, order=1),
    ]
    engine = CountingEngine(score_lead=9.9, candidates=candidates)

    async def fake_engine():
        return engine

    monkeypatch.setattr(ms, "get_engine", fake_engine)
    monkeypatch.setattr(ms, "get_profile", lambda rank, size=19: SELECTOR_PROFILE)

    out = SelectorEval()
    move = await select_ai_move(Board(9), Color.BLACK, "15k", eval_out=out)

    assert move is None  # KataGo's top move is pass, past the opening → pass
    assert out.score_lead_before == 3.5
