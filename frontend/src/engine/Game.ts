import { Board } from './Board';
import {
  BOARD_SIZE,
  Color,
  oppositeColor,
  Point,
  MoveResult,
  type MoveRecord,
  type GameResult,
  type Stone,
} from './types';

export type GamePhase = 'playing' | 'scoring' | 'finished';

const DEFAULT_KOMI = 7.5; // Standard komi for 19x19; callers should adjust for smaller boards.

/**
 * Full game controller — manages turns, move history, pass detection,
 * scoring, and game lifecycle.
 */
export class Game {
  board: Board;
  currentColor: Stone;
  moveHistory: MoveRecord[];
  phase: GamePhase;
  komi: number;
  consecutivePasses: number;
  result: GameResult | null;
  /** Handicap stones placed at game setup (all Black). Kept separate from
   *  moveHistory because they're SGF "setup stones" (AB), not numbered
   *  moves — but undo's rebuild needs them so they don't vanish, and
   *  SGF export needs to emit AB tags for them. */
  handicapStones: Point[];

  constructor(komi: number = DEFAULT_KOMI, size: number = BOARD_SIZE) {
    this.board = new Board(size);
    this.currentColor = Color.Black;
    this.moveHistory = [];
    this.phase = 'playing';
    this.komi = komi;
    this.consecutivePasses = 0;
    this.result = null;
    this.handicapStones = [];
  }

  /** Place handicap stones at setup. All stones are Black, and White
   *  moves first afterwards (per standard handicap rules). Must be
   *  called before any playMove/pass; idempotent on the same set. */
  setHandicap(stones: Point[]): void {
    this.handicapStones = stones.slice();
    for (const p of stones) {
      this.board.grid[p.row * this.board.size + p.col] = Color.Black;
    }
    if (stones.length > 0) {
      this.currentColor = Color.White;
    }
  }

  /** Get the current move number (1-indexed) */
  get moveNumber(): number {
    return this.moveHistory.length + 1;
  }

  /** Play a stone at the given point */
  playMove(point: Point): { result: MoveResult; captures: Point[] } {
    if (this.phase !== 'playing') {
      return { result: MoveResult.GameOver, captures: [] };
    }

    const { result, captures } = this.board.tryPlay(this.currentColor, point);

    if (result === MoveResult.Ok) {
      this.moveHistory.push({
        color: this.currentColor,
        point,
        captures,
        moveNumber: this.moveNumber,
      });
      this.consecutivePasses = 0;
      this.currentColor = oppositeColor(this.currentColor);
    }

    return { result, captures };
  }

