import { create } from 'zustand';
import { Game } from '../engine/Game';
import { Board } from '../engine/Board';
import { Color, BOARD_SIZE, type Point, MoveResult } from '../engine/types';

interface ReplayState {
  active: boolean;
  sgf: string;
  totalMoves: number;
  currentMove: number;     // 0 = initial position, totalMoves = final
  grid: number[];          // Board state at currentMove
  lastMove: Point | null;  // The move that was just played
  gameResult: string;      // Display string
  playerColor: string;
  opponentRank: string;

  // Actions
  loadGame: (sgf: string, meta?: { result?: string; playerColor?: string; opponentRank?: string }) => void;
  goToMove: (n: number) => void;
  nextMove: () => void;
  prevMove: () => void;
  firstMove: () => void;
  lastMovePos: () => void;
  close: () => void;
}

/** Replay a game up to move N and return the board state */
function replayToMove(sgf: string, moveNum: number): { grid: number[]; lastMove: Point | null } {
  const game = Game.fromSGF(sgf);
  const allMoves = game.moveHistory;

  // Rebuild from scratch up to moveNum
  const board = new Board();
  let lastMove: Point | null = null;
  let currentColor = Color.Black;

  for (let i = 0; i < Math.min(moveNum, allMoves.length); i++) {
    const move = allMoves[i];
    if (move.point) {
      board.tryPlay(currentColor, move.point);
      lastMove = move.point;
    } else {
      lastMove = null;
    }
    currentColor = currentColor === Color.Black ? Color.White : Color.Black;
  }

  return { grid: [...board.grid], lastMove };
}

function countMoves(sgf: string): number {
  try {
    return Game.fromSGF(sgf).moveHistory.length;
  } catch {
    return 0;
  }
}

export const useReplayStore = create<ReplayState>((set, get) => ({
  active: false,
  sgf: '',
  totalMoves: 0,
  currentMove: 0,
  grid: new Array(BOARD_SIZE * BOARD_SIZE).fill(Color.Empty),
  lastMove: null,
  gameResult: '',
  playerColor: 'black',
  opponentRank: '',

  loadGame: (sgf, meta) => {
    const total = countMoves(sgf);
    const { grid, lastMove } = replayToMove(sgf, 0);
    set({
      active: true,
      sgf,
      totalMoves: total,
      currentMove: 0,
      grid,
      lastMove,
      gameResult: meta?.result ?? '',
      playerColor: meta?.playerColor ?? 'black',
      opponentRank: meta?.opponentRank ?? '',
    });
  },

  goToMove: (n: number) => {
    const { sgf, totalMoves } = get();
    const clamped = Math.max(0, Math.min(n, totalMoves));
    const { grid, lastMove } = replayToMove(sgf, clamped);
    set({ currentMove: clamped, grid, lastMove });
  },

  nextMove: () => {
    const { currentMove, totalMoves } = get();
    if (currentMove < totalMoves) get().goToMove(currentMove + 1);
  },

  prevMove: () => {
    const { currentMove } = get();
    if (currentMove > 0) get().goToMove(currentMove - 1);
  },

  firstMove: () => get().goToMove(0),

  lastMovePos: () => get().goToMove(get().totalMoves),

  close: () => set({ active: false }),
}));
