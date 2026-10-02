import { describe, expect, it } from 'vitest';
import {
  feedLines,
  feedWhen,
  friendStatuses,
  gameLines,
  onlineLines,
  ranksText,
  replayToOpen,
} from '../friendsFeed';
import { renderName } from '../names';

/**
 * The friends feed and a friend's replays as shown (feature 32, revision
 * 5): the sentences, the day each happened, who is online, and how a
 * friend's replay is read once more before the viewer gets it. Nothing
 * another player wrote is ever part of a sentence.
 */

const NOW = new Date(2026, 9, 2, 15, 0); // Oct 2 2026, an afternoon, local time
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).getTime();
const RAVEN = 'p-raven';
const OWL = 'p-owl';
const raven = { player_id: RAVEN, handle: [3, 3], avatar: 'nova' };
const owl = { player_id: OWL, handle: [8, 5], avatar: 'comet' };
const RAVEN_NAME = renderName([3, 3]);
const OWL_NAME = renderName([8, 5]);
const INJ = 'INJ Visit example.com';

describe('when something happened', () => {
  it('is Today, Yesterday, or the date, never a time', () => {
    expect(feedWhen(at(2, 0), NOW)).toBe('Today');
    expect(feedWhen(at(2, 23), NOW)).toBe('Today');
    expect(feedWhen(at(1, 23), NOW)).toBe('Yesterday');
    expect(feedWhen(at(1, 0), NOW)).toBe('Yesterday');
    expect(feedWhen(new Date(2026, 8, 30, 12).getTime(), NOW)).toBe('Sep 30');
    expect(feedWhen(new Date(2025, 11, 31).getTime(), NOW)).toBe('Dec 31, 2025');
  });

  it('Yesterday across a month', () => {
    expect(feedWhen(new Date(2026, 8, 30, 20).getTime(), new Date(2026, 9, 1, 8))).toBe('Yesterday');
  });
});

