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
    target_rank: str = "15k"  # e.g. "30k", "18k", "15k", "10k", "5k", "3k"
    mode: GameMode = GameMode.casual
    komi: float = 7.5
    player_color: StoneColor = StoneColor.black
    handicap: int = 0  # 0-9 stones (capped to 5 on 9x9). Clamped server-side per board size.
    black_rank: Optional[str] = None  # For bot-vs-bot: black bot rank
    white_rank: Optional[str] = None  # For bot-vs-bot: white bot rank
    board_size: int = 19  # 9, 13, or 19


class PlayMoveRequest(BaseModel):
    row: int
    col: int


class GameStateResponse(BaseModel):
    game_id: str
    board: list[list[int]]  # size×size grid: 0=empty, 1=black, 2=white
    board_size: int = 19
    current_color: StoneColor
    move_number: int
    captures: dict[str, int]  # {"black": N, "white": N}
    phase: str  # "playing", "scoring", "finished"
    last_move: Optional[PointSchema] = None
    ko_point: Optional[PointSchema] = None
    result: Optional[dict] = None
    sgf: Optional[str] = None  # Full SGF when game is finished
    # KataGo's estimated point margin from Black's perspective at the current
    # board state. Positive = Black ahead, negative = White ahead. None if
    # KataGo wasn't available. Used by the live score graph.
    score_lead: Optional[float] = None


class AIMoveResponse(BaseModel):
    point: PointSchema
    captures: list[PointSchema]
    debug: Optional[dict] = None  # For development: KataGo analysis info
    score_lead: Optional[float] = None  # See GameStateResponse.score_lead.


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
