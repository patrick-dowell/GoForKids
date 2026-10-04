"""
The human path's border check: before it passes, the bot counts the board the
way the server scores a finished game (dead stones off by the ownership read,
then a flood fill in which a region touching both colours counts for nobody)
and plays a legal move that raises its count by `human_border_gain` points or
more instead of passing. Positions are from three 9x9 ladder games of
2026-10-04 (komi 6.5, the bot White), each at the bot's pass.
"""

import pytest

import app.ai.move_selector as ms
import app.game.state as state_mod
from app.ai import profile_loader
from app.game.engine import Board, Color, Point
from app.game.scoring import dead_stones_from_ownership, remove_dead_and_count
from app.katago.engine import point_to_gtp

SIZE = 9
N = SIZE * SIZE

# SGF coordinates (column letter, row letter from the top), Black first.
GAME_12K = "eeegcegdfgccecffefggfhdggffehgghhhedddfddccfdebebdafgbehgibccbbbdacdbafbfcgchbebfaeidb"
DEAD_12K = [(1, 4), (1, 5), (2, 6), (3, 1), (3, 4), (3, 5), (3, 6), (4, 5), (5, 5)]
GAME_18K = "eeggeggccdgeecfhehcgbfbgcfdgdhchbicidfbhagahafaidififbfghbgfhdgdhcgbgaheieifidfcebeddd"
DEAD_18K = [(6, 1), (6, 2), (6, 3), (7, 0), (7, 1), (7, 2), (8, 0), (8, 2)]
GAME_15K = "eeggeggecdfhehfgecfcfdgdfbgcgbfeedefdfffdghbhaibfigiei"

# The live 12k's knobs (data/profiles/b20.yaml, 9x9).
PROFILE_12K = {
    "human_sl_profile": "rank_20k",
    "human_tilt": -4.0,
    "human_tilt_from": 12,
    "human_cand_min": 0.03,
    "human_cand_max": 8,
    "human_score_visits": 4,
    "human_pass_margin": 0.5,
    "human_small_gain": 2.0,
    "human_confirm_visits": 12,
    "human_confirm_margin": 0.75,
    "human_loss_cap": 4.0,
}


def _pt(gtp: str) -> Point:
    return Point(SIZE - int(gtp[1:]), "ABCDEFGHJ".index(gtp[0]))


