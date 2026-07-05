/**
 * Backend API client for GoForKids.
 * Communicates with the FastAPI backend for game management and AI moves.
 *
 * iPad path (Phase D, May 2026): when `window.kataGo` is injected by the
 * WKWebView bridge, the move-loop endpoints (create / get / play / pass /
 * resign / undo) route through `localGameRouter.ts` instead of hitting
 * Render. Moves drop from ~1.5 s of network round-trip to a localStorage
 * write. See localGameRouter.ts for what stays on Render (scoring with
 * dead stones, finishMove).
 */

import { boardToMoves, fromGtp, getKataGoBridge, type KataGoBridge } from './nativeKataGo';
import {
  selectAiMove,
  boardFromGrid,
  pickLegalNonEyeMove,
  type AnalyzeOpts,
  type PositionAnalysis,
  type MoveCandidate,
} from '../ai/moveSelector';
import { Color, type Stone, type Point } from '../engine/types';
import { recordSelectorLog } from '../ai/selectorLog';
import { localGameRouter } from './localGameRouter';
import type { SavedGame } from '../store/libraryStore';
import type {
  AIMoveDTO,
  CreateGameOptions,
  GameStateDTO,
  PointDTO,
} from './types';

const API_BASE = `${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'}/api`;

/**
 * Number of *additional* retries on network-level fetch failure
 * (`TypeError: Load failed` in WebKit, `TypeError: Failed to fetch` in
 * Chromium). Total attempts = MAX_RETRIES + 1.
 *
 * Why retry only TypeErrors and not HTTP errors:
 *   - TypeError from fetch() means the request never reached the
 *     server (or the response never came back). The server state can't
 *     have changed, so a duplicate POST can't double-play a move —
 *     retrying is safe even for /move and /pass.
 *   - HTTP errors (4xx/5xx) come back as a non-OK response that we
 *     wrap in `new Error(...)`. The server saw the request — retrying
 *     a 400 spams a real bug; retrying a 500 hammers a struggling
 *     server. Surface those to the caller.
 *
 * Surfaces in the iPad WKWebView console as the previously-fatal
 * "AI move failed: TypeError: Load failed" — those should now be
 * preceded by `[api] retrying ... after TypeError` lines.
 */
const MAX_RETRIES = 2;

/** Per-request hard timeout. Comfortably above the ~2-3s a healthy Render call
 *  takes, but bounds a hung connection (server accepted the request but never
 *  responds) so a blocking modal like "Calculating the final score" can't wait
 *  forever. On timeout the fetch aborts → AbortError (a DOMException, NOT a
 *  TypeError, so it doesn't retry) → the caller's catch runs, e.g. the scoring
 *  path flips `scoringInProgress` back to false and the modal clears itself. */
const REQUEST_TIMEOUT_MS = 20_000;

/** In-flight request controllers, so navigation (App's goHome) can abort
 *  everything — a hung backend then can't keep a modal alive after the user
 *  has already left the screen. */
const inFlight = new Set<AbortController>();

/** Abort every in-flight HTTP request. Called by goHome() as part of the
 *  always-works "back to home" teardown (the menu-trap fix). */
