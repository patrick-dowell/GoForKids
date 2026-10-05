"""
The standard selector's border check (2026-10-04): wherever the standard path
would pass, it first counts the board as the server will and plays the best
move that raises its count by `human_border_gain` points or more, through the
human path's shared check (move_selector._close_border). The ownership is one
extra 1-visit read, made only when the path is about to pass. Positions are
the human path's border tests' (9x9, komi 6.5, the bot White).
"""

import math

import pytest

import app.ai.move_selector as ms
from app.game.engine import Color, Point
from tests.test_human_net_border import (
    DEAD_12K, DEAD_18K, GAME_12K, GAME_15K, GAME_18K, _ownership, _pt, _replay,
)

SIZE = 9

# A standard 9x9 rung with every random branch closed, so each test reaches
# the pass route it names.
PROFILE = {
    "max_point_loss": 10.0, "mistake_freq": 0.0, "policy_weight": 1.0, "randomness": 0.0,
    "random_move_chance": 0.0, "local_bias": 0.0, "first_line_chance": 0.0, "visits": 16,
    "min_candidates": 5, "opening_moves": 0, "pass_threshold": 0.1,
    "clarity_prior": 1.1, "clarity_score_gap": 999.0,
}


class Cand:
    def __init__(self, gtp, prior=0.1, score_lead=0.0, visits=20):
        self.move = (-1, -1) if gtp == "pass" else (_pt(gtp).row, _pt(gtp).col)
        self.prior = prior
        self.score_lead = score_lead
        self.visits = visits
        self.winrate = 0.5


class Analysis:
    def __init__(self, candidates=None, ownership=None, score_lead=0.0):
        self.candidates = candidates or []
        self.ownership = ownership
        self.score_lead = score_lead
        self.winrate = 0.5


class Engine:
    """The path's own search answers `candidates`; the border check's
    ownership read (include_ownership) answers `ownership`; a scoring query
    (Black to move after White's move or pass) answers a Black-perspective
    lead from `leads` by that move, else `default_lead`."""

    def __init__(self, candidates, ownership=None, fail=False, leads=None, default_lead=-26.0):
        self.candidates = candidates
        self.ownership = ownership
        self.fail = fail
        self.leads = leads or {}
        self.default_lead = default_lead
        self.calls = []

    async def analyze(self, board_2d, player, **kwargs):
        self.calls.append(dict(kwargs, player=player))
        if kwargs.get("include_ownership"):
            if self.fail:
                raise RuntimeError("engine down")
            return Analysis(ownership=self.ownership)
        if player == "B":
            return Analysis(score_lead=self.leads.get(kwargs["moves"][-1][1], self.default_lead))
        return Analysis(list(self.candidates))

    def reads(self):
        return [c for c in self.calls if c.get("include_ownership")]

    def scored(self):
        return [c["moves"][-1][1] for c in self.calls if c["player"] == "B"]


def _own12():
    board, _ = _replay(GAME_12K)
    return _ownership(board, DEAD_12K)


async def _select(monkeypatch, engine, sgf=GAME_12K, profile=PROFILE, opponent_passed=False, komi=6.5):
    monkeypatch.setattr(ms, "get_profile", lambda rank, size: profile)
    board, moves = _replay(sgf)
    if opponent_passed:
        moves = moves + [["B", "pass"]]
    return await ms._select_with_katago(
        engine, board, Color.WHITE, "9k", None, opponent_passed, moves, [], None, komi,
    )


TOP_PASS = [Cand("pass", 0.6, -26.0, visits=50), Cand("D4", 0.3, -26.1)]


async def test_top_move_pass_becomes_the_border_move(monkeypatch):
    engine = Engine(TOP_PASS, _own12())
    assert await _select(monkeypatch, engine) == _pt("A8")
    # without the read it passes, as before
    assert await _select(monkeypatch, Engine(TOP_PASS, None)) is None


async def test_the_read_is_one_1_visit_query_at_the_games_komi(monkeypatch):
    engine = Engine(TOP_PASS, _own12())
    await _select(monkeypatch, engine, komi=0.5)
    assert len(engine.reads()) == 1
    read = engine.reads()[0]
    assert read["max_visits"] == 1 and read["komi"] == 0.5
    assert read["moves"][-1] == ["B", "D8"] and read["initial_stones"] == []
    # then the qualifying moves and the pass, scored once each at 4 visits
    assert sorted(engine.scored()) == ["A6", "A7", "A8", "pass"]
    assert {c["max_visits"] for c in engine.calls if c["player"] == "B"} == {ms.BORDER_SCORE_VISITS} == {4}
    assert [c.get("komi") for c in engine.calls] == [0.5] * 6


async def test_a_move_that_does_not_pass_makes_no_read(monkeypatch):
    engine = Engine([Cand("D4", 0.5, -28.0), Cand("pass", 0.1, -26.0, visits=2)], _own12())
    assert await _select(monkeypatch, engine) == _pt("D4")
    assert engine.reads() == []


async def test_no_border_open_still_passes(monkeypatch):
    board, _ = _replay(GAME_15K)
    engine = Engine(TOP_PASS[:1], _ownership(board, []))
    assert await _select(monkeypatch, engine, sgf=GAME_15K) is None
    assert len(engine.reads()) == 1


