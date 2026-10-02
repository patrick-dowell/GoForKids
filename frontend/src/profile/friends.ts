/**
 * The Friends section's rules (feature 32, revision 4), kept free of React
 * and of the stores so each is tested on its own: the friend code field's
 * normalisation, what each answer to a send says, and how another player's
 * values are read before anything is shown.
 *
 * Nothing a player types is ever shown to another player. Everything this
 * section shows about someone else comes from the server, and is read here
 * once more before it is shown: a name only through the word lists, an
 * avatar only from the app's own set, a board only from the three the app
 * has, a rank only in the ladder's form, a result only as a win or a loss
 * on a date. Anything else is left out, never shown as text.
 */

import type { AdminBoard, FriendCard, FriendEntry, FriendRequestEntry, FriendResult } from '../api/sync';
import { PAIRING_CODE_ALPHABET } from '../api/sync';
import type { PlayerAvatarType } from '../components/Avatar';
import { boardRanks, type BoardRank } from './admin';
import { renderName, isHandle, type Handle } from './names';

/* ------------------------------------------------------------------------- *
 * The friend code.
 * ------------------------------------------------------------------------- */

/** A friend code is 8 characters of the share-code alphabet. */
export const FRIEND_CODE_LENGTH = 8;

const FRIEND_CODE_RE = new RegExp(`^[${PAIRING_CODE_ALPHABET}]{${FRIEND_CODE_LENGTH}}$`);

/** The plan's normalisation, the server's too: remove every space and
 *  hyphen, then uppercase. Nothing else is changed. */
export function normalizeFriendCode(raw: string): string {
  return raw.replace(/[ -]/g, '').toUpperCase();
}

/** True for a normalised code the server would look up (8 characters of
 *  the alphabet); anything else it answers with 422. */
export function isFriendCode(code: string): boolean {
  return FRIEND_CODE_RE.test(code);
}

/** "ABCDEFGH" → "ABCD EFGH": two groups of four. */
export function formatFriendCode(code: string): string {
  const c = normalizeFriendCode(code);
  return isFriendCode(c) ? `${c.slice(0, 4)} ${c.slice(4)}` : c;
}

/* ------------------------------------------------------------------------- *
 * What a send says.
 * ------------------------------------------------------------------------- */

export type SendOutcome = 'sent' | 'not-found' | 'own-code' | 'not-a-code' | 'too-many' | 'failed';

/** The line shown after a send, in the plan's words. */
export const SEND_TEXT: Record<SendOutcome, string> = {
  sent: 'Request sent',
  'not-found': 'No player has that code',
  'own-code': "That's your own code",
  'not-a-code': "That isn't a friend code",
  'too-many': 'Too many tries. Wait a little, then try again.',
  failed: "Couldn't connect. Try again in a minute.",
};

/**
 * What the server's answer to `POST /friends/requests` means. The server
 * answers 422 for a malformed code and for the requester's own code alike,
 * and normalises exactly as this field does; a code this field finds
 * malformed is never sent, so a 422 for a well-formed code is the own code.
 * `status` is null when no answer came (offline, a timeout).
 */
export function sendOutcome(status: number | null, code: string): SendOutcome {
  if (status === 202) return 'sent';
  if (status === 404) return 'not-found';
  if (status === 422) return isFriendCode(code) ? 'own-code' : 'not-a-code';
  if (status === 429) return 'too-many';
  return 'failed';
}

/* ------------------------------------------------------------------------- *
 * Another player's values.
 * ------------------------------------------------------------------------- */

const AVATARS: readonly PlayerAvatarType[] = ['blackhole', 'nova', 'nebula', 'tide', 'eclipse', 'prism', 'comet'];

/** The board keys a card may carry. */
export const FRIEND_BOARDS = ['9x9', '13x13', '19x19'] as const;

const RUNG_RE = /^[0-9]{1,2}[kdp]$/;

/** One of the app's avatars, else the default. */
export function friendAvatar(v: unknown): PlayerAvatarType {
  return typeof v === 'string' && (AVATARS as readonly string[]).includes(v) ? (v as PlayerAvatarType) : 'blackhole';
}

