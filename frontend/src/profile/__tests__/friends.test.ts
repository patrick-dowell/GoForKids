import { describe, expect, it } from 'vitest';
import type { FriendCard } from '../../api/sync';
import {
  SEND_TEXT,
  cardView,
  countOf,
  formatFriendCode,
  friendAvatar,
  friendBoardRanks,
  friendName,
  isFriendCode,
  normalizeFriendCode,
  personLines,
  recentLines,
  resultDate,
  sendOutcome,
} from '../friends';

/**
 * The Friends section's rules (feature 32, revision 4): the code field's
 * normalisation, the line each answer to a send shows, and how another
 * player's values are read before anything about them is shown.
 */

describe('the friend code field', () => {
  it('removes every space and hyphen, then uppercases, and nothing else', () => {
    expect(normalizeFriendCode('ht4n9cwe')).toBe('HT4N9CWE');
    expect(normalizeFriendCode('HT4N 9CWE')).toBe('HT4N9CWE');
    expect(normalizeFriendCode('ht4n-9cwe')).toBe('HT4N9CWE');
    expect(normalizeFriendCode(' Ht4N - 9cWe ')).toBe('HT4N9CWE');
    expect(normalizeFriendCode('h-t 4-n 9-c w-e')).toBe('HT4N9CWE');
    // Other characters stay, so the code reads as malformed.
    expect(normalizeFriendCode('ht4n_9cwe')).toBe('HT4N_9CWE');
    expect(normalizeFriendCode('ht4n\t9cwe')).toBe('HT4N\t9CWE');
    expect(normalizeFriendCode('ht4n.9cwe')).toBe('HT4N.9CWE');
  });

  it('a code is exactly 8 characters of the share-code alphabet', () => {
    expect(isFriendCode('HT4N9CWE')).toBe(true);
    expect(isFriendCode('23456789')).toBe(true);
    expect(isFriendCode('ACDEFGHJ')).toBe(true);
    expect(isFriendCode('KMNPQRTV')).toBe(true);
    expect(isFriendCode('WXY2WXY3')).toBe(true);
    for (const bad of ['HT4N9CW', 'HT4N9CWEE', '', 'HT4N9CW0', 'HT4N9CW1', 'HT4N9CWB', 'HT4N9CWO', 'HT4N9CWI', 'HT4N9CWL', 'HT4N9CWS', 'HT4N9CWU', 'HT4N9CWZ', 'ht4n9cwe', 'HT4N 9CWE', 'HT4N9CWE\n']) {
      expect(isFriendCode(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('is shown in two groups of four', () => {
    expect(formatFriendCode('HT4N9CWE')).toBe('HT4N 9CWE');
    expect(formatFriendCode('ht4n-9cwe')).toBe('HT4N 9CWE');
    expect(formatFriendCode('HT4N9CW')).toBe('HT4N9CW');
  });
});

describe('what a send says', () => {
  it("each answer reads in the plan's words", () => {
    expect(SEND_TEXT[sendOutcome(202, 'HT4N9CWE')]).toBe('Request sent');
    expect(SEND_TEXT[sendOutcome(404, 'HT4N9CWE')]).toBe('No player has that code');
    expect(SEND_TEXT[sendOutcome(429, 'HT4N9CWE')]).toBe('Too many tries. Wait a little, then try again.');
    expect(SEND_TEXT[sendOutcome(503, 'HT4N9CWE')]).toBe("Couldn't connect. Try again in a minute.");
    expect(SEND_TEXT[sendOutcome(null, 'HT4N9CWE')]).toBe("Couldn't connect. Try again in a minute.");
  });

  it('both 422s: a well-formed code is the own code; a malformed one is not a friend code', () => {
    expect(sendOutcome(422, 'HT4N9CWE')).toBe('own-code');
    expect(SEND_TEXT['own-code']).toBe("That's your own code");
    expect(sendOutcome(422, 'HT4N9CW')).toBe('not-a-code');
    expect(sendOutcome(422, 'HT4N_9CW')).toBe('not-a-code');
    expect(SEND_TEXT['not-a-code']).toBe("That isn't a friend code");
  });
});

/** Text a tampered client might have written into its state. */
const INJECTED = 'INJ<b>Visit example.com</b>';

describe("another player's values", () => {
  it('a name only through the word lists', () => {
    expect(friendName([4, 2])).toBe('Gentle Panda');
    expect(friendName(null)).toBe('No name');
    expect(friendName([64, 0])).toBe('No name');
    expect(friendName(INJECTED)).toBe('No name');
    expect(friendName([1.5, 2])).toBe('No name');
    expect(friendName(['4', '2'])).toBe('No name');
  });

  it("an avatar only from the app's set, else the default", () => {
    for (const a of ['blackhole', 'nova', 'nebula', 'tide', 'eclipse', 'prism', 'comet']) expect(friendAvatar(a)).toBe(a);
    expect(friendAvatar(INJECTED)).toBe('blackhole');
    expect(friendAvatar('ember')).toBe('blackhole'); // a bot's, not a player's
    expect(friendAvatar(null)).toBe('blackhole');
  });

  it('ranks per board the way the Profile page reads them; other boards and rungs are left out', () => {
    expect(
      friendBoardRanks({
        '19x19': { rung: '20k', games: 5 },
        '9x9': { rung: '15k', games: 12 },
        [INJECTED]: { rung: '1d', games: 3 },
        '7x7': { rung: '15k', games: 3 },
      }),
    ).toEqual([
      { board: '9×9', rank: '15k', games: 12 },
      { board: '19×19', rank: '20k', games: 5 },
    ]);
    // A rung not in the ladder's form is never shown: the board's starting rung is.
    const [only] = friendBoardRanks({ '9x9': { rung: INJECTED, games: 2 } });
    expect(only.board).toBe('9×9');
    expect(only.rank).toMatch(/^[0-9]{1,2}[kdp]$/);
    expect(only.rank).not.toContain('INJ');
    expect(friendBoardRanks({ '9x9': { rung: '15k\n', games: 2 } })[0].rank).not.toContain('\n');
    // 13×13 has no ladder to resolve a rung against: the form alone keeps text out.
    expect(friendBoardRanks({ '13x13': { rung: '12k', games: 2 } })).toEqual([{ board: '13×13', rank: '12k', games: 2 }]);
    const [thirteen] = friendBoardRanks({ '13x13': { rung: INJECTED, games: 2 } });
    expect(thirteen.board).toBe('13×13');
    expect(thirteen.rank).not.toContain('INJ');
    // The whole rung must have the form, not just part of it.
    for (const rung of ['x12k', '12k<b>', '12kd', '123k', ' 12k', '12k ']) {
      expect(friendBoardRanks({ '13x13': { rung, games: 1 } })[0].rank, rung).not.toBe(rung);
    }
    expect(friendBoardRanks(null)).toEqual([]);
    expect(friendBoardRanks([1, 2])).toEqual([]);
    expect(friendBoardRanks(INJECTED)).toEqual([]);
  });

  it('counts are whole numbers, never below 0', () => {
    expect(countOf(12)).toBe(12);
    expect(countOf(0)).toBe(0);
    expect(countOf(-1)).toBe(0);
    expect(countOf(2.5)).toBe(0);
    expect(countOf('12')).toBe(0);
    expect(countOf(true)).toBe(0);
    expect(friendBoardRanks({ '9x9': { rung: '15k', games: INJECTED } })[0].games).toBe(0);
  });

  it('recent results: a board the app has, a win or a loss, a whole-number time; at most ten', () => {
    const ok = { board: '9x9', result: 'win', rung: '18k', ts: 1759363200000 };
    const lines = recentLines([
      ok,
      { ...ok, board: '19x19', result: 'loss' },
      { ...ok, board: '13x13' },
      { ...ok, board: INJECTED },
      { ...ok, result: INJECTED },
      { ...ok, result: 'draw' },
      { ...ok, ts: INJECTED },
      { ...ok, ts: true },
      { ...ok, ts: 1.5 },
      { ...ok, ts: -1 },
      { ...ok, ts: 2 ** 53 + 2 },
      null,
      INJECTED,
    ]);
    expect(lines).toEqual([
      { board: '9×9', result: 'win', ts: 1759363200000 },
      { board: '19×19', result: 'loss', ts: 1759363200000 },
      { board: '13×13', result: 'win', ts: 1759363200000 },
    ]);
    expect(recentLines([0, 0])).toEqual([]);
    expect(recentLines(Array.from({ length: 14 }, () => ok))).toHaveLength(10);
    expect(recentLines(INJECTED)).toEqual([]);
    expect(recentLines({ 0: ok })).toEqual([]);
    expect(recentLines([{ ...ok, ts: 0 }, { ...ok, ts: 2 ** 53 }])).toHaveLength(2);
  });

  it('a date, never a time', () => {
    const now = new Date(2026, 9, 2, 12);
    const ts = new Date(2026, 9, 1, 15, 42).getTime();
    const text = resultDate(ts, now);
    expect(text).toBe(new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }));
    expect(text).not.toMatch(/15|42|:/);
    // Another year says which.
    const old = new Date(2025, 11, 30, 9, 5).getTime();
    expect(resultDate(old, now)).toBe(new Date(old).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }));
    expect(resultDate(old, now)).toContain('2025');
  });

  it('list entries: the id, the name and the avatar; an entry without an id is left out', () => {
    expect(
      personLines([
        { player_id: 'a', handle: [4, 2], avatar: 'nova', since: '2026-10-01T09:00:00Z' },
        { player_id: 'b', handle: INJECTED, avatar: INJECTED, sent_at: INJECTED },
        { player_id: 7, handle: [1, 1], avatar: 'tide' },
        { player_id: '', handle: [1, 1], avatar: 'tide' },
        null,
      ]),
    ).toEqual([
      { playerId: 'a', name: 'Gentle Panda', avatar: 'nova' },
      { playerId: 'b', name: 'No name', avatar: 'blackhole' },
    ]);
    expect(personLines(INJECTED)).toEqual([]);
  });

  it('a card shows nothing a tampered state wrote', () => {
    const card = {
      player_id: 'f-1',
      handle: INJECTED,
      avatar: INJECTED,
      boards: { [INJECTED]: { rung: INJECTED, games: 1 }, '9x9': { rung: INJECTED, games: 4 } },
      games: INJECTED,
      recent: [{ board: INJECTED, result: INJECTED, rung: INJECTED, ts: INJECTED }],
    } as unknown as FriendCard;
    const view = cardView(card);
    expect(JSON.stringify(view)).not.toContain('INJ');
    expect(view.name).toBe('No name');
    expect(view.avatar).toBe('blackhole');
    expect(view.games).toBe(0);
    expect(view.recent).toEqual([]);
    expect(view.ranks.map((r) => r.board)).toEqual(['9×9']);
  });

  it('a card as the server sends it', () => {
    const view = cardView({
      player_id: 'f-1',
      handle: [4, 2],
      avatar: 'nova',
      boards: { '9x9': { rung: '18k', games: 12 }, '19x19': { rung: null, games: 0 } },
      games: 12,
      recent: [{ board: '9x9', result: 'win', rung: '18k', ts: 1759363200000 }],
    });
    expect(view).toMatchObject({
      playerId: 'f-1',
      name: 'Gentle Panda',
      avatar: 'nova',
      games: 12,
      recent: [{ board: '9×9', result: 'win', ts: 1759363200000 }],
    });
    expect(view.ranks[0]).toEqual({ board: '9×9', rank: '18k', games: 12 });
    expect(view.ranks[1].board).toBe('19×19');
  });
});
