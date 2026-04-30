/**
 * Backend API client for GoForKids.
 * Communicates with the FastAPI backend for game management and AI moves.
 */

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

  getAIMove: (gameId: string) =>
    request<AIMoveDTO>(`/games/${gameId}/ai-move`, { method: 'POST' }),

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
