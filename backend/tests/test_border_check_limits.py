"""
Two limits on the border check both paths share (move_selector._close_border):
it scores at most BORDER_MAX_QUERIES border moves in one decision, the largest
count gains first; and a border move is played only if it loses no more than
its own count gain against the pass (and, on the human path with a loss cap,
no more than the cap against the best scored move).
"""

import asyncio

import app.ai.move_selector as ms
from app.game.engine import Board, Color, Point
from app.katago.engine import point_to_gtp
from tests.test_human_net_border import (
    DEAD_12K, GAME_12K, HUMAN_12K, PROFILE_12K, FakeEngine, _ownership, _policy, _pt, _replay,
)
from tests.test_standard_border import TOP_PASS, Engine, _own12, _select as _select_standard

SIZE = 9


def _pockets() -> Board:
    """White's one-point pockets on the top and bottom edges, each open to a
    region that touches Black through a gap; White closing a gap gains it."""
    b = Board(SIZE)
    for r in (0, 1, 7, 8):
        for c in range(1, SIZE, 2):
            b.grid[r * SIZE + c] = Color.WHITE
    for c in range(SIZE):
        b.grid[3 * SIZE + c] = Color.BLACK
        b.grid[5 * SIZE + c] = Color.BLACK
    return b


def _passing_engine(board, **kw):
    """The human path with the main net on pass: straight to the border check."""
    return FakeEngine(_policy({}), main=_policy({}, pass_prob=0.9), ownership=_ownership(board, []), **kw)


def _scored(engine):
    return [c["moves"][-1][1] for c in engine.calls if not c.get("include_policy")]


# --- the ceiling and the order ------------------------------------------------


async def test_many_qualifying_moves_make_at_most_the_ceiling_of_queries():
    board = _pockets()
    found = ms._border_moves(board, Color.WHITE, _ownership(board, []), 1.0)
    assert len(found) == 20 > ms.BORDER_MAX_QUERIES == 8
    engine = _passing_engine(board, default_lead=0.0)
    handled, move = await ms._select_with_human_net(
        engine, board, Color.WHITE, "18k", dict(PROFILE_12K, human_loss_cap=10.0), [["B", "pass"]] * 30, [], None, False,
    )
    assert handled and move is not None and move.index(SIZE) in {i for _, i in found}
    scored = _scored(engine)
    assert len(scored) == ms.BORDER_MAX_QUERIES + 1 and scored.count("pass") == 1


async def test_the_largest_gains_are_scored_first_ties_to_the_likelier(monkeypatch):
    board, moves = _replay(GAME_12K)
    gains = {"A9": 1, "B9": 1, "C9": 2, "E9": 3, "G9": 3, "H9": 1, "J9": 2, "J8": 5, "J7": 1, "J6": 2, "J5": 4, "J4": 1}
    monkeypatch.setattr(ms, "_border_moves", lambda b, c, o, m: [(g, _pt(p).index(SIZE)) for p, g in gains.items()])
    human = _policy({"D4": 0.3, "H9": 0.2, "A9": 0.1, "B9": 0.05})
    engine = FakeEngine(human, main=_policy({}, pass_prob=0.9), ownership=_ownership(board, DEAD_12K))
    await ms._select_with_human_net(engine, board, Color.WHITE, "12k", PROFILE_12K, moves, [], None, False)
    # gains 5, 4, 3, 3, 2, 2, 2, then the likeliest of the five one-point moves (H9 0.2)
    assert sorted(_scored(engine)) == sorted(["J8", "J5", "E9", "G9", "C9", "J9", "J6", "H9", "pass"])


async def test_the_ceiling_keeps_the_human_path_inside_its_allowance(monkeypatch):
    # An engine that works through the queries one at a time at a fixed cost:
    # all twenty border moves and the pass would take 21 costs, past the
    # allowance; the ceiling's nine fit inside it.
    board = _pockets()
    cost = 0.04
    monkeypatch.setattr(ms, "HUMAN_PATH_BUDGET_S", 15 * cost)
    engine = _passing_engine(board, default_lead=0.0)
    engine.has_human_model = True
    lock = asyncio.Lock()
    plain = engine.analyze

    async def serial(*args, **kwargs):
        if kwargs.get("include_policy"):
            return await plain(*args, **kwargs)
        async with lock:
            await asyncio.sleep(cost)
            return await plain(*args, **kwargs)

    engine.analyze = serial

    async def fake_get_engine():
        return engine

    monkeypatch.setattr(ms, "get_engine", fake_get_engine)
    monkeypatch.setattr(ms, "get_profile", lambda rank, size: dict(PROFILE_12K, human_loss_cap=10.0))
    fell_back = []

    async def standard(*args, **kwargs):
        fell_back.append(True)
        return None

    monkeypatch.setattr(ms, "_select_with_katago", standard)
    move = await ms.select_ai_move(board, Color.WHITE, "18k", engine_moves=[["B", "pass"]] * 30, engine_setup=[])
    assert move is not None and not fell_back


async def test_the_standard_path_scores_at_most_the_ceiling_too(monkeypatch):
    board = _pockets()

    async def select(engine):
        monkeypatch.setattr(ms, "get_profile", lambda rank, size: {
            "max_point_loss": 10.0, "mistake_freq": 0.0, "policy_weight": 1.0, "randomness": 0.0,
            "random_move_chance": 0.0, "local_bias": 0.0, "first_line_chance": 0.0, "visits": 16,
            "min_candidates": 5, "opening_moves": 0,
        })
        return await ms._select_with_katago(
            engine, board, Color.WHITE, "9k", None, False, [["B", "pass"]] * 30, [], None, 6.5,
        )

    engine = Engine(TOP_PASS, _ownership(board, []), default_lead=0.0)
    move = await select(engine)
    assert move is not None
    assert len(engine.scored()) == ms.BORDER_MAX_QUERIES + 1 and engine.scored().count("pass") == 1


