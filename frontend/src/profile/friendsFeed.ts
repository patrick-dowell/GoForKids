/**
 * The friends feed and a friend's replays as shown (feature 32, revision 5),
 * kept free of React and of the stores so each rule is tested on its own.
 *
 * As in friends.ts, everything here comes from the server, which sends only
 * values it has checked, and is read once more before it is shown: a name
 * only through the word lists, an avatar from the app's set, a board from
 * the three the app has, a rank in the ladder's form, a result as a win or a
 * loss on a day. A sentence is built here from those values alone; nothing
 * another player wrote is ever part of one.
 */

import type { FeedFriend, FriendGame, FriendGameEntry } from '../api/sync';
import type { PlayerAvatarType } from '../components/Avatar';
import type { BoardRank } from './admin';
import { FRIEND_BOARDS, friendAvatar, friendBoardRanks, resultDate } from './friends';
import { isHandle, renderName, type Handle } from './names';

const RUNG_RE = /^[0-9]{1,2}[kdp]$/;
/** A replay id as the app writes it (8 hex digits, or "local-" and a time). */
const GAME_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MATCHUP_RE = /^(?:[0-9]{1,2}[kdp]|\?) vs (?:[0-9]{1,2}[kdp]|\?)$/;
const RESULT_RE = /^(Black|White) wins (?:by [0-9]{1,4}(?:\.[0-9]{1,2})?|\(resignation\))$/;
/** The one SGF shape the server serves for a friend's replay: what the app
 *  itself writes, rebuilt from the board alone. */
const SGF_RE =
  /^\(;GM\[1\]FF\[4\]CA\[UTF-8\]SZ\[[0-9]{1,2}\](?:KM\[-?[0-9]{1,3}(?:\.[0-9]{1,2})?\])?RU\[Japanese\](?:HA\[[0-9]{1,3}\]AB(?:\[[a-s]{2}\])+)?(?:RE\[[BW]\+[0-9]{1,4}(?:\.[0-9]{1,3})?\])?(?:;[BW]\[(?:[a-s]{2})?\])*\)$/;

function isRung(v: unknown): v is string {
  return typeof v === 'string' && RUNG_RE.test(v);
}

function isBoardKey(v: unknown): v is string {
  return typeof v === 'string' && (FRIEND_BOARDS as readonly string[]).includes(v);
}

