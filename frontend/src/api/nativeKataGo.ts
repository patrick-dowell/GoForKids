/**
 * Native KataGo bridge — only available when running inside the iPad app's
 * WKWebView (the bridge is injected by Swift at document-start). On the web,
 * `window.kataGo` is undefined and callers fall back to the HTTP backend.
 *
 * Path C (May 2026): bridge returns the full KataGo candidate list, and
 * frontend/src/ai/moveSelector.ts picks the actual move using b28-calibrated
 * profile logic. The bridge is intentionally dumb — it does NOT pick a move,
 * just runs analysis.
 *
 * Cloud bot (July 2026): the Settings toggle "Bot plays online" makes
 * getKataGoBridge() return null even inside the iPad app, forcing all bot
 * moves onto the HTTP/Render path — the escape hatch for old iPads whose
 * on-device analysis is unplayably slow. Since October 2026 a device whose
 * capabilities() says `localBots: false` is held there whatever the toggle
 * says (capabilitiesStore.ts botsPlayOnline), as the web always is.
 *
 * Human-style bots (October 2026): a build whose engine carries KataGo's
 * human SL net answers capabilities(), humanPolicy() and scoreAfter(); with
 * the Settings toggle on, a rank that has a rung in b28_human.yaml takes its
 * moves from humanNetSelector.ts (see getHumanRung). Older builds lack the
 * three calls and play as before.
 */

import { useSettingsStore } from '../store/settingsStore';
import { botsPlayOnline, hasHumanModel } from '../store/capabilitiesStore';
import { getHumanProfile, type HumanRankProfile } from '../ai/profileLoader';

/** One candidate from `kata-genmove_analyze`. Bridge passes through the
 *  raw KataGo fields; fields are optional because parser drops malformed ones. */
export interface BridgeCandidate {
  /** GTP coord like "C4", or "pass". */
  move: string;
  visits?: number;
  winrate?: number;
  /** Already flipped to black's perspective by the bridge. */
  scoreLead?: number;
  scoreMean?: number;
  prior?: number;
  /** KataGo's preference rank (0 = best). Bridge sorts the array by this. */
  order?: number;
}

export interface BridgeAnalysis {
  candidates: BridgeCandidate[];
  rootVisits: number;
  /** The move KataGo would have picked (best candidate per its own logic).
   *  Useful only for diagnostics; the selector ignores it. */
  kataGoPlayedMove: string;
  /** Per-intersection ownership in [-1, +1] from Black's perspective
   *  (positive = Black controls). Row-major, length = boardSize²; only
   *  present when the caller passed `ownership: true`. Used for end-of-game
   *  dead-stone detection in localGameRouter.pass. */
  ownership?: number[];
}

export interface KataGoBridge {
  ping(): Promise<{ pong: boolean }>;
  analyze(params: {
    boardSize: number;
    komi: number;
    rules?: string;
    moves: Array<{ color: 'B' | 'W'; point: string }>;
    color: 'B' | 'W';
    maxVisits: number;
    /** When true, KataGo emits per-intersection ownership values; bridge
     *  parses them and returns them on `BridgeAnalysis.ownership`. */
    ownership?: boolean;
    /** KataGo search override for weak-rung move selection: spreads root
     *  visits across most plausible moves so the candidate list becomes a
     *  wide policy sample (§3 out-of-pool mechanism). The bridge applies it
     *  via `kata-set-param wideRootNoise` on EVERY call (0 when omitted) so
     *  the long-lived GTP engine never carries a stale value. Older native
     *  builds ignore the field (param simply not sent). */
    wideRootNoise?: number;
  }): Promise<BridgeAnalysis>;
  /** Present the iOS share sheet for an SGF (AirDrop / Files / other Go
   *  apps). Absent on older native builds — callers must catch and fall
   *  back to the web download path. */
  shareSGF?(params: { sgf: string; filename: string }): Promise<{ ok: boolean }>;
  /** What this device's engine can do, measured once at cold start by the
   *  native shell. `humanModel`: the engine started with the human SL net
   *  beside the main one, so humanPolicy and scoreAfter answer. Absent on
   *  older native builds: the app then reads no human model. Read once at
   *  app start (store/capabilitiesStore.ts). */
  capabilities?(): Promise<{ localBots: boolean; evalsPerSecond: number; humanModel: boolean }>;
  /** The human SL path's first query (humanNetSelector.ts HumanPolicyAnswer):
   *  one raw evaluation of the position, no search. Both policies hold
   *  boardSize² + 1 values, row-major from the top-left (index 0 is A9 on
   *  9×9), pass last, illegal points negative (KataGo's NAN sent as -1).
   *  `humanPolicy` is the human net's under `profile`, null when the engine
   *  has no human model; `policy` is the main net's raw policy; `scoreLead`
   *  is the main net's lead for the position, from Black's side. Absent on
   *  builds without the human net. */
  humanPolicy?(params: {
    boardSize: number;
    komi: number;
    rules?: string;
    moves: Array<{ color: 'B' | 'W'; point: string }>;
    /** The side to move. */
    color: 'B' | 'W';
    /** The human SL profile, e.g. "rank_20k" (KataGo's humanSLProfile). */
    profile: string;
    /** The selector's visits for this query (1); required by the native side. */
    maxVisits: number;
  }): Promise<{ humanPolicy: number[] | null; policy: number[] | null; scoreLead: number }>;
  /** The human SL path's scoring query (humanNetSelector.ts ScoreAfterAnswer):
   *  the main net's search, no human profile, of the position after `color`
   *  plays `move`, at `maxVisits`. `scoreLead` and `winrate` from Black's
   *  side. The selector sends one per candidate plus one for "pass" without
   *  waiting between them (up to human_cand_max + 1 at once); the bridge
   *  queues them for its one engine. Absent on builds without the human net. */
  scoreAfter?(params: {
    boardSize: number;
    komi: number;
    rules?: string;
    moves: Array<{ color: 'B' | 'W'; point: string }>;
    /** The side to move, who plays `move`. */
    color: 'B' | 'W';
    /** A GTP point like "E5", or "pass". */
    move: string;
    maxVisits: number;
  }): Promise<{ scoreLead: number; winrate: number }>;
}

