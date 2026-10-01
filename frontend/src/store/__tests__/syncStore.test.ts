/**
 * Sync (feature 32): the client's sync pass, against an in-memory fake of
 * the server contract in feature_plans/32_sync_foundation.md behind a mocked
 * `fetch`. Every test re-imports the stores (vi.resetModules) so each one
 * starts from fresh module state and a fresh localStorage.
 *
 * Project-wide vitest env is 'node'; localStorage is shimmed like the other
 * store tests do.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncStateDoc } from '../../api/sync';
import type { PersistedSlot, PersistedState } from '../autoPlayStore';
import type { SavedGame } from '../libraryStore';
import { applyResult, type RungState } from '../../autoplay/matchmaker';
import { rankToRating, updateRating, type Rating } from '../../autoplay/glicko';

function installLocalStorage() {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

/* ------------------------------------------------------------------------- *
 * A fake of the server side of the contract.
 * ------------------------------------------------------------------------- */

interface CallBody {
  state?: SyncStateDoc;
  base_rev?: number;
  code?: string;
  date?: string;
  payload?: Record<string, unknown>;
}

interface Call {
  method: string;
  path: string;
  body: CallBody | undefined;
  auth: string | null;
}

interface StoredGame {
  id: string;
  date: string;
  payload: Record<string, unknown>;
}

const ALLOWED_KEYS = ['avatar', 'avatarPicked', 'ladder', 'lessons', 'schema'];

function json(status: number, body?: unknown): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body ?? {}), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

class FakeServer {
  rev = 1;
  state: SyncStateDoc;
  games = new Map<string, StoredGame>();
  tokens = new Set<string>(['tok-1']);
  codes = new Map<string, boolean>(); // code → used
  calls: Call[] = [];
  /** Return (or resolve to) a Response to take over a request; throw to
   *  simulate a network failure; return undefined for the default. */
  intercept?: (c: Call) => Response | Promise<Response> | undefined;
  /** When set, GET /state waits on it. */
  gate?: Promise<void>;
  inFlight = 0;
  maxInFlight = 0;

  constructor(state: SyncStateDoc) {
    this.state = clone(state);
  }

  fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api/, '');
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as CallBody) : undefined;
    const call: Call = { method, path, body, auth: headers.Authorization ?? null };
    this.calls.push(call);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.gate && method === 'GET' && path === '/sync/state') await this.gate;
      const over = await this.intercept?.(call);
      if (over) return over;
      return this.handle(call);
    } finally {
      this.inFlight--;
    }
  });

  count(method: string, path: string): number {
    return this.calls.filter((c) => c.method === method && c.path === path).length;
  }

  find(method: string, path: string): Call[] {
    return this.calls.filter((c) => c.method === method && c.path === path);
  }

  slot(board = '19x19'): PersistedSlot {
    return this.state.ladder.byBoardSize[board as '19x19']!;
  }

  private badKeys(state: SyncStateDoc | undefined): boolean {
    return !state || Object.keys(state).some((k) => !ALLOWED_KEYS.includes(k));
  }

  private handle(c: Call): Response {
    const token = c.auth?.replace(/^Bearer /, '') ?? null;
    if (c.method === 'POST' && c.path === '/sync/players') {
      if (this.badKeys(c.body?.state)) return json(422, { detail: 'bad keys' });
      this.rev = 1;
      this.state = clone(c.body!.state!);
      this.tokens.add('tok-new');
      return json(201, { player_id: 'p-1', device_token: 'tok-new', rev: 1, state: this.state });
    }
    if (c.method === 'POST' && c.path === '/sync/pairing-codes/redeem') {
      const code = String(c.body?.code ?? '').trim().toUpperCase();
      if (this.codes.get(code) !== false) return json(404, { detail: 'unknown code' });
      this.codes.set(code, true);
      this.tokens.add('tok-2');
      return json(200, { player_id: 'p-1', device_token: 'tok-2', rev: this.rev, state: clone(this.state) });
    }
    if (!token || !this.tokens.has(token)) return json(401, { detail: 'unauthorized' });
    if (c.method === 'POST' && c.path === '/sync/pairing-codes') {
      this.codes.set('K7QX2MPD', false);
      return json(201, { code: 'K7QX2MPD', expires_at: '2026-03-01T12:10:00Z' });
    }
    if (c.path === '/sync/state' && c.method === 'GET') {
      return json(200, { rev: this.rev, state: clone(this.state) });
    }
    if (c.path === '/sync/state' && c.method === 'PUT') {
      if (this.badKeys(c.body?.state)) return json(422, { detail: 'bad keys' });
      if (c.body?.base_rev !== this.rev) return json(409, { rev: this.rev, state: clone(this.state) });
      this.rev += 1;
      this.state = clone(c.body!.state!);
      return json(200, { rev: this.rev });
    }
    if (c.path === '/sync/games' && c.method === 'GET') {
      return json(200, { games: this.newestFirst().map(({ id, date }) => ({ id, date })) });
    }
    const m = /^\/sync\/games\/(.+)$/.exec(c.path);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (c.method === 'GET') {
        const g = this.games.get(id);
        return g ? json(200, clone(g)) : json(404, { detail: 'no such game' });
      }
      if (c.method === 'PUT') {
        if (typeof c.body?.payload?.sgf !== 'string') return json(422, { detail: 'payload.sgf required' });
        const payload = { ...c.body.payload };
        delete payload.selectorLog;
        this.games.set(id, { id, date: c.body.date!, payload });
        const keep = this.newestFirst().slice(0, 100);
        this.games = new Map(keep.map((g) => [g.id, g]));
        return json(200, { kept: this.games.has(id) });
      }
      if (c.method === 'DELETE') {
        this.games.delete(id);
        return json(204);
      }
    }
    if (c.method === 'DELETE' && c.path === '/sync/devices/current') {
      this.tokens.delete(token);
      return json(204);
    }
    return json(404, { detail: 'no route' });
  }

  private newestFirst(): StoredGame[] {
    return [...this.games.values()].sort((a, b) =>
      a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.id < b.id ? 1 : a.id > b.id ? -1 : 0,
    );
  }
}

/* ------------------------------------------------------------------------- *
 * Fixtures.
 * ------------------------------------------------------------------------- */

/** Free text that must never reach the server. */
const NAME = 'NAME-SENTINEL-7Q';

async function load() {
  vi.resetModules();
  const sync = await import('../syncStore');
  const auto = await import('../autoPlayStore');
  const learn = await import('../learnStore');
  const profile = await import('../profileStore');
  const library = await import('../libraryStore');
  return { sync, auto, learn, profile, library };
}
type Mods = Awaited<ReturnType<typeof load>>;

function linkLocally(
  m: Mods,
  baseRev: number,
  extra: Partial<{ syncedGameIds: string[]; pendingGameDeletes: string[] }> = {},
) {
  m.sync.useSyncStore.setState({
    playerId: 'p-1',
    deviceToken: 'tok-1',
    baseRev,
    dirty: false,
    pendingResults: [],
    syncedGameIds: [],
    pendingGameDeletes: [],
    lastSyncAt: null,
    ...extra,
  });
}

function minute(n: number): string {
  return new Date(Date.UTC(2026, 2, 1) + n * 60_000).toISOString();
}

function game(id: string, date: string, extra: Partial<SavedGame> = {}): SavedGame {
  return {
    id,
    sgf: `(;GM[1]SZ[9];B[ee]C[${id}])`,
    date,
    playerColor: 'black',
    opponentRank: '30k',
    result: 'Black wins by 5.5',
    moveCount: 1,
    isRanked: true,
    gameId: id,
    ...extra,
  };
}

function storedGame(id: string, date: string): StoredGame {
  return { id, date, payload: game(id, date) as unknown as Record<string, unknown> };
}

