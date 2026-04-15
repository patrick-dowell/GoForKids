import { create } from 'zustand';
import { Game } from '../engine/Game';
import { Board } from '../engine/Board';
import { Color, BOARD_SIZE, type Point } from '../engine/types';
import { api } from '../api/client';

interface TerritoryMap {
  black: Set<number>;
  white: Set<number>;
  neutral: Set<number>;
}

interface DeadStone { row: number; col: number; color: Color; }

interface ReplayState {
  active: boolean;
  sgf: string;
  totalMoves: number;
  currentMove: number;
  grid: number[];
  lastMove: Point | null;
  territory: TerritoryMap | null;
  deadStones: DeadStone[];
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

/**
 * Heuristic dead stone detection for replay (no KataGo needed).
 * A stone is dead if its group is entirely inside opponent territory.
 * We do two passes: first score territory ignoring potential dead stones,
 * then identify groups that are surrounded by opponent territory.
 */
function detectDeadStones(board: Board): DeadStone[] {
  const { blackTerritory, whiteTerritory } = board.scoreTerritory();
  const dead: DeadStone[] = [];
  const visited = new Set<number>();

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const idx = row * BOARD_SIZE + col;
      if (visited.has(idx)) continue;
      const color = board.grid[idx];
      if (color === Color.Empty) continue;

      // Get the whole group
      const group = board.getGroup({ row, col });
      for (const s of group) visited.add(s.row * BOARD_SIZE + s.col);

      // Check if this group is inside opponent territory
      // A group is dead if ALL its liberties are in opponent territory
      const liberties = board.getLiberties(group);
      if (liberties.length === 0) continue; // Already captured — shouldn't happen

      const opponentTerritory = color === Color.Black ? whiteTerritory : blackTerritory;
      const allLibsInOpponentTerritory = liberties.every(
        (lib) => opponentTerritory.has(lib.row * BOARD_SIZE + lib.col)
      );

      if (allLibsInOpponentTerritory) {
        for (const s of group) {
          dead.push({ row: s.row, col: s.col, color: color as Color });
        }
      }
    }
  }

  return dead;
}

function replayToMove(sgf: string, moveNum: number, total: number): {
  grid: number[];
  lastMove: Point | null;
  territory: TerritoryMap | null;
  deadStones: DeadStone[];
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

  // At the final position, detect dead stones and compute territory
  let territory: TerritoryMap | null = null;
  let deadStones: DeadStone[] = [];

  if (moveNum >= total && total > 0) {
    // Detect dead stones first
    deadStones = detectDeadStones(board);

    // Remove dead stones from a scoring copy
    const scoringBoard = board.clone();
    for (const ds of deadStones) {
      scoringBoard.grid[ds.row * BOARD_SIZE + ds.col] = Color.Empty;
    }

    // Score on the cleaned board
    const { blackTerritory, whiteTerritory, neutral } = scoringBoard.scoreTerritory();
    territory = { black: blackTerritory, white: whiteTerritory, neutral };
  }

  return { grid: [...board.grid], lastMove, territory, deadStones };
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
  deadStones: [],
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
    const { grid, lastMove, territory, deadStones } = replayToMove(sgf, 0, total);
    set({
      active: true,
      sgf,
      totalMoves: total,
      currentMove: 0,
      grid,
      lastMove,
      territory,
      deadStones,
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
    const { grid, lastMove, territory, deadStones } = replayToMove(sgf, clamped, totalMoves);
    set({ currentMove: clamped, grid, lastMove, territory, deadStones });

    // At the final move, ask KataGo for accurate dead stone detection
    if (clamped >= totalMoves && totalMoves > 0) {
      // Convert flat grid to 2D for the API
      const board2d: number[][] = [];
      for (let r = 0; r < BOARD_SIZE; r++) {
        board2d.push(grid.slice(r * BOARD_SIZE, (r + 1) * BOARD_SIZE));
      }
      api.scorePosition(board2d).then((result) => {
        const dead: DeadStone[] = result.dead_stones.map((ds) => ({
          row: ds.row,
          col: ds.col,
          color: ds.color === 'black' ? Color.Black : Color.White,
        }));

        // Rescore territory with dead stones removed
        const board = new Board();
        board.grid = [...grid];
        for (const ds of dead) {
          board.grid[ds.row * BOARD_SIZE + ds.col] = Color.Empty;
        }
        const { blackTerritory, whiteTerritory, neutral } = board.scoreTerritory();

        set({
          deadStones: dead,
          territory: { black: blackTerritory, white: whiteTerritory, neutral },
        });
      }).catch(() => {
        // KataGo unavailable — keep the heuristic result
      });
    }
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
