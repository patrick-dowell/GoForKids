"""
Phase 1 rank-calibrated move selection.

Uses KataGo analysis with heuristic-based move sampling to simulate play
at a target rank level.

Key lesson from playtesting: the raw Fox dataset stats (57% local, 10% first
line) describe ALL moves including endgame gote. Applying those rates uniformly
makes the bot play nonsense in the opening/midgame. Real 15k players:
  - Play recognizable openings (star points, 3-4 points, approaches)
  - Have basic shape instincts (don't randomly throw stones on the edge)
  - Can read 1-3 moves in a fight (won't walk into obvious captures)
  - Make big strategic errors: wrong direction, overconcentration,
    ignoring cutting points, saving dead stones
  - Play too locally in the midgame (miss the big point)
  - Lose groups they shouldn't through misreading

The bot should play KataGo moves most of the time but with a loose hand —
occasionally picking the 3rd or 5th best move instead of the 1st, and
sometimes making genuinely bad choices in non-tactical positions.
"""

from __future__ import annotations
import math
import random
import logging
from typing import Optional

from app.game.engine import Board, Color, Point, BOARD_SIZE


def edge_distance(row: int, col: int, size: int = BOARD_SIZE) -> int:
    """Distance from the nearest board edge."""
    return min(row, col, size - 1 - row, size - 1 - col)


def _is_eye_fill(board: Board, color: Color, point: Point) -> bool:
    """
    Check if playing at `point` would fill a friendly eye.
    An eye is an empty point where all adjacent points are the same color
    (or board edge) and at least 3 of the 4 diagonals are the same color.
    No human above 30k would do this.
    """
    size = board.size

    # Must be empty
    if board.get(point) != Color.EMPTY:
        return False

    # All orthogonal neighbors must be our color or off-board
    for nb in point.neighbors(size):
        c = board.get(nb)
        if c != color:
            return False

    # Diagonals decide real vs false eye. Standard doctrine: a center point
    # (4 on-board diagonals) is a real eye with >= 3 friendly; an EDGE or
    # CORNER point needs ALL of its on-board diagonals friendly — one enemy
    # diagonal there makes it a false eye (= a connection point, playable).
    # The old rule counted off-board diagonals as friendly AND allowed one
    # miss, so an edge connection out of atari got flagged as an eye-fill
    # (JEA338QQ move 36, 2026-07-04 — bot passed a live game away).
    diagonals = [
        Point(point.row - 1, point.col - 1),
        Point(point.row - 1, point.col + 1),
        Point(point.row + 1, point.col - 1),
        Point(point.row + 1, point.col + 1),
    ]
    friendly_diags = 0
    total_diags = 0
    for d in diagonals:
        if d.is_valid(size):
            total_diags += 1
            if board.get(d) == color:
                friendly_diags += 1

    if total_diags == 0:
        return True
    required = 3 if total_diags == 4 else total_diags
    return friendly_diags >= required


from app.katago.engine import get_engine, PositionAnalysis
from app.ai.profile_loader import get_profile

logger = logging.getLogger(__name__)

# Read-streak state (S50): moves remaining on which the bot may NOT take the
# reading path, keyed by color (bot-vs-bot runs two bots through this module).
# Set to profile["read_cooldown"] after every read move — a weak player
# doesn't produce several engine-quality moves in a row. Carrying a ≤2
# counter across games is harmless. Mirrors the TS selector's _readCooldown.
_READ_COOLDOWN: dict = {}

# Bot tuning parameters used to live as RANK_PROFILES_* dicts here. They now
# live in data/profiles/*.yaml and are loaded via profile_loader.get_profile().
# Tuning rationale per profile lives in AI_CALIBRATION.md.


def _is_own_territory_fill(board: Board, color: Color, point: Point) -> bool:
    """True if `point` sits in an empty region whose stone borders are ALL
    friendly — playing there fills our own settled territory. Region-based,
    so it is ko-safe by construction: a ko recapture point's region always
    borders the opponent's ko stone and can never be flagged. Empty regions
    touching no stones at all (early board) are not territory. Endgame
    safety net after the "never pass" changes let the sampler fill its own
    territory instead of letting the game end (2026-07-05). Mirrors the TS
    isOwnTerritoryFill."""
    if board.get(point) != Color.EMPTY:
        return False
    size = board.size
    seen: set[int] = set()
    stack = [point]
    saw_own = False
    while stack:
        p = stack.pop()
        idx = p.index(size)
        if idx in seen:
            continue
        seen.add(idx)
        for nb in p.neighbors(size):
            c = board.get(nb)
            if c == Color.EMPTY:
                stack.append(nb)
            elif c == color:
                saw_own = True
            else:
                return False  # region borders the opponent — not our territory
    return saw_own