function isTs(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 2 ** 53;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** "9x9" → "9×9". */
function boardLabel(key: string): string {
  return key.replace('x', '×');
}

/** A friend's name in a sentence: the generated name, or "A friend" for a
 *  profile from before names (a list shows "No name"; a sentence reads
 *  better this way). */
function sentenceName(handle: unknown): string {
  return isHandle(handle) ? renderName(handle as Handle) : 'A friend';
}

/** When something happened, to the day: "Today", "Yesterday", else the date
 *  as the card shows it ("Oct 1"). Never a time of day. */
export function feedWhen(ts: number, now: Date = new Date()): string {
  const d = new Date(ts);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const today = day(now);
  if (day(d) === today) return 'Today';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  if (day(d) === yesterday) return 'Yesterday';
  return resultDate(ts, now);
}

/* ------------------------------------------------------------------------- *
 * The feed.
 * ------------------------------------------------------------------------- */

export interface FeedLine {
  /** Unique within one feed. */
  key: string;
  playerId: string;
  avatar: PlayerAvatarType;
  /** A device of theirs was seen in the last ten minutes. */
  active: boolean;
  /** A win or a promotion: shown brighter. */
  good: boolean;
  /** "Swift Raven beat the 12k bot on 9×9". */
  text: string;
  /** "Today", "Yesterday", "Oct 1". */
  when: string;
  /** The friend's replay of this game, which the line opens (revision 8);
   *  null for a result without one, and always for a promotion. */
  gameId: string | null;
}

/** Who is active, by player id. */
function activeIds(feed: unknown): Set<string> {
  const friends = isRecord(feed) && Array.isArray(feed.friends) ? feed.friends : [];
  return new Set(
    friends
      .filter((f): f is FeedFriend => isRecord(f) && typeof f.player_id === 'string' && f.active_recently === true)
      .map((f) => f.player_id),
  );
}

/** One event as a sentence a child reads, or null when it fails a check. */
function eventText(e: Record<string, unknown>): { text: string; good: boolean } | null {
  if (!isBoardKey(e.board) || !isTs(e.ts)) return null;
  const name = sentenceName(e.handle);
  const on = `on ${boardLabel(e.board)}`;
  if (e.kind === 'promotion') {
    return isRung(e.to) ? { text: `${name} was promoted to ${e.to} ${on}`, good: true } : null;
  }
  if (e.kind !== 'game') return null;
  const bot = isRung(e.bot) ? e.bot : null;
  if (e.result === 'win') {
    return { text: bot ? `${name} beat the ${bot} bot ${on}` : `${name} won a game ${on}`, good: true };
  }
  if (e.result === 'loss') {
    return { text: bot ? `${name} lost to the ${bot} bot ${on}` : `${name} lost a game ${on}`, good: false };
  }
  return null;
}

/** `GET /friends/feed`'s events as shown, in the server's order (newest
 *  first). An event that fails a check is left out. */
export function feedLines(feed: unknown, now: Date = new Date()): FeedLine[] {
  const events = isRecord(feed) && Array.isArray(feed.events) ? feed.events : [];
  const active = activeIds(feed);
  const lines: FeedLine[] = [];
  events.forEach((raw, i) => {
    if (!isRecord(raw) || typeof raw.player_id !== 'string' || !raw.player_id) return;
    const said = eventText(raw);
    if (!said) return;
    lines.push({
      key: `${i}-${raw.player_id}-${String(raw.ts)}`,
      playerId: raw.player_id,
      avatar: friendAvatar(raw.avatar),
      active: active.has(raw.player_id),
      good: said.good,
      text: said.text,
      when: feedWhen(raw.ts as number, now),
      gameId: raw.kind === 'game' && typeof raw.game_id === 'string' && GAME_ID_RE.test(raw.game_id) ? raw.game_id : null,
    });
  });
  return lines;
}

export interface OnlineLine {
  playerId: string;
  avatar: PlayerAvatarType;
  /** "Swift Raven is online now". */
  text: string;
}

/** The friends with a device seen in the last ten minutes, in the server's
 *  order, as feed lines of their own. */
export function onlineLines(feed: unknown): OnlineLine[] {
  const friends = isRecord(feed) && Array.isArray(feed.friends) ? feed.friends : [];
  return friends
    .filter((f): f is FeedFriend => isRecord(f) && typeof f.player_id === 'string' && !!f.player_id && f.active_recently === true)
    .map((f) => ({ playerId: f.player_id, avatar: friendAvatar(f.avatar), text: `${sentenceName(f.handle)} is online now` }));
}

export interface FriendStatus {
  active: boolean;
  /** Rank per board, as the card shows them. */
  ranks: BoardRank[];
}

/** Each friend's online dot and ranks from the feed, by player id, for the
 *  friends list. */
export function friendStatuses(feed: unknown): Map<string, FriendStatus> {
  const out = new Map<string, FriendStatus>();
  const friends = isRecord(feed) && Array.isArray(feed.friends) ? feed.friends : [];
  for (const f of friends) {
    if (!isRecord(f) || typeof f.player_id !== 'string' || !f.player_id) continue;
    out.set(f.player_id, { active: f.active_recently === true, ranks: friendBoardRanks(f.boards) });
  }
  return out;
}

/** "9×9 9k · 19×19 25k": a friend's ranks on one short line. */
export function ranksText(ranks: BoardRank[]): string {
  return ranks.map((r) => `${r.board} ${r.rank}`).join(' · ');
}

/* ------------------------------------------------------------------------- *
 * A friend's replays.
 * ------------------------------------------------------------------------- */

export interface GameLine {
  id: string;
  /** "Beat the 12k bot on 9×9". */
  text: string;
  /** "Today", "Yesterday", "Oct 1". */
  when: string;
  outcome: FriendGameEntry['outcome'];
}

function gameText(e: Record<string, unknown>): string {
  const opp = isRung(e.opponent) ? e.opponent : null;
  const what =
    e.outcome === 'win'
      ? opp ? `Beat the ${opp} bot` : 'Won a game'
      : e.outcome === 'loss'
        ? opp ? `Lost to the ${opp} bot` : 'Lost a game'
        : e.outcome === 'watched'
          ? 'Watched two bots play'
          : opp ? `Played the ${opp} bot` : 'Played a game';
  return isBoardKey(e.board) ? `${what} on ${boardLabel(e.board)}` : what;
}

/** `GET /friends/{id}/games` as shown, newest first. An entry without an id
 *  or a date is left out. */
export function gameLines(list: unknown, now: Date = new Date()): GameLine[] {
  if (!Array.isArray(list)) return [];
  const lines: GameLine[] = [];
  for (const e of list) {
    if (!isRecord(e) || typeof e.id !== 'string' || !e.id || typeof e.date !== 'string') continue;
    const ts = Date.parse(e.date);
    if (Number.isNaN(ts)) continue;
    const outcome = e.outcome === 'win' || e.outcome === 'loss' || e.outcome === 'watched' ? e.outcome : null;
    lines.push({ id: e.id, text: gameText(e), when: feedWhen(ts, now), outcome });
  }
  return lines;
}

/** What the replay viewer is opened with: the Library's `loadGame` meta,
 *  without a library id (the game is not in this device's Library, so it
 *  can't be shared from here). */
export interface ReplayToOpen {
  sgf: string;
  meta: {
    result?: string;
    playerColor: 'black' | 'white';
    opponentRank?: string;
    scoreHistory?: Array<{ move: number; lead: number }>;
    deadStones?: Array<{ row: number; col: number; color: number }>;
  };
}

/** A friend's replay, read once more before the viewer gets it; null when its
 *  SGF is not the one shape the server serves. */
export function replayToOpen(game: FriendGame | unknown): ReplayToOpen | null {
  const p = isRecord(game) && isRecord(game.payload) ? game.payload : null;
  if (!p || typeof p.sgf !== 'string' || !SGF_RE.test(p.sgf)) return null;
  const meta: ReplayToOpen['meta'] = { playerColor: p.playerColor === 'white' ? 'white' : 'black' };
  if (typeof p.result === 'string' && RESULT_RE.test(p.result)) meta.result = p.result;
  if (typeof p.opponentRank === 'string' && (RUNG_RE.test(p.opponentRank) || MATCHUP_RE.test(p.opponentRank))) {
    meta.opponentRank = p.opponentRank;
  }
  if (Array.isArray(p.scoreHistory)) {
    const points = p.scoreHistory.filter(
      (s): s is { move: number; lead: number } =>
        isRecord(s) && Number.isInteger(s.move) && typeof s.lead === 'number' && Number.isFinite(s.lead),
    );
    if (points.length > 0) meta.scoreHistory = points.map((s) => ({ move: s.move, lead: s.lead }));
  }
  if (Array.isArray(p.deadStones)) {
    const stones = p.deadStones.filter(
      (s): s is { row: number; col: number; color: number } =>
        isRecord(s) && Number.isInteger(s.row) && Number.isInteger(s.col) && (s.color === 1 || s.color === 2),
    );
    if (stones.length > 0) meta.deadStones = stones.map((s) => ({ row: s.row, col: s.col, color: s.color }));
  }
  return { sgf: p.sgf, meta };
}