function slotAt(rungState: RungState, extra: Partial<PersistedSlot> = {}): PersistedSlot {
  return {
    rungState,
    history: [],
    promotionEvents: [],
    shadowRating: { mu: 1700, phi: 120, sigma: 0.06 },
    ...extra,
  };
}

function ladderOf(slot: PersistedSlot, undoBank: number): PersistedState {
  return { byBoardSize: { '19x19': slot }, undoBank };
}

/** The server answers, but with a 503. */
const down = () => json(503, { detail: 'down' });

let clock = 0;
beforeEach(() => {
  installLocalStorage();
  // Distinct, increasing timestamps: a ranked result's ts is its identity.
  clock = Date.UTC(2026, 2, 1, 12);
  vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1000));
  // A failed pass is silent to the player; keep its console note out of the output.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------------- *
 * Tests.
 * ------------------------------------------------------------------------- */

describe('sync — a device that is not linked', () => {
  it('makes no request, writes no sync key, and plays exactly as before', async () => {
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    vi.stubGlobal('fetch', server.fetch);

    await m.sync.startSync();
    m.auto.useAutoPlayStore.getState().recordResult('win');
    m.learn.useLearnStore.getState().markComplete('drop-first-stone');
    m.profile.useProfileStore.getState().setAvatar('nova');
    m.library.useLibraryStore.getState().saveGame(game('g1', minute(1)));
    m.library.useLibraryStore.getState().deleteGame('g1');
    await m.sync.requestSync();
    await m.sync.useSyncStore.getState().sync();
    await m.sync.syncBeforePlay();
    await m.sync.syncIdle();

    expect(server.fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem('goforkids.sync.v1')).toBeNull();
    expect(m.sync.useSyncStore.getState().pendingResults).toEqual([]);
    expect(m.auto.useAutoPlayStore.getState().history).toHaveLength(1);
  });
});

describe('sync — the state push', () => {
  it('pushes a ranked result when level, with only the five allowed keys and no display name', async () => {
    const m = await load();
    m.profile.useProfileStore.getState().setDisplayName(NAME);
    const server = new FakeServer(m.sync.buildLocalDoc());
    server.rev = 3;
    vi.stubGlobal('fetch', server.fetch);
    linkLocally(m, 3);

    m.auto.useAutoPlayStore.getState().recordResult('win', 1);
    await m.sync.syncIdle();

    const puts = server.find('PUT', '/sync/state');
    expect(puts).toHaveLength(1);
    expect(puts[0].auth).toBe('Bearer tok-1');
    expect(puts[0].body!.base_rev).toBe(3);
    expect(Object.keys(puts[0].body!.state!).sort()).toEqual(ALLOWED_KEYS);
    expect(server.rev).toBe(4);
    expect(server.slot().history).toHaveLength(1);
    expect(server.slot().history[0].undosUsed).toBe(1);

    const s = m.sync.useSyncStore.getState();
    expect(s.baseRev).toBe(4);
    expect(s.dirty).toBe(false);
    expect(s.pendingResults).toEqual([]);
    expect(s.lastSyncAt).not.toBeNull();

    const sent = JSON.stringify(server.calls.map((c) => c.body));
    expect(sent).not.toContain(NAME);
    expect(sent).not.toContain('themeId'); // settings stay per device
  });

  it('turning sync on sends the state and every local replay, without the display name', async () => {
    const m = await load();
    m.profile.useProfileStore.getState().setDisplayName(NAME);
    m.library.useLibraryStore.getState().replaceGames([game('a', minute(2)), game('b', minute(1))]);
    const server = new FakeServer(m.sync.buildLocalDoc());
    server.tokens.clear();
    vi.stubGlobal('fetch', server.fetch);

    const code = await m.sync.useSyncStore.getState().addDevice();
    await m.sync.syncIdle();

    const create = server.find('POST', '/sync/players');
    expect(create).toHaveLength(1);
    expect(Object.keys(create[0].body!.state!).sort()).toEqual(ALLOWED_KEYS);
    expect(code.code).toBe('K7QX2MPD');
    expect(m.sync.useSyncStore.getState().deviceToken).toBe('tok-new');
    expect([...server.games.keys()].sort()).toEqual(['a', 'b']);
    expect(JSON.stringify(server.calls.map((c) => c.body))).not.toContain(NAME);
  });
});