declare global {
  interface Window {
    kataGo?: KataGoBridge;
  }
}

export function getKataGoBridge(): KataGoBridge | null {
  // Cloud bot (Settings → "Bot plays online", or a device whose capabilities
  // said localBots: false): report "no bridge" even when Swift injected one,
  // so EVERY engine consumer — game routing (client.ts useLocal), the finish
  // loop, replay better-move analysis, the bridge= game-log header —
  // uniformly falls back to the HTTP/web path. Exists for older iPads where
  // on-device analysis takes ~1 min/move vs ~2s on Render. Checked on every
  // call (nothing caches the bridge) so the toggle takes effect immediately,
  // no reload needed. Before the capabilities answer this reads as unlocked;
  // callers that start a game or ask the engine await whenBotRoutingKnown().
  if (botsPlayOnline()) return null;
  return typeof window !== 'undefined' && window.kataGo ? window.kataGo : null;
}

/** The bridge Swift injected, whatever the routing: for calls that are not
 *  the engine's (the SGF share sheet), which a device playing the online
 *  bots still has. Null on the web. */
export function getNativeBridge(): KataGoBridge | null {
  return typeof window !== 'undefined' && window.kataGo ? window.kataGo : null;
}

/**
 * The human-set rung (b28_human.yaml) that plays this rank and board size on
 * the device right now, or undefined, in which case the standard b28.yaml
 * rung plays exactly as before. All four must hold: the bridge is in use
 * (getKataGoBridge: inside the app, "Bot plays online" off; for a game that
 * lives on the device, `gameOnDevice`, the injected bridge, since a mid-game
 * flip of the setting leaves that game where it is), the setting
 * "Human-style bots" is on, the bridge reported the human model at start,
 * and the human set has a rung for this rank and size. Read per move, so
 * flipping "Human-style bots" takes effect on the next move.
 */
export function getHumanRung(rank: string, size: number, gameOnDevice = false): HumanRankProfile | undefined {
  if (!(gameOnDevice ? getNativeBridge() : getKataGoBridge())) return undefined;
  if (!useSettingsStore.getState().humanBots) return undefined;
  if (!hasHumanModel()) return undefined;
  return getHumanProfile(rank, size);
}

/** {row, col} → GTP coord like "E5". Skips letter 'I' per GTP convention. */
export function toGtp(point: { row: number; col: number }, boardSize: number): string {
  const letterIdx = point.col >= 8 ? point.col + 1 : point.col;
  const letter = String.fromCharCode('A'.charCodeAt(0) + letterIdx);
  return `${letter}${boardSize - point.row}`;
}

/** GTP coord → {row, col}, or 'pass' / 'resign' tokens. */
export function fromGtp(
  coord: string,
  boardSize: number,
): { row: number; col: number } | 'pass' | 'resign' {
  const c = coord.trim().toLowerCase();
  if (c === 'pass') return 'pass';
  if (c === 'resign') return 'resign';
  const upper = coord.trim().toUpperCase();
  const letter = upper.charAt(0);
  const num = parseInt(upper.slice(1), 10);
  let col = letter.charCodeAt(0) - 'A'.charCodeAt(0);
  if (letter > 'I') col -= 1;
  return { row: boardSize - num, col };
}

/**
 * Encode a board state as a sequence of GTP setup plays. Order doesn't matter
 * for stable positions (no captures triggered) — every legal Go position can
 * be replayed any-order without regressions. Edge case: ko bans are lost
 * since we don't have move history. Acceptable for Phase 2A.
 *
 * Backend board encoding: 0 = empty, 1 = black, 2 = white.
 */
export function boardToMoves(
  board: number[][],
  boardSize: number,
): Array<{ color: 'B' | 'W'; point: string }> {
  const moves: Array<{ color: 'B' | 'W'; point: string }> = [];
  for (let row = 0; row < boardSize; row++) {
    for (let col = 0; col < boardSize; col++) {
      if (board[row][col] === 1) moves.push({ color: 'B', point: toGtp({ row, col }, boardSize) });
    }
  }
  for (let row = 0; row < boardSize; row++) {
    for (let col = 0; col < boardSize; col++) {
      if (board[row][col] === 2) moves.push({ color: 'W', point: toGtp({ row, col }, boardSize) });
    }
  }
  return moves;
}
