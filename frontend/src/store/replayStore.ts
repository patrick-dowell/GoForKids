import { create } from 'zustand';
import { getKataGoBridge } from '../api/nativeKataGo';
import { Game } from '../engine/Game';
import { Board } from '../engine/Board';
import { Color, BOARD_SIZE, type Point, type Stone } from '../engine/types';
import { api } from '../api/client';
import { playPlaceSound, playCaptureSound, playPassSound, resumeAudio } from '../audio/SoundManager';
import { buildReview, type ReviewHighlight, type ScorePoint } from '../learn/gameReview';

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
  /** Autoplay stops (and clears itself) when the cursor reaches this move —
   *  set by playSegment for the highlight quick-replay. Null = play to end. */
  _autoPlayStopAt: number | null;
  /** Where "back" leads when this replay was opened from the Play-of-the-Game
   *  overlay (§4a quick replay): 'game' reopens the live review, 'demo' the
   *  fixture review. Null = a normal replay, no back affordance. */
  returnToReview: 'game' | 'demo' | null;
  /** Play-of-the-Game highlights for this game (empty if no score data). */
  highlights: ReviewHighlight[];
  /** Per-move score leads saved with the game — drives the replay score
   *  graph. Empty for older saves and stub-AI games (graph hides itself). */
  scoreHistory: ScorePoint[];
  /** See loadGame meta. */
  libraryId: string | null;
  sharedId: string | null;
  /** Dead stones from the live game's scoring (saved with the game), used to
   *  reproduce accurate end-of-game territory in the replay. */
  _savedDeadStones: DeadStone[];

  loadGame: (
    sgf: string,
    meta?: {
      result?: string;
      playerColor?: string;
      opponentRank?: string;
      scoreHistory?: ScorePoint[];
      deadStones?: Array<{ row: number; col: number; color: number }>;
      /** Library id of the SavedGame this replay came from — lets the
       *  replay's Share button upload it and stamp the share code back. */
      libraryId?: string;
      /** Share code when the replay was opened FROM a share link — the
       *  button renders as the link straight away. */
      sharedId?: string;
      /** See ReplayState.returnToReview. */
      returnToReview?: 'game' | 'demo';
    },
  ) => void;
  /** §4a quick replay: jump to `from`, autoplay into `to`, stop there (the
   *  key-move note + graph dot are showing when the motion ends). */
  playSegment: (from: number, to: number) => void;
  goToMove: (n: number) => void;
  nextMove: () => void;
  prevMove: () => void;
  firstMove: () => void;
  lastMovePos: () => void;
  /** Jump to the next / previous highlighted move relative to the current one. */
  nextHighlight: () => void;
  prevHighlight: () => void;
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

  // Place handicap setup stones (all Black) first — otherwise handicap games
  // (every stones-rung on the ranked ladder) replay WITHOUT them, so the board
  // and the final scoring come out wrong. Use each move's recorded color rather
  // than alternating from Black, which also handles White-moves-first handicap.
  for (const p of game.handicapStones) {
    board.grid[p.row * size + p.col] = Color.Black;
  }

  let lastMove: Point | null = null;
  for (let i = 0; i < Math.min(moveNum, allMoves.length); i++) {
    const move = allMoves[i];
    if (move.point) {
      board.tryPlay(move.color as Stone, move.point);
      lastMove = move.point;
    } else {
      lastMove = null;
    }
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
  _autoPlayStopAt: null,
  returnToReview: null,
  highlights: [],
  scoreHistory: [],
  libraryId: null,
  sharedId: null,
  _savedDeadStones: [],

  loadGame: (sgf, meta) => {
    const prev = get()._autoPlayTimer;
    if (prev) clearTimeout(prev);

    const total = countMoves(sgf);
    const { grid, size, lastMove, territory, deadStones } = replayToMove(sgf, 0, total);

    // Play-of-the-Game highlights for the timeline. Needs the move list (from
    // the SGF) + the per-move score history (saved with the game). No score
    // data → buildReview falls back to capture/atari detection.
    let highlights: ReviewHighlight[] = [];
    try {
      const reviewGame = Game.fromSGF(sgf);
      const pc: Stone = (meta?.playerColor ?? 'black') === 'white' ? Color.White : Color.Black;
      // Pass handicap stones so highlight snapshots include Black's setup.
      highlights = buildReview(reviewGame.moveHistory, meta?.scoreHistory ?? [], pc, size, reviewGame.handicapStones);
    } catch {
      // Malformed SGF — leave highlights empty rather than break the replay.
    }

    const savedDead: DeadStone[] = (meta?.deadStones ?? []).map((d) => ({
      row: d.row,
      col: d.col,
      color: d.color as Color,
    }));

    set({
      _savedDeadStones: savedDead,
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
      _autoPlayStopAt: null,
      returnToReview: meta?.returnToReview ?? null,
      highlights,
      scoreHistory: meta?.scoreHistory ?? [],
      libraryId: meta?.libraryId ?? null,
      sharedId: meta?.sharedId ?? null,
    });
  },

  playSegment: (from: number, to: number) => {
    // Stop any running autoplay, seek to the segment start, then autoplay
    // into the target move. toggleAutoPlay's start branch clears the stop
    // target (a manual ▶ always plays to the end), so set it afterwards.
    if (get().autoPlaying) get().toggleAutoPlay();
    get().goToMove(Math.max(0, from));
    get().toggleAutoPlay();
    set({ _autoPlayStopAt: to });
  },

  nextHighlight: () => {
    const { highlights, currentMove } = get();
    const next = highlights
      .map((h) => h.moveNumber)
      .filter((m) => m > currentMove)
      .sort((a, b) => a - b)[0];
    if (next !== undefined) get().goToMove(next);
  },

  prevHighlight: () => {
    const { highlights, currentMove } = get();
    const prev = highlights
      .map((h) => h.moveNumber)
      .filter((m) => m < currentMove)
      .sort((a, b) => b - a)[0];
    if (prev !== undefined) get().goToMove(prev);
  },

  goToMove: (n: number) => {
    const { sgf, totalMoves } = get();
    const clamped = Math.max(0, Math.min(n, totalMoves));
    const { grid, size, lastMove, territory, deadStones } = replayToMove(sgf, clamped, totalMoves);
    set({ currentMove: clamped, grid, lastMove, territory, deadStones, boardSize: size });

    // At the final move, settle the score. Prefer the dead stones the LIVE game
    // already computed (saved with the game) — accurate and synchronous. Only
    // fall back to the Render score-position call when we don't have them
    // (older saves); its catch leaves the heuristic territory in place.
    if (clamped >= totalMoves && totalMoves > 0) {
      const saved = get()._savedDeadStones;
      if (saved.length > 0) {
        const board = new Board(size);
        board.grid = [...grid];
        for (const ds of saved) board.grid[ds.row * size + ds.col] = Color.Empty;
        const { blackTerritory, whiteTerritory, neutral } = board.scoreTerritory();
        set({ deadStones: saved, territory: { black: blackTerritory, white: whiteTerritory, neutral } });
        return;
      }
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
      set({ autoPlaying: false, _autoPlayTimer: null, _autoPlayStopAt: null });
    } else {
      if (currentMove >= totalMoves) {
        get().goToMove(0);
      }
      // Manual ▶ plays to the end — playSegment sets its stop target AFTER
      // this call, so clearing here is what scopes the target to segments.
      set({ autoPlaying: true, _autoPlayStopAt: null });

      const tick = () => {
        const { currentMove: cm, totalMoves: tm, autoPlaying: ap, grid: prevGrid } = get();
        if (!ap || cm >= tm || cm >= (get()._autoPlayStopAt ?? Infinity)) {
          set({ autoPlaying: false, _autoPlayTimer: null, _autoPlayStopAt: null });
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
    const filename = `game-vs-${opponentRank || 'unknown'}-${Date.now()}.sgf`;

    // Inside the native app, the Blob-URL download flow silently no-ops in
    // WKWebView (TestFlight bug, 2026-05-14) — hand the SGF to Swift for the
    // iOS share sheet (AirDrop / Files / other Go apps) instead. Falls back
    // to the web path if the native build predates the shareSGF handler.
    const bridge = getKataGoBridge();
    const webDownload = () => {
      const blob = new Blob([sgf], { type: 'application/x-go-sgf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    };
    if (bridge?.shareSGF) {
      bridge.shareSGF({ sgf, filename }).catch(webDownload);
    } else {
      webDownload();
    }
  },

  close: () => {
    const timer = get()._autoPlayTimer;
    if (timer) clearTimeout(timer);
    set({ active: false, autoPlaying: false, _autoPlayTimer: null, _autoPlayStopAt: null, returnToReview: null });
  },
}));

// Keep sizeFromSGF accessible if any downstream caller needs it without a full Game parse.
export { sizeFromSGF };

// Dev convenience: expose replayStore on `window.__replayStore` to mirror
// the gameStore/autoPlayStore shims. The layout suite uses it to seek the
// replay onto a key move (mounting the highlight note) before sweeping.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __replayStore: typeof useReplayStore }).__replayStore = useReplayStore;
}
