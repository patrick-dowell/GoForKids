"""
Study mode: game analysis + Claude API narrative explanations.

Process:
1. KataGo analyzes every move at high visit count
2. Extract per-move metrics (winrate delta, score delta, mistake type)
3. Identify 3-7 critical moments (biggest swings)
4. Claude API generates plain-language explanations, tone-calibrated to rank
"""

from __future__ import annotations
import logging
from typing import Optional
from dataclasses import dataclass

from app.katago.engine import get_engine, PositionAnalysis, gtp_to_point
from app.game.engine import Board, Color, Point, BOARD_SIZE

logger = logging.getLogger(__name__)


@dataclass
class MoveEval:
    move_number: int
    color: str  # "black" or "white"
    point: Optional[tuple[int, int]]  # (row, col) or None for pass
    winrate_before: float
    winrate_after: float
    score_before: float
    score_after: float
    score_delta: float
    is_critical: bool
    mistake_type: Optional[str]
    best_move: Optional[tuple[int, int]]
    best_move_score: float
    alternatives: list[dict]


# Mistake classification thresholds
MISTAKE_THRESHOLDS = {
    "blunder": 8.0,      # > 8 point loss
    "mistake": 4.0,       # > 4 point loss
    "inaccuracy": 2.0,    # > 2 point loss
}


def classify_mistake(score_delta: float, position_context: dict = {}) -> Optional[str]:
    """Classify a mistake by type based on score loss and context."""
    loss = abs(score_delta)

    if loss < MISTAKE_THRESHOLDS["inaccuracy"]:
        return None

    # Simple classification — can be enriched with position analysis
    if loss >= MISTAKE_THRESHOLDS["blunder"]:
        return "blunder"
    elif loss >= MISTAKE_THRESHOLDS["mistake"]:
        return "mistake"
    else:
        return "inaccuracy"


async def analyze_game(
    moves: list[dict],  # [{color, row, col}]
    komi: float = 7.5,
    visits: int = 200,
) -> list[MoveEval]:
    """
    Analyze a complete game move by move using KataGo.
    Returns per-move evaluation data.
    """
    engine = await get_engine()
    if not engine:
        logger.warning("KataGo not available for study analysis")
        return _stub_analysis(moves)

    board = Board()
    evaluations: list[MoveEval] = []
    prev_winrate = 0.5
    prev_score = 0.0

    for i, move in enumerate(moves):
        color_enum = Color.BLACK if move["color"] == "black" else Color.WHITE
        player_str = "B" if color_enum == Color.BLACK else "W"

        # Analyze position BEFORE the move
        try:
            analysis = await engine.analyze(
                board.to_2d(), player_str, max_visits=visits, komi=komi
            )
        except Exception as e:
            logger.error(f"Analysis failed for move {i+1}: {e}")
            continue

        winrate_before = analysis.winrate
        score_before = analysis.score_lead

        # Find the best move's score
        best_score = analysis.candidates[0].score_lead if analysis.candidates else 0
        best_move = analysis.candidates[0].move if analysis.candidates else None

        # Play the move on the board
        point = Point(move["row"], move["col"]) if move.get("row") is not None else None
        if point:
            result, _ = board.try_play(color_enum, point)
            if result != "ok":
                continue

        # Analyze position AFTER the move
        try:
            opponent_str = "W" if player_str == "B" else "B"
            post_analysis = await engine.analyze(
                board.to_2d(), opponent_str, max_visits=visits, komi=komi
            )
            # Winrate from the perspective of the player who just moved
            winrate_after = 1 - post_analysis.winrate
            score_after = -post_analysis.score_lead
        except Exception:
            winrate_after = winrate_before
            score_after = score_before

        # Calculate score delta (negative = move was worse than best)
        actual_move_gtp = f"{chr(65 + move['col'] + (1 if move['col'] >= 8 else 0))}{BOARD_SIZE - move['row']}" if point else "pass"
        score_delta = score_after - best_score

        mistake_type = classify_mistake(score_delta)

        # Alternatives (top 3 other moves)
        alternatives = []
        for c in analysis.candidates[:3]:
            if c.move != (move.get("row", -1), move.get("col", -1)):
                alternatives.append({
                    "row": c.move[0],
                    "col": c.move[1],
                    "score_lead": c.score_lead,
                    "winrate": c.winrate,
                })

        evaluations.append(MoveEval(
            move_number=i + 1,
            color=move["color"],
            point=(move["row"], move["col"]) if point else None,
            winrate_before=winrate_before,
            winrate_after=winrate_after,
            score_before=score_before,
            score_after=score_after,
            score_delta=score_delta,
            is_critical=False,  # Set below
            mistake_type=mistake_type,
            best_move=best_move,
            best_move_score=best_score,
            alternatives=alternatives,
        ))

        prev_winrate = winrate_after
        prev_score = score_after

    # Mark critical moments (top 5 biggest swings)
    if evaluations:
        sorted_by_swing = sorted(evaluations, key=lambda e: abs(e.score_delta), reverse=True)
        for e in sorted_by_swing[:min(7, len(sorted_by_swing))]:
            if abs(e.score_delta) > 1.0:  # Only if swing is meaningful
                e.is_critical = True

    return evaluations


def _stub_analysis(moves: list[dict]) -> list[MoveEval]:
    """Stub analysis when KataGo is not available."""
    return [
        MoveEval(
            move_number=i + 1,
            color=m["color"],
            point=(m.get("row"), m.get("col")),
            winrate_before=0.5,
            winrate_after=0.5,
            score_before=0.0,
            score_after=0.0,
            score_delta=0.0,
            is_critical=False,
            mistake_type=None,
            best_move=None,
            best_move_score=0.0,
            alternatives=[],
        )
        for i, m in enumerate(moves)
    ]
