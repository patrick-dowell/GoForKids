"""
The human SL path's lean at a negative or infinite `human_tilt`: past
`human_tilt_from` the candidates are scored as for a positive tilt (pass check,
loss cap, second look), and a negative tilt leans toward the candidates that
lose less. A tilt of 0, or none, keeps the unscored path; the 18k's positive
lean is unchanged.
"""

import math
from pathlib import Path

import app.ai.move_selector as ms
from app.ai import profile_loader
from app.game.engine import Board, Color, Point
from tests.test_human_net import C3, EARLY, G7, LATE, PROFILE, SIZE, FakeEngine, _pick, _policy

C7, G3, E5 = (2, 2), (6, 6), (4, 4)


class _Capture:
    """Stands in for the `random` module: records the weights, picks the first."""

    def __init__(self):
        self.weights = None

    def choices(self, population, weights):
        self.weights = list(weights)
        return [population[0]]


def _scored(engine):
    return {c["moves"][-1][1] for c in engine.calls if not c.get("include_policy")}


def _without_tilt():
    return {k: v for k, v in PROFILE.items() if k != "human_tilt"}


# --- negative tilt: the lean runs toward the better candidates ----------------


async def test_negative_tilt_scores_past_tilt_from_and_picks_the_better_move():
    # G3 is the human net's first choice and loses 12 against C7.
    engine = FakeEngine(_policy({C7: 0.4, G3: 0.6}), leads={"C7": 5.0, "G3": -7.0})
    picks = [(await _pick(engine, dict(PROFILE, human_tilt=-0.25), LATE))[1] for _ in range(40)]
    assert all((m.row, m.col) == C7 for m in picks)
    assert _scored(engine) == {"C7", "G3", "pass"}


async def test_negative_tilt_gives_the_better_candidate_more_than_its_probability(monkeypatch):
    cap = _Capture()
    monkeypatch.setattr(ms, "random", cap)
    # G7 (p 0.7) loses 6 against C3 (p 0.3)
    engine = FakeEngine(_policy({G7: 0.7, C3: 0.3}), leads={"G7": 4.0, "C3": 10.0})
    await _pick(engine, dict(PROFILE, human_tilt=-4.0), LATE)
    worse, better = cap.weights
    assert worse == 0.7 * math.exp(6.0 / -4.0) and better == 0.3
    assert better / (better + worse) > 0.3


async def test_negative_tilt_weights_fall_with_the_loss_past_fifteen_points(monkeypatch):
    cap = _Capture()
    monkeypatch.setattr(ms, "random", cap)
    # equal probabilities; losses 0, 5, 14, 20, 40 in the candidates' order
    human = _policy({C7: 0.2, G7: 0.2, E5: 0.2, C3: 0.2, G3: 0.2})
    leads = {"C7": 40.0, "G7": 35.0, "E5": 26.0, "C3": 20.0, "G3": 0.0, "pass": 0.0}
    await _pick(FakeEngine(human, leads=leads), dict(PROFILE, human_tilt=-8.0), LATE)
    w = cap.weights
    assert len(w) == 5 and all(a > b for a, b in zip(w, w[1:]))
    assert w[4] == 0.2 * math.exp(40.0 / -8.0)  # no 15-point cap on this side


async def test_negative_tilt_extreme_losses_give_finite_weights(monkeypatch):
    cap = _Capture()
    monkeypatch.setattr(ms, "random", cap)
    human = _policy({C7: 0.5, G7: 0.3, C3: 0.2})
    # an infinite loss (the leads' difference overflows) and a huge one, at a tiny and a moderate tilt
    leads = {"C7": 1e308, "G7": -1e308, "C3": -1e300, "pass": -1e308}
    for tilt in (-2.0, -1e-300):
        await _pick(FakeEngine(human, leads=leads), dict(PROFILE, human_tilt=tilt), LATE)
        assert cap.weights == [0.5, 0.0, 0.0]
    monkeypatch.undo()
    for _ in range(10):
        _, move = await _pick(FakeEngine(human, leads=leads), dict(PROFILE, human_tilt=-1e-300), LATE)
        assert (move.row, move.col) == C7


async def test_negative_tilt_keeps_the_loss_cap_the_pass_check_and_the_self_atari_filter(monkeypatch):
    cap = _Capture()
    monkeypatch.setattr(ms, "random", cap)
    capped = dict(PROFILE, human_tilt=-4.0, human_loss_cap=10.0)
    # E5 loses 12: over the cap, dropped before the lean
    engine = FakeEngine(_policy({C7: 0.4, G7: 0.35, E5: 0.25}), leads={"C7": 20.0, "G7": 15.0, "E5": 8.0})
    await _pick(engine, capped, LATE)
    assert cap.weights == [0.4, 0.35 * math.exp(5.0 / -4.0)]
    monkeypatch.undo()
    # nothing gains over passing: a pass
    engine = FakeEngine(_policy({C7: 0.6, G7: 0.4}), leads={"C7": 20.0, "G7": 19.5, "pass": 20.0})
    assert await _pick(engine, capped, LATE) == (True, None)
    # a self-atari is never a candidate
    board = Board(SIZE)
    board.try_play(Color.WHITE, Point(0, 1))
    engine = FakeEngine(_policy({(0, 0): 0.9, C3: 0.1}), leads={"C3": 5.0})
    _, move = await ms._select_with_human_net(engine, board, Color.BLACK, "18k", capped, LATE, [], None)
    assert (move.row, move.col) == C3 and _scored(engine) == {"C3", "pass"}


