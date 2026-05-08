/**
 * Backend API client for GoForKids.
 * Communicates with the FastAPI backend for game management and AI moves.
 */

import { boardToMoves, fromGtp, getKataGoBridge, type KataGoBridge } from './nativeKataGo';
import {
  selectAiMove,
  boardFromGrid,
  type PositionAnalysis,
  type MoveCandidate,
} from '../ai/moveSelector';
import { Color, type Stone, type Point } from '../engine/types';

const API_BASE = `${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'}/api`;

interface CreateGameOptions {
  target_rank?: string;
  mode?: 'ranked' | 'casual';
  komi?: number;
  player_color?: 'black' | 'white';
  handicap?: number;
  black_rank?: string;
  white_rank?: string;
  board_size?: number;
}

interface PointDTO {
  row: number;
  col: number;
}

interface GameStateDTO {
  game_id: string;
  board: number[][];
  board_size: number;
  current_color: 'black' | 'white';
  move_number: number;
  captures: { black: number; white: number };
  phase: string;
  last_move: PointDTO | null;
  ko_point: PointDTO | null;
  result: Record<string, unknown> | null;
  sgf: string | null;
  /** KataGo's point-margin estimate from Black's perspective. Null when KataGo
   *  isn't available. Drives the live score graph in the sidebar. */
  score_lead: number | null;
}

interface AIMoveDTO {
  point: PointDTO;
  captures: PointDTO[];
  debug?: Record<string, unknown>;
  score_lead?: number | null;
  /** Set when the AI's pass ended the game. Carries the scored final state
   *  inline so the frontend doesn't need a follow-up GET (which would 404,
   *  since the active game is deleted post-scoring). */
  final_state?: GameStateDTO | null;
}

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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(error.detail || `API error: ${res.status}`);
      }
      return res.json();
    } catch (e) {
      lastError = e;
      // Only TypeErrors retry (network leg failed, request didn't land).
      // Errors we threw ourselves (HTTP non-OK) are real responses; bail.
      const isNetworkError = e instanceof TypeError;
      if (!isNetworkError || attempt === MAX_RETRIES) {
        throw e;
      }
      const delayMs = 300 * Math.pow(3, attempt); // 300ms, 900ms
      console.warn(`[api] retrying ${path} after TypeError (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, e);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

export const api = {
  createGame: (options: CreateGameOptions = {}) =>
    request<GameStateDTO>('/games', {
      method: 'POST',
      body: JSON.stringify({
        target_rank: options.target_rank ?? '15k',
        mode: options.mode ?? 'casual',
        komi: options.handicap ? 0.5 : (options.komi ?? 7.5),
        player_color: options.player_color ?? 'black',
        handicap: options.handicap ?? 0,
        black_rank: options.black_rank ?? null,
        white_rank: options.white_rank ?? null,
        board_size: options.board_size ?? 19,
      }),
    }),

  getGame: (gameId: string) =>
    request<GameStateDTO>(`/games/${gameId}`),

  playMove: (gameId: string, row: number, col: number) =>
    request<GameStateDTO>(`/games/${gameId}/move`, {
      method: 'POST',
      body: JSON.stringify({ row, col }),
    }),

  pass: (gameId: string) =>
    request<GameStateDTO>(`/games/${gameId}/pass`, { method: 'POST' }),

  resign: (gameId: string) =>
    request<GameStateDTO>(`/games/${gameId}/resign`, { method: 'POST' }),

  undo: (gameId: string) =>
    request<GameStateDTO>(`/games/${gameId}/undo`, { method: 'POST' }),

  getAIMove: async (gameId: string, targetRank?: string): Promise<AIMoveDTO> => {
    const bridge = getKataGoBridge();
    if (bridge) return getAIMoveViaBridge(gameId, bridge, targetRank ?? '15k');
    return request<AIMoveDTO>(`/games/${gameId}/ai-move`, { method: 'POST' });
  },

  finishMove: (gameId: string) =>
    request<AIMoveDTO>(`/games/${gameId}/finish-move`, { method: 'POST' }),

  /** Score a board position using KataGo ownership analysis. Returns dead stones. */
  scorePosition: (board: number[][]) =>
    request<{ dead_stones: { row: number; col: number; color: string }[] }>(
      '/games/score-position',
      { method: 'POST', body: JSON.stringify({ board }) },
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
): Promise<AIMoveDTO> {
  const state = await api.getGame(gameId);
  const board = boardFromGrid(state.board, state.board_size);
  const color: Stone = state.current_color === 'black' ? Color.Black : Color.White;
  const colorChar: 'B' | 'W' = color === Color.Black ? 'B' : 'W';
  const lastOpponentMove: Point | null = state.last_move
    ? { row: state.last_move.row, col: state.last_move.col }
    : null;

  // The selector calls `analyze(visits)` to fetch KataGo's candidate list.
  // We capture the best candidate's scoreLead so we can return it for the
  // score graph. (The selector itself doesn't expose its internal state.)
  const moves = boardToMoves(state.board, state.board_size);
  let cachedScoreLead: number | null = null;

  const analyze = async (visits: number): Promise<PositionAnalysis> => {
    const result = await bridge.analyze({
      boardSize: state.board_size,
      // GameStateDTO doesn't expose komi; backend default is 7.5, handicap is
      // 0.5. Wrong komi may shift KataGo's score estimates slightly but doesn't
      // break the selector's logic. Acceptable for now.
      komi: 7.5,
      rules: 'tromp-taylor',
      moves,
      color: colorChar,
      maxVisits: visits,
    });

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

    // Best non-pass candidate's scoreLead represents the position after the
    // AI's likely move — that's what the score graph should show.
    if (cachedScoreLead === null) {
      const bestNonPass = candidates.find((c) => c.move.row >= 0);
      if (bestNonPass) cachedScoreLead = bestNonPass.scoreLead;
      else if (candidates.length > 0) cachedScoreLead = candidates[0].scoreLead;
    }

    return {
      rootVisits: result.rootVisits ?? visits,
      candidates,
    };
  };

  const chosen = await selectAiMove(board, color, targetRank, lastOpponentMove, analyze);

  if (chosen === null) {
    // Selector returned pass.
    const newState = await api.pass(gameId);
    return {
      point: { row: -1, col: -1 },
      captures: [],
      score_lead: cachedScoreLead ?? newState.score_lead,
      final_state: newState.phase === 'finished' ? newState : null,
    };
  }

  const newState = await api.playMove(gameId, chosen.row, chosen.col);
  return {
    point: chosen,
    captures: [],
    score_lead: cachedScoreLead ?? newState.score_lead,
  };
}
