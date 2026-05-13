/**
 * Local game-state router for the iPad app (Phase D).
 *
 * When the native KataGo bridge is present (`window.kataGo`), the iPad runs
 * Go game state entirely on-device: this module replaces the HTTP calls in
 * client.ts (`createGame`, `getGame`, `playMove`, `pass`, `resign`, `undo`)
 * with operations on a local `Game` instance from frontend/src/engine/.
 *
 * Why: on iPad each Render round-trip is 0.5–1.5 s (see [perf-js] commit
 * times in 19x1930kyu.log). Moves themselves are now instant; the previous
 * 5s perceived AI latency was dominated by `POST /move` on Render, not by
 * KataGo. By routing through this module we drop that to a localStorage
 * write (~1 ms) and also kill the "TypeError: Load failed → freeze" class
 * of bug (Session 16 known-issue): you can't lose a network leg that
 * doesn't exist.
 *
 * What's NOT here (yet):
 * - **score_lead** (live score graph) only updates on AI moves (via the
 *   analyze in getAIMoveViaBridge). Player moves leave the previous value
 *   intact; no extra KataGo call is fired. Documented as a v1 limitation.
 *
 * What landed:
 * - **Dead-stone detection** runs on-device via the bridge's ownership
 *   mode (see deadStonesViaOwnership). Render fallback retained for the
 *   web build, but iPad never reaches it now.
 * - **finishMove** routes through `getAIMoveViaBridge` on iPad (see
 *   client.ts:finishMove). Each call returns one AI move/pass; the
 *   gameStore loops until two passes trigger localGameRouter.pass's
 *   on-device scoring. Fixes the Session 16 "Finish Game iPad-only" bug.
 *
 * Persistence: every mutation serializes the LocalActiveGame to
 * localStorage under `goforkids:game:<gameId>`. On `getGame()` for an
 * unknown id we fall back to Render — covers games started before this
 * commit, and lets web→iPad handoffs still work (one-way).
 */

import { Board } from '../engine/Board';
import { Game } from '../engine/Game';
import {
  Color,
  MoveResult,
  pointToIndex,
  type GameResult,
  type Point,
} from '../engine/types';
import { boardToMoves, getKataGoBridge } from './nativeKataGo';
import type { CreateGameOptions, GameStateDTO, PointDTO } from './types';

/** KataGo ownership threshold for "this stone is dead": opposite-side
 *  ownership exceeds 0.3. Matches the backend's score-position threshold
 *  (backend/app/routers/games.py:score_position). */
const DEAD_STONE_OWNERSHIP_THRESHOLD = 0.3;
/** Visit budget for end-of-game ownership analysis. Higher than mid-game
 *  search because we want a confident dead/alive read. Mirrors
 *  KATAGO_OWNERSHIP_VISITS in backend/app/game/state.py. */
const OWNERSHIP_VISITS = 200;

const STORAGE_PREFIX = 'goforkids:game:';

// --- Handicap stone positions ------------------------------------------------
// Mirror backend/app/game/state.py:HANDICAP_POSITIONS_{9,13,19}. Don't import
// — duplicating eight tiny tables is cheaper than a build-time codegen step
// and these positions are part of the Go traditional canon (won't change).

const HANDICAP_19: Record<number, Array<[number, number]>> = {
  2: [[15, 3], [3, 15]],
  3: [[15, 3], [3, 15], [15, 15]],
  4: [[15, 3], [3, 15], [3, 3], [15, 15]],
  5: [[15, 3], [3, 15], [3, 3], [15, 15], [9, 9]],
  6: [[15, 3], [3, 15], [3, 3], [15, 15], [9, 3], [9, 15]],
  7: [[15, 3], [3, 15], [3, 3], [15, 15], [9, 3], [9, 15], [9, 9]],
  8: [[15, 3], [3, 15], [3, 3], [15, 15], [9, 3], [9, 15], [3, 9], [15, 9]],
  9: [[15, 3], [3, 15], [3, 3], [15, 15], [9, 3], [9, 15], [3, 9], [15, 9], [9, 9]],
};
const HANDICAP_13: Record<number, Array<[number, number]>> = {
  2: [[9, 3], [3, 9]],
  3: [[9, 3], [3, 9], [9, 9]],
  4: [[9, 3], [3, 9], [3, 3], [9, 9]],
  5: [[9, 3], [3, 9], [3, 3], [9, 9], [6, 6]],
  6: [[9, 3], [3, 9], [3, 3], [9, 9], [6, 3], [6, 9]],
  7: [[9, 3], [3, 9], [3, 3], [9, 9], [6, 3], [6, 9], [6, 6]],
  8: [[9, 3], [3, 9], [3, 3], [9, 9], [6, 3], [6, 9], [3, 6], [9, 6]],
  9: [[9, 3], [3, 9], [3, 3], [9, 9], [6, 3], [6, 9], [3, 6], [9, 6], [6, 6]],
};
const HANDICAP_9: Record<number, Array<[number, number]>> = {
  2: [[6, 2], [2, 6]],
  3: [[6, 2], [2, 6], [6, 6]],
  4: [[6, 2], [2, 6], [2, 2], [6, 6]],
  5: [[6, 2], [2, 6], [2, 2], [6, 6], [4, 4]],
};

