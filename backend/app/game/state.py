"""
Game state manager — holds active games, processes moves,
interfaces with AI for bot responses.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional, Union

import logging

from app.game.engine import Board, Color, Point, MoveRecord, BOARD_SIZE
from app.models.schemas import (
    CreateGameRequest,
    GameStateResponse,
    AIMoveResponse,
    PointSchema,
    StoneColor,
    GameMode,
)
from app.ai.move_selector import select_ai_move
from app.katago.engine import get_engine
from app.game import storage

logger = logging.getLogger(__name__)


@dataclass
class ActiveGame:
    game_id: str
    board: Board
    current_color: Color
    move_history: list[MoveRecord]
    phase: str  # "playing", "scoring", "finished"
    komi: float
    target_rank: str
    mode: GameMode
    player_color: Color
    consecutive_passes: int = 0
    result: Optional[dict] = None


class GameManager:
    def __init__(self):
        self.games: dict[str, ActiveGame] = {}

    def create_game(self, game_id: str, req: CreateGameRequest) -> GameStateResponse:
        player_color = Color.BLACK if req.player_color == StoneColor.black else Color.WHITE
        game = ActiveGame(
            game_id=game_id,
            board=Board(),
            current_color=Color.BLACK,
            move_history=[],
            phase="playing",
            komi=req.komi,
            target_rank=req.target_rank,
            mode=req.mode,
            player_color=player_color,
        )
        self.games[game_id] = game
        return self._to_response(game)

    def get_state(self, game_id: str) -> Optional[GameStateResponse]:
        game = self.games.get(game_id)
        if game is None:
            return None
        return self._to_response(game)

    def play_move(
        self, game_id: str, row: int, col: int
    ) -> Optional[Union[GameStateResponse, str]]:
        game = self.games.get(game_id)
        if game is None:
            return None
        if game.phase != "playing":
            return "Game is not in playing phase"

        point = Point(row, col)
        result, captures = game.board.try_play(game.current_color, point)

        if result != "ok":
            return f"Illegal move: {result}"

        game.move_history.append(
            MoveRecord(
                color=game.current_color,
                point=point,
                captures=[Point(c.row, c.col) for c in captures],
                move_number=len(game.move_history) + 1,
            )
        )
        game.consecutive_passes = 0
        game.current_color = game.current_color.opposite()

        return self._to_response(game)

    async def pass_move(self, game_id: str) -> Optional[GameStateResponse]:
        game = self.games.get(game_id)
        if game is None:
            return None
        if game.phase != "playing":
            return self._to_response(game)

        game.move_history.append(
            MoveRecord(
                color=game.current_color,
                point=None,
                captures=[],
                move_number=len(game.move_history) + 1,
            )
        )
        game.consecutive_passes += 1
        game.current_color = game.current_color.opposite()

        if game.consecutive_passes >= 2:
            await self._score_game_async(game)

        return self._to_response(game)

    def resign(self, game_id: str) -> Optional[GameStateResponse]:
        game = self.games.get(game_id)
        if game is None:
            return None
        if game.phase != "playing":
            return self._to_response(game)

        winner = game.current_color.opposite()
        game.phase = "finished"
        game.result = {
            "winner": "black" if winner == Color.BLACK else "white",
            "reason": "resignation",
        }
        # Persist to SQLite
        import asyncio
        asyncio.ensure_future(self._persist_finished_game(game))
        return self._to_response(game)

    def undo(self, game_id: str) -> Optional[Union[GameStateResponse, str]]:
        game = self.games.get(game_id)
        if game is None:
            return None
        if game.mode != GameMode.casual:
            return "Undo only allowed in casual games"
        if not game.move_history:
            return "No moves to undo"
        if game.phase != "playing":
            return "Cannot undo in this phase"

        # Replay all moves except the last
        moves = game.move_history[:-1]
        game.board = Board()
        game.current_color = Color.BLACK
        game.move_history = []
        game.consecutive_passes = 0

        for move in moves:
            if move.point:
                game.board.try_play(move.color, move.point)
                game.move_history.append(move)
                game.current_color = move.color.opposite()
            else:
                game.move_history.append(move)
                game.consecutive_passes += 1
                game.current_color = move.color.opposite()

        return self._to_response(game)

    async def get_ai_move(
        self, game_id: str
    ) -> Optional[Union[AIMoveResponse, str]]:
        game = self.games.get(game_id)
        if game is None:
            return None
        if game.phase != "playing":
            return "Game is not in playing phase"

        # Get AI move (for now using the stub selector)
        point = await select_ai_move(game.board, game.current_color, game.target_rank)

        if point is None:
            # AI passes
            await self.pass_move(game_id)
            return AIMoveResponse(point=PointSchema(row=-1, col=-1), captures=[])

        result, captures = game.board.try_play(game.current_color, point)
        if result != "ok":
            # Fallback: pass if the selected move is illegal
            await self.pass_move(game_id)
            return AIMoveResponse(point=PointSchema(row=-1, col=-1), captures=[])

        game.move_history.append(
            MoveRecord(
                color=game.current_color,
                point=point,
                captures=captures,
                move_number=len(game.move_history) + 1,
            )
        )
        game.consecutive_passes = 0
        game.current_color = game.current_color.opposite()

        return AIMoveResponse(
            point=PointSchema(row=point.row, col=point.col),
            captures=[PointSchema(row=c.row, col=c.col) for c in captures],
        )

    async def _score_game_async(self, game: ActiveGame):
        """
        Score the game using KataGo ownership to detect dead stones.
        Falls back to raw territory scoring if KataGo is unavailable.
        """
        dead_stones: list[Point] = []

        # Try to get KataGo's ownership map for dead stone detection
        engine = await get_engine()
        if engine:
            try:
                board_2d = game.board.to_2d()
                # Analyze with ownership — use high visits for accuracy
                analysis = await engine.analyze(
                    board_2d, "B", max_visits=200,
                    komi=game.komi, include_ownership=True,
                )
                if analysis.ownership:
                    # Ownership values: +1 = definitely black, -1 = definitely white
                    # A stone is "dead" if the ownership says the intersection
                    # belongs to the opponent with high confidence
                    for row in range(BOARD_SIZE):
                        for col in range(BOARD_SIZE):
                            idx = row * BOARD_SIZE + col
                            stone = game.board.get(Point(row, col))
                            own = analysis.ownership[idx]

                            if stone == Color.BLACK and own < -0.5:
                                # Black stone in white-owned territory = dead
                                dead_stones.append(Point(row, col))
                            elif stone == Color.WHITE and own > 0.5:
                                # White stone in black-owned territory = dead
                                dead_stones.append(Point(row, col))

                    logger.info(f"KataGo detected {len(dead_stones)} dead stones")
            except Exception as e:
                logger.warning(f"KataGo ownership analysis failed: {e}")

        # Remove dead stones from the board before scoring
        scoring_board = game.board.clone()
        for ds in dead_stones:
            stone_color = scoring_board.get(ds)
            scoring_board.grid[ds.index()] = Color.EMPTY
            # Count dead stones as captures for the opponent
            if stone_color == Color.BLACK:
                scoring_board.captures[Color.WHITE] += 1
            elif stone_color == Color.WHITE:
                scoring_board.captures[Color.BLACK] += 1

        # Japanese scoring: territory + captures (not stones on board)
        black_terr, white_terr, _ = scoring_board.score_territory()
        black_caps = scoring_board.captures[Color.BLACK]
        white_caps = scoring_board.captures[Color.WHITE]

        black_score = len(black_terr) + black_caps
        white_score = len(white_terr) + white_caps + game.komi

        winner = "black" if black_score > white_score else "white"
        game.phase = "finished"
        game.result = {
            "winner": winner,
            "black_score": black_score,
            "white_score": white_score,
            "black_territory": len(black_terr),
            "white_territory": len(white_terr),
            "black_captures": black_caps,
            "white_captures": white_caps,
            "dead_stones": [{"row": ds.row, "col": ds.col} for ds in dead_stones],
            "margin": abs(black_score - white_score),
        }

        # Update the actual board to reflect removed dead stones
        # so the frontend territory overlay is accurate
        game.board = scoring_board

        await self._persist_finished_game(game)

    def _score_game_sync(self, game: ActiveGame):
        """Fallback synchronous scoring without dead stone detection."""
        black_terr, white_terr, _ = game.board.score_territory()
        black_caps = game.board.captures[Color.BLACK]
        white_caps = game.board.captures[Color.WHITE]

        black_score = len(black_terr) + black_caps
        white_score = len(white_terr) + white_caps + game.komi

        winner = "black" if black_score > white_score else "white"
        game.phase = "finished"
        game.result = {
            "winner": winner,
            "black_score": black_score,
            "white_score": white_score,
            "black_territory": len(black_terr),
            "white_territory": len(white_terr),
            "black_captures": black_caps,
            "white_captures": white_caps,
            "margin": abs(black_score - white_score),
        }

    async def _persist_finished_game(self, game: ActiveGame):
        """Save a finished game to SQLite."""
        try:
            # Build SGF
            sgf = f"(;GM[1]FF[4]SZ[19]KM[{game.komi}]RU[Japanese]"
            if game.result:
                winner = game.result.get("winner", "?")[0].upper()
                margin = game.result.get("margin", 0)
                reason = game.result.get("reason", "")
                if reason == "resignation":
                    sgf += f"RE[{winner}+R]"
                else:
                    sgf += f"RE[{winner}+{margin}]"
            for move in game.move_history:
                c = "B" if move.color == Color.BLACK else "W"
                if move.point:
                    col = chr(97 + move.point.col)
                    row = chr(97 + move.point.row)
                    sgf += f";{c}[{col}{row}]"
                else:
                    sgf += f";{c}[]"
            sgf += ")"

            result_str = None
            if game.result:
                w = game.result.get("winner", "unknown")
                reason = game.result.get("reason", "")
                margin = game.result.get("margin", 0)
                if reason == "resignation":
                    result_str = f"{w} wins by resignation"
                else:
                    result_str = f"{w} wins by {margin}"

            await storage.save_game(
                game_id=game.game_id,
                player_id=None,  # No user auth yet
                target_rank=game.target_rank,
                mode=game.mode.value if hasattr(game.mode, 'value') else str(game.mode),
                komi=game.komi,
                player_color="black" if game.player_color == Color.BLACK else "white",
                result_winner=game.result.get("winner") if game.result else None,
                result_score=result_str,
                sgf=sgf,
                move_count=len(game.move_history),
            )
            logger.info(f"Game {game.game_id} saved to database ({len(game.move_history)} moves)")
        except Exception as e:
            logger.error(f"Failed to persist game {game.game_id}: {e}")

    def _to_response(self, game: ActiveGame) -> GameStateResponse:
        last_move = None
        if game.move_history and game.move_history[-1].point:
            lm = game.move_history[-1].point
            last_move = PointSchema(row=lm.row, col=lm.col)

        ko_point = None
        if game.board.ko_point:
            ko_point = PointSchema(
                row=game.board.ko_point.row, col=game.board.ko_point.col
            )

        return GameStateResponse(
            game_id=game.game_id,
            board=game.board.to_2d(),
            current_color=StoneColor.black
            if game.current_color == Color.BLACK
            else StoneColor.white,
            move_number=len(game.move_history) + 1,
            captures={
                "black": game.board.captures[Color.BLACK],
                "white": game.board.captures[Color.WHITE],
            },
            phase=game.phase,
            last_move=last_move,
            ko_point=ko_point,
            result=game.result,
        )