export function abortPendingRequests(): void {
  for (const c of inFlight) c.abort();
  inFlight.clear();
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    inFlight.add(controller);
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
        signal: controller.signal,
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(error.detail || `API error: ${res.status}`);
      }
      return res.json();
    } catch (e) {
      lastError = e;
      // Only TypeErrors retry (network leg failed, request didn't land).
      // AbortError (timeout / goHome) and HTTP non-OK are real outcomes; bail.
      const isNetworkError = e instanceof TypeError;
      if (!isNetworkError || attempt === MAX_RETRIES) {
        throw e;
      }
      const delayMs = 300 * Math.pow(3, attempt); // 300ms, 900ms
      console.warn(`[api] retrying ${path} after TypeError (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, e);
      await new Promise((r) => setTimeout(r, delayMs));
    } finally {
      clearTimeout(timer);
      inFlight.delete(controller);
    }
  }
  throw lastError;
}

/** True when the iPad's native KataGo bridge is injected; we then run game
 *  state on-device. Recomputed on every call (cheap) so a developer can
 *  toggle the bridge without restarting. */
function useLocal(): boolean {
  return getKataGoBridge() !== null;
}

/** Wrap the local-router's `{ error }` discriminated union to match the
 *  HTTP client's "throw on failure" contract. Keeps callers oblivious. */
function unwrap<T>(r: T | { error: string } | null, notFoundMsg = 'Game not found'): T {
  if (r === null) throw new Error(notFoundMsg);
  if (typeof r === 'object' && r !== null && 'error' in r) throw new Error((r as { error: string }).error);
  return r as T;
}

// Hand the local router a way to call Render's /score-position for end-of-
// game dead-stone analysis (without circling imports). Commit 2 replaces
// this with bridge ownership mode.
localGameRouter.setRenderScorePositionFn((board) =>
  request<{ dead_stones: { row: number; col: number; color: string }[] }>(
    '/games/score-position',
    { method: 'POST', body: JSON.stringify({ board }) },
  ),
);

export const api = {
  createGame: async (options: CreateGameOptions = {}): Promise<GameStateDTO> => {
    if (useLocal()) return localGameRouter.createGame(options);
    return request<GameStateDTO>('/games', {
      method: 'POST',
      body: JSON.stringify({
        target_rank: options.target_rank ?? '15k',
        mode: options.mode ?? 'casual',
        // Explicit komi wins even with handicap (feature 25: rung 12k).
        komi: options.komi ?? (options.handicap ? 0.5 : 7.5),
        player_color: options.player_color ?? 'black',
        handicap: options.handicap ?? 0,
        black_rank: options.black_rank ?? null,
        white_rank: options.white_rank ?? null,
        board_size: options.board_size ?? 19,
      }),
    });
  },

  getGame: async (gameId: string): Promise<GameStateDTO> => {
    if (useLocal()) {
      const local = localGameRouter.getGame(gameId);
      if (local) return local;
      // Not in local storage — game might predate this commit, or was created
      // on the web and the user is opening it on iPad. Fall back to Render.
      return request<GameStateDTO>(`/games/${gameId}`);
    }
    return request<GameStateDTO>(`/games/${gameId}`);
  },

  playMove: async (gameId: string, row: number, col: number): Promise<GameStateDTO> => {
    if (useLocal()) return unwrap(localGameRouter.playMove(gameId, row, col));
    return request<GameStateDTO>(`/games/${gameId}/move`, {
      method: 'POST',
      body: JSON.stringify({ row, col }),
    });
  },

  pass: async (gameId: string): Promise<GameStateDTO> => {
    if (useLocal()) return unwrap(await localGameRouter.pass(gameId));
    return request<GameStateDTO>(`/games/${gameId}/pass`, { method: 'POST' });
  },

  resign: async (gameId: string): Promise<GameStateDTO> => {
    if (useLocal()) return unwrap(localGameRouter.resign(gameId));
    return request<GameStateDTO>(`/games/${gameId}/resign`, { method: 'POST' });
  },

  undo: async (gameId: string): Promise<GameStateDTO> => {
    if (useLocal()) return unwrap(localGameRouter.undo(gameId));
    return request<GameStateDTO>(`/games/${gameId}/undo`, { method: 'POST' });
  },

  getAIMove: async (
    gameId: string,
    targetRank?: string,
    options?: {
      neverPass?: boolean;
      /** Real GTP move history (incl. handicap + passes) for the bridge so
       *  KataGo correctly tracks ko / superko. When omitted, the bridge
       *  falls back to `boardToMoves` which loses move order — KataGo
       *  then can't see the ko ban and suggests illegal recaptures. See
       *  buildBridgeMovesFromGame in gameStore for the canonical builder. */
      movesForBridge?: Array<{ color: 'B' | 'W'; point: string }>;
    },
  ): Promise<AIMoveDTO> => {
    const bridge = getKataGoBridge();
    if (bridge) return getAIMoveViaBridge(gameId, bridge, targetRank ?? '15k', options);
    // Web path: backend /ai-move doesn't know about neverPass yet — that
    // would need a body. Tutorial games typically run on iPad anyway; if
    // we need this for web tutorials later, thread neverPass through the
    // POST body and update backend/app/ai/move_selector.py the same way.
    return request<AIMoveDTO>(`/games/${gameId}/ai-move`, { method: 'POST' });
  },

  // On iPad the auto-finish loop drives `finishMoveViaBridge` — which
  // BYPASSES the selector and plays KataGo's actual top candidate at 200
  // visits. The selector's rank-calibrated mistake injection (mistake_freq,
  // max_point_loss, randomness) is wrong for finishing: we want solid
  // endgame moves and a clean pass when KataGo recognizes the game is
  // settled, NOT the kid-friendly noise we use during play. Mirrors the
  // backend's `/finish-move` (full-strength KataGo, top pick only — see
  // backend/app/game/state.py:331).
  //
  // Each call returns ONE move (or pass); gameStore.finishGame loops until
  // two consecutive passes trigger localGameRouter.pass's scoring path.
  // Fixes the Session 16 "Finish Game iPad-only" bug — see
  // 19x19scoring.log:70745 for the original failure (HTTP-only,
  // game_id only existed in localStorage).
  finishMove: async (
    gameId: string,
    options?: { movesForBridge?: Array<{ color: 'B' | 'W'; point: string }> },
  ): Promise<AIMoveDTO> => {
    const bridge = getKataGoBridge();
    if (bridge) return finishMoveViaBridge(gameId, bridge, options);
    return request<AIMoveDTO>(`/games/${gameId}/finish-move`, { method: 'POST' });
  },

  /** Score a board position using KataGo ownership analysis. Returns dead
   *  stones. Used by replayStore for post-game analysis (one-shot, not a
   *  per-move call) and by the local router's pass→scoring path. */
  scorePosition: (board: number[][]) =>
    request<{ dead_stones: { row: number; col: number; color: string }[] }>(
      '/games/score-position',
      { method: 'POST', body: JSON.stringify({ board }) },
    ),

  /** Upload a finished game (the SavedGame verbatim) for sharing/diagnostics.
   *  Returns the share code. Always an HTTP call — uploads only exist on the
   *  server, there is no local-router path. */
  uploadGame: (
    game: SavedGame,
    meta: { playerName?: string; boardSize?: number },
  ): Promise<{ id: string }> =>
    request<{ id: string }>('/uploads', {
      method: 'POST',
      body: JSON.stringify({
        payload: game,
        player_name: meta.playerName || null,
        board_size: meta.boardSize ?? null,
        opponent_rank: game.opponentRank,
        result: game.result,
      }),
    }),

  /** Fetch a shared game by its share code, for replay hydration. */
  fetchSharedGame: (shareId: string): Promise<{ id: string; payload: SavedGame }> =>
    request<{ id: string; payload: SavedGame }>(
      `/uploads/${encodeURIComponent(shareId.trim())}`,
    ),
};

export type { GameStateDTO, AIMoveDTO, PointDTO, CreateGameOptions };

// --- Native KataGo path (iPad, Path C) -----------------------------------
//
// On iPad the WKWebView injects `window.kataGo`. AI moves run locally on the
// Neural Engine — bridge returns analysis candidates, the TS selector
// (frontend/src/ai/moveSelector.ts) applies b28-calibrated rank logic, and
// the chosen move commits via the existing /move|/pass endpoints. Web users
// hit the existing `/api/games/:id/ai-move` HTTP path unchanged.
//
// Two HTTP calls per AI move on iPad: GET game state, POST chosen move.
// The expensive KataGo inference happens entirely on-device.

async function getAIMoveViaBridge(
  gameId: string,
  bridge: KataGoBridge,
  targetRank: string,
  options?: {
    neverPass?: boolean;
    movesForBridge?: Array<{ color: 'B' | 'W'; point: string }>;
  },
): Promise<AIMoveDTO> {
  // [perf-js] Outer envelope — sums GET state + selector + analyze(s) +
  // commit POST. Compare against the Swift [perf] total to isolate the
  // non-engine cost of an AI move.
  const tOuterStart = performance.now();
  const state = await api.getGame(gameId);
  const tAfterGet = performance.now();
  const color: Stone = state.current_color === 'black' ? Color.Black : Color.White;
  const colorChar: 'B' | 'W' = color === Color.Black ? 'B' : 'W';
  // ko_point was set by the opponent's last move, so the ban applies to the
  // side about to move — us. Without it the grid-only selector board is
  // ko-blind and the local-bias/random branches propose the recapture
  // (888P9NXK move 235).
  const koBan = state.ko_point
    ? { point: { row: state.ko_point.row, col: state.ko_point.col }, color }
    : null;
  const board = boardFromGrid(state.board, state.board_size, koBan);
  const lastOpponentMove: Point | null = state.last_move
    ? { row: state.last_move.row, col: state.last_move.col }
    : null;

  // The selector calls `analyze(visits)` to fetch KataGo's candidate list.
  // We capture the best candidate's scoreLead so we can return it for the
  // score graph. (The selector itself doesn't expose its internal state.)
  //
  // Prefer the caller-supplied move history (handicap + plays in order)
  // so KataGo sees the real game sequence and tracks ko correctly. Fall
  // back to `boardToMoves` (stones only, no order) for callers that
  // haven't been updated — the legacy path still works but KataGo will
  // miss ko bans and suggest illegal moves we filter out below.
  const moves = options?.movesForBridge ?? boardToMoves(state.board, state.board_size);
  let cachedScoreLead: number | null = null;
  // Most recent candidate list, kept so we can report the eval of the move
  // the selector ACTUALLY chose (not just the best move) — see the
  // score_lead / score_lead_before split in AIMoveDTO.
  let lastCandidates: MoveCandidate[] | null = null;

  const analyze = async (visits: number, opts?: AnalyzeOpts): Promise<PositionAnalysis> => {
    // [perf-js] Measure JS-perceived bridge round-trip. Difference vs the
    // Swift-side [perf] total = pure bridge marshaling cost. Should be <20ms.
    const tAnalyzeStart = performance.now();
    const result = await bridge.analyze({
      boardSize: state.board_size,
      // Real komi + japanese rules, matching the backend engine the b28
      // profiles were calibrated against (backend/app/katago/engine.py).
      // The old hardcoded komi 7.5 + tromp-taylor skewed the score graph
      // toward White (assumed komi minus real komi) and — because area
      // scoring makes own-territory fills free — kept the settle path from
      // ever surfacing pass on-device. Fixed 2026-06-11.
      komi: state.komi,
      rules: 'japanese',
      moves,
      color: colorChar,
      maxVisits: visits,
      // §3 out-of-pool: widens the root search for weak-rung profiles. The
      // bridge ALWAYS applies this via kata-set-param (0 when absent) so the
      // long-lived GTP engine never carries a stale value between calls.
      wideRootNoise: opts?.wideRootNoise ?? 0,
    });
    const analyzeMs = Math.round(performance.now() - tAnalyzeStart);
    console.log(`[perf-js] bridge.analyze visits=${visits} jsRT=${analyzeMs}ms`);

    // Diagnostic for the §3 wide-pool mechanism: pool width proves whether
    // kata-set-param wideRootNoise took effect on this device build. Rides
    // the upload payload, so a shared game self-diagnoses (JEA338QQ lesson).
    if (opts?.wideRootNoise) {
      recordSelectorLog(
        `[analyze] wrn=${opts.wideRootNoise} candidates=${result.candidates.length}`,
      );
    }

    const candidates: MoveCandidate[] = result.candidates.map((c, idx) => {
      const decoded = fromGtp(c.move, state.board_size);
      const move =
        decoded === 'pass' || decoded === 'resign'
          ? { row: -1, col: -1 }
          : decoded;
      return {
        move,
        visits: c.visits ?? 0,
        winrate: c.winrate ?? 0.5,
        scoreLead: c.scoreLead ?? 0,
        prior: c.prior ?? 0,
        order: c.order ?? idx,
      };
    });

    // Best non-pass candidate's scoreLead ≈ the eval of the analyzed position
    // itself (assumes best play from here) — this is the score_lead_before
    // read: it belongs to the move that CREATED this position, i.e. the
    // player's move, not the bot's upcoming reply.
    if (cachedScoreLead === null) {
      const bestNonPass = candidates.find((c) => c.move.row >= 0);
      if (bestNonPass) cachedScoreLead = bestNonPass.scoreLead;
      else if (candidates.length > 0) cachedScoreLead = candidates[0].scoreLead;
    }
    lastCandidates = candidates;

    return {
      rootVisits: result.rootVisits ?? visits,
      candidates,
    };
  };

  // Eval AFTER the bot's actual move: the chosen candidate's own scoreLead.
  // Guard on visits ≥ 2 — wideRootNoise fills the pool tail with 1-visit
  // candidates whose scoreLead is a single-playout guess; carrying the root
  // eval is less wrong than plotting that noise on the score graph.
  const chosenMoveLead = (p: Point): number | null => {
    const c = lastCandidates?.find((c) => c.move.row === p.row && c.move.col === p.col);
    return c && (c.visits ?? 0) >= 2 && typeof c.scoreLead === 'number' ? c.scoreLead : null;
  };

  // Opponent passed iff their last action left no stone (a pass carries no
  // point) and we're past the opening — the stone-count guard avoids a false
  // positive on a handicap game's first move, which also has no prior opponent
  // stone. Routes the selector through its "settle cleanly" path.
  const opponentPassed = state.last_move == null && moves.length >= state.board_size;

  const tBeforeSelect = performance.now();
  const chosen = await selectAiMove(board, color, targetRank, lastOpponentMove, analyze, {
    neverPass: options?.neverPass,
    opponentPassed,
  });
  const tAfterSelect = performance.now();

  if (chosen === null) {
    // Selector returned pass.
    const newState = await api.pass(gameId);
    const tEnd = performance.now();
    console.log(
      `[perf-js] aiMove(pass) get=${Math.round(tAfterGet - tOuterStart)}ms ` +
      `select=${Math.round(tAfterSelect - tBeforeSelect)}ms ` +
      `commit=${Math.round(tEnd - tAfterSelect)}ms ` +
      `total=${Math.round(tEnd - tOuterStart)}ms`
    );
    return {
      point: { row: -1, col: -1 },
      captures: [],
      score_lead: cachedScoreLead ?? newState.score_lead,
      score_lead_before: cachedScoreLead,
      final_state: newState.phase === 'finished' ? newState : null,
      board: newState.board,
    };
  }

  // Commit the chosen move. If the game engine rejects the pick (superko
  // the grid-only selector board can't see, or an engine desync), do NOT
  // pass — a wrong pass in a ko fight hands the game away (888P9NXK move
  // 235: the recapture was rejected and the old fallback passed). Retry
  // with legal alternatives; pass only when nothing legal remains.
  let newState: GameStateDTO | null = null;
  let played: Point = chosen;
  const rejected: Point[] = [];
  while (newState === null) {
    try {
      newState = await api.playMove(gameId, played.row, played.col);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      rejected.push(played);
      const line =
        `[getAIMoveViaBridge] engine rejected pick #${rejected.length} ` +
        `(${played.row},${played.col}): ${msg}`;
      console.warn(line);
      recordSelectorLog(line);
      const alt =
        rejected.length <= 3 ? pickLegalNonEyeMove(board, color, rejected) : null;
      if (!alt) {
        recordSelectorLog(
          `[selector] PASS reason=commit-rejected-exhausted (${rejected.length} picks refused)`,
        );
        const passState = await api.pass(gameId);
        const tEnd = performance.now();
        console.log(
          `[perf-js] aiMove(forced-pass) get=${Math.round(tAfterGet - tOuterStart)}ms ` +
          `select=${Math.round(tAfterSelect - tBeforeSelect)}ms ` +
          `commit=${Math.round(tEnd - tAfterSelect)}ms ` +
          `total=${Math.round(tEnd - tOuterStart)}ms`,
        );
        return {
          point: { row: -1, col: -1 },
          captures: [],
          score_lead: cachedScoreLead ?? passState.score_lead,
          score_lead_before: cachedScoreLead,
          final_state: passState.phase === 'finished' ? passState : null,
          board: passState.board,
        };
      }
      played = alt;
    }
  }
  const tEnd = performance.now();
  console.log(
    `[perf-js] aiMove get=${Math.round(tAfterGet - tOuterStart)}ms ` +
    `select=${Math.round(tAfterSelect - tBeforeSelect)}ms ` +
    `commit=${Math.round(tEnd - tAfterSelect)}ms ` +
    `total=${Math.round(tEnd - tOuterStart)}ms`
  );
  return {
    point: played,
    captures: [],
    score_lead: chosenMoveLead(played) ?? cachedScoreLead ?? newState.score_lead,
    score_lead_before: cachedScoreLead,
    board: newState.board,
  };
}

