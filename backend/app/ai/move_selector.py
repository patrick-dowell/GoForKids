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

logger = logging.getLogger(__name__)

# Rank-specific tuning parameters, indexed by board size.
# 19x19 is the canonical, well-calibrated set. Smaller boards override only
# the few ranks we expose in the picker (30k / 15k / 6k); other ranks fall
# back to the 19x19 profile so existing callers don't break.
#
# Why size-specific overrides exist: same visit count is effectively stronger
# on smaller boards (smaller search space). Without overrides, a "30k bot"
# on 9x9 plays closer to a 12-15k. The small-board profiles below are
# first-pass guesses, intentionally weakened, and need playtesting to dial in.
RANK_PROFILES_19 = {
    "30k": {
        # Weakest KataGo bot. Target: 50/50 vs 18k at 9 handicap stones.
        # v1: 5 visits, 65% mistakes → 17% win rate (too weak)
        # v2: more visits, fewer random moves, still lots of mistakes
        "max_point_loss": 30.0,
        "mistake_freq": 0.55,
        "policy_weight": 0.15,
        "randomness": 0.78,
        "random_move_chance": 0.08,
        "local_bias": 0.42,
        "first_line_chance": 0.0,
        "visits": 10,
        "min_candidates": 15,
        "opening_moves": 8,
    },
    "18k": {
        # Weak but not random. Uses KataGo with very shallow search.
        # Target: loses to 15k ~75-80% of the time at even games.
        # v1: 60% loss rate (too strong). v2: 100% (too weak). v3: split the diff.
        "max_point_loss": 28.0,
        "mistake_freq": 0.55,
        "policy_weight": 0.18,
        "randomness": 0.76,
        "random_move_chance": 0.12,
        "local_bias": 0.38,
        "first_line_chance": 0.0,
        "visits": 12,
        "min_candidates": 15,
        "opening_moves": 12,
    },
    "15k": {
        "max_point_loss": 20.0,     # Allow big mistakes, but not suicidal
        "mistake_freq": 0.40,       # 40% of moves pick a suboptimal candidate
        "policy_weight": 0.30,      # Loosely follows KataGo policy
        "randomness": 0.60,         # Moderate randomness in candidate selection
        "random_move_chance": 0.05, # 5% truly random (rare — not every other move)
        "local_bias": 0.25,         # 25% local response (midgame only, not opening)
        "first_line_chance": 0.0,   # No first-line injection (too disruptive)
        "visits": 30,               # Enough for basic shape, not enough for deep reading
        "min_candidates": 12,
        "opening_moves": 30,        # First 30 moves: play KataGo top-3 only (sensible opening)
    },
    "12k": {
        # v1 (interpolated): even 75%, H3 71%, match-rate not measured.
        # v2: weakened globally for better H3 → even 71%, H3 62%, but
        #   match-rate against real 12k Fox games dropped to 15% exact /
        #   23% close / 33% same area. Too random in midgame/endgame.
        # v3 (reverted): over-weakened, games stalled past move 400.
        # v4 (current): dial back pure noise (randomness, random_move_chance)
        #   and tighten KataGo following (higher policy_weight) while
        #   keeping the bell-curve mistake mechanism — moderate errors
        #   that match real 12k patterns instead of random chaos.
        #   Even 75%, H3 62%, exact 15% / close 25% / same-area 43% /
        #   quadrant 53% / midgame exact 20% (near 15k's 21%).
        "max_point_loss": 17.0,
        "mistake_freq": 0.34,
        "policy_weight": 0.42,
        "randomness": 0.45,
        "random_move_chance": 0.02,
        "local_bias": 0.20,
        "first_line_chance": 0.0,
        "visits": 42,
        "min_candidates": 10,
        "opening_moves": 22,
    },
    # NOTE: The four profiles below were renamed 2026-04-23 to land on a
    # uniform 3-rank progression (30k → 18k → 15k → 12k → 9k → 6k → 3k → 1d).
    # Parameters started as the old 10k/8k/5k/3k interpolated profiles.
    # 9k was validated at those inherited parameters on 2026-04-23 and
    # shipped without tuning. 6k, 3k, 1d still need calibration.
    "9k": {  # Boulder
        # v1 (inherited): 81% vs 12k / 50% H3 / 20% match. Validated but
        #   dropped groups occasionally in playtest at visits=80.
        # v2-v4 (abandoned): tried bumping visits to 120/140 + tuning
        #   mistake params to bridge the new stronger 6k. Every version
        #   lost 88-100% against 6k v4 because the universal clarity gate
        #   flattens "clear" positions — rank gap then has to come from
        #   unclear positions, where 9k at deep visits plays nearly as
        #   well as 6k at slightly deeper visits.
        # v5 (current): back to v1 parameters. The universal clarity gate
        #   and pass fix already address the "drops a group to an obvious
        #   one-move blunder" case that was the real playtest complaint.
        #   What 9k should still do (and does, at visits=80) is misread
        #   mid-tactical positions that 6k at visits=150 handles. That's
        #   the 3-rank gap expressed through tactical depth.
        "max_point_loss": 10.0,
        "mistake_freq": 0.25,
        "policy_weight": 0.50,
        "randomness": 0.40,
        "random_move_chance": 0.02,
        "local_bias": 0.12,
        "first_line_chance": 0.0,
        "visits": 80,
        "min_candidates": 8,
        "opening_moves": 20,
    },
    "6k": {  # Ember
        # v1 (inherited from old 8k): 88% even / 88% H3 — too strong.
        # v2: 81% even / 50% H3 / 18.5% match — blundered large groups
        #   in playtest.
        # v3: visits 150 + clarity gate — fixed blunders, too strong.
        # v4: visits 150 + bell-curve mistakes at 32% / max 11pts —
        #   25% match rate (on par with 15k baseline), but human
        #   playtest said mistakes felt "too drastic" / artificial,
        #   and the bot felt "a bit stronger than 6k" overall.
        # v5 (current): lean on natural tactical limitations instead of
        #   injected mistakes. visits down to 120 (still deep enough
        #   for clarity gate + pass fix to block obvious blunders, but
        #   shallower reads occasionally miss things). mistake_freq and
        #   max_point_loss both down — fewer artificial errors. policy
        #   tighter, randomness lower. Imperfection should now feel more
        #   like "didn't see that ladder deeply enough" than "deliberately
        #   picked a 4-point-worse move."
        "max_point_loss": 9.0,
        "mistake_freq": 0.22,
        "policy_weight": 0.50,
        "randomness": 0.38,
        "random_move_chance": 0.02,
        "local_bias": 0.08,
        "first_line_chance": 0.0,
        "visits": 120,
        "min_candidates": 8,
        "opening_moves": 18,
    },
    "3k": {  # Storm — was 5k
        "max_point_loss": 4.0,
        "mistake_freq": 0.10,
        "policy_weight": 0.75,
        "randomness": 0.18,
        "random_move_chance": 0.0,
        "local_bias": 0.03,
        "first_line_chance": 0.0,
        "visits": 200,
        "min_candidates": 6,
        "opening_moves": 10,
    },
    "1d": {  # Void — was 3k
        "max_point_loss": 2.5,
        "mistake_freq": 0.06,
        "policy_weight": 0.85,
        "randomness": 0.10,
        "random_move_chance": 0.0,
        "local_bias": 0.0,
        "first_line_chance": 0.0,
        "visits": 300,
        "min_candidates": 5,
        "opening_moves": 5,
    },
}


