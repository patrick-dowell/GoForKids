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