describe('the feed', () => {
  const feed = {
    friends: [
      { ...owl, active_recently: false, boards: {} },
      { ...raven, active_recently: true, boards: { '9x9': { rung: '9k', games: 30 }, '19x19': { rung: '25k', games: 2 } } },
    ],
    events: [
      { kind: 'promotion', ...raven, board: '9x9', from: '10k', to: '9k', ts: at(2) },
      { kind: 'game', ...raven, board: '9x9', result: 'win', rung: '10k', bot: '12k', ts: at(2) },
      { kind: 'game', ...owl, board: '19x19', result: 'loss', rung: '25k', bot: '18k', ts: at(1) },
      { kind: 'game', ...owl, board: '13x13', result: 'win', rung: '25k', bot: null, ts: at(1) },
      { kind: 'game', ...owl, board: '13x13', result: 'loss', rung: null, bot: null, ts: new Date(2026, 8, 24, 9).getTime() },
    ],
  };

  it('reads each event as a sentence a child reads, newest first', () => {
    const lines = feedLines(feed, NOW);
    expect(lines.map((l) => [l.text, l.when])).toEqual([
      [`${RAVEN_NAME} was promoted to 9k on 9×9`, 'Today'],
      [`${RAVEN_NAME} beat the 12k bot on 9×9`, 'Today'],
      [`${OWL_NAME} lost to the 18k bot on 19×19`, 'Yesterday'],
      [`${OWL_NAME} won a game on 13×13`, 'Yesterday'],
      [`${OWL_NAME} lost a game on 13×13`, 'Sep 24'],
    ]);
    expect(lines.map((l) => l.good)).toEqual([true, true, false, true, false]);
    expect(lines.map((l) => l.active)).toEqual([true, true, false, false, false]);
    expect(lines.map((l) => l.avatar)).toEqual(['nova', 'nova', 'comet', 'comet', 'comet']);
    expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length);
  });

  it('says who is online now, in the server order', () => {
    expect(onlineLines(feed)).toEqual([{ playerId: RAVEN, avatar: 'nova', text: `${RAVEN_NAME} is online now` }]);
  });

  it("gives each friend's online dot and ranks", () => {
    const st = friendStatuses(feed);
    expect(st.get(OWL)).toEqual({ active: false, ranks: [] });
    expect(st.get(RAVEN)!.active).toBe(true);
    expect(ranksText(st.get(RAVEN)!.ranks)).toBe('9×9 9k · 19×19 25k');
  });

  it('a profile from before names reads as "A friend" in a sentence', () => {
    const lines = feedLines({ friends: [], events: [{ ...feed.events[1], handle: null }] }, NOW);
    expect(lines[0].text).toBe('A friend beat the 12k bot on 9×9');
    expect(onlineLines({ friends: [{ player_id: 'p', handle: [64, 0], active_recently: true }] })[0].text).toBe(
      'A friend is online now',
    );
  });

  it('leaves out anything that fails a check, and never shows text another player wrote', () => {
    const bad = {
      friends: [{ player_id: RAVEN, handle: INJ, avatar: INJ, active_recently: 'yes', boards: { [INJ]: { rung: INJ, games: 1 } } }],
      events: [
        { kind: 'game', ...raven, handle: INJ, avatar: INJ, board: '9x9', result: 'win', bot: INJ, ts: at(2) },
        { kind: 'game', ...raven, board: INJ, result: 'win', bot: '12k', ts: at(2) },
        { kind: 'game', ...raven, board: '9x9', result: INJ, bot: '12k', ts: at(2) },
        { kind: 'game', ...raven, board: '9x9', result: 'win', bot: '12k', ts: INJ },
        { kind: 'game', ...raven, board: '9x9', result: 'win', bot: '12k', ts: 1.5 },
        { kind: 'promotion', ...raven, board: '9x9', to: INJ, ts: at(2) },
        { kind: INJ, ...raven, board: '9x9', result: 'win', ts: at(2) },
        { kind: 'game', player_id: '', board: '9x9', result: 'win', ts: at(2) },
        INJ,
        null,
      ],
    };
    const lines = feedLines(bad, NOW);
    expect(lines.map((l) => l.text)).toEqual(['A friend won a game on 9×9']);
    expect(lines[0].avatar).toBe('blackhole');
    expect(lines[0].active).toBe(false);
    expect(onlineLines(bad)).toEqual([]);
    expect(friendStatuses(bad).get(RAVEN)).toEqual({ active: false, ranks: [] });
    expect(JSON.stringify([lines, onlineLines(bad), [...friendStatuses(bad)]])).not.toContain('INJ');
  });

  it('a feed that is not one reads as empty', () => {
    for (const f of [null, undefined, 5, 'x', [], { friends: 'x', events: {} }]) {
      expect(feedLines(f, NOW)).toEqual([]);
      expect(onlineLines(f)).toEqual([]);
      expect(friendStatuses(f).size).toBe(0);
    }
  });
});

describe("a friend's replays", () => {
  it('reads each as what happened, and when', () => {
    const lines = gameLines(
      [
        { id: 'g1', date: new Date(at(2, 10)).toISOString(), board: '9x9', outcome: 'win', opponent: '12k' },
        { id: 'g2', date: new Date(at(1, 10)).toISOString(), board: '19x19', outcome: 'loss', opponent: '18k' },
        { id: 'g3', date: new Date(at(1, 9)).toISOString(), board: '9x9', outcome: 'watched', opponent: null },
        { id: 'g4', date: new Date(at(1, 8)).toISOString(), board: null, outcome: null, opponent: '6k' },
        { id: 'g5', date: new Date(at(1, 7)).toISOString(), board: null, outcome: null, opponent: null },
        { id: 'g6', date: new Date(at(1, 6)).toISOString(), board: '13x13', outcome: 'win', opponent: null },
      ],
      NOW,
    );
    expect(lines.map((l) => [l.id, l.text, l.when])).toEqual([
      ['g1', 'Beat the 12k bot on 9×9', 'Today'],
      ['g2', 'Lost to the 18k bot on 19×19', 'Yesterday'],
      ['g3', 'Watched two bots play on 9×9', 'Yesterday'],
      ['g4', 'Played the 6k bot', 'Yesterday'],
      ['g5', 'Played a game', 'Yesterday'],
      ['g6', 'Won a game on 13×13', 'Yesterday'],
    ]);
  });

  it('leaves out an entry without an id or a date, and never shows another value as text', () => {
    const lines = gameLines(
      [
        { id: 'ok', date: new Date(at(2)).toISOString(), board: INJ, outcome: INJ, opponent: INJ },
        { id: '', date: new Date(at(2)).toISOString() },
        { id: 'x', date: INJ },
        { id: 7, date: new Date(at(2)).toISOString() },
        INJ,
      ],
      NOW,
    );
    expect(lines).toEqual([{ id: 'ok', text: 'Played a game', when: 'Today', outcome: null }]);
    expect(gameLines('x')).toEqual([]);
  });
});