# Small-board overrides — only the 3 ranks we surface in the picker on 9/13.
# These are FIRST-PASS GUESSES — calibrate via play, not formal harness yet.
# Heuristic: cut visits, bump randomness/random_move_chance for the weakest
# tier, shorten opening_moves to match shorter games.
# pass_threshold note: smaller than the 19x19 default of 0.3 because shallow
# visits on small boards add noise to score estimates — at 0.3, the bot reads
# a real ~1pt endgame move as ~0.25 above pass and passes prematurely.
RANK_PROFILES_13 = {
    "30k": {
        # 19x19's 30k profile felt too strong on 13x13 (smaller search space).
        # Weaken: cut visits, disable clarity gate so mistake injection
        # applies in tactical positions, push local_bias high so the bot
        # mostly responds to the player's last move rather than surveying.
        "max_point_loss": 35.0,
        "mistake_freq": 0.65,
        "policy_weight": 0.10,
        "randomness": 0.85,
        "random_move_chance": 0.15,
        "local_bias": 0.80,
        "local_bias_in_opening": True,
        "first_line_chance": 0.0,
        "visits": 5,
        "min_candidates": 12,
        "opening_moves": 4,
        "pass_threshold": 0.15,
        "clarity_prior": 1.1,
        "clarity_score_gap": 999.0,
    },
    "15k": {
        "max_point_loss": 22.0,
        "mistake_freq": 0.42,
        "policy_weight": 0.28,
        "randomness": 0.62,
        "random_move_chance": 0.06,
        "local_bias": 0.22,
        "first_line_chance": 0.0,
        "visits": 18,
        "min_candidates": 10,
        "opening_moves": 8,
        "pass_threshold": 0.15,
    },
    "6k": {
        "max_point_loss": 9.0,
        "mistake_freq": 0.22,
        "policy_weight": 0.50,
        "randomness": 0.38,
        "random_move_chance": 0.02,
        "local_bias": 0.08,
        "first_line_chance": 0.0,
        "visits": 70,
        "min_candidates": 8,
        "opening_moves": 6,
        "pass_threshold": 0.15,
    },
}