def _is_opponent_enclosed_fill(board: Board, color: Color, point: Point) -> bool:
    """True if playing at `point` drops a stone inside a region the OPPONENT
    has fully enclosed — a junk invasion that only drags the game out. Same
    region test as _is_own_territory_fill, opposite color; ko-safe for the
    same reason (a ko point's region has mixed-color borders).

    Degenerate-case guard: when the opponent owns the ONLY stones on the
    board (handicap openings), every region is "enclosed" by them and this
    check would veto the whole board — the mover must have at least one
    stone down before anything counts as sealed."""
    if not any(c == color for c in board.grid):
        return False
    opponent = Color.WHITE if color == Color.BLACK else Color.BLACK
    return _is_own_territory_fill(board, opponent, point)


def _get_nearby_moves(board: Board, color: Color, center: Point, radius: int = 3) -> list[Point]:
    """Get legal moves within `radius` intersections of `center`."""
    size = board.size
    moves = []
    for dr in range(-radius, radius + 1):
        for dc in range(-radius, radius + 1):
            r, c = center.row + dr, center.col + dc
            if 0 <= r < size and 0 <= c < size:
                p = Point(r, c)
                test = board.clone()
                result, _ = test.try_play(color, p)
                if result == "ok":
                    moves.append(p)
    return moves


def _pick_random_legal(board: Board, color: Color) -> Optional[Point]:
    """Pick a random legal move with preference for 3rd/4th line."""
    size = board.size
    moves = []
    weights = []
    for row in range(size):
        for col in range(size):
            p = Point(row, col)
            test = board.clone()
            result, _ = test.try_play(color, p)
            if result == "ok":
                moves.append(p)
                ed = edge_distance(row, col, size)
                if ed in (2, 3):
                    weights.append(2.5)
                elif ed in (4, 5):
                    weights.append(1.5)
                elif ed in (1,):
                    weights.append(0.8)
                elif ed == 0:
                    weights.append(0.2)
                else:
                    weights.append(1.0)
    if not moves:
        return None
    total = sum(weights)
    weights = [w / total for w in weights]
    return random.choices(moves, weights=weights, k=1)[0]


def _pick_legal_non_eye_move(board: Board, color: Color) -> Optional[Point]:
    """A legal move that doesn't fill our own eye — the safety fallback for when
    EVERY KataGo candidate was filtered illegal. Usual cause: a ko-rule mismatch
    (KataGo runs simple ko under ``japanese`` rules and offers a move our
    positional-superko engine rejects as a whole-board repeat). Returns None only
    when the board's legal moves are all own-eye fills (or there are none) — then
    passing is genuinely correct."""
    for _ in range(16):
        m = _pick_random_legal(board, color)
        # Only refuse own-EYE fills here. Territory/enclosure filtering was
        # removed (DX4QAWTT, 2026-07-05): a large OPEN midgame region borders
        # only one color and the flood-fill wrongly reads it as sealed
        # territory, so this rescue returned None → premature pass mid-game.
        # Endgame passing is handled by the settle path (opponent_passed),
        # where the board is full and the territory read is reliable.
        if m is not None and not _is_eye_fill(board, color, m):
            return m
    return None


def _count_stones(board: Board) -> int:
    """Count total stones on the board (proxy for move number)."""
    return sum(1 for c in board.grid if c != Color.EMPTY)


def _sample_by_prior(pool: list, temp: float, lapse: float = 0.0):
    """Sample a candidate by prior^(1/temp), blended with an attention lapse
    (sampler v2, 2026-07-05 round 2): λ of the weight mass goes to uniform
    over the pool. Temperature alone can never make the sampler miss a
    0.9-prior vital point (the gap survives any exponent) — that tactical
    free ride is why every sampling rung converged toward dan strength.
    Lapse is the "didn't even look there" dial. Mirrors the TS
    sampleByPrior."""
    t = max(temp, 0.05)
    raw = [max(c.prior, 1e-4) ** (1.0 / t) for c in pool]
    total = sum(raw) or 1.0
    n = len(pool)
    weights = [(1.0 - lapse) * (w / total) + lapse / n for w in raw]
    return random.choices(pool, weights=weights, k=1)[0]