describe('sync — rebase when the server is ahead', () => {
  it('re-applies two queued results in order on the server ladder, then pushes on its revision', async () => {
    const m = await load();
    const serverSlot = slotAt({ currentRung: '12k', winsAtCurrentRung: 3, lossStreak: 0 });
    const server = new FakeServer({ ...m.sync.buildLocalDoc(), ladder: ladderOf(serverSlot, 1) });
    server.rev = 5;
    vi.stubGlobal('fetch', server.fetch);
    linkLocally(m, 2);

    // Two ranked games finish while the server is unreachable.
    server.intercept = down;
    m.auto.useAutoPlayStore.getState().recordResult('win');
    m.auto.useAutoPlayStore.getState().recordResult('loss');
    await m.sync.syncIdle();
    const queued = [...m.sync.useSyncStore.getState().pendingResults];
    expect(queued.map((r) => r.result)).toEqual(['win', 'loss']);
    expect(server.count('PUT', '/sync/state')).toBe(0);

    server.intercept = undefined;
    await m.sync.useSyncStore.getState().sync();

    // What applying them in order to the server's ladder gives.
    let st: RungState = { ...serverSlot.rungState };
    let rating: Rating = { ...serverSlot.shadowRating! };
    for (const r of ['win', 'loss'] as const) {
      rating = updateRating(rating, rankToRating(st.currentRung), 100, r === 'win' ? 1 : 0);
      st = applyResult(st, r, 19).state;
    }
    expect(st).toEqual({ currentRung: '11k', winsAtCurrentRung: 0, lossStreak: 1 }); // the win promoted

    const puts = server.find('PUT', '/sync/state');
    expect(puts).toHaveLength(1);
    expect(puts[0].body!.base_rev).toBe(5);
    const pushed = puts[0].body!.state!.ladder;
    const slot = pushed.byBoardSize['19x19']!;
    expect(slot.rungState).toEqual(st);
    expect(slot.shadowRating!.mu).toBeCloseTo(rating.mu, 9);
    expect(slot.shadowRating!.phi).toBeCloseTo(rating.phi, 9);
    expect(slot.shadowRating!.sigma).toBeCloseTo(rating.sigma, 9);
    expect(slot.history.map((h) => [h.ts, h.result])).toEqual(queued.map((r) => [r.ts, r.result]));
    expect(slot.promotionEvents).toEqual([{ from: '12k', to: '11k', ts: queued[0].ts }]);
    expect(pushed.undoBank).toBe(3);

    expect(m.auto.useAutoPlayStore.getState().rungState).toEqual(st);
    const s = m.sync.useSyncStore.getState();
    expect(s.baseRev).toBe(6);
    expect(s.pendingResults).toEqual([]);
    expect(s.dirty).toBe(false);
  });

  it('does not apply a queued result twice when its earlier push landed but the reply was lost', async () => {
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    server.rev = 3;
    vi.stubGlobal('fetch', server.fetch);
    linkLocally(m, 3);

    server.intercept = down;
    m.auto.useAutoPlayStore.getState().recordResult('win');
    await m.sync.syncIdle();
    expect(m.sync.useSyncStore.getState().pendingResults).toHaveLength(1);

    // The push had in fact reached the server.
    server.intercept = undefined;
    server.state = m.sync.buildLocalDoc();
    server.rev = 4;
    await m.sync.useSyncStore.getState().sync();

    expect(server.slot().history).toHaveLength(1);
    expect(server.count('PUT', '/sync/state')).toBe(0);
    expect(m.auto.useAutoPlayStore.getState().history).toHaveLength(1);
    const s = m.sync.useSyncStore.getState();
    expect(s.pendingResults).toEqual([]);
    expect(s.baseRev).toBe(4);
    expect(s.dirty).toBe(false);
  });

  it('keeps an avatar changed here when the server has moved on', async () => {
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    server.rev = 2;
    vi.stubGlobal('fetch', server.fetch);
    linkLocally(m, 1);

    m.profile.useProfileStore.getState().setAvatar('prism');
    await m.sync.syncIdle();

    expect(m.profile.useProfileStore.getState().avatar).toBe('prism');
    expect(server.state.avatar).toBe('prism');
  });
});

