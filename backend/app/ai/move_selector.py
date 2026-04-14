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


def edge_distance(row: int, col: int) -> int:
    """Distance from the nearest board edge."""
    return min(row, col, BOARD_SIZE - 1 - row, BOARD_SIZE - 1 - col)


from app.katago.engine import get_engine, PositionAnalysis

logger = logging.getLogger(__name__)

# Rank-specific tuning parameters
# Revised after playtesting: previous version was too chaotic.
# 15k should feel like "a player who knows the rules and basic shapes
# but makes strategic errors and can't read more than 2-3 moves."
RANK_PROFILES = {
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
        "max_point_loss": 15.0,
        "mistake_freq": 0.32,
        "policy_weight": 0.40,
        "randomness": 0.50,
        "random_move_chance": 0.03,
        "local_bias": 0.18,
        "first_line_chance": 0.0,
        "visits": 50,
        "min_candidates": 10,
        "opening_moves": 25,
    },
    "10k": {
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
    "8k": {
        "max_point_loss": 6.0,
        "mistake_freq": 0.18,
        "policy_weight": 0.60,
        "randomness": 0.30,
        "random_move_chance": 0.01,
        "local_bias": 0.08,
        "first_line_chance": 0.0,
        "visits": 120,
        "min_candidates": 7,
        "opening_moves": 15,
    },
    "5k": {
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
    "3k": {
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


def get_profile(rank: str) -> dict:
    return RANK_PROFILES.get(rank, RANK_PROFILES["15k"])


def _get_nearby_moves(board: Board, color: Color, center: Point, radius: int = 3) -> list[Point]:
    """Get legal moves within `radius` intersections of `center`."""
    moves = []
    for dr in range(-radius, radius + 1):
        for dc in range(-radius, radius + 1):
            r, c = center.row + dr, center.col + dc
            if 0 <= r < BOARD_SIZE and 0 <= c < BOARD_SIZE:
                p = Point(r, c)
                test = board.clone()
                result, _ = test.try_play(color, p)
                if result == "ok":
                    moves.append(p)
    return moves


def _pick_random_legal(board: Board, color: Color) -> Optional[Point]:
    """Pick a random legal move with preference for 3rd/4th line."""
    moves = []
    weights = []
    for row in range(BOARD_SIZE):
        for col in range(BOARD_SIZE):
            p = Point(row, col)
            test = board.clone()
            result, _ = test.try_play(color, p)
            if result == "ok":
                moves.append(p)
                ed = edge_distance(row, col)
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
    board: Board, color: Color, target_rank: str
) -> Optional[Point]:
    """Select a move for the AI at the given target rank."""
    engine = await get_engine()
    if engine:
        return await _select_with_katago(engine, board, color, target_rank)
    else:
        return _pick_random_legal(board, color)


async def _select_with_katago(
    engine, board: Board, color: Color, target_rank: str
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
    profile = get_profile(target_rank)
    stone_count = _count_stones(board)
    is_opening = stone_count < profile.get("opening_moves", 20)

    try:
        board_2d = board.to_2d()
        player = "B" if color == Color.BLACK else "W"
        analysis = await engine.analyze(board_2d, player, max_visits=profile["visits"])

        if not analysis.candidates:
            return None

        # --- Pass detection ---
        best = analysis.candidates[0]
        if best.move[0] < 0:
            return None

        pass_candidate = next((c for c in analysis.candidates if c.move[0] < 0), None)
        if pass_candidate:
            gain_vs_pass = best.score_lead - pass_candidate.score_lead
            if gain_vs_pass < 0.5:
                return None

        top_3 = analysis.candidates[:min(3, len(analysis.candidates))]
        score_spread = max(c.score_lead for c in top_3) - min(c.score_lead for c in top_3)
        if score_spread < 0.3 and best.visits > 10:
            return None

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

        # --- Local bias (midgame only) ---
        if not is_opening and random.random() < profile["local_bias"]:
            # Find stones near the last-played area and respond locally
            occupied = [Point(r, c) for r in range(BOARD_SIZE)
                       for c in range(BOARD_SIZE) if board.get(Point(r, c)) != Color.EMPTY]
            if occupied:
                anchor = random.choice(occupied[-10:])  # Bias toward recent stones
                nearby = _get_nearby_moves(board, color, anchor, radius=2)
                if nearby:
                    return random.choice(nearby)

        # --- KataGo candidate selection with rank-based mistakes ---
        best_score = analysis.candidates[0].score_lead

        # Filter candidates within acceptable point loss
        filtered = []
        for c in analysis.candidates[:profile["min_candidates"] + 5]:
            if c.move[0] < 0:
                continue
            point_loss = abs(best_score - c.score_lead)
            if point_loss <= profile["max_point_loss"]:
                filtered.append((c, point_loss))

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
