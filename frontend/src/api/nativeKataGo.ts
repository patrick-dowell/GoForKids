/**
 * Native KataGo bridge — only available when running inside the iPad app's
 * WKWebView (the bridge is injected by Swift at document-start). On the web,
 * `window.kataGo` is undefined and callers fall back to the HTTP backend.
 *
 * Path C (May 2026): bridge returns the full KataGo candidate list, and
 * frontend/src/ai/moveSelector.ts picks the actual move using b28-calibrated
 * profile logic. The bridge is intentionally dumb — it does NOT pick a move,
 * just runs analysis.
 */

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
  }): Promise<BridgeAnalysis>;
}

declare global {
  interface Window {
    kataGo?: KataGoBridge;
  }
}

export function getKataGoBridge(): KataGoBridge | null {
  return typeof window !== 'undefined' && window.kataGo ? window.kataGo : null;
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