describe('sync — 409', () => {
  it('rebases onto the state in the 409 and retries with its revision', async () => {
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    server.rev = 3;
    vi.stubGlobal('fetch', server.fetch);
    linkLocally(m, 3);

    const otherSlot = slotAt({ currentRung: '25k', winsAtCurrentRung: 1, lossStreak: 0 }, {
      history: [{ rung: '26k', bot: '18k', handicap: 8, result: 'win', ts: 42, undosUsed: 0 }],
    });
    let first = true;
    server.intercept = (c) => {
      if (first && c.method === 'PUT' && c.path === '/sync/state') {
        first = false;
        // Another device writes between this device's read and its push.
        server.rev = 4;
        server.state = { ...server.state, ladder: ladderOf(otherSlot, 2), lessons: ['other-lesson'] };
        return json(409, { rev: server.rev, state: server.state });
      }
      return undefined;
    };

    m.auto.useAutoPlayStore.getState().recordResult('win');
    await m.sync.syncIdle();

    expect(server.find('PUT', '/sync/state').map((c) => c.body!.base_rev)).toEqual([3, 4]);
    expect(server.slot().rungState).toEqual(applyResult(otherSlot.rungState, 'win', 19).state);
    expect(server.slot().history).toHaveLength(2);
    expect(server.state.lessons).toContain('other-lesson');
    expect(m.learn.useLearnStore.getState().completed.has('other-lesson')).toBe(true);
    const s = m.sync.useSyncStore.getState();
    expect(s.baseRev).toBe(5);
    expect(s.pendingResults).toEqual([]);
  });

  it('gives up after three retries, keeps the queue, and lands it on a later pass', async () => {
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    server.rev = 3;
    vi.stubGlobal('fetch', server.fetch);
    linkLocally(m, 3);

    server.intercept = (c) => {
      if (c.method === 'PUT' && c.path === '/sync/state') {
        server.rev += 1; // someone else always wins the race
        return json(409, { rev: server.rev, state: server.state });
      }
      return undefined;
    };
    m.auto.useAutoPlayStore.getState().recordResult('win');
    await m.sync.syncIdle();

    expect(server.count('PUT', '/sync/state')).toBe(1 + m.sync.MAX_CONFLICT_RETRIES);
    expect(m.sync.MAX_CONFLICT_RETRIES).toBe(3);
    expect(m.sync.useSyncStore.getState().pendingResults).toHaveLength(1);
    expect(m.sync.useSyncStore.getState().dirty).toBe(true);

    server.intercept = undefined;
    await m.sync.useSyncStore.getState().sync();
    expect(m.sync.useSyncStore.getState().pendingResults).toEqual([]);
    expect(server.slot().history).toHaveLength(1);
  });
});

