import { create } from 'zustand';
import { Game } from '../engine/Game';
import { Board } from '../engine/Board';
import { Color, BOARD_SIZE, type Point } from '../engine/types';

interface TerritoryMap {
  black: Set<number>;
  white: Set<number>;
  neutral: Set<number>;
}

interface ReplayState {
  active: boolean;
  sgf: string;
  totalMoves: number;
  currentMove: number;
  grid: number[];
  lastMove: Point | null;
  territory: TerritoryMap | null;
  gameResult: string;
  playerColor: string;
  opponentRank: string;
  autoPlaying: boolean;
  autoPlaySpeed: number;  // ms between moves
  _autoPlayTimer: number | null;

  loadGame: (sgf: string, meta?: { result?: string; playerColor?: string; opponentRank?: string }) => void;
  goToMove: (n: number) => void;
  nextMove: () => void;
  prevMove: () => void;
  firstMove: () => void;
  lastMovePos: () => void;
  toggleAutoPlay: () => void;
  setAutoPlaySpeed: (ms: number) => void;
  downloadSGF: () => void;
  close: () => void;
}

function replayToMove(sgf: string, moveNum: number, total: number): {
  grid: number[];
  lastMove: Point | null;
  territory: TerritoryMap | null;
} {
  const game = Game.fromSGF(sgf);
  const allMoves = game.moveHistory;
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

  // Compute territory at the final position
  let territory: TerritoryMap | null = null;
  if (moveNum >= total && total > 0) {
    const { blackTerritory, whiteTerritory, neutral } = board.scoreTerritory();
    territory = { black: blackTerritory, white: whiteTerritory, neutral };
  }

  return { grid: [...board.grid], lastMove, territory };
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
  territory: null,
  gameResult: '',
  playerColor: 'black',
  opponentRank: '',
  autoPlaying: false,
  autoPlaySpeed: 600,
  _autoPlayTimer: null,

  loadGame: (sgf, meta) => {
    // Stop any existing autoplay
    const prev = get()._autoPlayTimer;
    if (prev) clearTimeout(prev);

    const total = countMoves(sgf);
    const { grid, lastMove, territory } = replayToMove(sgf, 0, total);
    set({
      active: true,
      sgf,
      totalMoves: total,
      currentMove: 0,
      grid,
      lastMove,
      territory,
      gameResult: meta?.result ?? '',
      playerColor: meta?.playerColor ?? 'black',
      opponentRank: meta?.opponentRank ?? '',
      autoPlaying: false,
      _autoPlayTimer: null,
    });
  },

  goToMove: (n: number) => {
    const { sgf, totalMoves } = get();
    const clamped = Math.max(0, Math.min(n, totalMoves));
    const { grid, lastMove, territory } = replayToMove(sgf, clamped, totalMoves);
    set({ currentMove: clamped, grid, lastMove, territory });
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

  toggleAutoPlay: () => {
    const { autoPlaying, _autoPlayTimer, currentMove, totalMoves, autoPlaySpeed } = get();

    if (autoPlaying) {
      // Stop
      if (_autoPlayTimer) clearTimeout(_autoPlayTimer);
      set({ autoPlaying: false, _autoPlayTimer: null });
    } else {
      // Start (reset to beginning if at end)
      if (currentMove >= totalMoves) {
        get().goToMove(0);
      }
      set({ autoPlaying: true });

      const tick = () => {
        const { currentMove: cm, totalMoves: tm, autoPlaying: ap } = get();
        if (!ap || cm >= tm) {
          set({ autoPlaying: false, _autoPlayTimer: null });
          return;
        }
        get().goToMove(cm + 1);
        const timer = window.setTimeout(tick, get().autoPlaySpeed);
        set({ _autoPlayTimer: timer });
      };

      const timer = window.setTimeout(tick, autoPlaySpeed);
      set({ _autoPlayTimer: timer });
    }
  },

  setAutoPlaySpeed: (ms: number) => {
    set({ autoPlaySpeed: ms });
  },

  downloadSGF: () => {
    const { sgf, opponentRank } = get();
    if (!sgf) return;

    const blob = new Blob([sgf], { type: 'application/x-go-sgf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `game-vs-${opponentRank || 'unknown'}-${Date.now()}.sgf`;
    a.click();
    URL.revokeObjectURL(url);
  },

  close: () => {
    const timer = get()._autoPlayTimer;
    if (timer) clearTimeout(timer);
    set({ active: false, autoPlaying: false, _autoPlayTimer: null });
  },
}));
