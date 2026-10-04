"""
The human SL path of the move selector (profiles with `human_sl_profile`):
moves sampled from the human net's policy, a lean toward the weaker of its
candidates once the opening is over, pass left to the main net, and the
standard selector whenever the human path cannot answer.
"""

import app.ai.move_selector as ms
from app.ai import profile_loader
from app.game.engine import Board, Color, Point
from app.katago.engine import KataGoConfig, KataGoEngine

SIZE = 9
N = SIZE * SIZE


def _policy(points: dict, pass_prob: float = 0.0, default: float = 0.0) -> list:
    """A policy list (row-major, pass last) with the given (row, col) -> p."""
    pol = [default] * (N + 1)
    for (row, col), p in points.items():
        pol[row * SIZE + col] = p
    pol[N] = pass_prob
    return pol


class FakeAnalysis:
    def __init__(self, score_lead=0.0, human_policy=None, policy=None):
        self.score_lead = score_lead
        self.winrate = 0.5
        self.candidates = []
        self.human_policy = human_policy
        self.policy = policy


class FakeEngine:
    """Answers the human-policy query, then one score per candidate move."""

    has_human_model = True

    def __init__(self, human, main=None, leads=None, fail=False):
        self.human = human
        self.main = main if main is not None else _policy({})
        self.leads = leads or {}  # gtp of the candidate -> Black-perspective lead after it
        self.fail = fail
        self.calls = []

    async def analyze(self, *args, **kwargs):
        self.calls.append(kwargs)
        if self.fail:
            raise RuntimeError("engine down")
        if kwargs.get("include_policy"):
            return FakeAnalysis(score_lead=1.5, human_policy=self.human, policy=self.main)
        last = kwargs["moves"][-1][1]
        return FakeAnalysis(score_lead=self.leads.get(last, 0.0))


PROFILE = {
    "human_sl_profile": "rank_20k",
    "human_tilt": 8.0,
    "human_tilt_from": 12,
    "human_cand_min": 0.03,
    "human_cand_max": 8,
    "human_score_visits": 4,
}

EARLY = [["B", "E5"], ["W", "C3"]]
LATE = [["B" if i % 2 == 0 else "W", "pass"] for i in range(12)]


async def _pick(engine, profile=PROFILE, moves=EARLY, color=Color.BLACK, eval_out=None):
    return await ms._select_with_human_net(
        engine, Board(SIZE), color, "18k", profile, moves, [], eval_out
    )


async def test_early_moves_are_sampled_from_the_human_policy():
    engine = FakeEngine(_policy({(2, 2): 0.7, (6, 6): 0.3}))
    seen = set()
    for _ in range(60):
        handled, move = await _pick(engine)
        assert handled
        seen.add((move.row, move.col))
    assert seen == {(2, 2), (6, 6)}
    # one query a move, carrying the profile, and no candidate scoring yet
    assert all(c.get("include_policy") for c in engine.calls)
    assert engine.calls[0]["override_settings"] == {"humanSLProfile": "rank_20k"}
    assert engine.calls[0]["max_visits"] == 1


async def test_illegal_points_in_the_policy_are_never_played():
    engine = FakeEngine(_policy({(2, 2): 0.9, (6, 6): 0.1}, default=-1.0))
    for _ in range(40):
        _, move = await _pick(engine)
        assert (move.row, move.col) in {(2, 2), (6, 6)}


async def test_tilt_leans_toward_the_candidate_that_loses_more():
    # C7 is the human net's first choice and the better move; G3 loses 12.
    human = _policy({(2, 2): 0.6, (6, 6): 0.4})
    engine = FakeEngine(human, leads={"C7": 5.0, "G3": -7.0})
    strong_tilt = dict(PROFILE, human_tilt=1.0)
    picks = [(await _pick(engine, strong_tilt, LATE))[1] for _ in range(40)]
    assert all((m.row, m.col) == (6, 6) for m in picks)
    # each candidate was scored on the position after it, at the profile's visits
    scored = [c for c in engine.calls if not c.get("include_policy")]
    assert {c["moves"][-1][1] for c in scored} == {"C7", "G3"}
    assert all(c["max_visits"] == 4 and len(c["moves"]) == len(LATE) + 1 for c in scored)


async def test_tilt_reads_the_lead_from_whites_side_for_white():
    # For White a Black-perspective lead of +5 after the move is the loss.
    human = _policy({(2, 2): 0.6, (6, 6): 0.4})
    engine = FakeEngine(human, leads={"C7": 5.0, "G3": -7.0})
    strong_tilt = dict(PROFILE, human_tilt=1.0)
    late_white = LATE + [["B", "pass"]]
    picks = [(await _pick(engine, strong_tilt, late_white, Color.WHITE))[1] for _ in range(40)]
    assert all((m.row, m.col) == (2, 2) for m in picks)