# --- the loss against the pass --------------------------------------------------


async def test_a_border_move_losing_more_than_its_gain_against_the_pass_is_not_played():
    # A cap of 10: A8 (four points by the count) loses five against the pass, A7 (three) four, A6 (two) three.
    board, moves = _replay(GAME_12K)
    own = _ownership(board, DEAD_12K)
    cap10 = dict(PROFILE_12K, human_loss_cap=10.0)
    leads = {"A8": -21.0, "A7": -22.0, "A6": -23.0}
    engine = FakeEngine(HUMAN_12K, ownership=own, leads=leads)
    assert await ms._select_with_human_net(engine, board, Color.WHITE, "18k", cap10, moves, [], None, False) == (True, None)
    # A8 losing exactly its four is played
    engine = FakeEngine(HUMAN_12K, ownership=own, leads=dict(leads, A8=-22.0))
    assert (await ms._select_with_human_net(engine, board, Color.WHITE, "18k", cap10, moves, [], None, False))[1] == _pt("A8")
    # A8 and A7 lose too much; A6 loses two, its own gain: played
    engine = FakeEngine(HUMAN_12K, ownership=own, leads=dict(leads, A6=-24.0))
    assert (await ms._select_with_human_net(engine, board, Color.WHITE, "18k", cap10, moves, [], None, False))[1] == _pt("A6")


async def test_the_cap_against_the_best_still_applies():
    # D4 reads 0.4 over the pass; A8 loses 0.4 against the pass and 0.8 against D4: played. When A8
    # loses its four against the pass (inside its gain) it loses 4.4 against D4, past the cap of 4.
    board, moves = _replay(GAME_12K)
    human = _policy({"D4": 0.3, "F1": 0.25, "J1": 0.2, "A7": 0.05, "A8": 0.02})
    leads = {"D4": -26.4, "A8": -25.6, "A7": -25.0, "A6": -25.0}
    engine = FakeEngine(human, ownership=_ownership(board, DEAD_12K), leads=leads)
    assert (await ms._select_with_human_net(engine, board, Color.WHITE, "12k", PROFILE_12K, moves, [], None, False))[1] == _pt("A8")
    engine = FakeEngine(human, ownership=_ownership(board, DEAD_12K), leads=dict(leads, A8=-22.0, A7=-22.0, A6=-22.0))
    assert await ms._select_with_human_net(engine, board, Color.WHITE, "12k", PROFILE_12K, moves, [], None, False) == (True, None)


async def test_the_standard_path_plays_a_border_move_only_within_its_gain_of_the_pass(monkeypatch):
    # The standard path has no loss cap: its rule is the gain against the pass alone.
    leads = {"A8": -21.0, "A7": -22.0, "A6": -23.0}  # each loses more than it gains
    assert await _select_standard(monkeypatch, Engine(TOP_PASS, _own12(), leads=leads)) is None
    assert await _select_standard(monkeypatch, Engine(TOP_PASS, _own12(), leads=dict(leads, A7=-23.0))) == _pt("A7")
    # a far better reading of a border move does not matter beyond passing the check: the largest gain wins
    assert await _select_standard(monkeypatch, Engine(TOP_PASS, _own12(), leads={"A6": -40.0})) == _pt("A8")


async def test_the_standard_scoring_without_a_move_history_scores_the_board_after_each_move(monkeypatch):
    # Games sent without their history: the board after the move goes over as a layout, the opponent to move.
    monkeypatch.setattr(ms, "get_profile", lambda rank, size: {
        "max_point_loss": 10.0, "mistake_freq": 0.0, "policy_weight": 1.0, "randomness": 0.0,
        "random_move_chance": 0.0, "local_bias": 0.0, "first_line_chance": 0.0, "visits": 16,
        "min_candidates": 5, "opening_moves": 0,
    })
    board, _ = _replay(GAME_12K)
    seen = []

    class Bare(Engine):
        async def analyze(self, board_2d, player, **kwargs):
            if player == "B":
                seen.append((board_2d, kwargs.get("moves"), kwargs.get("komi"), kwargs.get("max_visits")))
                a8 = board_2d[_pt("A8").row][_pt("A8").col]
                from tests.test_standard_border import Analysis
                return Analysis(score_lead=-21.0 if a8 else -26.0)  # A8 loses five: over its gain
            return await Engine.analyze(self, board_2d, player, **kwargs)

    move = await ms._select_with_katago(Bare(TOP_PASS, _own12()), board, Color.WHITE, "9k", None, False, None, None, None, 6.5)
    assert move == _pt("A7")
    assert all(m is None and k == 6.5 and v == 4 for _, m, k, v in seen) and len(seen) == 4
    assert sum(1 for b2d, *_ in seen if b2d == board.to_2d()) == 1  # the pass


async def test_with_nothing_scored_equal_gains_still_go_to_the_likelier(monkeypatch):
    # The human path with no loss cap scores nothing; A8 comes first by index, A6 is likelier.
    board, moves = _replay(GAME_12K)
    monkeypatch.setattr(ms, "_border_moves", lambda b, c, o, m: [(4, _pt("A8").index(SIZE)), (4, _pt("A6").index(SIZE))])
    no_cap = {k: v for k, v in PROFILE_12K.items() if k != "human_loss_cap"}
    engine = FakeEngine(_policy({"A6": 0.05, "A8": 0.02}), main=_policy({}, pass_prob=0.9), ownership=_ownership(board, DEAD_12K))
    assert (await ms._select_with_human_net(engine, board, Color.WHITE, "12k", no_cap, moves, [], None, False))[1] == _pt("A6")
    assert _scored(engine) == []
