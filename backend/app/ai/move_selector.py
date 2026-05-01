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

    # Check diagonals — at least 3 of 4 must be our color (or off-board)
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
        else:
            friendly_diags += 1  # Board edge counts as friendly

    # For corner eyes (2 diags), need both. For edge (3), need 2+. For center (4), need 3+.
    return friendly_diags >= max(total_diags - 1, 1) if total_diags > 0 else True


from app.katago.engine import get_engine, PositionAnalysis
from app.ai.profile_loader import get_profile

logger = logging.getLogger(__name__)

# Bot tuning parameters used to live as RANK_PROFILES_* dicts here. They now
# live in data/profiles/*.yaml and are loaded via profile_loader.get_profile().
# Tuning rationale per profile lives in AI_CALIBRATION.md.


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


def _count_stones(board: Board) -> int:
    """Count total stones on the board (proxy for move number)."""
    return sum(1 for c in board.grid if c != Color.EMPTY)


async def select_ai_move(
    board: Board, color: Color, target_rank: str,
    last_opponent_move: Optional[Point] = None,
) -> Optional[Point]:
    """Select a move for the AI at the given target rank.

    `last_opponent_move` is the location of the most recent opponent stone, used
    as a preferred anchor for local-bias play (beginner bots respond locally).
    """
    move = await _select_ai_move_inner(board, color, target_rank, last_opponent_move)

    # Safety check: NEVER fill your own eye. No human above 30k does this.
    if move and _is_eye_fill(board, color, move):
        logger.info(f"[{target_rank}] Rejected eye-filling move at ({move.row},{move.col})")
        # Try to find a non-eye-filling alternative
        for _ in range(5):
            alt = await _select_ai_move_inner(board, color, target_rank, last_opponent_move)
            if alt and not _is_eye_fill(board, color, alt):
                return alt
        # All attempts fill eyes — just pass
        logger.warning(f"[{target_rank} {board.size}x{board.size}] PASS: 5 alternatives all filled eyes")
        return None

    return move


async def _select_ai_move_inner(
    board: Board, color: Color, target_rank: str,
    last_opponent_move: Optional[Point] = None,
) -> Optional[Point]:
    """Inner move selection (before eye-fill safety check)."""
    profile = get_profile(target_rank, board.size)

    # 30k bot: pure heuristic, no KataGo needed
    if not profile.get("use_katago", True):
        return _select_beginner_move(board, color, profile)

    engine = await get_engine()
    if engine:
        return await _select_with_katago(engine, board, color, target_rank, last_opponent_move)
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
        analysis = await engine.analyze(
            board_2d, player, max_visits=profile["visits"], size=board.size,
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
            logger.warning(
                f"[{target_rank} {board.size}x{board.size}] PASS: all candidates illegal"
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
        if random.random() < profile["random_move_chance"]:
            rand_move = _pick_random_legal(board, color)
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
                nearby = _get_nearby_moves(board, color, anchor, radius=2)
                if nearby:
                    return random.choice(nearby)

        # --- KataGo candidate selection with rank-based mistakes ---
        size = board.size
        best_score = analysis.candidates[0].score_lead

        # Filter candidates within acceptable point loss
        filtered = []
        for c in analysis.candidates[:profile["min_candidates"] + 5]:
            if c.move[0] < 0:
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
            c = analysis.candidates[0]
            if c.move[0] < 0:
                return None
            return Point(c.move[0], c.move[1])

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

    except Exception as e:
        logger.error(f"KataGo analysis failed: {e}")
        return _pick_random_legal(board, color)