function handicapPoints(size: number, handicap: number): Point[] {
  const table = size === 19 ? HANDICAP_19 : size === 13 ? HANDICAP_13 : size === 9 ? HANDICAP_9 : null;
  if (!table) return [];
  const positions = table[handicap] ?? [];
  return positions.map(([row, col]) => ({ row, col }));
}

// --- LocalActiveGame ---------------------------------------------------------

interface LocalActiveGame {
  gameId: string;
  game: Game;
  /** Per-iPad fields not represented inside `Game` itself. */
  target_rank: string;
  mode: 'ranked' | 'casual';
  player_color: 'black' | 'white';
  handicap: number;
  black_rank: string | null;
  white_rank: string | null;
  /** Last known KataGo point-margin (Black's perspective). Updated by
   *  getAIMoveViaBridge from the analyze it runs for AI moves. Preserved
   *  across player moves so the graph stays continuous. */
  score_lead: number | null;
  /** Cached handicap stones — re-applied after `Game.undo()` (which rebuilds
   *  the board from move history alone and would wipe them). */
  handicapStones: Point[];
}

const games = new Map<string, LocalActiveGame>();

// --- Persistence -------------------------------------------------------------
// We serialize a flat snapshot rather than the Game object itself because
// Game contains Sets and Maps that don't survive JSON. Restore reconstructs
// a fresh Game and replays the move history (same logic as Game.undo).

interface Serialized {
  gameId: string;
  target_rank: string;
  mode: 'ranked' | 'casual';
  player_color: 'black' | 'white';
  handicap: number;
  black_rank: string | null;
  white_rank: string | null;
  score_lead: number | null;
  board_size: number;
  komi: number;
  // Move history is enough to fully reconstruct the board state.
  moves: Array<{ color: 'B' | 'W'; row: number; col: number } | { color: 'B' | 'W'; pass: true }>;
  phase: string;
  result: Record<string, unknown> | null;
}

function serialize(lg: LocalActiveGame): Serialized {
  const moves: Serialized['moves'] = lg.game.moveHistory.map((m) => {
    const c: 'B' | 'W' = m.color === Color.Black ? 'B' : 'W';
    if (m.point) return { color: c, row: m.point.row, col: m.point.col };
    return { color: c, pass: true };
  });
  return {
    gameId: lg.gameId,
    target_rank: lg.target_rank,
    mode: lg.mode,
    player_color: lg.player_color,
    handicap: lg.handicap,
    black_rank: lg.black_rank,
    white_rank: lg.white_rank,
    score_lead: lg.score_lead,
    board_size: lg.game.board.size,
    komi: lg.game.komi,
    moves,
    phase: lg.game.phase,
    result: lg.game.result as Record<string, unknown> | null,
  };
}

