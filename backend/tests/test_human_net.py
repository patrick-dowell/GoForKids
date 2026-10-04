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


async def test_the_engine_is_started_at_boot_only_when_the_human_model_is_configured(monkeypatch):
    import app.main as main

    started = []

    async def fake_get_engine():
        started.append(1)

    monkeypatch.setattr(main, "get_engine", fake_get_engine)
    monkeypatch.delenv("KATAGO_HUMAN_MODEL", raising=False)
    assert main._warm_engine() is None and started == []

    monkeypatch.setenv("KATAGO_HUMAN_MODEL", "/models/human.bin.gz")
    await main._warm_engine()
    assert started == [1]

    async def broken_get_engine():
        raise RuntimeError("no engine")

    monkeypatch.setattr(main, "get_engine", broken_get_engine)
    await main._warm_engine()  # a failed warm-up is logged, never raised


# --- points off the diagonal, colours, legality, limits (review round) -------

G7, C3 = (2, 6), (6, 2)  # (row, col): transposing either gives the other


async def test_points_keep_their_row_and_column_through_sampling_and_scoring():
    engine = FakeEngine(_policy({G7: 1.0}))
    _, move = await _pick(engine)
    assert (move.row, move.col) == G7

    # scoring names each candidate by its own GTP point and as the mover's stone
    engine = FakeEngine(_policy({G7: 0.6, C3: 0.4}), leads={"G7": 5.0, "C3": -7.0})
    picks = [(await _pick(engine, dict(PROFILE, human_tilt=1.0), LATE))[1] for _ in range(30)]
    assert all((m.row, m.col) == C3 for m in picks)  # Black to move: C3 is the loser
    scored = [c for c in engine.calls if not c.get("include_policy")]
    assert {tuple(c["moves"][-1]) for c in scored} == {("B", "G7"), ("B", "C3")}


async def test_a_point_our_rules_refuse_is_never_played():
    board = Board(SIZE)
    board.try_play(Color.WHITE, Point(*G7))  # occupied: KataGo may not know (ko, superko)
    engine = FakeEngine(_policy({G7: 0.9, C3: 0.1}))
    for _ in range(30):
        _, move = await ms._select_with_human_net(engine, board, Color.BLACK, "18k", PROFILE, EARLY, [], None)
        assert (move.row, move.col) == C3


async def test_candidates_are_the_likeliest_few_at_or_above_the_floor():
    points = {(r, c): 0.05 for r in range(3) for c in range(3)}  # nine at 5%
    points[(8, 8)] = 0.03                                        # at the floor: a candidate
    points[(8, 0)] = 0.029                                       # under it: never scored
    engine = FakeEngine(_policy(points))
    await _pick(engine, PROFILE, LATE)
    scored = [c["moves"][-1][1] for c in engine.calls if not c.get("include_policy")]
    assert len(scored) == 8 and "J1" not in scored and "A1" not in scored
    engine = FakeEngine(_policy({(0, 0): 0.5, (8, 8): 0.03, (8, 0): 0.029}))
    await _pick(engine, PROFILE, LATE)
    scored = {c["moves"][-1][1] for c in engine.calls if not c.get("include_policy")}
    assert scored == {"A9", "J1"}


async def test_the_lean_is_capped_at_a_fifteen_point_loss(monkeypatch):
    seen = {}

    class Capture:
        def choices(self, population, weights):
            seen["weights"] = list(weights)
            return [population[0]]

    monkeypatch.setattr(ms, "random", Capture())
    engine = FakeEngine(_policy({G7: 0.5, C3: 0.5}), leads={"G7": 60.0, "C3": 0.0})
    await _pick(engine, dict(PROFILE, human_tilt=5.0), LATE)
    best, worst = seen["weights"]
    assert abs(worst / best - ms.math.exp(15.0 / 5.0)) < 1e-9


async def test_eval_out_keeps_the_first_root_lead():
    engine = FakeEngine(_policy({G7: 1.0}))
    out = ms.SelectorEval(score_lead_before=-3.0)
    await _pick(engine, eval_out=out)
    assert out.score_lead_before == -3.0


async def test_pass_needs_more_than_half_the_main_policy():
    handled, move = await _pick(FakeEngine(_policy({G7: 1.0}), main=_policy({}, pass_prob=0.5)))
    assert handled and (move.row, move.col) == G7