/** Finish Game pass threshold. If KataGo's pass candidate has a scoreLead
 *  within this many points of the best move (from the player-to-move's
 *  perspective), we pass instead of playing — the game is settled enough
 *  to wrap up. Matches the selector's default `pass_threshold` of 0.3 but
 *  slightly more eager (user explicitly chose "Finish Game"). */
const FINISH_PASS_THRESHOLD = 0.5;

/**
 * Bridge-side Finish Game move. Unlike `getAIMoveViaBridge`, this bypasses
 * the rank-calibrated selector entirely and plays KataGo's actual top
 * candidate — matching the backend's `finish_move` semantic (full-strength
 * KataGo, top pick only). The selector is for in-game play where we WANT
 * the bot to make rank-calibrated mistakes; for finishing the game we want
 * solid endgame play so the position converges on passes.
 *
 * Two non-obvious choices match the backend (backend/app/game/state.py:331,
 * backend/app/katago/engine.py:158):
 * - **Japanese rules** (territory scoring). Under area scoring (tromp-taylor),
 *   filling your own territory is point-neutral so KataGo has no incentive
 *   to pass — it'll happily fill every dame and self-liberty until the
 *   board is full. Under territory scoring, those moves cost you a point,
 *   so the value head correctly favors passing once the position is sealed.
 *   This matches our local Game.score() which is territory-style.
 * - **Eager pass-threshold check** (FINISH_PASS_THRESHOLD = 0.5). Even with
 *   territory scoring, if KataGo's top candidate is a real move that's
 *   only marginally better than passing, we pass — the kid hit "Finish
 *   Game" because they want it OVER, not because they want to grind out
 *   the last 0.3-point yose move.
 *
 * Visits set to 200 — same budget used for end-of-game ownership analysis
 * (OWNERSHIP_VISITS in localGameRouter). The backend uses 500; we trade a
 * tiny bit of strength for ~2× faster per-move latency on iPad. Still
 * vastly stronger than the strongest b28 profile.
 *
 * History: 2026-05-12 playtest — was using getAIMoveViaBridge with '1d'
 * profile; mistake_freq 0.22 burned a Black lead. Switched to top-
 * candidate but used tromp-taylor rules; KataGo then refused to pass and
 * kept filling its own liberties. Switched to japanese + pass-threshold.
 */
