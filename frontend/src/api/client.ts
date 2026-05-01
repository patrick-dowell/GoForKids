/**
 * Backend API client for GoForKids.
 * Communicates with the FastAPI backend for game management and AI moves.
 */

import { boardToMoves, fromGtp, getKataGoBridge } from './nativeKataGo';

const API_BASE = `${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'}/api`;

// Phase 2A: iPad's native KataGo plays at a fixed visit count, no rank
// calibration. Re-tune once `move_selector.py` is ported to TS (Path C).
const NATIVE_BRIDGE_VISITS = 64;

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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `API error: ${res.status}`);
  }
  return res.json();
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

  getAIMove: async (gameId: string): Promise<AIMoveDTO> => {
    const bridge = getKataGoBridge();
    if (bridge) return getAIMoveViaBridge(gameId, bridge);
    return request<AIMoveDTO>(`/games/${gameId}/ai-move`, { method: 'POST' });
  },

  autoComplete: (gameId: string) =>
    request<GameStateDTO>(`/games/${gameId}/auto-complete`, { method: 'POST' }),

  /** Score a board position using KataGo ownership analysis. Returns dead stones. */
  scorePosition: (board: number[][]) =>
    request<{ dead_stones: { row: number; col: number; color: string }[] }>(
      '/games/score-position',
      { method: 'POST', body: JSON.stringify({ board }) },
    ),
};

export type { GameStateDTO, AIMoveDTO, PointDTO, CreateGameOptions };

// --- Phase 2A: native KataGo path ----------------------------------------
//
// On iPad the WKWebView injects `window.kataGo`. AI moves run locally on the
// Neural Engine instead of round-tripping to Render. Game state still lives
// on the backend — we fetch it, ask the bridge for a move, then commit via
// the existing /move|/pass|/resign endpoints. Two API calls per AI move,
// but no backend changes required.

async function getAIMoveViaBridge(
  gameId: string,
  bridge: ReturnType<typeof getKataGoBridge> & object,
): Promise<AIMoveDTO> {
  const state = await api.getGame(gameId);
  const moves = boardToMoves(state.board, state.board_size);
  const color = state.current_color === 'black' ? 'B' : 'W';

  // GameStateDTO doesn't expose komi today; backend default is 7.5, handicap
  // games use 0.5. Fix when porting move_selector.py (Path C).
  const result = await bridge.aiMove({
    boardSize: state.board_size,
    komi: 7.5,
    rules: 'tromp-taylor',
    moves,
    color,
    maxVisits: NATIVE_BRIDGE_VISITS,
  });

  const decoded = fromGtp(result.point, state.board_size);

  // Prefer the bridge's scoreLead (computed by the iPad's local KataGo, no
  // Render dependency). Fall back to whatever the backend returns if the
  // bridge didn't supply one for some reason.
  const bridgeScoreLead = result.scoreLead ?? null;

  if (decoded === 'pass') {
    const newState = await api.pass(gameId);
    return {
      point: { row: -1, col: -1 },
      captures: [],
      score_lead: bridgeScoreLead ?? newState.score_lead,
      final_state: newState.phase === 'finished' ? newState : null,
    };
  }
  if (decoded === 'resign') {
    await api.resign(gameId);
    return { point: { row: -1, col: -1 }, captures: [] };
  }

  const newState = await api.playMove(gameId, decoded.row, decoded.col);
  return {
    point: decoded,
    captures: [],
    score_lead: bridgeScoreLead ?? newState.score_lead,
  };
}