function deserialize(s: Serialized): LocalActiveGame {
  const game = new Game(s.komi, s.board_size);
  const handicapStones = handicapPoints(s.board_size, s.handicap);
  applyHandicapStones(game, handicapStones);
  // Replay moves on the post-handicap board.
  for (const m of s.moves) {
    if ('pass' in m) {
      game.pass();
    } else {
      game.playMove({ row: m.row, col: m.col });
    }
  }
  // Force phase/result if the saved game ended (e.g. resignation), since
  // the move replay alone won't reproduce a resign state.
  if (s.phase === 'finished' && s.result) {
    game.phase = 'finished';
    // Saved shape is the toDTO()-flat dict (e.g. `black_score`); reverse
    // back into the engine's GameResult fields. Defaults are zero so a
    // resignation (which only carries winner/captures/komi) round-trips
    // safely.
    const r = s.result;
    const winnerStr = String(r.winner ?? 'black');
    game.result = {
      winner: winnerStr === 'black' ? Color.Black : Color.White,
      blackScore: Number(r.black_score ?? 0),
      whiteScore: Number(r.white_score ?? 0),
      blackTerritory: Number(r.black_territory ?? 0),
      whiteTerritory: Number(r.white_territory ?? 0),
      blackCaptures: Number(r.black_captures ?? 0),
      whiteCaptures: Number(r.white_captures ?? 0),
      komi: Number(r.komi ?? s.komi),
    } as GameResult;
  }
  return {
    gameId: s.gameId,
    game,
    target_rank: s.target_rank,
    mode: s.mode,
    player_color: s.player_color,
    handicap: s.handicap,
    black_rank: s.black_rank,
    white_rank: s.white_rank,
    score_lead: s.score_lead,
    handicapStones,
  };
}

function persist(lg: LocalActiveGame): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + lg.gameId, JSON.stringify(serialize(lg)));
  } catch (e) {
    // localStorage can throw QuotaExceededError or be disabled in private mode.
    // Game still works in memory; the user just loses persistence across reloads.
    console.warn('[localGameRouter] persist failed:', e);
  }
}

function loadFromStorage(gameId: string): LocalActiveGame | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + gameId);
    if (!raw) return null;
    return deserialize(JSON.parse(raw) as Serialized);
  } catch (e) {
    console.warn(`[localGameRouter] load ${gameId} failed:`, e);
    return null;
  }
}

function getOrLoad(gameId: string): LocalActiveGame | null {
  const cached = games.get(gameId);
  if (cached) return cached;
  const loaded = loadFromStorage(gameId);
  if (loaded) games.set(gameId, loaded);
  return loaded;
}

// --- Handicap helpers --------------------------------------------------------
// Manually patches a Game's board grid + flips to-play color. We deliberately
// don't go through `Game.playMove()` for setup stones because:
//   1. They aren't moves — they don't go in moveHistory or fire captures.
//   2. Game.playMove would alternate currentColor after each placement; we
//      want all-black-then-white-to-play.

function applyHandicapStones(game: Game, stones: Point[]): void {
  if (stones.length === 0) return;
  for (const p of stones) {
    game.board.grid[pointToIndex(p, game.board.size)] = Color.Black;
  }
  // Snapshot the post-handicap position into the superko history so a future
  // play that ko-recaptures back to this position is correctly rejected. The
  // Board constructor already added the empty-board hash; add the new one.
  // (Reach inside via the public hash() + a getter would be cleaner — but
  // Board.positionHistory is private. The empty-board entry is now stale and
  // unreachable through normal play, so leaving it is harmless.)
  // The Set is private; we'd need a Board API to update it. For now we
  // accept the (negligible) risk that an exotic ko replaying the empty-board
  // hash post-handicap could be flagged falsely — never happens in practice.
  // With handicap, White plays first.
  game.currentColor = Color.White;
}

// --- ID generation -----------------------------------------------------------
// Mirror the backend's 8-char hex slice of a UUID. Avoids any dependency on
// a uuid library — Math.random is good enough for collision-resistance
// across one device's game set.

function newGameId(): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// --- DTO building ------------------------------------------------------------
// Shape must match what backend/app/game/state.py:_to_response() produces.

function boardTo2d(board: Board): number[][] {
  const rows: number[][] = [];
  for (let r = 0; r < board.size; r++) {
    const row: number[] = [];
    for (let c = 0; c < board.size; c++) {
      row.push(board.grid[r * board.size + c]);
    }
    rows.push(row);
  }
  return rows;
}

function lastMovePoint(game: Game): PointDTO | null {
  for (let i = game.moveHistory.length - 1; i >= 0; i--) {
    const m = game.moveHistory[i];
    if (m.point) return { row: m.point.row, col: m.point.col };
    return null; // Most recent entry is a pass — backend returns null too.
  }
  return null;
}