async function finishMoveViaBridge(
  gameId: string,
  bridge: KataGoBridge,
  options?: { movesForBridge?: Array<{ color: 'B' | 'W'; point: string }> },
): Promise<AIMoveDTO> {
  const tOuterStart = performance.now();
  const state = await api.getGame(gameId);
  const tAfterGet = performance.now();
  const colorChar: 'B' | 'W' = state.current_color === 'black' ? 'B' : 'W';
  // Prefer caller-supplied move history so ko bans are respected — the
  // TODO at the top of getAIMoveViaBridge applies here too.
  const moves = options?.movesForBridge ?? boardToMoves(state.board, state.board_size);

  const tAnalyzeStart = performance.now();
  const result = await bridge.analyze({
    boardSize: state.board_size,
    komi: state.komi,
    rules: 'japanese',
    moves,
    color: colorChar,
    maxVisits: 200,
  });
  const analyzeMs = Math.round(performance.now() - tAnalyzeStart);
  console.log(`[perf-js] finish.analyze visits=200 jsRT=${analyzeMs}ms`);

  const top = result.candidates[0];
  // Defensive: if KataGo returned no candidates at all (shouldn't happen
  // outside a degenerate position) treat as a pass so the loop terminates
  // gracefully instead of throwing.
  if (!top) {
    const line = '[finishMoveViaBridge] bridge returned no candidates — passing';
    console.warn(line);
    recordSelectorLog(line);
    const passState = await api.pass(gameId);
    return {
      point: { row: -1, col: -1 },
      captures: [],
      score_lead: passState.score_lead,
      final_state: passState.phase === 'finished' ? passState : null,
    };
  }

  const decoded = fromGtp(top.move, state.board_size);
  const topScoreLead = top.scoreLead ?? null;

  // Eager pass: if pass is in the candidates with enough visits to trust
  // its score estimate AND the gap to the best move is below threshold
  // (from the side-to-move's perspective), just pass. Bridge has flipped
  // scoreLead to Black's perspective; flip back for the comparison when
  // we're playing as White.
  const passCand =
    result.candidates.find((c) => c.move.toLowerCase() === 'pass') ?? null;
  const minPassVisits = Math.max(4, Math.floor((top.visits ?? 0) / 10));
  if (
    passCand &&
    (passCand.visits ?? 0) >= minPassVisits &&
    typeof top.scoreLead === 'number' &&
    typeof passCand.scoreLead === 'number'
  ) {
    const sign = colorChar === 'B' ? 1 : -1;
    const bestForMover = sign * top.scoreLead;
    const passForMover = sign * passCand.scoreLead;
    if (bestForMover - passForMover < FINISH_PASS_THRESHOLD) {
      const line =
        `[finishMoveViaBridge] eager-pass best=${bestForMover.toFixed(2)} ` +
        `pass=${passForMover.toFixed(2)} thr=${FINISH_PASS_THRESHOLD} ` +
        `(passV=${passCand.visits} bestV=${top.visits})`;
      console.log(line);
      recordSelectorLog(line);
      const passState = await api.pass(gameId);
      return {
        point: { row: -1, col: -1 },
        captures: [],
        score_lead: passCand.scoreLead ?? passState.score_lead,
        score_lead_before: topScoreLead,
        final_state: passState.phase === 'finished' ? passState : null,
      };
    }
  }

  // KataGo's top is itself a pass (or resign — treat the same in finish
  // mode). This is the happy-path termination: KataGo recognizes the game
  // is settled, we pass, two passes triggers localGameRouter.pass's
  // on-device scoring.
  if (decoded === 'pass' || decoded === 'resign') {
    recordSelectorLog(`[finishMoveViaBridge] KataGo top candidate is ${decoded} — passing`);
    const passState = await api.pass(gameId);
    const tEnd = performance.now();
    console.log(
      `[perf-js] finishMove(pass) get=${Math.round(tAfterGet - tOuterStart)}ms ` +
      `analyze=${analyzeMs}ms total=${Math.round(tEnd - tOuterStart)}ms`,
    );
    return {
      point: { row: -1, col: -1 },
      captures: [],
      score_lead: topScoreLead ?? passState.score_lead,
      score_lead_before: topScoreLead,
      final_state: passState.phase === 'finished' ? passState : null,
    };
  }

  // Commit the move. If the engine rejects KataGo's pick (positional
  // superko the bridge's simple-ko rules don't see, or an engine desync),
  // fall to KataGo's NEXT real candidate instead of passing — in a live ko
  // fight a wrong pass hands the game away (S27; 888P9NXK). Pass only when
  // every candidate is refused.
  const realCandidates: Array<{ point: Point; scoreLead: number | null; visits: number }> = [];
  for (const c of result.candidates) {
    const m = fromGtp(c.move, state.board_size);
    if (m !== 'pass' && m !== 'resign') {
      realCandidates.push({
        point: m,
        scoreLead: typeof c.scoreLead === 'number' ? c.scoreLead : null,
        visits: c.visits ?? 0,
      });
    }
  }
  let newState: GameStateDTO | null = null;
  let played: (typeof realCandidates)[number] | null = null;
  for (const cand of realCandidates.slice(0, 4)) {
    try {
      newState = await api.playMove(gameId, cand.point.row, cand.point.col);
      played = cand;
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const line = `[finishMoveViaBridge] engine rejected candidate (${cand.point.row},${cand.point.col}): ${msg} — trying next`;
      console.warn(line);
      recordSelectorLog(line);
    }
  }
  if (newState === null || played === null) {
    recordSelectorLog('[selector] PASS reason=commit-rejected-exhausted (finish mode)');
    const passState = await api.pass(gameId);
    return {
      point: { row: -1, col: -1 },
      captures: [],
      score_lead: topScoreLead ?? passState.score_lead,
      score_lead_before: topScoreLead,
      final_state: passState.phase === 'finished' ? passState : null,
      board: passState.board,
    };
  }

  const tEnd = performance.now();
  console.log(
    `[perf-js] finishMove get=${Math.round(tAfterGet - tOuterStart)}ms ` +
    `analyze=${analyzeMs}ms total=${Math.round(tEnd - tOuterStart)}ms`,
  );
  // Same visits ≥ 2 guard as getAIMoveViaBridge's chosenMoveLead: only trust
  // the played candidate's own eval when KataGo actually read it.
  const playedLead =
    played.visits >= 2 && typeof played.scoreLead === 'number' ? played.scoreLead : null;
  return {
    point: played.point,
    captures: [],
    score_lead: playedLead ?? topScoreLead ?? newState.score_lead,
    score_lead_before: topScoreLead,
    board: newState.board,
  };
}