describe('sync — failure is silent', () => {
  it('an offline pass leaves the queue intact (and persisted), and it lands once back online', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    server.rev = 3;
    vi.stubGlobal('fetch', server.fetch);
    linkLocally(m, 3);
    server.intercept = () => {
      throw new TypeError('Load failed');
    };
    m.auto.useAutoPlayStore.getState().recordResult('win');
    m.auto.useAutoPlayStore.getState().recordResult('loss');
    const idle = m.sync.syncIdle();
    await vi.runAllTimersAsync();
    await idle;

    expect(server.calls.length).toBeGreaterThan(0);
    expect(m.auto.useAutoPlayStore.getState().history).toHaveLength(2); // play went on
    expect(m.sync.useSyncStore.getState().pendingResults).toHaveLength(2);
    const stored = JSON.parse(localStorage.getItem('goforkids.sync.v1')!) as { pendingResults: unknown[] };
    expect(stored.pendingResults).toHaveLength(2);

    vi.useRealTimers();
    server.intercept = undefined;
    await m.sync.useSyncStore.getState().sync();
    expect(m.sync.useSyncStore.getState().pendingResults).toEqual([]);
    expect(server.slot().history.map((h) => h.result)).toEqual(['win', 'loss']);
  });

  it('Play waits at most 2 seconds for a pass that hangs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    vi.stubGlobal('fetch', server.fetch);
    linkLocally(m, 1);
    server.intercept = () => new Promise<Response>(() => {});

    let started = false;
    const play = m.sync.syncBeforePlay().then(() => {
      started = true;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(started).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await play;
    expect(started).toBe(true);
    expect(m.sync.PLAY_SYNC_TIMEOUT_MS).toBe(2000);
  });

  it('concurrent triggers never run two passes at once', async () => {
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    vi.stubGlobal('fetch', server.fetch);
    linkLocally(m, 1);
    let release!: () => void;
    server.gate = new Promise<void>((r) => {
      release = r;
    });

    const a = m.sync.useSyncStore.getState().sync();
    const b = m.sync.requestSync();
    const c = m.sync.syncBeforePlay();
    m.auto.useAutoPlayStore.getState().recordResult('win');
    await Promise.resolve();
    expect(server.count('GET', '/sync/state')).toBe(1);

    release();
    await Promise.all([a, b, c]);
    await m.sync.syncIdle();
    expect(server.maxInFlight).toBe(1);
    expect(server.count('GET', '/sync/state')).toBe(2); // the running pass + one behind it
    expect(m.sync.useSyncStore.getState().pendingResults).toEqual([]);
    expect(server.slot().history).toHaveLength(1);
  });
});

describe('sync — replays', () => {
  it('sends unsent games (without selectorLog), fetches missing ones, drops ones the server no longer lists', async () => {
    const m = await load();
    const lib = m.library.useLibraryStore;
    lib.getState().replaceGames([
      game('A', minute(4), { selectorLog: ['[selector] diagnostic'] }),
      game('B', minute(3)),
      game('D', minute(2)),
    ]);
    const server = new FakeServer(m.sync.buildLocalDoc());
    server.games.set('C', storedGame('C', minute(5)));
    server.games.set('D', storedGame('D', minute(2)));
    vi.stubGlobal('fetch', server.fetch);
    // B and D were sent before; B has since been deleted on another device.
    linkLocally(m, 1, { syncedGameIds: ['B', 'D'] });

    await m.sync.useSyncStore.getState().sync();

    const putA = server.find('PUT', '/sync/games/A');
    expect(putA).toHaveLength(1);
    expect(putA[0].body!.date).toBe(minute(4));
    expect(putA[0].body!.payload!.sgf).toBe(game('A', minute(4)).sgf);
    expect('selectorLog' in putA[0].body!.payload!).toBe(false);
    expect(server.count('GET', '/sync/games/C')).toBe(1);
    expect(server.count('DELETE', '/sync/games/B')).toBe(0);
    expect(server.count('PUT', '/sync/games/D')).toBe(0);

    expect(lib.getState().games.map((g) => g.id)).toEqual(['C', 'A', 'D']);
    expect(lib.getState().games.find((g) => g.id === 'A')!.selectorLog).toEqual(['[selector] diagnostic']);
    expect([...m.sync.useSyncStore.getState().syncedGameIds].sort()).toEqual(['A', 'C', 'D']);

    // A delete here reaches the server, and the game doesn't come back.
    lib.getState().deleteGame('D');
    await m.sync.syncIdle();
    expect(server.count('DELETE', '/sync/games/D')).toBe(1);
    expect(server.games.has('D')).toBe(false);
    expect(lib.getState().games.map((g) => g.id)).toEqual(['C', 'A']);
    expect(m.sync.useSyncStore.getState().pendingGameDeletes).toEqual([]);
  });

  it('keeps the newest 100 of the union and moves only those', async () => {
    const m = await load();
    const lib = m.library.useLibraryStore;
    const local = Array.from({ length: 60 }, (_, i) => game(`L${String(i).padStart(2, '0')}`, minute(2 * i)));
    lib.getState().replaceGames([...local].reverse());
    const server = new FakeServer(m.sync.buildLocalDoc());
    for (let i = 0; i < 60; i++) {
      const id = `R${String(i).padStart(2, '0')}`;
      server.games.set(id, storedGame(id, minute(2 * i + 1)));
    }
    vi.stubGlobal('fetch', server.fetch);
    linkLocally(m, 1);

    await m.sync.useSyncStore.getState().sync();

    // Union of 120: the oldest 20 are minutes 0–19 (L00–L09, R00–R09).
    const games = lib.getState().games;
    expect(games).toHaveLength(100);
    const expected = Array.from({ length: 100 }, (_, k) => {
      const n = 119 - k;
      const id = `${n % 2 === 0 ? 'L' : 'R'}${String(Math.floor(n / 2)).padStart(2, '0')}`;
      return id;
    });
    expect(games.map((g) => g.id)).toEqual(expected);
    for (let i = 0; i < 10; i++) {
      const s = String(i).padStart(2, '0');
      expect(server.count('GET', `/sync/games/R${s}`)).toBe(0);
      expect(server.count('PUT', `/sync/games/L${s}`)).toBe(0);
    }
    expect(server.find('PUT', '/sync/games/L10')).toHaveLength(1);
    expect(server.games.size).toBe(100);
  });
});