def _pick_noisy_best(pool: list, sigma: float):
    """Noisy-argmax: each candidate's score_lead gets N(0, sigma) noise and
    the noisy best wins. The human model behind `score_noise` (§3 iter 2,
    2026-07-04): close calls flip constantly (small mistakes all the time),
    big gaps survive the noise (obvious moves still get played), one sigma
    knob scales strength smoothly. Mirrors the TS pickNoisyBest."""
    best = pool[0]
    best_score = float("-inf")
    for c in pool:
        noisy = c.score_lead + random.gauss(0.0, sigma)
        if noisy > best_score:
            best_score = noisy
            best = c
    return best


# Visit count for "settle the game cleanly" moves (after the opponent passes).
# Low-visit rank profiles never search `pass` enough to trust it; bumping to a
# deep search lets KataGo surface pass at a settled position so the bot passes
# back instead of filling its own territory.
SETTLE_VISITS = 100


async def select_ai_move(
    board: Board, color: Color, target_rank: str,
    last_opponent_move: Optional[Point] = None,
    opponent_passed: bool = False,
    engine_moves: Optional[list[list[str]]] = None,
    engine_setup: Optional[list[list[str]]] = None,
) -> Optional[Point]:
    """Select a move for the AI at the given target rank.

    `last_opponent_move` is the location of the most recent opponent stone, used
    as a preferred anchor for local-bias play (beginner bots respond locally).
    `opponent_passed` routes through a "settle cleanly" path (deeper search, no
    mistake injection) so the bot passes at a settled position instead of
    filling its own territory.
    `engine_moves` / `engine_setup` are the real game history + handicap setup
    in KataGo query form (see engine.analyze) — without them KataGo analyzes a
    bare stone layout and can't see ko bans, so it suggests recaptures our
    engine rejects (the web half of the 888P9NXK ko-pass bug).
    """
    move = await _select_ai_move_inner(
        board, color, target_rank, last_opponent_move, opponent_passed,
        engine_moves, engine_setup,
    )

    # Safety check: NEVER fill your own eye. No human above 30k does this.
    if move and _is_eye_fill(board, color, move):
        logger.info(f"[{target_rank}] Rejected eye-filling move at ({move.row},{move.col})")
        # Try to find a non-eye-filling alternative
        for _ in range(5):
            alt = await _select_ai_move_inner(
                board, color, target_rank, last_opponent_move, opponent_passed,
                engine_moves, engine_setup,
            )
            if alt and not _is_eye_fill(board, color, alt):
                return alt
        # On the settle path (opponent just passed), "honest play keeps
        # picking an eye-fill" MEANS the game is over — pass back instead of
        # playing random junk (GN5R6K9G).
        if opponent_passed:
            logger.warning(
                f"[{target_rank} {board.size}x{board.size}] PASS: eye-fill exhausted on settle path"
            )
            return None
        # Selection can be near-deterministic (clarity gates, forced
        # positions), so 5 identical eye-flagged picks happen in live games —
        # passing here threw a won game away (JEA338QQ). Play any legal
        # non-eye move instead; pass only when nothing legal remains.
        fallback = _pick_legal_non_eye_move(board, color)
        if fallback is not None:
            logger.warning(
                f"[{target_rank} {board.size}x{board.size}] eye-fill rejected 5x at "
                f"({move.row},{move.col}) — playing legal fallback"
            )
            return fallback
        logger.warning(f"[{target_rank} {board.size}x{board.size}] PASS: 5 alternatives all filled eyes")
        return None

    return move


async def _select_ai_move_inner(
    board: Board, color: Color, target_rank: str,
    last_opponent_move: Optional[Point] = None,
    opponent_passed: bool = False,
    engine_moves: Optional[list[list[str]]] = None,
    engine_setup: Optional[list[list[str]]] = None,
) -> Optional[Point]:
    """Inner move selection (before eye-fill safety check)."""
    profile = get_profile(target_rank, board.size)

    # 30k bot: pure heuristic, no KataGo needed
    if not profile.get("use_katago", True):
        return _select_beginner_move(board, color, profile)

    engine = await get_engine()
    if engine:
        return await _select_with_katago(
            engine, board, color, target_rank, last_opponent_move,
            opponent_passed, engine_moves, engine_setup,
        )
    else:
        return _pick_random_legal(board, color)