async def test_a_gain_under_the_knob_still_passes(monkeypatch):
    # F5 makes F6 White's: one point.
    board, _ = _replay(GAME_18K)
    own = _ownership(board, DEAD_18K)
    assert await _select(monkeypatch, Engine(TOP_PASS[:1], own), sgf=GAME_18K) == _pt("F5")
    two = dict(PROFILE, human_border_gain=2.0)
    assert await _select(monkeypatch, Engine(TOP_PASS[:1], own), sgf=GAME_18K, profile=two) is None


async def test_the_knob_at_infinity_switches_it_off_with_no_read(monkeypatch):
    off = dict(PROFILE, human_border_gain=math.inf)
    engine = Engine(TOP_PASS, _own12())
    assert await _select(monkeypatch, engine, profile=off) is None
    assert engine.reads() == []
    # a finite knob is still on: 4.0 reaches A8's four points, 5.0 does not
    assert await _select(monkeypatch, Engine(TOP_PASS, _own12()), profile=dict(PROFILE, human_border_gain=4.0)) == _pt("A8")
    assert await _select(monkeypatch, Engine(TOP_PASS, _own12()), profile=dict(PROFILE, human_border_gain=5.0)) is None


async def test_a_failed_read_leaves_the_pass(monkeypatch):
    engine = Engine(TOP_PASS, _own12(), fail=True)
    assert await _select(monkeypatch, engine) is None


async def test_equal_gains_go_to_the_search_prior(monkeypatch):
    board, _ = _replay(GAME_12K)
    monkeypatch.setattr(ms, "_border_moves", lambda b, c, o, m: [(4, _pt("A8").index(SIZE)), (4, _pt("A6").index(SIZE))])
    cands = [Cand("pass", 0.6, -26.0, visits=50), Cand("A6", 0.2, -26.0), Cand("A8", 0.1, -26.0)]
    assert await _select(monkeypatch, Engine(cands, _own12())) == _pt("A6")
    cands = [Cand("pass", 0.6, -26.0, visits=50), Cand("A6", 0.05, -26.0), Cand("A8", 0.1, -26.0)]
    assert await _select(monkeypatch, Engine(cands, _own12())) == _pt("A8")


# --- every pass route of the standard path goes through the check ----------


async def test_route_no_candidates(monkeypatch):
    assert await _select(monkeypatch, Engine([], _own12())) == _pt("A8")


async def test_route_every_candidate_illegal_and_no_rescue(monkeypatch):
    monkeypatch.setattr(ms, "_pick_legal_non_eye_move", lambda b, c: None)
    engine = Engine([Cand("D8", 0.9, -26.0)], _own12())  # D8 is occupied
    assert await _select(monkeypatch, engine) == _pt("A8")


async def test_route_opening_with_only_a_pass(monkeypatch):
    opening = dict(PROFILE, opening_moves=999)
    assert await _select(monkeypatch, Engine([Cand("pass", 0.9, -26.0)], _own12()), profile=opening) == _pt("A8")


async def test_route_pass_within_the_threshold(monkeypatch):
    engine = Engine([Cand("D4", 0.5, -26.0, visits=40), Cand("pass", 0.3, -26.0, visits=30)], _own12())
    assert await _select(monkeypatch, engine) == _pt("A8")


async def test_route_settle_top_unplayable(monkeypatch):
    # After the opponent's pass the honest top fills White's own territory (B3);
    # it beats the pass by 4 for White (leads are Black's), so the pass check lets it through.
    engine = Engine([Cand("B3", 0.5, -30.0, visits=60), Cand("pass", 0.3, -26.0, visits=30)], _own12())
    assert await _select(monkeypatch, engine, opponent_passed=True) == _pt("A8")
    assert engine.calls[0]["max_visits"] == ms.SETTLE_VISITS


async def test_route_only_eye_fills_left(monkeypatch):
    monkeypatch.setattr(ms, "_pick_legal_non_eye_move", lambda b, c: None)
    real = ms._is_eye_fill
    monkeypatch.setattr(ms, "_is_eye_fill", lambda b, c, p: p == _pt("J1") or real(b, c, p))
    engine = Engine([Cand("J1", 0.5, -26.0)], _own12())
    assert await _select(monkeypatch, engine) == _pt("A8")


async def test_select_ai_move_hands_the_komi_to_the_read(monkeypatch):
    engine = Engine(TOP_PASS, _own12())

    async def fake_get_engine():
        return engine

    monkeypatch.setattr(ms, "get_engine", fake_get_engine)
    monkeypatch.setattr(ms, "get_profile", lambda rank, size: PROFILE)
    board, moves = _replay(GAME_12K)
    move = await ms.select_ai_move(board, Color.WHITE, "9k", engine_moves=moves, engine_setup=[], komi=6.5)
    assert move == _pt("A8")
    assert [c.get("komi") for c in engine.calls] == [6.5] * 6


@pytest.mark.parametrize("rung", ["9k", "6k"])
def test_the_live_standard_rungs_leave_the_knob_at_its_default(rung):
    from app.ai.profile_loader import get_profile
    assert "human_border_gain" not in get_profile(rung, 9)
    assert ms.HUMAN_BORDER_GAIN == 1.0