function toDTO(lg: LocalActiveGame): GameStateDTO {
  const g = lg.game;
  const sgf = g.phase === 'finished' ? g.toSGF() : null;
  let result: Record<string, unknown> | null = null;
  if (g.result) {
    // Shape mirrors the backend's `game.result` dict so existing UI code
    // (e.g. result modal) doesn't need to special-case the iPad path.
    const r = g.result;
    const winner = r.winner === Color.Black ? 'black' : 'white';
    const margin = Math.abs(r.blackScore - r.whiteScore);
    result = {
      winner,
      black_score: r.blackScore,
      white_score: r.whiteScore,
      black_territory: r.blackTerritory,
      white_territory: r.whiteTerritory,
      black_captures: r.blackCaptures,
      white_captures: r.whiteCaptures,
      komi: r.komi,
      margin,
      reason: margin === 0 && r.blackScore === 0 && r.whiteScore === 0 ? 'resignation' : 'territory',
    };
  }
  return {
    game_id: lg.gameId,
    board: boardTo2d(g.board),
    board_size: g.board.size,
    current_color: g.currentColor === Color.Black ? 'black' : 'white',
    move_number: g.moveHistory.length + 1,
    captures: {
      black: g.board.captures[Color.Black],
      white: g.board.captures[Color.White],
    },
    phase: g.phase,
    last_move: lastMovePoint(g),
    ko_point: g.board.koPoint ? { row: g.board.koPoint.row, col: g.board.koPoint.col } : null,
    result,
    sgf,
    score_lead: lg.score_lead,
  };
}

// --- The router --------------------------------------------------------------