def _select_beginner_move(
    board: Board, color: Color, profile: dict
) -> Optional[Point]:
    """
    30k-level bot: plays random legal moves with basic survival instincts.

    Priorities (checked in order, with probability gates):
    1. If own group is in atari → save it (extend/connect)
    2. If opponent group is in atari → capture it
    3. Play near the last stone (local response)
    4. Play a random legal move (prefer 3rd/4th line)
    """
    opponent = Color.WHITE if color == Color.BLACK else Color.BLACK
    size = board.size

    # 1. Save own groups in atari
    if random.random() < profile.get("save_atari_chance", 0.5):
        own_atari_groups = []
        visited: set[int] = set()
        for r in range(size):
            for c in range(size):
                p = Point(r, c)
                if board.get(p) == color and p.index(size) not in visited:
                    group = board._get_group(p)
                    for s in group:
                        visited.add(s.index(size))
                    if board._count_liberties(group) == 1:
                        own_atari_groups.append(group)

        if own_atari_groups:
            # Try to extend into the liberty
            group = random.choice(own_atari_groups)
            liberties = []
            lib_set: set[int] = set()
            for s in group:
                for nb in s.neighbors(size):
                    if board.get(nb) == Color.EMPTY and nb.index(size) not in lib_set:
                        lib_set.add(nb.index(size))
                        liberties.append(nb)
            if liberties:
                lib = liberties[0]
                test = board.clone()
                result, _ = test.try_play(color, lib)
                if result == "ok":
                    return lib

    # 2. Capture opponent groups in atari
    if random.random() < profile.get("capture_chance", 0.4):
        opp_atari_groups = []
        visited2: set[int] = set()
        for r in range(size):
            for c in range(size):
                p = Point(r, c)
                if board.get(p) == opponent and p.index(size) not in visited2:
                    group = board._get_group(p)
                    for s in group:
                        visited2.add(s.index(size))
                    if board._count_liberties(group) == 1:
                        opp_atari_groups.append(group)

        if opp_atari_groups:
            # Play at the liberty to capture
            group = random.choice(opp_atari_groups)
            lib_set2: set[int] = set()
            for s in group:
                for nb in s.neighbors(size):
                    if board.get(nb) == Color.EMPTY and nb.index(size) not in lib_set2:
                        lib_set2.add(nb.index(size))
                        test = board.clone()
                        result, _ = test.try_play(color, nb)
                        if result == "ok":
                            return nb

    # 3. Local response — play near existing stones
    if random.random() < profile.get("local_bias", 0.6):
        occupied = [Point(r, c) for r in range(size)
                    for c in range(size) if board.get(Point(r, c)) != Color.EMPTY]
        if occupied:
            # Pick a random recent stone and play nearby
            anchor = random.choice(occupied[-8:]) if len(occupied) > 8 else random.choice(occupied)
            nearby = _get_nearby_moves(board, color, anchor, radius=2)
            if nearby:
                return random.choice(nearby)

    # 4. Random legal move (avoid eyes)
    for _ in range(10):
        move = _pick_random_legal(board, color)
        if move and not _is_eye_fill(board, color, move):
            return move
    return _pick_random_legal(board, color)


