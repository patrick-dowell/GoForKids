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

  constructor(komi: number = DEFAULT_KOMI, size: number = BOARD_SIZE) {
    this.board = new Board(size);
    this.currentColor = Color.Black;
    this.moveHistory = [];
    this.phase = 'playing';
    this.komi = komi;
    this.consecutivePasses = 0;
    this.result = null;
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

  /** Resign — the other player wins */
  resign(): void {
    if (this.phase !== 'playing') return;

    const winner = oppositeColor(this.currentColor);
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
    this.currentColor = Color.Black;
    this.moveHistory = [];
    this.consecutivePasses = 0;

    for (const move of moves) {
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

    // Extract moves. SGF coords use 'a'..'s' for 19 (and subsets for smaller boards).
    const moveRegex = /;([BW])\[([a-z]{0,2})\]/g;
    let match: RegExpExecArray | null;

    while ((match = moveRegex.exec(sgf)) !== null) {
      const coords = match[2];
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