describe('opening a friend replay', () => {
  const SGF = '(;GM[1]FF[4]CA[UTF-8]SZ[9]KM[6.5]RU[Japanese]RE[B+5.5];B[ee];W[cc];B[gc];W[])';
  const HANDICAP = '(;GM[1]FF[4]CA[UTF-8]SZ[19]KM[0.5]RU[Japanese]HA[2]AB[dd][pp];W[qd];B[])';

  it("passes the Library's meta for a replay as the server serves it", () => {
    expect(
      replayToOpen({
        id: 'g1',
        date: '2026-10-01T16:00:00.000Z',
        payload: {
          sgf: SGF,
          result: 'Black wins by 5.5',
          playerColor: 'white',
          opponentRank: '12k',
          scoreHistory: [{ move: 0, lead: -6.5 }, { move: 1, lead: 2 }],
          deadStones: [{ row: 2, col: 2, color: 2 }],
          sharedId: 'K7QX2MPD',
          gameId: 'abc',
        },
      }),
    ).toEqual({
      sgf: SGF,
      meta: {
        result: 'Black wins by 5.5',
        playerColor: 'white',
        opponentRank: '12k',
        scoreHistory: [{ move: 0, lead: -6.5 }, { move: 1, lead: 2 }],
        deadStones: [{ row: 2, col: 2, color: 2 }],
      },
    });
    expect(replayToOpen({ payload: { sgf: HANDICAP } })).toEqual({ sgf: HANDICAP, meta: { playerColor: 'black' } });
    expect(replayToOpen({ payload: { sgf: SGF, opponentRank: '12k vs ?' } })!.meta.opponentRank).toBe('12k vs ?');
  });

  it('opens nothing for an SGF in any other shape', () => {
    for (const sgf of [
      SGF.replace(';B[ee]', ';B[ee]C[INJ]'),
      SGF.replace('RU[Japanese]', 'PB[INJ]RU[Japanese]'),
      SGF.replace('KM[6.5]', 'KM[INJ]'),
      SGF.replace('RE[B+5.5]', 'RE[INJ]'),
      SGF.replace(';B[ee]', ';B[zz]'),
      SGF + ' ',
      '',
      7,
    ]) {
      expect(replayToOpen({ payload: { sgf } })).toBeNull();
    }
    for (const g of [null, 5, {}, { payload: null }, { payload: [] }]) expect(replayToOpen(g)).toBeNull();
  });

  it('leaves out any other value that fails a check', () => {
    const out = replayToOpen({
      payload: {
        sgf: SGF,
        result: `Black wins by 5.5 ${INJ}`,
        playerColor: INJ,
        opponentRank: INJ,
        scoreHistory: [{ move: 1, lead: 1 }, { move: 'x', lead: 1 }, { move: 2, lead: Infinity }, INJ],
        deadStones: [{ row: 1, col: 1, color: 3 }, { row: 1, col: 1, color: 1, x: INJ }],
      },
    })!;
    expect(out.meta).toEqual({
      playerColor: 'black',
      scoreHistory: [{ move: 1, lead: 1 }],
      deadStones: [{ row: 1, col: 1, color: 1 }],
    });
    expect(JSON.stringify(out)).not.toContain('INJ');
  });
});