async def test_a_human_path_over_its_budget_hands_over_to_the_standard_selector(monkeypatch):
    import asyncio

    class Slow(FakeEngine):
        async def analyze(self, *a, **k):
            await asyncio.sleep(1.0)
            return await super().analyze(*a, **k)

    monkeypatch.setattr(ms, "HUMAN_PATH_BUDGET_S", 0.05)
    _, std = await _inner(monkeypatch, Slow(_policy({G7: 1.0})), PROFILE, engine_moves=EARLY)
    assert std.ran == 1


# --- engine start-up with the human model -----------------------------------

import app.katago.engine as eng


class StubEngine:
    """Stands in for KataGoEngine: records each start and how it went."""

    log = []
    start_fails_with_human = False
    human_answers = True

    def __init__(self, config):
        self.config = config
        self.running = False

    async def start(self):
        StubEngine.log.append(("start", bool(self.config.human_model)))
        if self.config.human_model and StubEngine.start_fails_with_human:
            raise RuntimeError("KataGo exited immediately")
        self.running = True

    async def stop(self):
        StubEngine.log.append(("stop", bool(self.config.human_model)))
        self.running = False

    async def analyze(self, *a, **k):
        import asyncio
        await asyncio.sleep(0.01)
        return FakeAnalysis(human_policy=[0.1] * 82 if StubEngine.human_answers else None, policy=[0.1] * 82)

    @property
    def is_running(self):
        return self.running

    @property
    def has_human_model(self):
        return bool(self.config.human_model)


def _engine_env(monkeypatch, tmp_path, with_human=True):
    model = tmp_path / "main.bin.gz"
    model.write_bytes(b"0" * (1024 * 1024 + 1))
    human = tmp_path / "human.bin.gz"
    human.write_bytes(b"0" * (1024 * 1024 + 1))
    cfg = tmp_path / "analysis.cfg"
    cfg.write_text("")
    monkeypatch.setenv("KATAGO_MODEL", str(model))
    monkeypatch.setenv("KATAGO_CONFIG", str(cfg))
    if with_human:
        monkeypatch.setenv("KATAGO_HUMAN_MODEL", str(human))
    else:
        monkeypatch.delenv("KATAGO_HUMAN_MODEL", raising=False)
    monkeypatch.delenv("STRICT_KATAGO", raising=False)
    monkeypatch.setattr(eng, "KataGoEngine", StubEngine)
    monkeypatch.setattr(eng, "_engine", None)
    StubEngine.log = []
    StubEngine.start_fails_with_human = False
    StubEngine.human_answers = True


async def test_a_working_human_model_is_kept(monkeypatch, tmp_path):
    _engine_env(monkeypatch, tmp_path)
    engine = await eng.get_engine()
    assert engine.has_human_model and StubEngine.log == [("start", True)]


async def test_an_engine_that_cannot_start_with_the_human_model_starts_without_it(monkeypatch, tmp_path):
    _engine_env(monkeypatch, tmp_path)
    StubEngine.start_fails_with_human = True
    engine = await eng.get_engine()
    assert engine is not None and engine.is_running and not engine.has_human_model
    assert StubEngine.log == [("start", True), ("stop", True), ("start", False)]


async def test_a_human_model_that_does_not_answer_is_dropped(monkeypatch, tmp_path):
    _engine_env(monkeypatch, tmp_path)
    StubEngine.human_answers = False
    engine = await eng.get_engine()
    assert engine.is_running and not engine.has_human_model
    assert StubEngine.log == [("start", True), ("stop", True), ("start", False)]


async def test_callers_arriving_during_start_up_share_one_engine(monkeypatch, tmp_path):
    import asyncio

    _engine_env(monkeypatch, tmp_path)
    StubEngine.human_answers = False  # the slow path: start, drop the model, start again
    engines = await asyncio.gather(*(eng.get_engine() for _ in range(5)))
    assert all(e is engines[0] for e in engines)
    assert [x for x in StubEngine.log if x[0] == "start"] == [("start", True), ("start", False)]


async def test_without_the_human_model_the_engine_starts_once_and_plainly(monkeypatch, tmp_path):
    _engine_env(monkeypatch, tmp_path, with_human=False)
    engine = await eng.get_engine()
    assert not engine.has_human_model and StubEngine.log == [("start", False)]


async def test_a_dead_engine_fails_its_waiting_queries_at_once():
    import asyncio

    class DeadOut:
        def readline(self):
            return ""  # EOF: the process has exited

    class DeadProc:
        stdout = DeadOut()

    engine = KataGoEngine(KataGoConfig(model="m", config="c"))
    engine.process = DeadProc()
    waiting = asyncio.get_event_loop().create_future()
    engine._pending["q0"] = waiting
    await engine._read_loop()
    assert waiting.done() and isinstance(waiting.exception(), RuntimeError) and not engine._pending