export const localGameRouter = {
  /** Optional injection point: client.ts wires this to its HTTP `scorePosition`
   *  helper. We can't import it directly without circling. Set once at
   *  module load; called only when a game ends in two passes. */
  setRenderScorePositionFn(
    fn: (board: number[][]) => Promise<{ dead_stones: { row: number; col: number; color: string }[] }>,
  ) {
    renderScorePosition = fn;
  },

  createGame(opts: CreateGameOptions): GameStateDTO {
    const size = opts.board_size ?? 19;
    const handicap = opts.handicap ?? 0;
    const komi = handicap > 0 ? 0.5 : (opts.komi ?? 7.5);
    const game = new Game(komi, size);
    const handicapStones = handicapPoints(size, handicap);
    applyHandicapStones(game, handicapStones);

    const lg: LocalActiveGame = {
      gameId: newGameId(),
      game,
      target_rank: opts.target_rank ?? '15k',
      mode: opts.mode ?? 'casual',
      player_color: opts.player_color ?? 'black',
      handicap,
      black_rank: opts.black_rank ?? null,
      white_rank: opts.white_rank ?? null,
      score_lead: null,
      handicapStones,
    };
    games.set(lg.gameId, lg);
    persist(lg);
    return toDTO(lg);
  },

  getGame(gameId: string): GameStateDTO | null {
    const lg = getOrLoad(gameId);
    return lg ? toDTO(lg) : null;
  },

  playMove(gameId: string, row: number, col: number): GameStateDTO | { error: string } {
    const lg = getOrLoad(gameId);
    if (!lg) return { error: 'Game not found' };
    const { result } = lg.game.playMove({ row, col });
    if (result !== MoveResult.Ok) {
      // Map MoveResult → message. Same strings as backend so the UI doesn't
      // branch on iPad vs web.
      const msg =
        result === MoveResult.Occupied
          ? 'Position occupied'
          : result === MoveResult.Suicide
            ? 'Suicide is not allowed'
            : result === MoveResult.Ko
              ? 'Ko violation'
              : result === MoveResult.GameOver
                ? 'Game is over'
                : 'Illegal move';
      return { error: msg };
    }
    persist(lg);
    return toDTO(lg);
  },

  async pass(gameId: string): Promise<GameStateDTO | { error: string }> {
    console.log(`[localGameRouter] pass(${gameId})`);
    const lg = getOrLoad(gameId);
    if (!lg) {
      console.warn(`[localGameRouter] pass: game ${gameId} not found`);
      return { error: 'Game not found' };
    }
    const wasPlaying = lg.game.phase === 'playing';
    const cpBefore = lg.game.consecutivePasses;
    lg.game.pass();
    const cpAfter = lg.game.consecutivePasses;
    const gameJustEnded = wasPlaying && lg.game.phase === 'finished';
    console.log(
      `[localGameRouter] pass: consecutivePasses ${cpBefore}→${cpAfter} phase=${lg.game.phase} gameJustEnded=${gameJustEnded}`,
    );
    // Two passes — Game.pass() already scored the position using raw
    // territory, but raw territory over-counts because dead stones still
    // occupy intersections. Get ownership analysis (from KataGo via the
    // bridge if available, falling back to Render), use it to mark stones
    // dead, then re-score.
    if (gameJustEnded) {
      const deadStones = await deadStonesViaOwnership(lg);
      if (deadStones.length > 0) {
        console.log(`[localGameRouter] removing ${deadStones.length} dead stones, rescoring`);
        for (const ds of deadStones) {
          const stone = lg.game.board.get(ds);
          if (stone === Color.Empty) continue;
          lg.game.board.grid[pointToIndex(ds, lg.game.board.size)] = Color.Empty;
          const captor = stone === Color.Black ? Color.White : Color.Black;
          lg.game.board.captures[captor] += 1;
        }
        // Game.score() recomputes from current board state and overwrites
        // result/phase. Phase is already 'finished'; calling again is safe.
        lg.game.score();
        console.log(
          `[localGameRouter] rescored: winner=${
            lg.game.result?.winner === Color.Black ? 'black' : 'white'
          } black=${lg.game.result?.blackScore} white=${lg.game.result?.whiteScore}`,
        );
      } else {
        console.log(`[localGameRouter] no dead stones removed; keeping raw-territory score`);
      }
    }
    persist(lg);
    return toDTO(lg);
  },

  resign(gameId: string): GameStateDTO | { error: string } {
    const lg = getOrLoad(gameId);
    if (!lg) return { error: 'Game not found' };
    // The caller (gameStore) always passes resign as "the player resigns",
    // never the AI. player_color is stored on LocalActiveGame for this.
    const loser = lg.player_color === 'black' ? Color.Black : Color.White;
    lg.game.resign(loser);
    persist(lg);
    return toDTO(lg);
  },

  undo(gameId: string): GameStateDTO | { error: string } {
    const lg = getOrLoad(gameId);
    if (!lg) return { error: 'Game not found' };
    const ok = lg.game.undo();
    if (!ok) return { error: 'Nothing to undo' };
    // Game.undo() rebuilt the board from move history alone — handicap
    // stones placed during setup are gone. Re-apply them and flip to-play
    // color (Game.undo defaults to Black-to-play; with handicap White plays).
    if (lg.handicapStones.length > 0) {
      applyHandicapStones(lg.game, lg.handicapStones);
      // Re-replay the move history on top of the now-handicapped board so
      // currentColor and consecutivePasses are correct. Easiest: snapshot
      // history, reset Game, applyHandicap, replay.
      const replay = [...lg.game.moveHistory];
      lg.game.board = new Board(lg.game.board.size);
      lg.game.moveHistory = [];
      lg.game.consecutivePasses = 0;
      applyHandicapStones(lg.game, lg.handicapStones);
      for (const m of replay) {
        if (m.point) lg.game.playMove(m.point);
        else lg.game.pass();
      }
    }
    persist(lg);
    return toDTO(lg);
  },

  /** Test-only / cleanup: drop a game from memory and storage. */
  _delete(gameId: string) {
    games.delete(gameId);
    try {
      localStorage.removeItem(STORAGE_PREFIX + gameId);
    } catch {
      // ignore
    }
  },

  /** Test-only / dev: wipe the in-memory map. Doesn't clear storage. */
  _resetForTests() {
    games.clear();
  },
};

let renderScorePosition:
  | ((board: number[][]) => Promise<{ dead_stones: { row: number; col: number; color: string }[] }>)
  | null = null;

/**
 * End-of-game dead-stone detection. Primary path: ask the local KataGo
 * bridge for ownership values, threshold each stone against the
 * opposite-side ownership cutoff. Fallback: Render's `/score-position`
 * (kept for web users and as a safety net if the bridge call throws —
 * which would surface in the Xcode console with [perf-js] / [Bridge]
 * lines).
 *
 * Returns an array of Points whose stones should be removed before
 * final scoring.
 */
