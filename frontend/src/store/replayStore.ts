import { create } from 'zustand';
import { Game } from '../engine/Game';
import { Board } from '../engine/Board';
import { Color, BOARD_SIZE, type Point } from '../engine/types';
import { api } from '../api/client';
import { playPlaceSound, playCaptureSound, playPassSound, resumeAudio } from '../audio/SoundManager';

/** Count stones present in `prev` but absent in `next` — i.e. captured by the latest move. */
function countCaptures(prev: number[], next: number[]): number {
  let n = 0;
  for (let i = 0; i < prev.length; i++) {
    if (prev[i] !== Color.Empty && next[i] === Color.Empty) n++;
  }
  return n;
}

interface TerritoryMap {
  black: Set<number>;
  white: Set<number>;
  neutral: Set<number>;
}

interface DeadStone { row: number; col: number; color: Color; }

interface ReplayState {
  active: boolean;
  sgf: string;
  boardSize: number;
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
 * A group is dead if all its liberties lie in opponent territory.
 */
function detectDeadStones(board: Board): DeadStone[] {
  const size = board.size;
  const { blackTerritory, whiteTerritory } = board.scoreTerritory();
  const dead: DeadStone[] = [];
  const visited = new Set<number>();

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const idx = row * size + col;
      if (visited.has(idx)) continue;
      const color = board.grid[idx];
      if (color === Color.Empty) continue;

      const group = board.getGroup({ row, col });
      for (const s of group) visited.add(s.row * size + s.col);

      const liberties = board.getLiberties(group);
      if (liberties.length === 0) continue;

      const opponentTerritory = color === Color.Black ? whiteTerritory : blackTerritory;
      const allLibsInOpponentTerritory = liberties.every(
        (lib) => opponentTerritory.has(lib.row * size + lib.col)
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
  size: number;
  lastMove: Point | null;
  territory: TerritoryMap | null;
  deadStones: DeadStone[];
} {
  const game = Game.fromSGF(sgf);
  const size = game.board.size;
  const allMoves = game.moveHistory;
  const board = new Board(size);
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

  let territory: TerritoryMap | null = null;
  let deadStones: DeadStone[] = [];

  if (moveNum >= total && total > 0) {
    deadStones = detectDeadStones(board);

    const scoringBoard = board.clone();
    for (const ds of deadStones) {
      scoringBoard.grid[ds.row * size + ds.col] = Color.Empty;
    }

    const { blackTerritory, whiteTerritory, neutral } = scoringBoard.scoreTerritory();
    territory = { black: blackTerritory, white: whiteTerritory, neutral };
  }

  return { grid: [...board.grid], size, lastMove, territory, deadStones };
}

function countMoves(sgf: string): number {
  try {
    return Game.fromSGF(sgf).moveHistory.length;
  } catch {
    return 0;
  }
}

function sizeFromSGF(sgf: string): number {
  const m = sgf.match(/SZ\[(\d+)\]/);
  return m ? parseInt(m[1], 10) : BOARD_SIZE;
}

export const useReplayStore = create<ReplayState>((set, get) => ({
  active: false,
  sgf: '',
  boardSize: BOARD_SIZE,
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
    const prev = get()._autoPlayTimer;
    if (prev) clearTimeout(prev);

    const total = countMoves(sgf);
    const { grid, size, lastMove, territory, deadStones } = replayToMove(sgf, 0, total);
    set({
      active: true,
      sgf,
      boardSize: size,
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
    const { grid, size, lastMove, territory, deadStones } = replayToMove(sgf, clamped, totalMoves);
    set({ currentMove: clamped, grid, lastMove, territory, deadStones, boardSize: size });

    // At the final move, ask KataGo for accurate dead stone detection
    if (clamped >= totalMoves && totalMoves > 0) {
      const board2d: number[][] = [];
      for (let r = 0; r < size; r++) {
        board2d.push(grid.slice(r * size, (r + 1) * size));
      }
      api.scorePosition(board2d).then((result) => {
        const dead: DeadStone[] = result.dead_stones.map((ds) => ({
          row: ds.row,
          col: ds.col,
          color: ds.color === 'black' ? Color.Black : Color.White,
        }));

        const board = new Board(size);
        board.grid = [...grid];
        for (const ds of dead) {
          board.grid[ds.row * size + ds.col] = Color.Empty;
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
    const { currentMove, totalMoves, grid: prevGrid } = get();
    if (currentMove >= totalMoves) return;
    get().goToMove(currentMove + 1);
    const { grid: newGrid, lastMove } = get();
    resumeAudio();
    if (lastMove) {
      playPlaceSound(lastMove.row, lastMove.col);
      const captured = countCaptures(prevGrid, newGrid);
      if (captured > 0) {
        setTimeout(() => playCaptureSound(captured), 100);
      }
    } else {
      playPassSound();
    }
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
      if (_autoPlayTimer) clearTimeout(_autoPlayTimer);
      set({ autoPlaying: false, _autoPlayTimer: null });
    } else {
      if (currentMove >= totalMoves) {
        get().goToMove(0);
      }
      set({ autoPlaying: true });

      const tick = () => {
        const { currentMove: cm, totalMoves: tm, autoPlaying: ap, grid: prevGrid } = get();
        if (!ap || cm >= tm) {
          set({ autoPlaying: false, _autoPlayTimer: null });
          return;
        }
        get().goToMove(cm + 1);
        const { grid: newGrid, lastMove } = get();
        resumeAudio();
        if (lastMove) {
          playPlaceSound(lastMove.row, lastMove.col);
          const captured = countCaptures(prevGrid, newGrid);
          if (captured > 0) {
            setTimeout(() => playCaptureSound(captured), 100);
          }
        } else {
          playPassSound();
        }
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

// Keep sizeFromSGF accessible if any downstream caller needs it without a full Game parse.
export { sizeFromSGF };
