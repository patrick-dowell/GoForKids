import { describe, expect, it } from 'vitest';
import type { AdminPlayer } from '../../api/sync';
import {
  CODE_MAX_AHEAD_MS,
  boardRanks,
  canRemoveDevice,
  canSignOutPlayer,
  codeExpiryOptions,
  daysLeftText,
  defaultCodeExpiry,
  expiryLabel,
  freshPlayerState,
  isAllowedCodeExpiry,
  isOwnProfile,
  isThisDevice,
} from '../admin';

/**
 * The Admin section's rules (feature 32, revision 3). Times are built in the
 * device's own time zone, as the section builds them, so these hold in any
 * zone the suite runs in.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;

/** 2 Oct 2026 at h:m, this device's time zone. */
function at(h: number, m = 0, s = 0, day = 2): Date {
  return new Date(2026, 9, day, h, m, s, 0);
}

describe('code expiry: the default', () => {
  it('is 4:30 pm today while that is still ahead', () => {
    expect(defaultCodeExpiry(at(8, 15))).toEqual(at(16, 30));
    expect(defaultCodeExpiry(at(16, 29, 59))).toEqual(at(16, 30));
  });

  it('is one hour from now once 4:30 pm has come', () => {
    expect(defaultCodeExpiry(at(16, 30))).toEqual(at(17, 30));
    expect(defaultCodeExpiry(at(20, 10, 5))).toEqual(at(21, 10, 5));
    expect(defaultCodeExpiry(at(23, 40))).toEqual(at(0, 40, 0, 3));
  });
});

