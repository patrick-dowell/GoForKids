"""
Phase 1 rank-calibrated move selection.

Uses KataGo analysis when available, with heuristic-based move sampling
to simulate play at a target rank level.

Without KataGo: random legal moves with center bias (stub).
With KataGo: rank-aware sampling from KataGo's candidate moves.
"""

from __future__ import annotations
import math
import random
import logging
from typing import Optional

from app.game.engine import Board, Color, Point, BOARD_SIZE
from app.katago.engine import get_engine, PositionAnalysis

logger = logging.getLogger(__name__)

# Rank-specific tuning parameters
# key: rank string, value: dict of tuning knobs
RANK_PROFILES = {
    "15k": {
        "max_point_loss": 15.0,    # Allow large mistakes
        "mistake_freq": 0.45,       # 45% of moves are non-optimal
        "policy_weight": 0.3,       # Low policy following
        "randomness": 0.7,          # High randomness
        "min_candidates": 10,       # Consider many candidates
    },
    "12k": {
        "max_point_loss": 12.0,
        "mistake_freq": 0.35,
        "policy_weight": 0.4,
        "randomness": 0.5,
        "min_candidates": 8,
    },
    "10k": {
        "max_point_loss": 8.0,
        "mistake_freq": 0.28,
        "policy_weight": 0.5,
        "randomness": 0.4,
        "min_candidates": 7,
    },
    "8k": {
        "max_point_loss": 5.0,
        "mistake_freq": 0.20,
        "policy_weight": 0.6,
        "randomness": 0.3,
        "min_candidates": 6,
    },
    "5k": {
        "max_point_loss": 3.0,
        "mistake_freq": 0.12,
        "policy_weight": 0.75,
        "randomness": 0.2,
        "min_candidates": 5,
    },
    "3k": {
        "max_point_loss": 2.0,
        "mistake_freq": 0.07,
        "policy_weight": 0.85,
        "randomness": 0.1,
        "min_candidates": 4,
    },
}


def get_profile(rank: str) -> dict:
    """Get the rank profile, defaulting to 15k if unknown."""
    return RANK_PROFILES.get(rank, RANK_PROFILES["15k"])


async def select_ai_move(
    board: Board, color: Color, target_rank: str
) -> Optional[Point]:
    """
    Select a move for the AI at the given target rank.

    Tries KataGo first; falls back to random stub.
    """
    engine = await get_engine()

    if engine:
        return await _select_with_katago(engine, board, color, target_rank)
    else:
        return _select_random(board, color, target_rank)


async def _select_with_katago(
    engine, board: Board, color: Color, target_rank: str
) -> Optional[Point]:
    """
    KataGo-backed rank-calibrated move selection.

    Process:
    1. Get top N candidate moves from KataGo with evaluations
    2. Build a selection distribution based on target rank:
       - Higher ranks: higher probability of best moves
       - Lower ranks: spread probability across suboptimal moves
    3. Filter out catastrophic blunders
    4. Sample from the distribution
    """
    profile = get_profile(target_rank)

    try:
        board_2d = board.to_2d()
        player = "B" if color == Color.BLACK else "W"
        analysis = await engine.analyze(board_2d, player)

        if not analysis.candidates:
            return None

        # Check if KataGo thinks passing is best or nearly best
        # If the best move gains less than 0.5 points, pass instead
        # This prevents the AI from filling its own territory at the endgame
        best = analysis.candidates[0]
        if best.move[0] < 0:
            # KataGo's top move is pass — respect that
            return None

        # Check if best move's score gain vs passing is negligible
        pass_candidate = next((c for c in analysis.candidates if c.move[0] < 0), None)
        if pass_candidate:
            gain_vs_pass = best.score_lead - pass_candidate.score_lead
            if gain_vs_pass < 0.5:
                logger.info(f"AI passing: best move gains only {gain_vs_pass:.1f} vs pass")
                return None

        # Also pass if the score swing of the best move is tiny and we're deep into the game
        # (heuristic: if all top candidates are within 0.3 pts of each other, board is settled)
        top_3 = analysis.candidates[:min(3, len(analysis.candidates))]
        score_spread = max(c.score_lead for c in top_3) - min(c.score_lead for c in top_3)
        if score_spread < 0.3 and best.visits > 20:
            logger.info(f"AI passing: top moves all within {score_spread:.2f} pts, game is settled")
            return None

        # Filter candidates by max point loss
        best_score = analysis.candidates[0].score_lead
        filtered = []
        for c in analysis.candidates[:profile["min_candidates"] + 5]:
            point_loss = abs(best_score - c.score_lead)
            if point_loss <= profile["max_point_loss"]:
                filtered.append((c, point_loss))

        if not filtered:
            # All moves are catastrophic — play the best one
            c = analysis.candidates[0]
            if c.move[0] < 0:
                return None
            return Point(c.move[0], c.move[1])

        # Build selection weights
        weights = []
        for c, point_loss in filtered:
            # Base weight from policy prior
            policy_w = c.prior ** profile["policy_weight"]

            # Mistake bias: moves with moderate point loss get boosted at low ranks
            if random.random() < profile["mistake_freq"] and point_loss > 0:
                # Occasionally pick a suboptimal move
                mistake_w = math.exp(-point_loss / (profile["max_point_loss"] * 0.5))
            else:
                # Prefer good moves
                mistake_w = math.exp(-point_loss * 2)

            # Randomness factor
            random_w = random.random() ** (1 - profile["randomness"])

            weight = policy_w * mistake_w * random_w
            weights.append(weight)

        # Normalize and sample
        total = sum(weights)
        if total == 0:
            # Fallback
            selected = filtered[0][0]
        else:
            weights = [w / total for w in weights]
            selected = random.choices(
                [c for c, _ in filtered],
                weights=weights,
                k=1,
            )[0]

        if selected.move[0] < 0:  # pass
            return None

        return Point(selected.move[0], selected.move[1])

    except Exception as e:
        logger.error(f"KataGo analysis failed: {e}")
        return _select_random(board, color, target_rank)


def _select_random(
    board: Board, color: Color, target_rank: str
) -> Optional[Point]:
    """
    Stub move selector: random legal moves with center bias.
    Used when KataGo is not available.
    """
    legal_moves: list[Point] = []
    for row in range(BOARD_SIZE):
        for col in range(BOARD_SIZE):
            p = Point(row, col)
            test_board = board.clone()
            result, _ = test_board.try_play(color, p)
            if result == "ok":
                legal_moves.append(p)

    if not legal_moves:
        return None

    def center_weight(p: Point) -> float:
        dr = abs(p.row - 9)
        dc = abs(p.col - 9)
        return 1.0 / (1.0 + dr + dc)

    weights = [center_weight(p) for p in legal_moves]
    total = sum(weights)
    weights = [w / total for w in weights]

    return random.choices(legal_moves, weights=weights, k=1)[0]