async def test_no_tilt_before_the_opening_is_over_or_without_the_knob():
    human = _policy({(2, 2): 0.6, (6, 6): 0.4})
    engine = FakeEngine(human, leads={"C7": 5.0, "G3": -7.0})
    await _pick(engine, dict(PROFILE, human_tilt=1.0), EARLY)
    await _pick(engine, dict(PROFILE, human_tilt=0.0), LATE)
    assert all(c.get("include_policy") for c in engine.calls)


async def test_a_single_candidate_is_not_scored():
    engine = FakeEngine(_policy({(2, 2): 0.98, (6, 6): 0.02}))
    await _pick(engine, PROFILE, LATE)
    assert all(c.get("include_policy") for c in engine.calls)


async def test_pass_is_the_main_nets_call():
    human = _policy({(2, 2): 1.0}, pass_prob=0.0)
    handled, move = await _pick(FakeEngine(human, main=_policy({}, pass_prob=0.9)))
    assert handled and move is None
    # the human net wanting to pass is not enough
    handled, move = await _pick(FakeEngine(_policy({(2, 2): 0.2}, pass_prob=0.8), main=_policy({}, pass_prob=0.1)))
    assert handled and (move.row, move.col) == (2, 2)


async def test_no_human_policy_or_a_failed_query_hands_over_to_the_standard_selector():
    handled, move = await _pick(FakeEngine(None))
    assert (handled, move) == (False, None)
    handled, move = await _pick(FakeEngine(_policy({(2, 2): 1.0}), fail=True))
    assert (handled, move) == (False, None)


async def test_eval_out_carries_the_root_lead_and_the_scored_candidates():
    human = _policy({(2, 2): 0.6, (6, 6): 0.4})
    engine = FakeEngine(human, leads={"C7": 5.0, "G3": -7.0})
    out = ms.SelectorEval()
    await _pick(engine, PROFILE, LATE, eval_out=out)
    assert out.score_lead_before == 1.5
    assert {(c.move, c.score_lead, c.visits) for c in out.candidates} == {((2, 2), 5.0, 4), ((6, 6), -7.0, 4)}


class _Standard:
    """Stands in for _select_with_katago; records that it ran."""

    def __init__(self):
        self.ran = 0

    async def __call__(self, *a, **k):
        self.ran += 1
        return Point(0, 0)


async def _inner(monkeypatch, engine, profile, **kwargs):
    std = _Standard()

    async def fake_get_engine():
        return engine

    monkeypatch.setattr(ms, "get_profile", lambda rank, size=19: profile)
    monkeypatch.setattr(ms, "get_engine", fake_get_engine)
    monkeypatch.setattr(ms, "_select_with_katago", std)
    move = await ms._select_ai_move_inner(Board(SIZE), Color.BLACK, "18k", **kwargs)
    return move, std


async def test_the_human_path_runs_only_with_the_knob_the_model_and_the_history(monkeypatch):
    human = _policy({(2, 2): 1.0})
    move, std = await _inner(monkeypatch, FakeEngine(human), PROFILE, engine_moves=EARLY, engine_setup=[])
    assert (move.row, move.col) == (2, 2) and std.ran == 0

    # the opponent passed: the settle path stays with the standard selector
    _, std = await _inner(monkeypatch, FakeEngine(human), PROFILE, engine_moves=EARLY, opponent_passed=True)
    assert std.ran == 1
    # no move history
    _, std = await _inner(monkeypatch, FakeEngine(human), PROFILE)
    assert std.ran == 1
    # a profile without the knob
    _, std = await _inner(monkeypatch, FakeEngine(human), {}, engine_moves=EARLY)
    assert std.ran == 1
    # the model is not loaded
    engine = FakeEngine(human)
    engine.has_human_model = False
    _, std = await _inner(monkeypatch, engine, PROFILE, engine_moves=EARLY)
    assert std.ran == 1
    # the human path could not answer
    _, std = await _inner(monkeypatch, FakeEngine(None), PROFILE, engine_moves=EARLY)
    assert std.ran == 1


def test_engine_adds_the_human_model_to_its_command_only_when_configured():
    assert KataGoEngine(KataGoConfig(model="m", config="c")).has_human_model is False
    assert KataGoEngine(KataGoConfig(model="m", config="c", human_model="h")).has_human_model is True


def test_profile_loader_accepts_the_human_knobs_and_types_them():
    base = {k: 1.0 for k in profile_loader.REQUIRED_KEYS}
    profile_loader._validate_profile(9, "18k", dict(base, **PROFILE))
    try:
        profile_loader._validate_profile(9, "18k", dict(base, human_sl_profile=20))
    except ValueError as e:
        assert "human_sl_profile" in str(e)
    else:
        raise AssertionError("a non-string human_sl_profile must be refused")