RANK_PROFILES_9 = {
    "30k": {
        # User playtest 2026-04-24: even 4-visit KataGo with bumped randomness
        # was too strong for a beginner because the clarity gate forced the
        # best tactical move whenever policy >= 0.5 (very common on 9x9).
        # Disable the clarity gate (huge thresholds) so mistake injection
        # actually applies in tactical positions — the bot will sometimes
        # miss obvious captures or atari saves, like a real 30k.
        # Also: very high local_bias + reactive-in-opening so the bot mostly
        # plays adjacent to whatever the player just played, rather than
        # surveying the whole board for the best move. That's how absolute
        # beginners actually behave.
        "max_point_loss": 30.0,
        "mistake_freq": 0.70,
        "policy_weight": 0.08,
        "randomness": 0.88,
        "random_move_chance": 0.20,  # down from 0.30 — local bias carries weakening now
        "local_bias": 0.85,
        "local_bias_in_opening": True,
        "first_line_chance": 0.0,
        "visits": 4,
        "min_candidates": 10,
        "opening_moves": 2,
        "pass_threshold": 0.10,
        "clarity_prior": 1.1,       # never triggers (prior is in [0,1])
        "clarity_score_gap": 999.0, # never triggers
    },
    "15k": {
        "max_point_loss": 18.0,
        "mistake_freq": 0.45,
        "policy_weight": 0.25,
        "randomness": 0.65,
        "random_move_chance": 0.08,
        "local_bias": 0.18,
        "first_line_chance": 0.0,
        "visits": 12,
        "min_candidates": 8,
        "opening_moves": 4,
        "pass_threshold": 0.10,
    },
    "6k": {
        # User playtest: 6k was passing while real endgame moves remained.
        # Lower threshold catches them despite shallow-visit estimate noise.
        "max_point_loss": 8.0,
        "mistake_freq": 0.22,
        "policy_weight": 0.50,
        "randomness": 0.38,
        "random_move_chance": 0.02,
        "local_bias": 0.06,
        "first_line_chance": 0.0,
        "visits": 50,
        "min_candidates": 6,
        "opening_moves": 3,
        "pass_threshold": 0.10,
    },
}

RANK_PROFILES_BY_SIZE = {
    9: RANK_PROFILES_9,
    13: RANK_PROFILES_13,
    19: RANK_PROFILES_19,
}

# Backwards-compat alias for callers that imported RANK_PROFILES (defaults to 19x19).
RANK_PROFILES = RANK_PROFILES_19


def get_profile(rank: str, size: int = 19) -> dict:
    """Look up the bot tuning profile for a rank and board size.
    Falls back to the 19x19 profile when there is no size-specific override
    (smaller boards only override 30k / 15k / 6k)."""
    sized = RANK_PROFILES_BY_SIZE.get(size)
    if sized and rank in sized:
        return sized[rank]
    return RANK_PROFILES_19.get(rank, RANK_PROFILES_19["15k"])


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

        if not analysis.candidates:
            logger.info(f"[{target_rank} {board.size}x{board.size}] PASS: no candidates returned")
            return None

        # --- Pass detection ---
        # Pass when either:
        #  (a) KataGo's #1 move is literally pass, or
        #  (b) KataGo lists pass as a candidate AND that candidate received
        #      enough visits to trust its score, AND no other move is
        #      meaningfully better than passing (< pass_threshold points).
        # The visits gate matters: at low visits a barely-searched pass
        # candidate has score_lead ≈ value-network prior (no search refinement),
        # which can be wildly off and trigger spurious passes mid-fuseki.
        # The 0.3 default is tuned for 19x19 with deep visits. On smaller
        # boards (shallower visits), pass_threshold drops to keep real
        # endgame moves above the bar.
        best = analysis.candidates[0]
        if best.move[0] < 0:
            logger.info(
                f"[{target_rank} {board.size}x{board.size}] PASS: KataGo top move is pass "
                f"(visits={best.visits}, score={best.score_lead:.2f})"
            )
            return None

        pass_threshold = profile.get("pass_threshold", 0.3)
        pass_cand = next((c for c in analysis.candidates if c.move[0] < 0), None)
        # Require pass to have at least ~10% of the top move's visits before
        # trusting its score estimate (and a hard floor of 2 visits).
        min_pass_visits = max(2, best.visits // 10)
        if (
            pass_cand is not None
            and pass_cand.visits >= min_pass_visits
            and best.score_lead - pass_cand.score_lead < pass_threshold
        ):
            logger.info(
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