async def _select_with_katago(
    engine, board: Board, color: Color, target_rank: str,
    last_opponent_move: Optional[Point] = None,
    opponent_passed: bool = False,
    engine_moves: Optional[list[list[str]]] = None,
    engine_setup: Optional[list[list[str]]] = None,
) -> Optional[Point]:
    """
    KataGo-backed rank-calibrated move selection.

    Strategy by game phase:
    - OPENING (first N moves): Play from KataGo's top 3 candidates only.
      Even 15k players play recognizable openings.
    - MIDGAME: Mix of KataGo candidates with rank-based mistake injection.
      Local bias kicks in here (respond near last move instead of global best).
    - ENDGAME: Play KataGo candidates with moderate mistakes. Auto-pass
      when no meaningful moves remain.
    """
    profile = get_profile(target_rank, board.size)
    stone_count = _count_stones(board)
    is_opening = stone_count < profile.get("opening_moves", 20)

    try:
        board_2d = board.to_2d()
        player = "B" if color == Color.BLACK else "W"
        # Opponent passed → settle cleanly: deeper search so KataGo reliably
        # surfaces `pass` at a settled position (low-visit profiles never search
        # pass enough to trust it). Mistake injection is also skipped below.
        analysis_visits = (
            max(profile["visits"], SETTLE_VISITS) if opponent_passed else profile["visits"]
        )
        # wideRootNoise (§3 out-of-pool, 2026-07-05): spread root visits across
        # most plausible moves so the pool contains real mistakes. Never on the
        # settle path — that analysis must stay honest.
        wide_root_noise = profile.get("wide_root_noise", 0.0)
        overrides = (
            {"wideRootNoise": wide_root_noise}
            if wide_root_noise > 0 and not opponent_passed
            else None
        )
        analysis = await engine.analyze(
            board_2d, player, max_visits=analysis_visits, size=board.size,
            moves=engine_moves, initial_stones=engine_setup,
            override_settings=overrides,
        )

        # Diagnostic logging: dump KataGo's full candidate list during the
        # opening so we can see exactly what the search returned. Helps
        # diagnose spurious passes — we can tell whether pass dominated
        # the visits, whether non-pass candidates were considered, etc.
        if is_opening:
            cand_summary = ", ".join(
                f"({'PASS' if c.move[0] < 0 else f'{c.move[0]},{c.move[1]}'} "
                f"v={c.visits} pri={c.prior:.3f} wr={c.winrate:.2f} sl={c.score_lead:.2f})"
                for c in analysis.candidates[:8]
            )
            logger.info(
                f"[{target_rank} {board.size}x{board.size}] OPENING analysis "
                f"(stone_count={stone_count}, profile_visits={profile['visits']}): "
                f"{len(analysis.candidates)} candidates: {cand_summary}"
            )

        if not analysis.candidates:
            logger.warning(f"[{target_rank} {board.size}x{board.size}] PASS: no candidates returned")
            return None

        # Filter out illegal moves before any decision logic. KataGo only sees
        # the position we send (empty `moves`), so it can recommend ko
        # recaptures and other moves our engine rejects. Without this filter
        # such moves either silently fall back to pass (state.py) or break
        # the candidate list. We keep the pass candidate (move[0] < 0) since
        # it's the legal "no move" choice.
        def _is_legal(cand) -> bool:
            if cand.move[0] < 0:
                return True
            test = board.clone()
            res, _ = test.try_play(color, Point(cand.move[0], cand.move[1]))
            return res == "ok"

        before = len(analysis.candidates)
        analysis.candidates = [c for c in analysis.candidates if _is_legal(c)]
        if len(analysis.candidates) < before:
            logger.info(
                f"[{target_rank} {board.size}x{board.size}] dropped "
                f"{before - len(analysis.candidates)} illegal candidate(s) "
                f"(likely ko)"
            )
        if not analysis.candidates:
            # Every move KataGo offered is illegal in our engine — usually a
            # ko-rule mismatch (KataGo = simple ko under japanese; our engine =
            # positional superko), so KataGo's pick repeats a past board
            # position. Passing here throws away a live game (confirmed
            # 2026-06-26). Play a legal heuristic move instead; only pass if
            # nothing legal remains.
            fallback = _pick_legal_non_eye_move(board, color)
            if fallback is not None:
                logger.info(
                    f"[{target_rank} {board.size}x{board.size}] all candidates illegal "
                    f"(likely superko) — playing legal fallback instead of passing"
                )
                return fallback
            logger.warning(
                f"[{target_rank} {board.size}x{board.size}] PASS: filtered-empty-no-legal-move"
            )
            return None

        # --- Pass detection ---
        # Pass when either:
        #  (a) KataGo's #1 move is literally pass, or
        #  (b) KataGo lists pass as a candidate AND that candidate received
        #      enough visits to trust its score, AND no other move is
        #      meaningfully better than passing (< pass_threshold points).
        # Both paths are skipped during the opening — there's no real position
        # yet, and passing on move 1 is never sensible regardless of what
        # KataGo's prior says. We saw this happen with the 30k 9x9 profile
        # (4 visits) on the deployed Linux Eigen build, which apparently
        # surfaces pass as #1 more readily than Mac Metal at the same visit
        # count.
        # The visits gate (path b) matters: at low visits a barely-searched
        # pass candidate has score_lead ≈ value-network prior (no search
        # refinement), which can be wildly off and trigger spurious passes
        # mid-fuseki. The 0.3 default is tuned for 19x19 with deep visits.
        # On smaller boards (shallower visits), pass_threshold drops to keep
        # real endgame moves above the bar.
        best = analysis.candidates[0]
        if best.move[0] < 0 and not is_opening:
            logger.warning(
                f"[{target_rank} {board.size}x{board.size}] PASS: KataGo top move is pass "
                f"(visits={best.visits}, score={best.score_lead:.2f})"
            )
            return None
        if best.move[0] < 0 and is_opening:
            # KataGo's #1 was pass during the opening — drop pass and pick
            # the best non-pass candidate to play out instead.
            non_pass_best = next((c for c in analysis.candidates if c.move[0] >= 0), None)
            if non_pass_best is None:
                logger.warning(
                    f"[{target_rank} {board.size}x{board.size}] PASS: opening but no non-pass candidates"
                )
                return None
            best = non_pass_best

        pass_threshold = profile.get("pass_threshold", 0.3)
        # Settle path uses a bar of at least 0.75: 100-visit score noise
        # exceeds a 0.10 threshold, so a dead position kept yielding
        # fractional-point "improvements" and the bot answered 20 player
        # passes with junk (GN5R6K9G, 2026-07-05). Mirrors the TS selector.
        if opponent_passed:
            pass_threshold = max(pass_threshold, 0.75)
        pass_cand = next((c for c in analysis.candidates if c.move[0] < 0), None)
        # Require pass to have at least ~10% of the top move's visits before
        # trusting its score estimate (and a hard floor of 4 visits — below
        # that, score_lead is just the value-network prior with no search
        # refinement, and the gap check is below the noise floor). This
        # specifically protects very-low-visit profiles (e.g. 30k uses 4
        # total visits) from spurious mid-fuseki passes when the KataGo
        # backend has slightly different prior distributions, which we saw
        # on the deployed Linux Eigen build vs. local Mac Metal.
        min_pass_visits = max(4, best.visits // 10)
        if (
            not is_opening
            and pass_cand is not None
            and pass_cand.visits >= min_pass_visits
            and best.score_lead - pass_cand.score_lead < pass_threshold
        ):
            logger.warning(
                f"[{target_rank} {board.size}x{board.size}] PASS: best={best.score_lead:.2f} "
                f"pass={pass_cand.score_lead:.2f} (passV={pass_cand.visits} bestV={best.visits} "
                f"thr={pass_threshold})"
            )
            return None

        # Opponent passed and a real move still beats passing (handled above):
        # play KataGo's honest top move WITHOUT mistake injection — injecting a
        # mistake here is exactly what fills own territory at game's end.
        # But if the honest best is itself an eye-fill / territory fill /
        # enclosed junk drop, the game is over — pass back (GN5R6K9G).
        if opponent_passed:
            bp = Point(best.move[0], best.move[1])
            if (
                _is_eye_fill(board, color, bp)
                or _is_own_territory_fill(board, color, bp)
                or _is_opponent_enclosed_fill(board, color, bp)
            ):
                logger.warning(
                    f"[{target_rank} {board.size}x{board.size}] PASS: settle top unplayable"
                )
                return None
            return bp

        # --- Reading-rate roll (§3 out-of-pool mechanism, 2026-07-05) ---
        # Human model: a weak player READS only some of their moves. With
        # probability (1 - reading_rate) this move is played on shape
        # intuition alone — sampled by prior with temperature over the
        # (wideRootNoise-widened) candidate list, scores ignored. Everything
        # below (clarity gates, opening top-3, machinery) is the READING
        # path and only runs for read moves — which is what lets a 15k
        # occasionally blunder a fight it never read. Small-mistake
        # frequency = 1 - reading_rate; small-mistake size = policy_temp;
        # big mistakes = the prior tail + random_move_chance.
        # A candidate the bot may actually play: on the board, not an
        # own-eye fill, not an own-territory fill (the endgame safety net —
        # the area-scoring policy prior thinks self-fills are free).
        def _playable(c) -> bool:
            # Just "not an own-eye fill". This runs during ACTIVE play only —
            # the settle path (opponent_passed) returns before we reach here,
            # so it owns the endgame territory/pass decision. Territory and
            # opponent-enclosed filtering was REMOVED from this active-play
            # path (DX4QAWTT, 2026-07-05): mid-game, a large OPEN region
            # borders a single color and the flood-fill misreads it as sealed
            # territory, so the bot filtered ~all candidates and passed
            # mid-fight. Don't judge territory while the board is still open.
            if c.move[0] < 0:
                return False
            return not _is_eye_fill(board, color, Point(c.move[0], c.move[1]))

        reading_rate = profile.get("reading_rate")
        if reading_rate is not None:
            # Read-streak cap (S50): a read move arms the cooldown; while
            # it's hot the bot MUST sample — no back-to-back engine-quality
            # moves. Mirrors the TS selector.
            cooldown = _READ_COOLDOWN.get(color, 0)
            reads = cooldown == 0 and random.random() < reading_rate
            if cooldown > 0:
                _READ_COOLDOWN[color] = cooldown - 1
            if reads:
                _READ_COOLDOWN[color] = int(profile.get("read_cooldown", 0))
                # Fall through to the reading path below.
            else:
                pool = [c for c in analysis.candidates if _playable(c)]
                # Sampling loss band (sampler v2 cap + v3 floor): a sampled
                # move loses at most sample_loss_cap points AND at least
                # sample_min_loss — never accidentally perfect (the b28
                # policy is dan-level on 9×9; without the floor ~half the
                # sampled moves landed on the engine's top pick — S50).
                # Floor yields if it would empty the pool.
                if len(pool) > 1:
                    ref = pool[0].score_lead  # pool keeps KataGo order: [0] = mover-best playable
                    cap = profile.get("sample_loss_cap")
                    if cap is not None:
                        capped = [c for c in pool if abs(ref - c.score_lead) <= cap]
                        if capped:
                            pool = capped
                    floor = profile.get("sample_min_loss")
                    if floor is not None:
                        banded = [c for c in pool if abs(ref - c.score_lead) >= floor]
                        if banded:
                            pool = banded
                if pool:
                    sel = _sample_by_prior(
                        pool, profile.get("policy_temp", 1.0), profile.get("sample_lapse", 0.0)
                    )
                    return Point(sel.move[0], sel.move[1])
                # Nothing samplable — fall through to the reading path.

        # --- Tactical clarity gate ---
        # If KataGo is clearly confident about one move, skip mistake
        # injection and play it. This catches straightforward life/death
        # and capture situations where real humans above 15k-ish don't
        # waver: even a 6k who misplays the opening will still capture
        # a dead group in atari. The mistake mechanism assumes positions
        # have multiple reasonable moves — in tactical moments they don't.
        # Signals of clarity:
        #   (a) top candidate's policy prior >= clarity_prior (concentrated)
        #   (b) score gap to second candidate >= clarity_score_gap (critical)
        # Set the thresholds high (e.g. 1.1 / 999) on a profile to disable
        # the gate so even tactical positions go through mistake injection —
        # appropriate for 30k where the player is meant to miss obvious moves.
        clarity_prior = profile.get("clarity_prior", 0.5)
        clarity_score_gap = profile.get("clarity_score_gap", 5.0)
        if best.prior >= clarity_prior:
            return Point(best.move[0], best.move[1])
        non_pass = [c for c in analysis.candidates if c.move[0] >= 0]
        if len(non_pass) >= 2 and non_pass[0].score_lead - non_pass[1].score_lead >= clarity_score_gap:
            return Point(non_pass[0].move[0], non_pass[0].move[1])

        # --- OPENING: play sensibly ---
        if is_opening:
            # Pick from top 3 candidates with slight randomness
            top_moves = [c for c in analysis.candidates[:3] if c.move[0] >= 0]
            if top_moves:
                # Weight by visits (KataGo's confidence)
                w = [c.visits for c in top_moves]
                selected = random.choices(top_moves, weights=w, k=1)[0]
                return Point(selected.move[0], selected.move[1])

        # --- Random move injection (rare) ---
        # Through the strict picker, NOT raw _pick_random_legal: at 18k this
        # branch fires on 30% of moves and unfiltered it fills territory /
        # dives into sealed areas instead of letting the game end.
        if random.random() < profile["random_move_chance"]:
            rand_move = _pick_legal_non_eye_move(board, color)
            if rand_move:
                return rand_move

        # --- Local bias (also applies in opening for very-reactive profiles) ---
        # Beginners tend to respond directly to whatever the opponent just
        # played. Prefer the opponent's last move as anchor; fall back to a
        # random recent stone if we don't know it (e.g. opening move 1).
        # Profiles that want this even during the opening (e.g. 30k) can set
        # `local_bias_in_opening: True`.
        local_bias_active = (
            random.random() < profile["local_bias"]
            and (not is_opening or profile.get("local_bias_in_opening", False))
        )
        if local_bias_active:
            sz = board.size
            anchor: Optional[Point] = None
            if last_opponent_move is not None and last_opponent_move.is_valid(sz):
                anchor = last_opponent_move
            else:
                occupied = [Point(r, c) for r in range(sz)
                           for c in range(sz) if board.get(Point(r, c)) != Color.EMPTY]
                if occupied:
                    anchor = random.choice(occupied[-10:])
            if anchor is not None:
                if profile.get("local_bias_from_candidates", False):
                    # Myopic mode (§3, 2026-07-04): play a KataGo candidate
                    # near the anchor — locally plausible, globally maybe
                    # wrong, which is how weak humans actually play. No local
                    # candidate → fall through to normal selection instead of
                    # inventing a move.
                    # §3 iter 2: on 9×9 the strongest local candidate usually
                    # IS the global best, so with `score_noise` set we pick
                    # the noisy best among locals instead (see below).
                    locals_ = [
                        c for c in analysis.candidates
                        if c.move[0] >= 0
                        and max(
                            abs(c.move[0] - anchor.row),
                            abs(c.move[1] - anchor.col),
                        ) <= 2
                    ]
                    if locals_:
                        noise = profile.get("score_noise", 0.0)
                        local_cand = _pick_noisy_best(locals_, noise) if noise > 0 else locals_[0]
                        return Point(local_cand.move[0], local_cand.move[1])
                else:
                    nearby = _get_nearby_moves(board, color, anchor, radius=2)
                    if nearby:
                        return random.choice(nearby)

        # --- KataGo candidate selection with rank-based mistakes ---
        size = board.size
        best_score = analysis.candidates[0].score_lead

        # Filter candidates within acceptable point loss
        filtered = []
        for c in analysis.candidates[:profile["min_candidates"] + 5]:
            if not _playable(c):
                continue
            point_loss = abs(best_score - c.score_lead)
            if point_loss <= profile["max_point_loss"]:
                filtered.append((c, point_loss))

        # Also drop candidates strictly worse than passing. Without this,
        # the mistake mechanism can pick an endgame move that fills own
        # territory/liberty when passing is strictly better. Only apply
        # this filter when pass has enough visits to trust its score —
        # otherwise a barely-searched pass with a noisy estimate can wipe
        # out every legitimate move.
        if pass_cand is not None and pass_cand.visits >= min_pass_visits:
            filtered = [
                (c, pl) for (c, pl) in filtered
                if c.score_lead >= pass_cand.score_lead - pass_threshold
            ]

        if not filtered:
            # No playable candidate survived the max-point-loss filter.
            # Prefer the best non-eye-fill candidate over the raw top.
            c = next((x for x in analysis.candidates if _playable(x)), None)
            if c is not None:
                return Point(c.move[0], c.move[1])
            top = analysis.candidates[0]
            if top.move[0] >= 0:
                # Every candidate is an own-eye fill — but the board may still
                # be live. Play any legal non-eye move if one exists; pass only
                # when the whole board is own-eye fills (genuinely dead).
                rescue = _pick_legal_non_eye_move(board, color)
                if rescue is not None:
                    return rescue
                logger.warning(
                    f"[{target_rank} {board.size}x{board.size}] PASS: only eye-fill moves left"
                )
            return None

        # --- score_noise path (§3 iter 2): noisy-argmax replaces the
        # mistake-weighting machinery entirely when set. The clarity gates
        # above still short-circuit genuinely forced moves.
        score_noise = profile.get("score_noise", 0.0)
        if score_noise > 0:
            sel = _pick_noisy_best([c for c, _ in filtered], score_noise)
            return Point(sel.move[0], sel.move[1])

        # Build selection weights
        weights = []
        for c, point_loss in filtered:
            # Policy influence
            policy_w = max(c.prior, 0.001) ** profile["policy_weight"]

            # Mistake injection
            if random.random() < profile["mistake_freq"]:
                # When making a mistake, prefer moves that are moderately bad
                # (not the best, not catastrophic — the kind of mistake a human makes)
                if point_loss > 0:
                    # Bell curve centered around 30-50% of max allowed loss
                    sweet_spot = profile["max_point_loss"] * 0.35
                    mistake_w = math.exp(-((point_loss - sweet_spot) ** 2) / (2 * sweet_spot ** 2))
                else:
                    mistake_w = 0.3  # Slightly de-prioritize best move
            else:
                # Normal play: strongly prefer good moves
                mistake_w = math.exp(-point_loss * 0.8)

            # Random jitter
            jitter = 0.3 + 0.7 * (random.random() ** (1 - profile["randomness"]))

            weight = policy_w * mistake_w * jitter
            weights.append(weight)

        total = sum(weights)
        if total == 0:
            selected = filtered[0][0]
        else:
            weights = [w / total for w in weights]
            selected = random.choices(
                [c for c, _ in filtered],
                weights=weights,
                k=1,
            )[0]

        return Point(selected.move[0], selected.move[1])

    except Exception:
        # Full traceback, not just str(e): this clause silently hid a
        # NameError (missing opponent_passed param) from 2026-06-04 to
        # 2026-07-03 — a month of the web bot playing pure random-legal
        # moves while the log line blended in with real KataGo hiccups.
        logger.exception("KataGo analysis failed — falling back to random-legal")
        return _pick_random_legal(board, color)
