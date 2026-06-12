/**
 * Shared DTO types for the GoForKids API.
 *
 * Lives separately from client.ts so both the HTTP client and the local
 * iPad game router (localGameRouter.ts) can produce identically-shaped
 * responses without a circular dependency.
 *
 * Shapes mirror the Python `GameStateResponse` / `AIMoveResponse` in
 * backend/app/models/schemas.py — see _to_response() in
 * backend/app/game/state.py for the canonical builder.
 */

export interface CreateGameOptions {
  target_rank?: string;
  mode?: 'ranked' | 'casual';
  komi?: number;
  player_color?: 'black' | 'white';
  handicap?: number;
  black_rank?: string;
  white_rank?: string;
  board_size?: number;
}

export interface PointDTO {
  row: number;
  col: number;
}

export interface GameStateDTO {
  game_id: string;
  board: number[][];
  board_size: number;
  /** The game's actual komi. On-device analysis must use this — a hardcoded
   *  komi skews score estimates and (under area rules) endgame pass behavior. */
  komi: number;
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

export interface AIMoveDTO {
  point: PointDTO;
  captures: PointDTO[];
  debug?: Record<string, unknown>;
  score_lead?: number | null;
  /** Set when the AI's pass ended the game. Carries the scored final state
   *  inline so the frontend doesn't need a follow-up GET (which would 404,
   *  since the active game is deleted post-scoring). */
  final_state?: GameStateDTO | null;
}