/** The generated name, or "No name" for a profile from before names. */
export function friendName(handle: unknown): string {
  return isHandle(handle) ? renderName(handle as Handle) : 'No name';
}

function isBoardKey(k: string): boolean {
  return (FRIEND_BOARDS as readonly string[]).includes(k);
}

/** "9x9" → "9×9", as the Profile page heads its rank card. */
function boardLabel(key: string): string {
  return key.replace('x', '×');
}

/** Each board's rank on the card, read the way the Profile page reads rank
 *  (the admin list's `boardRanks`), after dropping any board key the app
 *  doesn't have and any rung not in the ladder's form. */
export function friendBoardRanks(boards: unknown): BoardRank[] {
  if (!boards || typeof boards !== 'object' || Array.isArray(boards)) return [];
  const clean: Record<string, AdminBoard> = {};
  for (const [key, b] of Object.entries(boards as Record<string, unknown>)) {
    if (!isBoardKey(key)) continue;
    const board = (b ?? {}) as Partial<AdminBoard>;
    const rung = typeof board.rung === 'string' && RUNG_RE.test(board.rung) ? board.rung : null;
    clean[key] = { rung, games: countOf(board.games) };
  }
  return boardRanks(clean);
}

/** A count to show: a whole number, never below 0. */
export function countOf(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0;
}

export interface RecentLine {
  /** "9×9". */
  board: string;
  result: 'win' | 'loss';
  /** Epoch ms, for the date. */
  ts: number;
}

function isResult(r: unknown): r is FriendResult {
  const x = r as FriendResult;
  return (
    !!x &&
    typeof x === 'object' &&
    typeof x.board === 'string' &&
    isBoardKey(x.board) &&
    (x.result === 'win' || x.result === 'loss') &&
    typeof x.ts === 'number' &&
    Number.isInteger(x.ts) &&
    x.ts >= 0 &&
    x.ts <= 2 ** 53
  );
}

/** The card's recent results as shown: board, win or loss, and a time for
 *  the date. Entries that fail a check are skipped; at most ten. */
export function recentLines(recent: unknown): RecentLine[] {
  if (!Array.isArray(recent)) return [];
  return recent
    .filter(isResult)
    .slice(0, 10)
    .map((r) => ({ board: boardLabel(r.board), result: r.result, ts: r.ts }));
}

/** A result's date, never its time: "Oct 1", or "Oct 1, 2025" in another
 *  year. */
export function resultDate(ts: number, now: Date = new Date()): string {
  const d = new Date(ts);
  return d.toLocaleDateString(
    [],
    d.getFullYear() === now.getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' },
  );
}

/** A list entry as shown: its id (never shown), name and avatar. */
export interface PersonLine {
  playerId: string;
  name: string;
  avatar: PlayerAvatarType;
}

function personLine(e: unknown): PersonLine | null {
  const x = e as FriendEntry | FriendRequestEntry;
  if (!x || typeof x !== 'object' || typeof x.player_id !== 'string' || !x.player_id) return null;
  return { playerId: x.player_id, name: friendName(x.handle), avatar: friendAvatar(x.avatar) };
}

/** `friends` or `incoming` from `GET /friends`, as shown, in the server's
 *  order (newest first). An entry without an id is left out. */
export function personLines(list: unknown): PersonLine[] {
  if (!Array.isArray(list)) return [];
  return list.map(personLine).filter((p): p is PersonLine => p !== null);
}

/** A friend's card as shown. */
export interface CardView {
  playerId: string;
  name: string;
  avatar: PlayerAvatarType;
  ranks: BoardRank[];
  games: number;
  recent: RecentLine[];
}

export function cardView(card: FriendCard): CardView {
  return {
    playerId: card.player_id,
    name: friendName(card.handle),
    avatar: friendAvatar(card.avatar),
    ranks: friendBoardRanks(card.boards),
    games: countOf(card.games),
    recent: recentLines(card.recent),
  };
}
