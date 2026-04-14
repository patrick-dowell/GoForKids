from pydantic import BaseModel
from enum import Enum
from typing import Optional


class StoneColor(str, Enum):
    black = "black"
    white = "white"


class GameMode(str, Enum):
    ranked = "ranked"
    casual = "casual"


class PointSchema(BaseModel):
    row: int
    col: int


class CreateGameRequest(BaseModel):
    target_rank: str = "15k"  # e.g. "15k", "10k", "5k", "3k"
    mode: GameMode = GameMode.casual
    komi: float = 7.5
    player_color: StoneColor = StoneColor.black


class PlayMoveRequest(BaseModel):
    row: int
    col: int


class GameStateResponse(BaseModel):
    game_id: str
    board: list[list[int]]  # 19x19 grid: 0=empty, 1=black, 2=white
    current_color: StoneColor
    move_number: int
    captures: dict[str, int]  # {"black": N, "white": N}
    phase: str  # "playing", "scoring", "finished"
    last_move: Optional[PointSchema] = None
    ko_point: Optional[PointSchema] = None
    result: Optional[dict] = None


class AIMoveResponse(BaseModel):
    point: PointSchema
    captures: list[PointSchema]
    debug: Optional[dict] = None  # For development: KataGo analysis info


class StudyAnalysisRequest(BaseModel):
    game_id: str


class MoveAnalysis(BaseModel):
    move_number: int
    color: StoneColor
    point: Optional[PointSchema]
    winrate_before: float
    winrate_after: float
    score_delta: float
    is_critical: bool
    mistake_type: Optional[str] = None
    explanation: Optional[str] = None  # LLM-generated narrative
    alternatives: list[dict] = []


class GameAnalysisResponse(BaseModel):
    game_id: str
    moves: list[MoveAnalysis]
    critical_moments: list[int]  # move numbers
    summary: Optional[str] = None