describe('sync — link and unlink', () => {
  it('link adopts the record ladder and avatar, unions lessons, pushes, and merges replays', async () => {
    const m = await load();
    // This device's own progress, made while not linked.
    for (let i = 0; i < 3; i++) m.auto.useAutoPlayStore.getState().recordResult('win');
    expect(m.auto.useAutoPlayStore.getState().rungState.currentRung).toBe('27k');
    m.learn.useLearnStore.getState().addCompleted(['lesson-a', 'lesson-b']);
    m.profile.useProfileStore.getState().setAvatar('nova');
    m.profile.useProfileStore.getState().setDisplayName(NAME);
    m.library.useLibraryStore.getState().replaceGames([game('L1', minute(1))]);

    const recordSlot = slotAt({ currentRung: '15k', winsAtCurrentRung: 2, lossStreak: 0 }, {
      history: [{ rung: '15k', bot: '15k', handicap: 0, result: 'win', ts: 7, undosUsed: 0 }],
    });
    const server = new FakeServer({
      schema: 1,
      ladder: ladderOf(recordSlot, 2),
      lessons: ['lesson-b', 'lesson-c'],
      avatar: 'comet',
      avatarPicked: true,
    });
    server.rev = 7;
    server.codes.set('ABCD2345', false);
    server.games.set('R1', storedGame('R1', minute(2)));
    vi.stubGlobal('fetch', server.fetch);
    expect(server.calls).toHaveLength(0);
    // Hold the pass that follows the link, to see what the link itself did.
    let release!: () => void;
    server.gate = new Promise<void>((r) => {
      release = r;
    });

    await m.sync.useSyncStore.getState().link('abcd 2345');

    expect(server.find('POST', '/sync/pairing-codes/redeem')[0].body).toEqual({ code: 'ABCD2345' });
    const auto = m.auto.useAutoPlayStore.getState();
    expect(auto.rungState).toEqual(recordSlot.rungState);
    expect(auto.history).toHaveLength(1);
    expect([...m.learn.useLearnStore.getState().completed].sort()).toEqual(['lesson-a', 'lesson-b', 'lesson-c']);
    expect(m.profile.useProfileStore.getState().avatar).toBe('comet');
    expect(m.profile.useProfileStore.getState().displayName).toBe(NAME);
    expect(m.sync.useSyncStore.getState().dirty).toBe(true); // the union added a lesson

    release();
    await m.sync.syncIdle();

    const puts = server.find('PUT', '/sync/state');
    expect(puts).toHaveLength(1);
    expect(puts[0].auth).toBe('Bearer tok-2');
    expect(puts[0].body!.base_rev).toBe(7);
    expect([...puts[0].body!.state!.lessons].sort()).toEqual(['lesson-a', 'lesson-b', 'lesson-c']);
    expect(puts[0].body!.state!.ladder.byBoardSize['19x19']!.rungState).toEqual(recordSlot.rungState);

    expect(server.count('PUT', '/sync/games/L1')).toBe(1);
    expect(server.count('GET', '/sync/games/R1')).toBe(1);
    expect(m.library.useLibraryStore.getState().games.map((g) => g.id)).toEqual(['R1', 'L1']);

    const s = m.sync.useSyncStore.getState();
    expect(s.deviceToken).toBe('tok-2');
    expect(s.baseRev).toBe(8);
    expect(JSON.stringify(server.calls.map((c) => c.body))).not.toContain(NAME);
  });

  it('a wrong code changes nothing here', async () => {
    const m = await load();
    m.auto.useAutoPlayStore.getState().recordResult('win');
    const server = new FakeServer(m.sync.buildLocalDoc());
    vi.stubGlobal('fetch', server.fetch);

    await expect(m.sync.useSyncStore.getState().link('ZZZZ 9999')).rejects.toMatchObject({ status: 404 });
    expect(m.sync.useSyncStore.getState().deviceToken).toBeNull();
    expect(m.auto.useAutoPlayStore.getState().history).toHaveLength(1);
    expect(localStorage.getItem('goforkids.sync.v1')).toBeNull();
  });

  it('unlink revokes the token, keeps local data, and stops all requests', async () => {
    const m = await load();
    m.auto.useAutoPlayStore.getState().recordResult('win');
    m.learn.useLearnStore.getState().addCompleted(['lesson-a']);
    m.library.useLibraryStore.getState().replaceGames([game('L1', minute(1))]);
    const server = new FakeServer(m.sync.buildLocalDoc());
    vi.stubGlobal('fetch', server.fetch);
    linkLocally(m, 1, { syncedGameIds: ['L1'] });

    await m.sync.useSyncStore.getState().unlink();

    const del = server.find('DELETE', '/sync/devices/current');
    expect(del).toHaveLength(1);
    expect(del[0].auth).toBe('Bearer tok-1');
    expect(server.tokens.has('tok-1')).toBe(false);
    expect(m.sync.useSyncStore.getState().deviceToken).toBeNull();
    const stored = JSON.parse(localStorage.getItem('goforkids.sync.v1')!) as { deviceToken: unknown };
    expect(stored.deviceToken).toBeNull();

    expect(m.auto.useAutoPlayStore.getState().history).toHaveLength(1);
    expect(m.learn.useLearnStore.getState().completed.has('lesson-a')).toBe(true);
    expect(m.library.useLibraryStore.getState().games.map((g) => g.id)).toEqual(['L1']);

    const before = server.calls.length;
    m.auto.useAutoPlayStore.getState().recordResult('loss');
    m.library.useLibraryStore.getState().deleteGame('L1');
    await m.sync.useSyncStore.getState().sync();
    await m.sync.syncBeforePlay();
    expect(server.calls.length).toBe(before);
  });
});

describe('sync — pairing codes', () => {
  it('normalises what was typed and shows the code in two groups of four', async () => {
    const { normalizePairingCode, formatPairingCode } = await import('../../api/sync');
    expect(normalizePairingCode(' abcd 2345 ')).toBe('ABCD2345');
    expect(normalizePairingCode('ab cd\t23 45')).toBe('ABCD2345');
    expect(formatPairingCode('abcd2345')).toBe('ABCD 2345');
  });
});
