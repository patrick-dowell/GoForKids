/**
 * Native KataGo bridge — only available when running inside the iPad app's
 * WKWebView (the bridge is injected by Swift at document-start). On the web,
 * `window.kataGo` is undefined and callers fall back to the HTTP backend.
 *
 * Phase 2A: fixed-strength AI on iPad (no rank calibration yet). Bot rank
 * profile logic still lives in Python and ships only via Render.
 */

export interface KataGoBridge {
  ping(): Promise<{ pong: boolean }>;
  aiMove(params: {
    boardSize: number;
    komi: number;
    rules?: string;
    moves: Array<{ color: 'B' | 'W'; point: string }>;
    color: 'B' | 'W';
    maxVisits: number;
  }): Promise<{ point: string }>;
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