def _replay(sgf: str):
    board = Board(SIZE)
    moves = []
    for k in range(0, len(sgf), 2):
        color = Color.BLACK if (k // 2) % 2 == 0 else Color.WHITE
        pt = Point(ord(sgf[k + 1]) - 97, ord(sgf[k]) - 97)
        assert board.try_play(color, pt)[0] == "ok"
        moves.append(["B" if color == Color.BLACK else "W", point_to_gtp(pt.row, pt.col, SIZE)])
    return board, moves


def _ownership(board: Board, dead) -> list:
    """A canned ownership read (Black +): stones and territory by the recorded
    count, the dead stones given to the other side, the open points 0."""
    dead_pts = [Point(r, c) for r, c in dead]
    _, black, white, _ = remove_dead_and_count(board, dead_pts)
    own = [0.0] * N
    for i, c in enumerate(board.grid):
        if c != Color.EMPTY:
            own[i] = 0.9 if c == Color.BLACK else -0.9
    for p in dead_pts:
        own[p.index(SIZE)] = -own[p.index(SIZE)]
    for i in black:
        own[i] = 0.9
    for i in white:
        own[i] = -0.9
    return own


def _policy(points: dict, pass_prob: float = 0.0) -> list:
    pol = [0.001] * (N + 1)
    for gtp, p in points.items():
        pol[_pt(gtp).index(SIZE)] = p
    pol[N] = pass_prob
    return pol


class FakeAnalysis:
    def __init__(self, score_lead=0.0, human_policy=None, policy=None, ownership=None):
        self.score_lead = score_lead
        self.winrate = 0.5
        self.candidates = []
        self.human_policy = human_policy
        self.policy = policy
        self.ownership = ownership


class FakeEngine:
    """The human-policy query (with ownership), then a Black-perspective lead
    after each scored move (`leads`, else `default_lead`)."""

    has_human_model = True

    def __init__(self, human, main=None, ownership=None, leads=None, default_lead=-26.0):
        self.human = human
        self.main = main if main is not None else _policy({})
        self.ownership = ownership
        self.leads = leads or {}
        self.default_lead = default_lead
        self.calls = []

    async def analyze(self, *args, **kwargs):
        self.calls.append(kwargs)
        if kwargs.get("include_policy"):
            return FakeAnalysis(1.5, self.human, self.main, self.ownership)
        return FakeAnalysis(self.leads.get(kwargs["moves"][-1][1], self.default_lead))

    def scored(self):
        return [c["moves"][-1][1] for c in self.calls if not c.get("include_policy")]


# The human net's likeliest moves at the 12k's pass: none gains over passing.
HUMAN_12K = _policy({"D4": 0.3, "F1": 0.25, "J1": 0.2, "J9": 0.1, "A8": 0.02})


async def _select(engine, board, moves, profile=PROFILE_12K, color=Color.WHITE, opponent_passed=False):
    return await ms._select_with_human_net(
        engine, board, color, "12k", profile, moves, [], None, opponent_passed
    )


async def test_the_12k_closes_the_border_at_a8_instead_of_passing():
    board, moves = _replay(GAME_12K)
    own = _ownership(board, DEAD_12K)
    engine = FakeEngine(HUMAN_12K, ownership=own)
    handled, move = await _select(engine, board, moves)
    assert handled and move == _pt("A8")
    # A5, A6, A7 and B6 (a dead Black stone's point) are White's after it, by the game's count
    after = board.clone()
    after.try_play(Color.WHITE, move)
    _, _, white, neutral = remove_dead_and_count(after, dead_stones_from_ownership(after, own))
    assert {_pt(g).index(SIZE) for g in ("A5", "A6", "A7", "B6")} <= white
    assert not {_pt(g).index(SIZE) for g in ("A5", "A6", "A7", "B6")} & neutral
    # A8 was not among the scored candidates, so it was scored for the loss cap, once, at the profile's visits
    a8 = [c for c in engine.calls if not c.get("include_policy") and c["moves"][-1][1] == "A8"]
    assert len(a8) == 1 and a8[0]["max_visits"] == 4
    # the ownership comes with the human-policy query; the pass already scored is not asked again
    assert engine.calls[0]["include_ownership"] is True and engine.calls[0]["max_visits"] == 1
    assert engine.scored().count("pass") == 1


async def test_the_border_count_matches_the_recorded_game():
    board, _ = _replay(GAME_12K)
    own = _ownership(board, DEAD_12K)
    assert sorted((p.row, p.col) for p in dead_stones_from_ownership(board, own)) == sorted(DEAD_12K)
    found = dict((point_to_gtp(i // SIZE, i % SIZE, SIZE), g) for g, i in ms._border_moves(board, Color.WHITE, own, 1.0))
    # A9 would gain five but is self-atari; A8 four, A7 three, A6 two
    assert found == {"A8": 4, "A7": 3, "A6": 2}


async def test_without_the_check_the_same_position_passes():
    board, moves = _replay(GAME_12K)
    engine = FakeEngine(HUMAN_12K, ownership=None)
    assert await _select(engine, board, moves) == (True, None)
    assert sorted(engine.scored()) == ["D4", "F1", "J1", "J9", "pass"]


async def test_a_border_is_also_closed_when_the_main_net_wants_to_pass():
    board, moves = _replay(GAME_12K)
    engine = FakeEngine(HUMAN_12K, main=_policy({}, pass_prob=0.9), ownership=_ownership(board, DEAD_12K))
    handled, move = await _select(engine, board, moves)
    assert move == _pt("A8")
    assert sorted(engine.scored()) == ["A6", "A7", "A8", "pass"]  # every qualifying border move, for the cap


async def test_a_border_is_also_closed_in_answer_to_the_opponents_pass():
    board, moves = _replay(GAME_12K)
    engine = FakeEngine(HUMAN_12K, ownership=_ownership(board, DEAD_12K))
    handled, move = await _select(engine, board, moves + [["B", "pass"]], opponent_passed=True)
    assert move == _pt("A8")


async def test_a_border_is_closed_after_the_second_look_says_pass():
    # D4 reads 1.0 over passing at 4 visits (inside human_small_gain) and 0 at 12: the second look passes.
    board, moves = _replay(GAME_12K)
    engine = FakeEngine(HUMAN_12K, ownership=_ownership(board, DEAD_12K), leads={"D4": -27.0})
    deep = {"D4": -26.0}

    async def analyze(*args, **kwargs):
        if kwargs.get("max_visits") == 12:
            engine.calls.append(kwargs)
            return FakeAnalysis(deep.get(kwargs["moves"][-1][1], -26.0))
        return await FakeEngine.analyze(engine, *args, **kwargs)

    engine.analyze = analyze
    handled, move = await _select(engine, board, moves)
    assert move == _pt("A8")
    assert sum(1 for c in engine.calls if c.get("max_visits") == 12) == 2


async def test_the_18k_position_plays_f5_for_one_point():
    # E1, E4, F4, F5 and F6 count for nobody; White F5 makes F6 White's (+1). The rest gain nothing.
    board, moves = _replay(GAME_18K)
    own = _ownership(board, DEAD_18K)
    found = ms._border_moves(board, Color.WHITE, own, 1.0)
    assert [(g, point_to_gtp(i // SIZE, i % SIZE, SIZE)) for g, i in found] == [(1, "F5")]
    engine = FakeEngine(_policy({"E1": 0.4, "J4": 0.3}), ownership=own, default_lead=-31.0)
    assert (await _select(engine, board, moves))[1] == _pt("F5")
    # a profile that asks for two points or more passes there
    engine = FakeEngine(_policy({"E1": 0.4, "J4": 0.3}), ownership=own, default_lead=-31.0)
    assert await _select(engine, board, moves, dict(PROFILE_12K, human_border_gain=2.0)) == (True, None)


async def test_the_15k_position_still_passes_j9_is_a_dame():
    board, moves = _replay(GAME_15K)
    own = _ownership(board, [])
    assert ms._border_moves(board, Color.WHITE, own, 1.0) == []
    engine = FakeEngine(_policy({"J9": 0.4, "J7": 0.3}), ownership=own, default_lead=-21.0)
    assert await _select(engine, board, moves) == (True, None)
    # no extra query when nothing qualifies
    assert sorted(engine.scored()) == ["J7", "J9", "pass"]
    # nor when the main net wants to pass, and with no loss cap it still passes
    engine = FakeEngine(_policy({"J9": 0.4}), main=_policy({}, pass_prob=0.9), ownership=own, default_lead=-21.0)
    assert await _select(engine, board, moves) == (True, None)
    assert engine.scored() == []
    no_cap = {k: v for k, v in PROFILE_12K.items() if k != "human_loss_cap"}
    engine = FakeEngine(_policy({"J9": 0.4, "J7": 0.3}), ownership=own, default_lead=-21.0)
    assert await _select(engine, board, moves, no_cap) == (True, None)


def _settled():
    """Black's wall on the E column, White's on the F column: every region is one side's."""
    board = Board(SIZE)
    for r in range(SIZE):
        board.grid[r * SIZE + 4] = Color.BLACK
        board.grid[r * SIZE + 5] = Color.WHITE
    return board


async def test_a_settled_position_still_passes_with_no_extra_query():
    board = _settled()
    _, _, _, neutral = remove_dead_and_count(board, [])
    assert neutral == set()
    moves = [["B" if k % 2 == 0 else "W", "pass"] for k in range(14)]
    engine = FakeEngine(_policy({"A1": 0.5, "J9": 0.4}), ownership=_ownership(board, []), default_lead=0.0)
    assert await _select(engine, board, moves) == (True, None)
    assert sorted(engine.scored()) == ["A1", "J9", "pass"]


async def test_the_loss_cap_still_applies_to_a_border_move():
    # The main net says A8 throws away five points: over the 12k's cap of 4, so pass.
    board, moves = _replay(GAME_12K)
    engine = FakeEngine(HUMAN_12K, ownership=_ownership(board, DEAD_12K), leads={"A8": -21.0, "A7": -21.0, "A6": -21.0})
    assert await _select(engine, board, moves) == (True, None)
    # four is inside the cap: played
    engine = FakeEngine(HUMAN_12K, ownership=_ownership(board, DEAD_12K), leads={"A8": -22.0})
    assert (await _select(engine, board, moves))[1] == _pt("A8")
    # with no cap the main net is not asked about it
    engine = FakeEngine(HUMAN_12K, ownership=_ownership(board, DEAD_12K), leads={"A8": -21.0})
    no_cap = {k: v for k, v in PROFILE_12K.items() if k != "human_loss_cap"}
    assert (await _select(engine, board, moves, no_cap))[1] == _pt("A8")
    assert "A8" not in engine.scored()


async def test_the_loss_cap_counts_from_the_best_scored_candidate():
    # D4 reads 0.4 over passing (under the pass margin); A8 loses 4.4 against it, past the cap of 4,
    # though only 4 against the pass. A7, a candidate itself, is scored once.
    board, moves = _replay(GAME_12K)
    human = _policy({"D4": 0.3, "F1": 0.25, "J1": 0.2, "A7": 0.05, "A8": 0.02})
    engine = FakeEngine(human, ownership=_ownership(board, DEAD_12K), leads={"D4": -26.4, "A8": -22.0})
    assert (await _select(engine, board, moves))[1] == _pt("A7")
    assert engine.scored().count("A7") == 1


async def test_no_legal_move_in_the_human_policy_still_closes_the_border():
    board, moves = _replay(GAME_12K)
    engine = FakeEngine([0.0] * (N + 1), ownership=_ownership(board, DEAD_12K))
    assert (await _select(engine, board, moves))[1] == _pt("A8")


async def test_a_short_or_missing_ownership_read_leaves_the_pass_alone():
    board, moves = _replay(GAME_12K)
    for own in (None, [], [0.0] * 10):
        engine = FakeEngine(HUMAN_12K, ownership=own)
        assert await _select(engine, board, moves) == (True, None)


async def test_a_stone_in_the_opponents_territory_is_never_a_border_move():
    # Black's area is sealed; the read is unsure of one point inside it. Dropping a White stone
    # there would make Black's whole area count for nobody, but it is not a border.
    board = _settled()
    own = _ownership(board, [])
    own[_pt("B5").index(SIZE)] = 0.0
    assert ms._border_moves(board, Color.WHITE, own, 1.0) == []


async def test_a_dead_stones_point_is_never_a_border_move():
    board, _ = _replay(GAME_12K)
    found = {i for _, i in ms._border_moves(board, Color.WHITE, _ownership(board, DEAD_12K), 0.0)}
    assert _pt("A5").index(SIZE) in found and _pt("D4").index(SIZE) in found
    assert _pt("B6").index(SIZE) not in found  # the dead Black stone's point: occupied


def test_a_stone_is_dead_only_past_the_threshold():
    board = Board(SIZE)
    board.grid[0] = Color.BLACK
    board.grid[1] = Color.WHITE
    own = [0.0] * N
    own[0], own[1] = -0.3, 0.3
    assert dead_stones_from_ownership(board, own) == []
    own[0], own[1] = -0.31, 0.31
    assert dead_stones_from_ownership(board, own) == [Point(0, 0), Point(0, 1)]


def test_the_profile_loader_types_the_border_knob():
    base = {k: 1.0 for k in profile_loader.REQUIRED_KEYS}
    profile_loader._validate_profile(9, "12k", dict(base, human_border_gain=1.0))
    with pytest.raises(ValueError, match="human_border_gain"):
        profile_loader._validate_profile(9, "12k", dict(base, human_border_gain="one"))


async def test_the_loss_cap_drops_one_border_move_and_keeps_another():
    # A8 loses five (dropped); A7 gains three by the count and loses nothing: played.
    board, moves = _replay(GAME_12K)
    engine = FakeEngine(HUMAN_12K, ownership=_ownership(board, DEAD_12K), leads={"A8": -21.0})
    assert (await _select(engine, board, moves))[1] == _pt("A7")


async def test_equal_gains_go_to_the_human_nets_probability(monkeypatch):
    board, moves = _replay(GAME_12K)
    own = _ownership(board, DEAD_12K)
    monkeypatch.setattr(
        ms, "_border_moves", lambda b, c, o, m: [(4, _pt("A8").index(SIZE)), (4, _pt("A6").index(SIZE))]
    )
    engine = FakeEngine(_policy({"D4": 0.3, "A6": 0.05, "A8": 0.02}), ownership=own)
    assert (await _select(engine, board, moves))[1] == _pt("A6")
    engine = FakeEngine(_policy({"D4": 0.3, "A6": 0.01, "A8": 0.02}), ownership=own)
    assert (await _select(engine, board, moves))[1] == _pt("A8")
    # a larger gain wins over a likelier move
    monkeypatch.setattr(
        ms, "_border_moves", lambda b, c, o, m: [(4, _pt("A8").index(SIZE)), (3, _pt("A6").index(SIZE))]
    )
    engine = FakeEngine(_policy({"D4": 0.3, "A6": 0.05, "A8": 0.02}), ownership=own)
    assert (await _select(engine, board, moves))[1] == _pt("A8")


async def test_a_stone_dropped_on_a_point_the_opponent_owns_counts_as_dead():
    board, _ = _replay(GAME_12K)
    own = _ownership(board, DEAD_12K)
    own[_pt("A8").index(SIZE)] = 0.5  # the read gives A8 to Black
    found = {i for _, i in ms._border_moves(board, Color.WHITE, own, 1.0)}
    assert _pt("A8").index(SIZE) not in found and _pt("A7").index(SIZE) in found


async def test_own_eye_fills_are_never_border_moves(monkeypatch):
    board, _ = _replay(GAME_12K)
    own = _ownership(board, DEAD_12K)
    monkeypatch.setattr(ms, "_is_eye_fill", lambda b, c, p: p == _pt("A8"))
    found = {i for _, i in ms._border_moves(board, Color.WHITE, own, 1.0)}
    assert _pt("A8").index(SIZE) not in found and _pt("A7").index(SIZE) in found


async def test_the_knob_is_read_from_the_profile():
    board, moves = _replay(GAME_12K)
    engine = FakeEngine(HUMAN_12K, ownership=_ownership(board, DEAD_12K))
    assert await _select(engine, board, moves, dict(PROFILE_12K, human_border_gain=5.0)) == (True, None)
    engine = FakeEngine(HUMAN_12K, ownership=_ownership(board, DEAD_12K))
    assert (await _select(engine, board, moves, dict(PROFILE_12K, human_border_gain=4.0)))[1] == _pt("A8")


# --- the server's scorer and the border check count alike -------------------


class _ScoreEngine:
    def __init__(self, ownership):
        self.ownership = ownership

    async def analyze(self, *args, **kwargs):
        return FakeAnalysis(ownership=self.ownership)


@pytest.mark.parametrize("sgf,dead,black,white", [
    (GAME_12K, DEAD_12K, 39, 19.5),
    (GAME_18K, DEAD_18K, 41, 16.5),
    (GAME_15K, [], 37, 22.5),
])
async def test_the_scorer_counts_the_recorded_games_as_the_border_check_does(monkeypatch, sgf, dead, black, white):
    board, _ = _replay(sgf)
    own = _ownership(board, dead)

    async def fake_get_engine():
        return _ScoreEngine(own)

    async def no_persist(self, game):
        return None

    monkeypatch.setattr(state_mod, "get_engine", fake_get_engine)
    monkeypatch.setattr(state_mod.GameManager, "_persist_finished_game", no_persist)
    game = state_mod.ActiveGame(
        game_id="t", board=board.clone(), current_color=Color.WHITE, move_history=[],
        phase="playing", komi=6.5, target_rank="12k", mode="ai", player_color=Color.BLACK,
    )
    await state_mod.GameManager()._score_game_async(game)
    assert (game.result["black_score"], game.result["white_score"]) == (black, white)
    assert sorted((d["row"], d["col"]) for d in game.result["dead_stones"]) == sorted(dead)
    # the border check's margin for White is the same count, komi aside
    margin, _ = ms._counted_margin(board, Color.WHITE, own)
    assert margin == white - 6.5 - black