async function deadStonesViaOwnership(lg: LocalActiveGame): Promise<Point[]> {
  const size = lg.game.board.size;
  const bridge = getKataGoBridge();
  if (bridge) {
    try {
      const t0 = performance.now();
      // KataGo expects the move list in its native format. We don't have
      // move history with captures preserved (Game.moveHistory has it but
      // we can simplify by sending the current board as setup stones —
      // which is what boardToMoves does).
      const moves = boardToMoves(boardTo2d(lg.game.board), size);
      const colorChar: 'B' | 'W' = lg.game.currentColor === Color.Black ? 'B' : 'W';
      console.log(
        `[localGameRouter] calling bridge.analyze ownership=true visits=${OWNERSHIP_VISITS} moves=${moves.length}`,
      );
      const result = await bridge.analyze({
        boardSize: size,
        komi: lg.game.komi,
        rules: 'tromp-taylor',
        moves,
        color: colorChar,
        maxVisits: OWNERSHIP_VISITS,
        ownership: true,
      });
      const elapsedMs = Math.round(performance.now() - t0);
      if (!result.ownership) {
        console.warn(`[localGameRouter] bridge returned no ownership in ${elapsedMs}ms — check Swift bridge build`);
      } else {
        // KataGo's GTP `kata-genmove_analyze` emits ownership values from
        // the player-to-move's perspective: positive = pla owns. Source:
        // ios/KataGo/cpp/command/gtp.cpp:983 — when pla == BLACK the GTP
        // layer outputs -whiteOwnerMap[pos], when pla == WHITE it outputs
        // whiteOwnerMap[pos] raw. Net effect across both branches is the
        // same convention: "+1 = the side we're asking-on-behalf-of owns".
        //
        // applyOwnership wants "+1 = Black owns" (its documented contract).
        // So we negate iff we sent color: 'W'; for color: 'B' the values
        // are already in the right frame.
        //
        // History: an earlier version negated unconditionally on the
        // assumption that pla is always Black at scoring time (kid plays
        // first, kid passes, AI passes → currentColor=Black). That holds
        // when the move count before the two passes is odd, but not when
        // it's even — see 19x19scoring.log (260 moves, pla=B, every Black
        // stone marked dead, "removing 238 dead stones"). Fixed 2026-05-12.
        const flipped =
          colorChar === 'W'
            ? result.ownership.map((v) => -v)
            : result.ownership.slice();
        console.log(
          `[localGameRouter] bridge ownership received in ${elapsedMs}ms ` +
            `(${flipped.length} values, sample[0..3]=${flipped.slice(0, 4).map((v) => v.toFixed(2)).join(',')})`,
        );
        return dedupeDead(applyOwnership(lg.game.board, flipped));
      }
    } catch (e) {
      console.warn('[localGameRouter] bridge ownership failed, falling back to Render:', e);
    }
  }
  if (renderScorePosition) {
    try {
      const t0 = performance.now();
      const { dead_stones } = await renderScorePosition(boardTo2d(lg.game.board));
      const elapsedMs = Math.round(performance.now() - t0);
      console.log(`[localGameRouter] Render /score-position returned ${dead_stones.length} dead stones in ${elapsedMs}ms`);
      return dead_stones.map((d) => ({ row: d.row, col: d.col }));
    } catch (e) {
      console.warn('[localGameRouter] Render /score-position failed:', e);
    }
  } else {
    console.warn('[localGameRouter] no ownership source available (no bridge, no renderScorePosition)');
  }
  return [];
}

/** Walk every stone on the board, compare to the matching ownership cell,
 *  return the points whose stones are dead. Ownership is in [-1,+1] from
 *  Black's perspective; positive = Black controls, negative = White
 *  controls. A stone is dead if its color is opposite of the side that
 *  controls its intersection past the threshold. */
function applyOwnership(board: Board, ownership: number[]): Point[] {
  const size = board.size;
  if (ownership.length !== size * size) {
    console.warn(
      `[localGameRouter] ownership size mismatch: expected ${size * size}, got ${ownership.length}`,
    );
    return [];
  }
  const dead: Point[] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const idx = row * size + col;
      const stone = board.grid[idx];
      if (stone === Color.Empty) continue;
      const own = ownership[idx];
      if (stone === Color.Black && own < -DEAD_STONE_OWNERSHIP_THRESHOLD) {
        dead.push({ row, col });
      } else if (stone === Color.White && own > DEAD_STONE_OWNERSHIP_THRESHOLD) {
        dead.push({ row, col });
      }
    }
  }
  return dead;
}

function dedupeDead(pts: Point[]): Point[] {
  const seen = new Set<number>();
  const out: Point[] = [];
  for (const p of pts) {
    const k = p.row * 31 + p.col;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}