  /** Apply a move the game server already committed but our own tryPlay
   *  rejected — the desync-recovery path (888P9NXK, 2026-07-03: local
   *  rejections were silently converted into bot passes, and the boards
   *  drifted further apart every time). The server board is authoritative:
   *  overwrite the grid from it, record the move, and reset the superko
   *  history (grid-only state can't reconstruct it; the server keeps
   *  enforcing the real rule). Returns the opponent stones that vanished,
   *  so the caller can play capture effects. */
  forceApplyServerMove(point: Point, serverGrid: number[][]): Point[] {
    const size = this.board.size;
    const mover = this.currentColor;
    const opponent = oppositeColor(mover);
    const removed: Point[] = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const idx = r * size + c;
        const after = serverGrid[r][c] as Color;
        if (this.board.grid[idx] === opponent && after === Color.Empty) {
          removed.push({ row: r, col: c });
        }
        this.board.grid[idx] = after;
      }
    }
    this.board.captures[mover] += removed.length;
    this.board.koPoint = null;
    this.board.koBan = null;
    this.board.resetPositionHistory();
    this.moveHistory.push({
      color: mover,
      point,
      captures: removed,
      moveNumber: this.moveNumber,
    });
    this.consecutivePasses = 0;
    this.currentColor = opponent;
    return removed;
  }

  /** Pass (null move) */
  pass(): void {
    if (this.phase !== 'playing') return;

    this.moveHistory.push({
      color: this.currentColor,
      point: null,
      captures: [],
      moveNumber: this.moveNumber,
    });

    this.consecutivePasses++;
    this.currentColor = oppositeColor(this.currentColor);

    // Two consecutive passes end the game
    if (this.consecutivePasses >= 2) {
      this.phase = 'scoring';
      this.score();
    }
  }

  /** Resign — the other player wins. Pass `loser` to specify which side
   *  is resigning; omit to fall back to "current color resigns" (correct for
   *  local hot-seat games). In AI games the caller must pass `playerColor`,
   *  because the AI may be the side currentColor is pointing at. */
  resign(loser?: Color): void {
    if (this.phase !== 'playing') return;

    const losingColor = loser ?? this.currentColor;
    const winner = oppositeColor(losingColor);
    this.phase = 'finished';
    this.result = {
      winner,
      blackScore: 0,
      whiteScore: 0,
      blackTerritory: 0,
      whiteTerritory: 0,
      blackCaptures: this.board.captures[Color.Black],
      whiteCaptures: this.board.captures[Color.White],
      komi: this.komi,
    };
  }

  /** Score the game using Japanese rules (territory scoring).
   *  Score = empty territory + captured stones + komi.
   *  Simpler for kids: "count the empty space you surround, add your captures." */
  score(): GameResult {
    const { blackTerritory, whiteTerritory } = this.board.scoreTerritory();

    const blackCaptures = this.board.captures[Color.Black];
    const whiteCaptures = this.board.captures[Color.White];
    const blackScore = blackTerritory.size + blackCaptures;
    const whiteScore = whiteTerritory.size + whiteCaptures + this.komi;

    const winner = blackScore > whiteScore ? Color.Black : Color.White;

    this.result = {
      winner,
      blackScore,
      whiteScore,
      blackTerritory: blackTerritory.size,
      whiteTerritory: whiteTerritory.size,
      blackCaptures,
      whiteCaptures,
      komi: this.komi,
    };

    this.phase = 'finished';
    return this.result;
  }

  /** Undo the last move (for casual games) */
  undo(): boolean {
    if (this.moveHistory.length === 0) return false;
    if (this.phase !== 'playing') return false;

    const size = this.board.size;
    const moves = this.moveHistory.slice(0, -1);
    this.board = new Board(size);
    this.moveHistory = [];
    this.consecutivePasses = 0;

    // Restore handicap setup so the stones don't vanish on undo (TestFlight
    // beta bug #8, 2026-05-14). Also sets currentColor to White if there's
    // a handicap, so the very first replay move belongs to the right side.
    if (this.handicapStones.length > 0) {
      for (const p of this.handicapStones) {
        this.board.grid[p.row * size + p.col] = Color.Black;
      }
      this.currentColor = Color.White;
    } else {
      this.currentColor = Color.Black;
    }

    for (const move of moves) {
      // Force currentColor to match the recorded move color. The replay
      // loop used to rely on currentColor flipping naturally via playMove,
      // which silently swapped W/B in handicap games (where W moves first)
      // and any other future scenario that starts with W.
      // MoveRecord.color is technically `Color`, but in practice the
      // engine only ever records Black or White moves — narrow here.
      this.currentColor = move.color as Stone;
      if (move.point) {
        this.playMove(move.point);
      } else {
        this.pass();
      }
    }

    return true;
  }

  /** Get all legal moves for the current player */
  getLegalMoves(): Point[] {
    if (this.phase !== 'playing') return [];

    const moves: Point[] = [];
    for (let row = 0; row < this.board.size; row++) {
      for (let col = 0; col < this.board.size; col++) {
        const point = { row, col };
        const testBoard = this.board.clone();
        const { result } = testBoard.tryPlay(this.currentColor, point);
        if (result === MoveResult.Ok) {
          moves.push(point);
        }
      }
    }
    return moves;
  }

  /** Export game to SGF format */
  toSGF(): string {
    let sgf = '(;GM[1]FF[4]CA[UTF-8]';
    sgf += `SZ[${this.board.size}]`;
    sgf += `KM[${this.komi}]`;
    sgf += `RU[Japanese]`;
    if (this.handicapStones.length > 0) {
      sgf += `HA[${this.handicapStones.length}]`;
      // AB = Add Black (setup stones). Must precede any numbered moves.
      sgf += 'AB';
      for (const p of this.handicapStones) {
        const col = String.fromCharCode(97 + p.col);
        const row = String.fromCharCode(97 + p.row);
        sgf += `[${col}${row}]`;
      }
    }

    if (this.result) {
      const winner = this.result.winner === Color.Black ? 'B' : 'W';
      const margin = Math.abs(this.result.blackScore - this.result.whiteScore);
      sgf += `RE[${winner}+${margin}]`;
    }

    for (const move of this.moveHistory) {
      const colorChar = move.color === Color.Black ? 'B' : 'W';
      if (move.point) {
        const col = String.fromCharCode(97 + move.point.col);
        const row = String.fromCharCode(97 + move.point.row);
        sgf += `;${colorChar}[${col}${row}]`;
      } else {
        sgf += `;${colorChar}[]`;
      }
    }

    sgf += ')';
    return sgf;
  }

  /** Import game from SGF string */
  static fromSGF(sgf: string): Game {
    // Extract size (default 19)
    const sizeMatch = sgf.match(/SZ\[(\d+)\]/);
    const size = sizeMatch ? parseInt(sizeMatch[1], 10) : BOARD_SIZE;

    // Extract komi (default 7.5)
    const komiMatch = sgf.match(/KM\[([^\]]+)\]/);
    const komi = komiMatch ? parseFloat(komiMatch[1]) : DEFAULT_KOMI;

    const game = new Game(komi, size);

    // AB = Add Black setup stones (handicap). Must apply before any moves.
    const abMatch = sgf.match(/AB((?:\[[a-z]{2}\])+)/);
    if (abMatch) {
      const stoneRegex = /\[([a-z]{2})\]/g;
      const stones: Point[] = [];
      let m: RegExpExecArray | null;
      while ((m = stoneRegex.exec(abMatch[1])) !== null) {
        const coords = m[1];
        const col = coords.charCodeAt(0) - 97;
        const row = coords.charCodeAt(1) - 97;
        stones.push({ row, col });
      }
      if (stones.length > 0) game.setHandicap(stones);
    }

    // Extract moves. SGF coords use 'a'..'s' for 19 (and subsets for smaller boards).
    const moveRegex = /;([BW])\[([a-z]{0,2})\]/g;
    let match: RegExpExecArray | null;

    while ((match = moveRegex.exec(sgf)) !== null) {
      const coords = match[2];
      // The recorded color drives the move; without this, fromSGF would
      // play W first as Black on handicap games (the same currentColor
      // assumption that bit Game.undo's replay loop pre-fix).
      game.currentColor = match[1] === 'B' ? Color.Black : Color.White;
      if (coords.length === 2) {
        const col = coords.charCodeAt(0) - 97;
        const row = coords.charCodeAt(1) - 97;
        game.playMove({ row, col });
      } else {
        game.pass();
      }
    }

    return game;
  }
}
