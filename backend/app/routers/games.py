import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException

from app.models.schemas import (
    CreateGameRequest,
    PlayMoveRequest,
    GameStateResponse,
    AIMoveResponse,
    PointSchema,
    StoneColor,
)
from app.game.state import GameManager
from app.game import storage

router = APIRouter()
manager = GameManager()


@router.get("/history")
async def list_saved_games(limit: int = 50):
    """List saved games from the database."""
    games = await storage.get_player_games(player_id="default", limit=limit)
    return {"games": games}


@router.post("/score-position")
async def score_position(req: dict):
    """Score a board position using KataGo ownership analysis. Returns dead stones."""
    from app.katago.engine import get_engine, BOARD_SIZE
    from app.game.engine import Color

    board = req.get("board", [])
    if len(board) != 19 or any(len(row) != 19 for row in board):
        raise HTTPException(status_code=400, detail="Board must be 19x19")

    engine = await get_engine()
    if not engine:
        raise HTTPException(status_code=503, detail="KataGo not available")

    try:
        analysis = await engine.analyze(board, "B", max_visits=200, komi=7.5, include_ownership=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"KataGo analysis failed: {e}")

    dead_stones = []
    if analysis.ownership:
        # Ownership: +1 = black controls, -1 = white controls
        # A stone is dead if the opponent controls that intersection
        # Black stone with ownership > 0.5 → black controls → alive
        # Black stone with ownership < -0.5 → white controls → dead
        # White stone with ownership > 0.5 → black controls → dead
        # White stone with ownership < -0.5 → white controls → alive
        for row in range(BOARD_SIZE):
            for col in range(BOARD_SIZE):
                idx = row * BOARD_SIZE + col
                stone = board[row][col]
                own = analysis.ownership[idx]
                if stone == 1 and own < -0.5:  # Black stone, white controls → dead
                    dead_stones.append({"row": row, "col": col, "color": "black"})
                elif stone == 2 and own > 0.5:  # White stone, black controls → dead
                    dead_stones.append({"row": row, "col": col, "color": "white"})
    else:
        import logging
        logging.getLogger(__name__).warning("KataGo returned no ownership data")

    return {"dead_stones": dead_stones}


@router.post("", response_model=GameStateResponse)
async def create_game(req: CreateGameRequest):
    """Create a new game against the AI."""
    game_id = str(uuid.uuid4())[:8]
    state = manager.create_game(game_id, req)
    return state


@router.get("/{game_id}", response_model=GameStateResponse)
async def get_game(game_id: str):
    """Get the current state of a game."""
    state = manager.get_state(game_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Game not found")
    return state


@router.post("/{game_id}/move", response_model=GameStateResponse)
async def play_move(game_id: str, req: PlayMoveRequest):
    """Play a move in the game."""
    result = manager.play_move(game_id, req.row, req.col)
    if result is None:
        raise HTTPException(status_code=404, detail="Game not found")
    if isinstance(result, str):
        raise HTTPException(status_code=400, detail=result)
    return result


@router.post("/{game_id}/pass", response_model=GameStateResponse)
async def pass_move(game_id: str):
    """Pass the current turn."""
    result = await manager.pass_move(game_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Game not found")
    return result


@router.post("/{game_id}/resign", response_model=GameStateResponse)
async def resign(game_id: str):
    """Resign the game."""
    result = manager.resign(game_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Game not found")
    return result


@router.post("/{game_id}/undo", response_model=GameStateResponse)
async def undo(game_id: str):
    """Undo the last move (casual games only)."""
    result = manager.undo(game_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Game not found")
    if isinstance(result, str):
        raise HTTPException(status_code=400, detail=result)
    return result


@router.post("/{game_id}/ai-move", response_model=AIMoveResponse)
async def get_ai_move(game_id: str):
    """Request an AI move for the current position."""
    result = await manager.get_ai_move(game_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Game not found")
    if isinstance(result, str):
        raise HTTPException(status_code=400, detail=result)
    return result


@router.post("/{game_id}/auto-complete", response_model=GameStateResponse)
async def auto_complete(game_id: str):
    """Auto-complete the game using full-strength KataGo, then score."""
    result = await manager.auto_complete(game_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Game not found")
    if isinstance(result, str):
        raise HTTPException(status_code=400, detail=result)
    return result
