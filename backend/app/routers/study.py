from fastapi import APIRouter, HTTPException
from typing import Optional

from app.models.schemas import (
    GameAnalysisResponse,
    MoveAnalysis,
    PointSchema,
    StoneColor,
)
from app.study.analyzer import analyze_game, MoveEval
from app.study.narrator import generate_explanation, generate_game_summary
from app.game.state import GameManager

router = APIRouter()

# Reference to the game manager (shared with games router)
_manager: Optional[GameManager] = None


def set_manager(manager: GameManager):
    global _manager
    _manager = manager


@router.post("/{game_id}/analyze", response_model=GameAnalysisResponse)
async def analyze_game_endpoint(game_id: str):
    """Trigger full analysis of a completed game."""
    if not _manager:
        raise HTTPException(status_code=500, detail="Game manager not initialized")

    game = _manager.games.get(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    if game.phase != "finished":
        raise HTTPException(status_code=400, detail="Game must be finished to analyze")

    # Build move list for analysis
    moves = []
    for record in game.move_history:
        if record.point:
            moves.append({
                "color": "black" if record.color == 1 else "white",
                "row": record.point.row,
                "col": record.point.col,
            })
        else:
            moves.append({
                "color": "black" if record.color == 1 else "white",
                "row": None,
                "col": None,
            })

    # Run analysis
    evaluations = await analyze_game(moves, komi=game.komi)

    # Generate narrative for critical moments
    critical_moves = []
    move_analyses = []

    for eval_data in evaluations:
        explanation = None
        if eval_data.is_critical or eval_data.mistake_type:
            explanation = await generate_explanation(
                eval_data, game.target_rank
            )

        move_analyses.append(MoveAnalysis(
            move_number=eval_data.move_number,
            color=StoneColor.black if eval_data.color == "black" else StoneColor.white,
            point=PointSchema(row=eval_data.point[0], col=eval_data.point[1]) if eval_data.point else None,
            winrate_before=eval_data.winrate_before,
            winrate_after=eval_data.winrate_after,
            score_delta=eval_data.score_delta,
            is_critical=eval_data.is_critical,
            mistake_type=eval_data.mistake_type,
            explanation=explanation,
            alternatives=[
                {"row": a["row"], "col": a["col"], "score": a.get("score_lead", 0)}
                for a in eval_data.alternatives
            ],
        ))

        if eval_data.is_critical:
            critical_moves.append(eval_data.move_number)

    # Generate game summary
    summary = await generate_game_summary(evaluations, game.target_rank, game.result)

    return GameAnalysisResponse(
        game_id=game_id,
        moves=move_analyses,
        critical_moments=critical_moves,
        summary=summary,
    )


@router.get("/{game_id}/move/{move_number}", response_model=MoveAnalysis)
async def get_move_analysis(game_id: str, move_number: int):
    """Get analysis for a specific move."""
    # This would typically use cached analysis
    raise HTTPException(status_code=501, detail="Per-move analysis not yet cached. Use /analyze first.")


@router.post("/{game_id}/explore")
async def explore_variation(game_id: str, row: int, col: int, move_number: int):
    """What-if: evaluate a hypothetical move at a given position in the game."""
    raise HTTPException(status_code=501, detail="What-if exploration coming soon")
