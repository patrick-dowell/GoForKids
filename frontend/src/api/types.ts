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
  /** Best-known eval AFTER the AI's own move (the chosen candidate's
   *  scoreLead when it was read with enough visits; otherwise carries
   *  score_lead_before). Black's perspective, like all leads. */
  score_lead?: number | null;
  /** Eval of the position the AI analyzed — i.e. right after the PREVIOUS
   *  move (usually the player's), before the AI replied. Recording this one
   *  move earlier than score_lead is what lets the score graph and
   *  Play-of-the-Game attribute a swing to the mover who caused it: without
   *  it, on-device player blunders were credited to the bot's reply, since
   *  player moves never get their own analysis (localGameRouter v1
   *  limitation). §4a attribution fix. */
  score_lead_before?: number | null;
  /** Set when the AI's pass ended the game. Carries the scored final state
   *  inline so the frontend doesn't need a follow-up GET (which would 404,
   *  since the active game is deleted post-scoring). */
  final_state?: GameStateDTO | null;
  /** Post-move server board (bridge/local-router paths only; the HTTP
   *  AIMoveResponse doesn't carry it). Lets gameStore verify the local
   *  engine stayed in sync with the game server and force-resync when it
   *  didn't, instead of silently turning a local rejection into a pass. */
  board?: number[][];
}
