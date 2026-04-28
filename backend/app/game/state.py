"""
Game state manager — holds active games, processes moves,
interfaces with AI for bot responses.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional, Union

import logging
import os
import pickle

from app.game.engine import Board, Color, Point, MoveRecord
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
    handicap: int = 0
    black_rank: Optional[str] = None  # For bot-vs-bot
    white_rank: Optional[str] = None  # For bot-vs-bot
    # KataGo's last point-margin estimate from Black's perspective.
    # Updated after every move; surfaced to the UI for the live score graph.
    score_lead: Optional[float] = None


# Standard handicap stone positions (row, col), per board size.
# Pattern follows 19x19 convention: diagonal corners (2), then 3 corners,
# then all 4 corners, then tengen, then edge midpoints, mixing in tengen.
HANDICAP_POSITIONS_19 = {
    2: [(15, 3), (3, 15)],
    3: [(15, 3), (3, 15), (15, 15)],
    4: [(15, 3), (3, 15), (3, 3), (15, 15)],
    5: [(15, 3), (3, 15), (3, 3), (15, 15), (9, 9)],
    6: [(15, 3), (3, 15), (3, 3), (15, 15), (9, 3), (9, 15)],
    7: [(15, 3), (3, 15), (3, 3), (15, 15), (9, 3), (9, 15), (9, 9)],
    8: [(15, 3), (3, 15), (3, 3), (15, 15), (9, 3), (9, 15), (3, 9), (15, 9)],
    9: [(15, 3), (3, 15), (3, 3), (15, 15), (9, 3), (9, 15), (3, 9), (15, 9), (9, 9)],
}

# 13x13 hoshi: corners (3,3), (3,9), (9,3), (9,9), tengen (6,6),
# plus edge midpoints (3,6), (6,3), (6,9), (9,6).
HANDICAP_POSITIONS_13 = {
    2: [(9, 3), (3, 9)],
    3: [(9, 3), (3, 9), (9, 9)],
    4: [(9, 3), (3, 9), (3, 3), (9, 9)],
    5: [(9, 3), (3, 9), (3, 3), (9, 9), (6, 6)],
    6: [(9, 3), (3, 9), (3, 3), (9, 9), (6, 3), (6, 9)],
    7: [(9, 3), (3, 9), (3, 3), (9, 9), (6, 3), (6, 9), (6, 6)],
    8: [(9, 3), (3, 9), (3, 3), (9, 9), (6, 3), (6, 9), (3, 6), (9, 6)],
    9: [(9, 3), (3, 9), (3, 3), (9, 9), (6, 3), (6, 9), (3, 6), (9, 6), (6, 6)],
}

# 9x9 hoshi: only 5 points exist — corners (2,2), (2,6), (6,2), (6,6) and tengen (4,4).
# Cap at 5 since there are no edge-midpoint hoshi to extend the pattern.
HANDICAP_POSITIONS_9 = {
    2: [(6, 2), (2, 6)],
    3: [(6, 2), (2, 6), (6, 6)],
    4: [(6, 2), (2, 6), (2, 2), (6, 6)],
    5: [(6, 2), (2, 6), (2, 2), (6, 6), (4, 4)],
}

_HANDICAP_BY_SIZE = {
    9: HANDICAP_POSITIONS_9,
    13: HANDICAP_POSITIONS_13,
    19: HANDICAP_POSITIONS_19,
}

# Maximum handicap stones per size (drives clamping).
MAX_HANDICAP_BY_SIZE = {9: 5, 13: 9, 19: 9}


def _handicap_positions(size: int, handicap: int) -> list[tuple[int, int]]:
    table = _HANDICAP_BY_SIZE.get(size)
    if not table:
        return []
    return table.get(handicap, [])


SUPPORTED_SIZES = (5, 9, 13, 19)

# Visit budget for the live score-graph estimate. Low enough to keep
# per-move latency tolerable but deep enough that the estimate isn't
# just the value-network prior. Independent of the bot's profile so the
# graph stays consistent across all bot strengths.
SCORE_ESTIMATE_VISITS = int(os.environ.get("KATAGO_SCORE_VISITS", "30"))
OWNERSHIP_VISITS = int(os.environ.get("KATAGO_OWNERSHIP_VISITS", "200"))


async def _compute_score_lead(game: "ActiveGame") -> Optional[float]:
    """KataGo's estimated point margin from Black's perspective on the current
    board. Positive = Black ahead. Returns None if KataGo isn't available.

    Empirically verified (2026-04-25 playtest + sign tests): rootInfo.scoreLead
    from KataGo's analysis engine is always Black-perspective regardless of
    the `initialPlayer` we send. An earlier flip-on-white-to-move caused the
    graph to invert sign every move (B+20 → W+20 → B+20 with the same
    underlying position). Don't flip — return the value as-is.
    """
    engine = await get_engine()
    if engine is None:
        return None
    try:
        player = "B" if game.current_color == Color.BLACK else "W"
        analysis = await engine.analyze(
            game.board.to_2d(), player,
            max_visits=SCORE_ESTIMATE_VISITS,
            komi=game.komi, size=game.board.size,
        )
        return analysis.score_lead
    except Exception as e:
        logger.warning(f"Score estimate failed: {e}")
        return None


class GameManager:
    def __init__(self):
        # Same-worker fast cache. Source of truth is the active_games SQLite
        # table — Render's runtime spawns multiple worker processes per
        # container, so any in-memory dict is per-worker only and a request
        # can land on a worker that didn't create the game. Always re-load
        # from the DB before mutating, always persist after.
        self.games: dict[str, ActiveGame] = {}

    async def _load(self, game_id: str) -> Optional[ActiveGame]:
        """Load an active game from the disk-backed table. Falls back to the
        in-memory cache only as a hint; the DB is authoritative across
        workers."""
        blob = await storage.load_active_game(game_id)
        if blob is None:
            # Either never existed or already finished and cleaned up.
            return None
        try:
            game = pickle.loads(blob)
        except Exception as e:
            logger.error(f"Failed to unpickle game {game_id}: {e}")
            return None
        self.games[game_id] = game
        return game

    async def _save(self, game: ActiveGame):
        """Persist the game state for cross-worker visibility."""
        self.games[game.game_id] = game
        try:
            blob = pickle.dumps(game)
        except Exception as e:
            logger.error(f"Failed to pickle game {game.game_id}: {e}")
            return
        await storage.save_active_game(game.game_id, blob)

    async def create_game(self, game_id: str, req: CreateGameRequest) -> GameStateResponse:
        player_color = Color.BLACK if req.player_color == StoneColor.black else Color.WHITE
        size = req.board_size if req.board_size in SUPPORTED_SIZES else 19
        max_h = MAX_HANDICAP_BY_SIZE.get(size, 0)
        handicap = max(0, min(max_h, req.handicap))
        komi = 0.5 if handicap > 0 else req.komi

        board = Board(size)

        # Place handicap stones
        handi_points = _handicap_positions(size, handicap)
        for r, c in handi_points:
            board.grid[r * size + c] = Color.BLACK

        # After handicap, White moves first
        current_color = Color.WHITE if handicap >= 2 else Color.BLACK

        game = ActiveGame(
            game_id=game_id,
            board=board,
            current_color=current_color,
            move_history=[],
            phase="playing",
            komi=komi,
            target_rank=req.target_rank,
            mode=req.mode,
            player_color=player_color,
            handicap=handicap,
            black_rank=req.black_rank,
            white_rank=req.white_rank,
        )
        await self._save(game)
        return self._to_response(game)

    async def get_state(self, game_id: str) -> Optional[GameStateResponse]:
        game = await self._load(game_id)
        if game is None:
            return None
        return self._to_response(game)

    async def play_move(
        self, game_id: str, row: int, col: int
    ) -> Optional[Union[GameStateResponse, str]]:
        game = await self._load(game_id)
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

        # Refresh the live score estimate for the UI graph.
        game.score_lead = await _compute_score_lead(game)

        await self._save(game)
        return self._to_response(game)

    async def pass_move(self, game_id: str) -> Optional[GameStateResponse]:
        game = await self._load(game_id)
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
            # _score_game_async → _persist_finished_game already cleared the
            # active_games row; don't resurrect it.
        else:
            await self._save(game)
        return self._to_response(game)

    async def resign(self, game_id: str) -> Optional[GameStateResponse]:
        game = await self._load(game_id)
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
        # Skip _save (would re-create the active row); _persist_finished_game
        # writes to the long-term games table and clears active_games.
        await self._persist_finished_game(game)
        return self._to_response(game)

    async def undo(self, game_id: str) -> Optional[Union[GameStateResponse, str]]:
        game = await self._load(game_id)
        if game is None:
            return None
        if game.mode != GameMode.casual:
            return "Undo only allowed in casual games"
        if not game.move_history:
            return "No moves to undo"
        if game.phase != "playing":
            return "Cannot undo in this phase"

        # Replay all moves except the last
        size = game.board.size
        moves = game.move_history[:-1]
        game.board = Board(size)
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

        await self._save(game)
        return self._to_response(game)

    async def auto_complete(
        self, game_id: str
    ) -> Optional[Union[GameStateResponse, str]]:
        """
        Auto-complete the game using full-strength KataGo.
        Both sides play best moves until two consecutive passes, then score.
        """
        game = await self._load(game_id)
        if game is None:
            return None
        if game.phase != "playing":
            return "Game is not in playing phase"

        engine = await get_engine()
        if not engine:
            return "KataGo not available for auto-complete"

        consecutive_passes = 0
        max_moves = 300  # Safety limit

        for _ in range(max_moves):
            if game.phase != "playing":
                break

            # Full-strength KataGo analysis
            board_2d = game.board.to_2d()
            player = "B" if game.current_color == Color.BLACK else "W"
            try:
                analysis = await engine.analyze(
                    board_2d, player, max_visits=500,
                    komi=game.komi, size=game.board.size,
                )
            except Exception as e:
                logger.error(f"Auto-complete KataGo failed: {e}")
                break

            if not analysis.candidates:
                break

            best = analysis.candidates[0]

            if best.move[0] < 0:
                # KataGo wants to pass
                consecutive_passes += 1
                game.move_history.append(MoveRecord(
                    color=game.current_color, point=None,
                    captures=[], move_number=len(game.move_history) + 1,
                ))
                game.current_color = game.current_color.opposite()

                if consecutive_passes >= 2:
                    await self._score_game_async(game)
                    break
            else:
                consecutive_passes = 0
                point = Point(best.move[0], best.move[1])
                result, captures = game.board.try_play(game.current_color, point)
                if result == "ok":
                    game.move_history.append(MoveRecord(
                        color=game.current_color, point=point,
                        captures=captures, move_number=len(game.move_history) + 1,
                    ))
                    game.current_color = game.current_color.opposite()
                else:
                    # Shouldn't happen with full-strength KataGo, but fallback to pass
                    consecutive_passes += 1
                    game.move_history.append(MoveRecord(
                        color=game.current_color, point=None,
                        captures=[], move_number=len(game.move_history) + 1,
                    ))
                    game.current_color = game.current_color.opposite()
                    if consecutive_passes >= 2:
                        await self._score_game_async(game)
                        break

        # If we hit the move limit without ending, force score
        if game.phase == "playing":
            await self._score_game_async(game)

        # auto_complete always lands the game in "finished" — don't _save
        # (it would re-create the active_games row that _score_game_async
        # already cleared via _persist_finished_game).
        return self._to_response(game)

    async def get_ai_move(
        self, game_id: str
    ) -> Optional[Union[AIMoveResponse, str]]:
        game = await self._load(game_id)
        if game is None:
            return None
        if game.phase != "playing":
            return "Game is not in playing phase"

        # Determine which rank to use for the current player
        # In bot-vs-bot mode, each color has its own rank
        if game.black_rank and game.white_rank:
            rank = game.black_rank if game.current_color == Color.BLACK else game.white_rank
        else:
            rank = game.target_rank

        # Last opponent stone — feeds reactive play for beginner-style profiles.
        last_opponent_move: Optional[Point] = None
        for record in reversed(game.move_history):
            if record.color != game.current_color and record.point is not None:
                last_opponent_move = record.point
                break

        point = await select_ai_move(
            game.board, game.current_color, rank,
            last_opponent_move=last_opponent_move,
        )

        if point is None:
            # AI passes — board unchanged, the prior score_lead is still valid.
            await self.pass_move(game_id)
            return AIMoveResponse(
                point=PointSchema(row=-1, col=-1), captures=[],
                score_lead=game.score_lead,
            )

        result, captures = game.board.try_play(game.current_color, point)
        if result != "ok":
            # Fallback: pass if the selected move is illegal
            await self.pass_move(game_id)
            return AIMoveResponse(
                point=PointSchema(row=-1, col=-1), captures=[],
                score_lead=game.score_lead,
            )

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

        # Refresh the live score estimate for the UI graph.
        game.score_lead = await _compute_score_lead(game)

        await self._save(game)
        return AIMoveResponse(
            point=PointSchema(row=point.row, col=point.col),
            captures=[PointSchema(row=c.row, col=c.col) for c in captures],
            score_lead=game.score_lead,
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
                    board_2d, "B", max_visits=OWNERSHIP_VISITS,
                    komi=game.komi, include_ownership=True,
                    size=game.board.size,
                )
                if analysis.ownership:
                    # Ownership values: +1 = definitely black, -1 = definitely white
                    # A stone is "dead" if the ownership says the intersection
                    # belongs to the opponent with high confidence
                    size = game.board.size
                    # Diagnostic: collect ownership values for ALL stones so
                    # we can see whether the threshold (0.3) is too tight or
                    # whether the analysis returned weak ownership signals.
                    stone_ownerships: list[tuple[int, int, str, float]] = []
                    for row in range(size):
                        for col in range(size):
                            idx = row * size + col
                            stone = game.board.get(Point(row, col))
                            own = analysis.ownership[idx]
                            if stone != Color.EMPTY:
                                stone_ownerships.append((
                                    row, col,
                                    "B" if stone == Color.BLACK else "W",
                                    own,
                                ))

                            if stone == Color.BLACK and own < -0.3:
                                # Black stone in white-owned territory = dead
                                dead_stones.append(Point(row, col))
                            elif stone == Color.WHITE and own > 0.3:
                                # White stone in black-owned territory = dead
                                dead_stones.append(Point(row, col))

                    own_summary = ", ".join(
                        f"({r},{c}){col}:{own:+.2f}"
                        for r, c, col, own in stone_ownerships
                    )
                    logger.info(
                        f"OWNERSHIP analysis ({len(stone_ownerships)} stones, "
                        f"threshold ±0.3): {own_summary}"
                    )
                    logger.info(f"KataGo detected {len(dead_stones)} dead stones")
                else:
                    logger.warning("OWNERSHIP analysis: KataGo returned no ownership data")
            except Exception as e:
                logger.warning(f"KataGo ownership analysis failed: {e}")

        # Remove dead stones from the board before scoring
        scoring_board = game.board.clone()
        for ds in dead_stones:
            stone_color = scoring_board.get(ds)
            scoring_board.grid[ds.index(scoring_board.size)] = Color.EMPTY
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
            sgf = f"(;GM[1]FF[4]SZ[{game.board.size}]KM[{game.komi}]RU[Japanese]"
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

        # Clear the active-games row now that the game is in long-term storage.
        try:
            await storage.delete_active_game(game.game_id)
            self.games.pop(game.game_id, None)
        except Exception as e:
            logger.warning(f"Failed to remove active game {game.game_id}: {e}")

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

        # Generate SGF for finished games
        sgf = None
        if game.phase == "finished":
            sgf = self._generate_sgf(game)

        return GameStateResponse(
            game_id=game.game_id,
            board=game.board.to_2d(),
            board_size=game.board.size,
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
            sgf=sgf,
            score_lead=game.score_lead,
        )

    def _generate_sgf(self, game: ActiveGame) -> str:
        """Generate SGF from the full move history, including handicap setup."""
        sgf = f"(;GM[1]FF[4]SZ[{game.board.size}]KM[{game.komi}]RU[Japanese]"

        # Add handicap stones as AB[] (Add Black) properties
        handi_points = _handicap_positions(game.board.size, game.handicap)
        if handi_points:
            sgf += f"HA[{game.handicap}]"
            ab_points = [f"{chr(97 + c)}{chr(97 + r)}" for r, c in handi_points]
            sgf += "AB" + "".join(f"[{p}]" for p in ab_points)

        if game.result:
            w = game.result.get("winner", "?")[0].upper()
            reason = game.result.get("reason", "")
            margin = game.result.get("margin", 0)
            sgf += f"RE[{w}+{'R' if reason == 'resignation' else margin}]"
        for move in game.move_history:
            c = "B" if move.color == Color.BLACK else "W"
            if move.point:
                col = chr(97 + move.point.col)
                row = chr(97 + move.point.row)
                sgf += f";{c}[{col}{row}]"
            else:
                sgf += f";{c}[]"
        sgf += ")"
        return sgf