async def test_negative_tilt_gets_the_second_look_on_a_small_gain():
    endgame = dict(PROFILE, human_tilt=-4.0, human_pass_margin=1.0, human_small_gain=2.0,
                   human_confirm_visits=12, human_confirm_margin=0.75)
    human = _policy({G7: 0.7, C3: 0.3})
    held = FakeEngine(human, leads={"G7": 10.5, "C3": 11.5, "pass": 10.0}, deep_leads={"C3": 11.2, "pass": 10.0})
    handled, move = await _pick(held, endgame, LATE)
    assert handled and (move.row, move.col) == C3
    assert {c["moves"][-1][1] for c in held.calls if c.get("max_visits") == 12} == {"C3", "pass"}
    faded = FakeEngine(human, leads={"G7": 10.5, "C3": 11.5, "pass": 10.0}, deep_leads={"C3": 10.5, "pass": 10.0})
    assert await _pick(faded, endgame, LATE) == (True, None)


async def test_negative_tilt_reads_the_loss_from_whites_side():
    # For White a Black-perspective lead of -7 after G3 is the better result.
    engine = FakeEngine(_policy({C7: 0.6, G3: 0.4}), leads={"C7": 5.0, "G3": -7.0})
    late_white = LATE + [["B", "pass"]]
    for _ in range(20):
        _, move = await _pick(engine, dict(PROFILE, human_tilt=-0.25), late_white, Color.WHITE)
        assert (move.row, move.col) == G3


# --- infinite tilt: scored, no lean -----------------------------------------


async def test_infinite_tilt_scores_and_samples_by_probability_among_the_kept(monkeypatch):
    cap = _Capture()
    monkeypatch.setattr(ms, "random", cap)
    leads = {"C7": 20.0, "G7": 15.0, "E5": 8.0}  # E5 loses 12: over the cap
    for tilt in (math.inf, -math.inf):
        engine = FakeEngine(_policy({C7: 0.4, G7: 0.35, E5: 0.25}), leads=leads)
        await _pick(engine, dict(PROFILE, human_tilt=tilt, human_loss_cap=10.0), LATE)
        assert cap.weights == [0.4, 0.35]
        assert _scored(engine) == {"C7", "G7", "E5", "pass"}


# --- boundaries -------------------------------------------------------------


async def test_before_tilt_from_no_tilt_scores():
    for tilt in (-0.25, -8.0, 0.0, -math.inf):
        engine = FakeEngine(_policy({C7: 0.6, G3: 0.4}), leads={"C7": 5.0, "G3": -7.0})
        for _ in range(5):
            await _pick(engine, dict(PROFILE, human_tilt=tilt), EARLY)
        assert all(c.get("include_policy") for c in engine.calls)


async def test_zero_tilt_or_no_tilt_key_stays_unscored_past_tilt_from():
    for profile in (dict(PROFILE, human_tilt=0.0), dict(PROFILE, human_tilt=0), _without_tilt()):
        engine = FakeEngine(_policy({C7: 0.6, G3: 0.4}), leads={"C7": 5.0, "G3": -7.0})
        seen = set()
        for _ in range(60):
            _, move = await _pick(engine, profile, LATE)
            seen.add((move.row, move.col))
        assert seen == {C7, G3}
        assert all(c.get("include_policy") for c in engine.calls)


async def test_after_the_opponents_pass_in_the_opening_a_negative_tilt_does_not_lean(monkeypatch):
    cap = _Capture()
    monkeypatch.setattr(ms, "random", cap)
    engine = FakeEngine(_policy({G7: 0.6, C3: 0.4}), leads={"G7": 1.0, "C3": 6.0})
    await ms._select_with_human_net(
        engine, Board(SIZE), Color.BLACK, "18k", dict(PROFILE, human_tilt=-1.0), EARLY, [], None, True
    )
    assert cap.weights == [0.6, 0.4]
    # past tilt_from the same pass does lean
    await ms._select_with_human_net(
        engine, Board(SIZE), Color.BLACK, "18k", dict(PROFILE, human_tilt=-1.0), LATE, [], None, True
    )
    assert cap.weights == [0.6 * math.exp(5.0 / -1.0), 0.4]


# --- the 18k, locked: its positive lean is unchanged ----------------------------


def _locked_18k() -> dict:
    path = Path(profile_loader.__file__).resolve().parents[3] / "data" / "profiles" / "b20.yaml"
    return profile_loader._load_from_path(path)[9]["18k"]


async def test_the_18k_lean_is_unchanged(monkeypatch):
    profile = _locked_18k()
    assert profile["human_tilt"] == 8.0
    cap = _Capture()
    monkeypatch.setattr(ms, "random", cap)
    # losses 0, 4, 9 kept; 12 over the 18k's cap of 10; best gains 10 over a pass (no second look)
    human = _policy({C7: 0.4, G7: 0.3, E5: 0.2, C3: 0.1})
    leads = {"C7": 10.0, "G7": 6.0, "E5": 1.0, "C3": -2.0, "pass": 0.0}
    await _pick(FakeEngine(human, leads=leads), profile, LATE)
    assert cap.weights == [0.4 * math.exp(0.0 / 8.0), 0.3 * math.exp(4.0 / 8.0), 0.2 * math.exp(9.0 / 8.0)]
    # a loss past 15 still counts as 15 (no cap on the profile here)
    uncapped = {k: v for k, v in profile.items() if k != "human_loss_cap"}
    leads = {"C7": 40.0, "G7": 0.0, "pass": 0.0}
    await _pick(FakeEngine(_policy({C7: 0.5, G7: 0.5}), leads=leads), uncapped, LATE)
    assert cap.weights == [0.5, 0.5 * math.exp(15.0 / 8.0)]