describe('code expiry: the 24-hour bound', () => {
  it('allows a time after now and at most 24 hours ahead', () => {
    const now = at(9);
    expect(isAllowedCodeExpiry(new Date(now.getTime() + 1), now)).toBe(true);
    expect(isAllowedCodeExpiry(new Date(now.getTime() + CODE_MAX_AHEAD_MS), now)).toBe(true);
    expect(isAllowedCodeExpiry(new Date(now.getTime() + CODE_MAX_AHEAD_MS + 1), now)).toBe(false);
    expect(isAllowedCodeExpiry(now, now)).toBe(false);
    expect(isAllowedCodeExpiry(new Date(now.getTime() - MIN), now)).toBe(false);
    expect(CODE_MAX_AHEAD_MS).toBe(24 * HOUR);
  });

  it('offers nothing past 24 hours and nothing already gone, earliest first, the default among them', () => {
    for (const now of [at(8, 15), at(16, 45, 20), at(23, 59, 59), at(0, 0)]) {
      const options = codeExpiryOptions(now);
      const times = options.map((d) => d.getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
      for (const t of times) {
        expect(t).toBeGreaterThan(now.getTime());
        expect(t - now.getTime()).toBeLessThanOrEqual(24 * HOUR);
      }
      // Reaches to within one step of the bound.
      expect(now.getTime() + 24 * HOUR - times[times.length - 1]).toBeLessThan(30 * MIN);
      expect(times).toContain(defaultCodeExpiry(now).getTime());
    }
  });

  it('steps on the half hour from a few minutes ahead, and keeps the default even when it is off the grid', () => {
    const options = codeExpiryOptions(at(16, 45, 20));
    expect(options[0]).toEqual(at(17, 0));
    expect(options[1]).toEqual(at(17, 30));
    expect(options).toContainEqual(at(17, 45, 20)); // one hour from now
    expect(options[options.length - 1]).toEqual(at(16, 30, 0, 3));

    // 9:28: 9:30 is too close to offer; 10:00 comes first. 4:30 pm is the default.
    const morning = codeExpiryOptions(at(9, 28));
    expect(morning[0]).toEqual(at(10, 0));
    expect(morning.filter((d) => d.getTime() === at(16, 30).getTime())).toHaveLength(1);
  });

  it('labels a time as today or tomorrow, or by its date beyond that', () => {
    expect(expiryLabel(at(16, 30), at(9))).toMatch(/^4:30\sPM today$/);
    expect(expiryLabel(at(9, 0, 0, 3), at(16, 45))).toMatch(/^9:00\sAM tomorrow$/);
    expect(expiryLabel(at(9, 0, 0, 4), at(16, 45))).toMatch(/^9:00\sAM, Oct 4$/);
  });
});

describe('a profile row', () => {
  it('reads each rank the way the Profile page does, smallest board first', () => {
    expect(
      boardRanks({
        '19x19': { rung: '15k', games: 12 },
        '9x9': { rung: '21k', games: 3 }, // a rung the 9×9 ladder dropped
      }),
    ).toEqual([
      { board: '9×9', rank: '22k', games: 3 },
      { board: '19×19', rank: '15k', games: 12 },
    ]);
  });

  it('a malformed board shows the starting rung and no games, and never fails the list', () => {
    expect(boardRanks({ '19x19': { rung: null, games: 0 } })).toEqual([{ board: '19×19', rank: '30k', games: 0 }]);
    expect(boardRanks({ '13x13': { rung: null, games: 0 } })).toEqual([{ board: '13×13', rank: '—', games: 0 }]);
    expect(boardRanks({})).toEqual([]);
    expect(boardRanks(null)).toEqual([]);
    const odd = { '9x9': { rung: '15k' }, '19x19': null, other: { rung: '15k', games: 2 } } as unknown as Record<
      string,
      { rung: string | null; games: number }
    >;
    expect(boardRanks(odd)).toEqual(
      expect.arrayContaining([
        { board: '9×9', rank: '15k', games: 0 },
        { board: '19×19', rank: '30k', games: 0 },
        { board: 'other', rank: '15k', games: 2 },
      ]),
    );
  });

  it('says how many days are left', () => {
    expect(daysLeftText(12)).toBe('12 days left');
    expect(daysLeftText(1)).toBe('1 day left');
    expect(daysLeftText(0)).toBe('0 days left');
  });
});

function player(id: string, deviceIds: string[]): AdminPlayer {
  return {
    player_id: id,
    handle: [0, 0],
    boards: {},
    devices: deviceIds.map((d) => ({ device_id: d, created_at: '2026-10-01T09:00:00Z', last_seen_at: null })),
    replays: 0,
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:00:00Z',
    no_device_since: deviceIds.length ? null : '2026-10-01T09:00:00Z',
    days_left: deviceIds.length ? null : 30,
  };
}

describe('what a row offers', () => {
  const self = { playerId: 'p-self', deviceId: 'd-self' };

  it('no Remove beside this device; Remove beside every other device', () => {
    const own = player('p-self', ['d-self', 'd-other']);
    expect(isThisDevice(own.devices[0], self)).toBe(true);
    expect(canRemoveDevice(own.devices[0], self)).toBe(false);
    expect(canRemoveDevice(own.devices[1], self)).toBe(true);
    expect(canRemoveDevice(player('p-2', ['d-2']).devices[0], self)).toBe(true);
    // Before the first pass has said which device this is, none is "this device".
    expect(isThisDevice(own.devices[0], { playerId: 'p-self', deviceId: null })).toBe(false);
  });

  it('no sign-out for this device own profile, found by its device id or by its player id', () => {
    expect(canSignOutPlayer(player('p-self', ['d-self']), self)).toBe(false);
    // Known by device id alone (player id not yet stored on this device).
    expect(isOwnProfile(player('p-x', ['d-self']), { playerId: null, deviceId: 'd-self' })).toBe(true);
    expect(canSignOutPlayer(player('p-x', ['d-self', 'd-9']), { playerId: null, deviceId: 'd-self' })).toBe(false);
    // Known by player id alone (the pass has not said its device id yet).
    expect(canSignOutPlayer(player('p-self', ['d-7']), { playerId: 'p-self', deviceId: null })).toBe(false);
    expect(canSignOutPlayer(player('p-2', ['d-2', 'd-3']), self)).toBe(true);
  });

  it('no sign-out for a profile with no device to sign out', () => {
    expect(canSignOutPlayer(player('p-3', []), self)).toBe(false);
  });
});

describe('New player', () => {
  it('starts from exactly the fresh state the plan spells out', () => {
    const state = freshPlayerState([4, 2]);
    expect(state).toStrictEqual({
      schema: 1,
      ladder: { byBoardSize: {} },
      lessons: [],
      avatar: 'blackhole',
      avatarPicked: false,
      handle: [4, 2],
    });
    expect(Object.keys(state).sort()).toEqual(['avatar', 'avatarPicked', 'handle', 'ladder', 'lessons', 'schema']);
    expect(Object.keys(state.ladder)).toEqual(['byBoardSize']);
  });
});
