/**
 * Sync (feature 32, revision 2): first launch, the sync pass, log in and log
 * out, against an in-memory fake of the server contract in
 * feature_plans/32_sync_foundation.md behind a mocked `fetch`. Every test
 * re-imports the stores (vi.resetModules) so each one starts from fresh
 * module state; `load()` again within a test is an app relaunch on the same
 * storage.
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
  player_name?: string | null;
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

const ALLOWED_KEYS = ['avatar', 'avatarPicked', 'handle', 'ladder', 'lessons', 'schema'];

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

function validHandle(v: unknown): boolean {
  return Array.isArray(v) && v.length === 2 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 63);
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

  indexOf(method: string, path: string): number {
    return this.calls.findIndex((c) => c.method === method && c.path === path);
  }

  slot(board = '19x19'): PersistedSlot {
    return this.state.ladder.byBoardSize[board as '19x19']!;
  }

  allBodies(): string {
    return JSON.stringify(this.calls.map((c) => c.body ?? null));
  }

  private badState(state: SyncStateDoc | undefined): boolean {
    if (!state || Object.keys(state).some((k) => !ALLOWED_KEYS.includes(k))) return true;
    return 'handle' in state && !validHandle(state.handle);
  }

  private handle(c: Call): Response {
    const token = c.auth?.replace(/^Bearer /, '') ?? null;
    if (c.method === 'POST' && c.path === '/uploads') return json(200, { id: 'SHARE123' });
    if (c.method === 'POST' && c.path === '/sync/players') {
      if (this.badState(c.body?.state)) return json(422, { detail: 'bad state' });
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
      if (this.badState(c.body?.state)) return json(422, { detail: 'bad state' });
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

/** An old free-text name: must never reach the server, or survive a load. */
const NAME = 'NAME-SENTINEL-7Q';

async function load() {
  vi.resetModules();
  const sync = await import('../syncStore');
  const auto = await import('../autoPlayStore');
  const learn = await import('../learnStore');
  const profile = await import('../profileStore');
  const library = await import('../libraryStore');
  const play = await import('../../autoplay/rankedPlay');
  const client = await import('../../api/client');
  return { sync, auto, learn, profile, library, play, client };
}
type Mods = Awaited<ReturnType<typeof load>>;

/** What App does at launch: load the stores, then decide the case. */
function boot(m: Mods) {
  m.library.useLibraryStore.getState().loadFromStorage();
  m.auto.useAutoPlayStore.getState().loadFromStorage();
  m.profile.useProfileStore.getState().loadFromStorage();
  return m.sync.startSync();
}

function loggedIn(
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
    pendingCreate: null,
    showIntro: false,
    refusedGameIds: [],
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

/** Seed storage the way an older build left it: a ranked game, a finished
 *  lesson, a replay, a picked avatar and a free-text name. */
function seedExistingPlayer() {
  localStorage.setItem(
    'goforkids.profile.v1',
    JSON.stringify({ avatar: 'tide', displayName: NAME, avatarPicked: true }),
  );
  localStorage.setItem('goforkids-learn-progress', JSON.stringify(['drop-first-stone']));
  localStorage.setItem('goforkids_library', JSON.stringify([game('old-1', minute(1))]));
  localStorage.setItem(
    'goforkids.autoplay.v1',
    JSON.stringify(
      ladderOf(
        slotAt({ currentRung: '30k', winsAtCurrentRung: 1, lossStreak: 0 }, {
          history: [{ rung: '30k', bot: '30k', handicap: 0, result: 'win', ts: 11, undosUsed: 0 }],
        }),
        3,
      ),
    ),
  );
}

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
 * First launch.
 * ------------------------------------------------------------------------- */

describe('first launch', () => {
  it('logged in: runs a pass and creates nothing', async () => {
    localStorage.setItem('goforkids.sync.v1', JSON.stringify({ playerId: 'p-1', deviceToken: 'tok-1', baseRev: 1 }));
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    vi.stubGlobal('fetch', server.fetch);

    expect(boot(m)).toBe('logged-in');
    await m.sync.syncIdle();

    expect(server.count('GET', '/sync/state')).toBe(1);
    expect(server.count('POST', '/sync/players')).toBe(0);
    expect(m.sync.useSyncStore.getState().firstRun).toBe(false);
    // A profile from before names existed gets a name, and it is pushed.
    expect(m.profile.useProfileStore.getState().handle).not.toBeNull();
    expect(server.state.handle).toEqual(m.profile.useProfileStore.getState().handle);
  });

  it('an existing player without a profile: created silently from what the device holds, replays sent, name card due', async () => {
    seedExistingPlayer();
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    server.tokens.clear();
    vi.stubGlobal('fetch', server.fetch);

    expect(boot(m)).toBe('existing');
    expect(m.sync.useSyncStore.getState().firstRun).toBe(false); // not asked first
    await m.sync.syncIdle();

    const create = server.find('POST', '/sync/players');
    expect(create).toHaveLength(1);
    const sent = create[0].body!.state!;
    expect(Object.keys(sent).sort()).toEqual(ALLOWED_KEYS);
    expect(sent.handle).toEqual(m.profile.useProfileStore.getState().handle);
    expect(sent.ladder.byBoardSize['19x19']!.history).toHaveLength(1);
    expect(sent.lessons).toEqual(['drop-first-stone']);
    expect(sent.avatar).toBe('tide');
    expect(server.count('PUT', '/sync/games/old-1')).toBe(1);

    const s = m.sync.useSyncStore.getState();
    expect(s.deviceToken).toBe('tok-new');
    expect(s.showIntro).toBe(true);
    s.dismissIntro();
    expect(m.sync.useSyncStore.getState().showIntro).toBe(false);

    // The old free-text name is gone from memory, storage and every request.
    expect(server.allBodies()).not.toContain(NAME);
    expect(localStorage.getItem('goforkids.profile.v1')).not.toContain(NAME);
    expect('displayName' in m.profile.useProfileStore.getState()).toBe(false);
  });

  it('a new install: the first-run choice, no request until a choice; New player creates the profile with the chosen name', async () => {
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    server.tokens.clear();
    vi.stubGlobal('fetch', server.fetch);

    expect(boot(m)).toBe('first-run');
    expect(m.sync.useSyncStore.getState().firstRun).toBe(true);
    await m.sync.requestSync();
    await m.sync.syncBeforePlay();
    await m.sync.syncIdle();
    expect(server.fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem('goforkids.sync.v1')).toBeNull();

    m.profile.useProfileStore.getState().setHandle([5, 7]);
    m.sync.useSyncStore.getState().startNewPlayer();
    expect(m.sync.useSyncStore.getState().firstRun).toBe(false); // straight on into the app
    await m.sync.syncIdle();

    const create = server.find('POST', '/sync/players');
    expect(create).toHaveLength(1);
    expect(create[0].body!.state!.handle).toEqual([5, 7]);
    expect(m.sync.useSyncStore.getState().deviceToken).toBe('tok-new');
    expect(m.sync.useSyncStore.getState().showIntro).toBe(false); // the card is for case 2 only
  });

  it('a failed create never blocks play and is retried at each trigger and at the next app open', async () => {
    seedExistingPlayer();
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    server.tokens.clear();
    vi.stubGlobal('fetch', server.fetch);
    server.intercept = down;

    expect(boot(m)).toBe('existing');
    await m.sync.syncIdle();
    expect(server.count('POST', '/sync/players')).toBe(1);
    expect(m.sync.useSyncStore.getState().deviceToken).toBeNull();
    expect(JSON.parse(localStorage.getItem('goforkids.sync.v1')!).pendingCreate).toBe('existing');

    // Play goes on; the ranked result is a trigger, so the create is retried.
    m.auto.useAutoPlayStore.getState().recordResult('win');
    await m.sync.syncIdle();
    expect(server.count('POST', '/sync/players')).toBe(2);
    expect(m.auto.useAutoPlayStore.getState().history).toHaveLength(2);

    // Next app open, back online: the create lands with everything played since.
    server.intercept = undefined;
    const m2 = await load();
    expect(boot(m2)).toBe('pending');
    await m2.sync.syncIdle();
    expect(server.count('POST', '/sync/players')).toBe(3);
    const sent = server.find('POST', '/sync/players')[2].body!.state!;
    expect(sent.ladder.byBoardSize['19x19']!.history.map((h) => h.result)).toEqual(['win', 'win']);
    expect(m2.sync.useSyncStore.getState().deviceToken).toBe('tok-new');
    expect(m2.sync.useSyncStore.getState().showIntro).toBe(true);
  });
});

/* ------------------------------------------------------------------------- *
 * Names.
 * ------------------------------------------------------------------------- */

describe('names', () => {
  it('Shuffle picks a different name, and a logged-in device pushes it', async () => {
    const m = await load();
    m.profile.useProfileStore.getState().setHandle([0, 0]);
    expect(m.profile.currentPlayerName()).toBe('Cosmic Otter');
    const server = new FakeServer(m.sync.buildLocalDoc());
    vi.stubGlobal('fetch', server.fetch);
    loggedIn(m, 1);

    m.profile.useProfileStore.getState().shuffleHandle();
    const h = m.profile.useProfileStore.getState().handle!;
    expect(h).not.toEqual([0, 0]);
    await m.sync.syncIdle();
    expect(server.state.handle).toEqual(h);
    expect(JSON.parse(localStorage.getItem('goforkids.profile.v1')!).handle).toEqual(h);
  });

  it('a shared replay sends the rendered name; no request body carries the old free-text name', async () => {
    seedExistingPlayer();
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    vi.stubGlobal('fetch', server.fetch);
    boot(m);
    await m.sync.syncIdle();

    const saved = m.library.useLibraryStore.getState().games[0];
    await m.client.api.uploadGame(saved, { playerName: m.profile.currentPlayerName() || undefined });

    const upload = server.find('POST', '/uploads');
    expect(upload).toHaveLength(1);
    expect(upload[0].body!.player_name).toBe(m.profile.currentPlayerName());
    expect(upload[0].body!.player_name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(server.allBodies()).not.toContain(NAME);
  });
});

/* ------------------------------------------------------------------------- *
 * Log in and log out.
 * ------------------------------------------------------------------------- */

describe('log in', () => {
  it('takes the account whole: rank, lessons, avatar, name and replays replace what was here, nothing merged', async () => {
    const m = await load();
    // Things on this device that must not survive or travel.
    m.auto.useAutoPlayStore.getState().recordResult('win');
    m.learn.useLearnStore.getState().addCompleted(['local-lesson']);
    m.library.useLibraryStore.getState().replaceGames([game('LOCAL', minute(3))]);
    m.profile.useProfileStore.getState().setAvatar('nova');
    m.profile.useProfileStore.getState().setHandle([1, 1]);

    const recordSlot = slotAt({ currentRung: '15k', winsAtCurrentRung: 2, lossStreak: 0 }, {
      history: [{ rung: '15k', bot: '15k', handicap: 0, result: 'win', ts: 7, undosUsed: 0 }],
    });
    const server = new FakeServer({
      schema: 1,
      ladder: ladderOf(recordSlot, 2),
      lessons: ['acct-lesson'],
      avatar: 'comet',
      avatarPicked: true,
      handle: [3, 4],
    });
    server.rev = 7;
    server.codes.set('ABCD2345', false);
    server.games.set('R1', storedGame('R1', minute(2)));
    vi.stubGlobal('fetch', server.fetch);

    await m.sync.useSyncStore.getState().logIn('abcd 2345');
    await m.sync.syncIdle();

    expect(server.find('POST', '/sync/pairing-codes/redeem')[0].body).toEqual({ code: 'ABCD2345' });
    const auto = m.auto.useAutoPlayStore.getState();
    expect(auto.rungState).toEqual(recordSlot.rungState);
    expect(auto.history.map((h) => h.ts)).toEqual([7]);
    expect([...m.learn.useLearnStore.getState().completed]).toEqual(['acct-lesson']);
    expect(m.profile.useProfileStore.getState().avatar).toBe('comet');
    expect(m.profile.useProfileStore.getState().handle).toEqual([3, 4]);
    expect(m.library.useLibraryStore.getState().games.map((g) => g.id)).toEqual(['R1']);

    expect(server.count('PUT', '/sync/state')).toBe(0); // nothing to merge, nothing to push
    expect(server.count('PUT', '/sync/games/LOCAL')).toBe(0);
    expect(server.state.lessons).toEqual(['acct-lesson']);
    const s = m.sync.useSyncStore.getState();
    expect(s.deviceToken).toBe('tok-2');
    expect(s.baseRev).toBe(7);
    expect(s.firstRun).toBe(false);
  });

  it('a wrong code changes nothing here', async () => {
    const m = await load();
    m.auto.useAutoPlayStore.getState().recordResult('win');
    const server = new FakeServer(m.sync.buildLocalDoc());
    vi.stubGlobal('fetch', server.fetch);

    await expect(m.sync.useSyncStore.getState().logIn('ZZZZ 9999')).rejects.toMatchObject({ status: 404 });
    expect(m.sync.useSyncStore.getState().deviceToken).toBeNull();
    expect(m.auto.useAutoPlayStore.getState().history).toHaveLength(1);
    expect(localStorage.getItem('goforkids.sync.v1')).toBeNull();
  });
});

describe('log out', () => {
  async function loggedInPlayer() {
    const m = await load();
    localStorage.setItem('goforkids_settings', JSON.stringify({ themeId: 'classic' }));
    m.profile.useProfileStore.getState().setHandle([2, 9]);
    m.profile.useProfileStore.getState().setAvatar('prism');
    m.learn.useLearnStore.getState().addCompleted(['lesson-a']);
    m.library.useLibraryStore.getState().replaceGames([game('g1', minute(1))]);
    const server = new FakeServer(m.sync.buildLocalDoc());
    server.rev = 3;
    vi.stubGlobal('fetch', server.fetch);
    loggedIn(m, 3);
    // A ranked game finished while the server was unreachable: queued.
    server.intercept = down;
    m.auto.useAutoPlayStore.getState().recordResult('win');
    await m.sync.syncIdle();
    expect(m.sync.useSyncStore.getState().pendingResults).toHaveLength(1);
    server.intercept = undefined;
    return { m, server };
  }

  it('saves everything first, then revokes, then clears the player (settings stay) and shows the first-run choice', async () => {
    const { m, server } = await loggedInPlayer();

    await m.sync.useSyncStore.getState().logOut();

    const revoke = server.indexOf('DELETE', '/sync/devices/current');
    expect(revoke).toBeGreaterThan(server.indexOf('PUT', '/sync/state'));
    expect(revoke).toBeGreaterThan(server.indexOf('PUT', '/sync/games/g1'));
    expect(server.calls[revoke].auth).toBe('Bearer tok-1');
    expect(server.slot().history).toHaveLength(1); // the queued result reached the server
    expect(server.tokens.has('tok-1')).toBe(false);

    const auto = m.auto.useAutoPlayStore.getState();
    expect(auto.history).toEqual([]);
    expect(auto.slots).toEqual({});
    expect(m.learn.useLearnStore.getState().completed.size).toBe(0);
    expect(m.library.useLibraryStore.getState().games).toEqual([]);
    const p = m.profile.useProfileStore.getState();
    expect(p.handle).toBeNull();
    expect(p.avatarPicked).toBe(false);
    const s = m.sync.useSyncStore.getState();
    expect(s.deviceToken).toBeNull();
    expect(s.pendingResults).toEqual([]);
    expect(s.firstRun).toBe(true);
    expect(s.firstRunNotice).toBeNull();
    expect(localStorage.getItem('goforkids_settings')).toBe(JSON.stringify({ themeId: 'classic' }));

    // And the device is quiet until a choice is made.
    const before = server.calls.length;
    await m.sync.requestSync();
    expect(server.calls.length).toBe(before);
  });

  it('refuses offline and changes nothing', async () => {
    const { m, server } = await loggedInPlayer();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    server.intercept = () => {
      throw new TypeError('Load failed');
    };

    const outcome = m.sync.useSyncStore.getState().logOut().then(() => 'done', () => 'refused');
    await vi.runAllTimersAsync();
    expect(await outcome).toBe('refused');

    expect(server.count('DELETE', '/sync/devices/current')).toBe(0);
    expect(m.sync.useSyncStore.getState().deviceToken).toBe('tok-1');
    expect(m.sync.useSyncStore.getState().pendingResults).toHaveLength(1);
    expect(m.sync.useSyncStore.getState().firstRun).toBe(false);
    expect(m.auto.useAutoPlayStore.getState().history).toHaveLength(1);
    expect(m.library.useLibraryStore.getState().games).toHaveLength(1);
    expect(m.profile.useProfileStore.getState().handle).toEqual([2, 9]);
  });

  it('refuses when the pass cannot save the state, even though a revoke would work', async () => {
    const { m, server } = await loggedInPlayer();
    server.intercept = (c) =>
      c.method === 'PUT' && c.path === '/sync/state' ? json(503, { detail: 'down' }) : undefined;

    await expect(m.sync.useSyncStore.getState().logOut()).rejects.toBeTruthy();

    expect(server.count('DELETE', '/sync/devices/current')).toBe(0);
    expect(server.tokens.has('tok-1')).toBe(true);
    expect(m.sync.useSyncStore.getState().deviceToken).toBe('tok-1');
    expect(m.sync.useSyncStore.getState().pendingResults).toHaveLength(1);
    expect(m.auto.useAutoPlayStore.getState().history).toHaveLength(1);
  });

  it('refuses when the replays cannot be reconciled, even with the state already level', async () => {
    const { m, server } = await loggedInPlayer();
    await m.sync.useSyncStore.getState().sync(); // state and replays level now
    expect(m.sync.useSyncStore.getState().dirty).toBe(false);
    server.intercept = (c) => (c.method === 'GET' && c.path === '/sync/games' ? json(503, { detail: 'down' }) : undefined);

    await expect(m.sync.useSyncStore.getState().logOut()).rejects.toBeTruthy();

    expect(server.count('DELETE', '/sync/devices/current')).toBe(0);
    expect(m.sync.useSyncStore.getState().deviceToken).toBe('tok-1');
    expect(m.library.useLibraryStore.getState().games).toHaveLength(1);
  });

  it('refuses when the revoke fails, and changes nothing', async () => {
    const { m, server } = await loggedInPlayer();
    server.intercept = (c) =>
      c.method === 'DELETE' && c.path === '/sync/devices/current' ? json(503, { detail: 'down' }) : undefined;

    await expect(m.sync.useSyncStore.getState().logOut()).rejects.toBeTruthy();

    expect(server.count('DELETE', '/sync/devices/current')).toBe(1);
    expect(m.sync.useSyncStore.getState().deviceToken).toBe('tok-1');
    expect(m.sync.useSyncStore.getState().firstRun).toBe(false);
    expect(m.learn.useLearnStore.getState().completed.has('lesson-a')).toBe(true);
    expect(m.library.useLibraryStore.getState().games).toHaveLength(1);
  });
});

describe('a token the server refuses (401)', () => {
  it('clears the player and sync state and shows the first-run choice with a reason', async () => {
    const m = await load();
    localStorage.setItem('goforkids_settings', JSON.stringify({ themeId: 'classic' }));
    m.profile.useProfileStore.getState().setHandle([2, 9]);
    m.learn.useLearnStore.getState().addCompleted(['lesson-a']);
    m.library.useLibraryStore.getState().replaceGames([game('g1', minute(1))]);
    m.auto.useAutoPlayStore.getState().recordResult('win');
    const server = new FakeServer(m.sync.buildLocalDoc());
    vi.stubGlobal('fetch', server.fetch);
    loggedIn(m, 1);
    server.tokens.delete('tok-1'); // logged out elsewhere

    await m.sync.useSyncStore.getState().sync();

    const s = m.sync.useSyncStore.getState();
    expect(s.firstRun).toBe(true);
    expect(s.firstRunNotice).toBe('logged-out');
    expect(s.deviceToken).toBeNull();
    expect(JSON.parse(localStorage.getItem('goforkids.sync.v1')!).deviceToken).toBeNull();
    expect(m.auto.useAutoPlayStore.getState().history).toEqual([]);
    expect(m.learn.useLearnStore.getState().completed.size).toBe(0);
    expect(m.library.useLibraryStore.getState().games).toEqual([]);
    expect(m.profile.useProfileStore.getState().handle).toBeNull();
    expect(localStorage.getItem('goforkids_settings')).toBe(JSON.stringify({ themeId: 'classic' }));
  });

  it('applies to Add a device too', async () => {
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    vi.stubGlobal('fetch', server.fetch);
    loggedIn(m, 1);
    server.tokens.delete('tok-1');

    await expect(m.sync.useSyncStore.getState().addDevice()).rejects.toMatchObject({ status: 401 });
    expect(m.sync.useSyncStore.getState().firstRun).toBe(true);
    expect(m.sync.useSyncStore.getState().firstRunNotice).toBe('logged-out');
  });
});

describe('add a device', () => {
  it('creates the profile first when it does not exist yet, then mints a code', async () => {
    seedExistingPlayer();
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    server.tokens.clear();
    vi.stubGlobal('fetch', server.fetch);
    server.intercept = down;
    boot(m);
    await m.sync.syncIdle();
    expect(m.sync.useSyncStore.getState().deviceToken).toBeNull();

    server.intercept = undefined;
    const code = await m.sync.useSyncStore.getState().addDevice();
    expect(code.code).toBe('K7QX2MPD');
    expect(server.indexOf('POST', '/sync/players')).toBeLessThan(server.indexOf('POST', '/sync/pairing-codes'));
    expect(server.find('POST', '/sync/pairing-codes')[0].auth).toBe('Bearer tok-new');
  });
});

/* ------------------------------------------------------------------------- *
 * Play.
 * ------------------------------------------------------------------------- */

describe('Play on a ranked game', () => {
  it('not logged in yet: starts at once and nudges the create', async () => {
    seedExistingPlayer();
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    server.tokens.clear();
    server.intercept = () => new Promise<Response>(() => {}); // never answers
    vi.stubGlobal('fetch', server.fetch);
    boot(m);

    const start = vi.fn();
    void m.play.playRanked({ start });
    expect(start).toHaveBeenCalledTimes(1); // synchronously, before any await
    expect(start.mock.calls[0][0].bot).toBe('30k');
  });

  it('logged in: pulls first, then starts on the rung the pull brought', async () => {
    const m = await load();
    const server = new FakeServer({
      ...m.sync.buildLocalDoc(),
      ladder: ladderOf(slotAt({ currentRung: '12k', winsAtCurrentRung: 0, lossStreak: 0 }), 3),
    });
    server.rev = 4;
    vi.stubGlobal('fetch', server.fetch);
    loggedIn(m, 1);

    const start = vi.fn();
    expect(await m.play.playRanked({ start, stillHere: () => true })).toBe(true);
    expect(server.count('GET', '/sync/state')).toBe(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0][0].bot).toBe('12k');
  });

  it('does not start when the player left while it waited', async () => {
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    vi.stubGlobal('fetch', server.fetch);
    loggedIn(m, 1);

    const start = vi.fn();
    expect(await m.play.playRanked({ start, stillHere: () => false })).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it('a pass that lands after the 2 s cap is held during the game, then applied before its result', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const m = await load();
    const serverSlot = slotAt({ currentRung: '12k', winsAtCurrentRung: 3, lossStreak: 0 });
    const server = new FakeServer({ ...m.sync.buildLocalDoc(), ladder: ladderOf(serverSlot, 1) });
    server.rev = 5;
    vi.stubGlobal('fetch', server.fetch);
    loggedIn(m, 2);
    let release!: () => void;
    server.gate = new Promise<void>((r) => {
      release = r;
    });

    const start = vi.fn();
    const pressed = m.play.playRanked({ start, stillHere: () => true });
    await vi.advanceTimersByTimeAsync(1999);
    expect(start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pressed).toBe(true);
    expect(start.mock.calls[0][0].bot).toBe('30k'); // the cap hit: started on the old rung
    m.auto.useAutoPlayStore.getState().setGamePending(true);

    // The slow pass lands mid-game: the rank must not move.
    release();
    await m.sync.syncIdle();
    expect(m.auto.useAutoPlayStore.getState().rungState.currentRung).toBe('30k');
    expect(server.count('PUT', '/sync/state')).toBe(0);

    // The game ends: what was held lands first, the result on top of it.
    m.auto.useAutoPlayStore.getState().recordResult('win');
    await m.sync.syncIdle();
    const expected = applyResult(serverSlot.rungState, 'win', 19).state;
    expect(expected.currentRung).toBe('11k');
    expect(m.auto.useAutoPlayStore.getState().rungState).toEqual(expected);
    const puts = server.find('PUT', '/sync/state');
    expect(puts).toHaveLength(1);
    expect(puts[0].body!.base_rev).toBe(5);
    expect(server.slot().rungState).toEqual(expected);
    expect(server.slot().history).toHaveLength(1);
  });

  it('Play waits at most 2 seconds for a pass that hangs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    vi.stubGlobal('fetch', server.fetch);
    loggedIn(m, 1);
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
});

/* ------------------------------------------------------------------------- *
 * The state pass (unchanged from the first round, logged in).
 * ------------------------------------------------------------------------- */

describe('the state pass', () => {
  it('pushes a ranked result when level, with only the allowed keys', async () => {
    const m = await load();
    m.profile.useProfileStore.getState().setHandle([10, 20]);
    const server = new FakeServer(m.sync.buildLocalDoc());
    server.rev = 3;
    vi.stubGlobal('fetch', server.fetch);
    loggedIn(m, 3);

    m.auto.useAutoPlayStore.getState().recordResult('win', 1);
    await m.sync.syncIdle();

    const puts = server.find('PUT', '/sync/state');
    expect(puts).toHaveLength(1);
    expect(puts[0].auth).toBe('Bearer tok-1');
    expect(puts[0].body!.base_rev).toBe(3);
    expect(Object.keys(puts[0].body!.state!).sort()).toEqual(ALLOWED_KEYS);
    expect(puts[0].body!.state!.handle).toEqual([10, 20]);
    expect(server.rev).toBe(4);
    expect(server.slot().history[0].undosUsed).toBe(1);
    const s = m.sync.useSyncStore.getState();
    expect(s.baseRev).toBe(4);
    expect(s.dirty).toBe(false);
    expect(s.pendingResults).toEqual([]);
    expect(server.allBodies()).not.toContain('themeId'); // settings stay per device
  });

  it('re-applies two queued results in order on the server ladder, then pushes on its revision', async () => {
    const m = await load();
    const serverSlot = slotAt({ currentRung: '12k', winsAtCurrentRung: 3, lossStreak: 0 });
    const server = new FakeServer({ ...m.sync.buildLocalDoc(), ladder: ladderOf(serverSlot, 1) });
    server.rev = 5;
    vi.stubGlobal('fetch', server.fetch);
    loggedIn(m, 2);

    server.intercept = down;
    m.auto.useAutoPlayStore.getState().recordResult('win');
    m.auto.useAutoPlayStore.getState().recordResult('loss');
    await m.sync.syncIdle();
    const queued = [...m.sync.useSyncStore.getState().pendingResults];
    expect(queued.map((r) => r.result)).toEqual(['win', 'loss']);

    server.intercept = undefined;
    await m.sync.useSyncStore.getState().sync();

    let st: RungState = { ...serverSlot.rungState };
    let rating: Rating = { ...serverSlot.shadowRating! };
    for (const r of ['win', 'loss'] as const) {
      rating = updateRating(rating, rankToRating(st.currentRung), 100, r === 'win' ? 1 : 0);
      st = applyResult(st, r, 19).state;
    }
    expect(st).toEqual({ currentRung: '11k', winsAtCurrentRung: 0, lossStreak: 1 });

    const puts = server.find('PUT', '/sync/state');
    expect(puts).toHaveLength(1);
    expect(puts[0].body!.base_rev).toBe(5);
    const pushed = puts[0].body!.state!.ladder;
    const slot = pushed.byBoardSize['19x19']!;
    expect(slot.rungState).toEqual(st);
    expect(slot.shadowRating!.mu).toBeCloseTo(rating.mu, 9);
    expect(slot.shadowRating!.phi).toBeCloseTo(rating.phi, 9);
    expect(slot.history.map((h) => [h.ts, h.result])).toEqual(queued.map((r) => [r.ts, r.result]));
    expect(slot.promotionEvents).toEqual([{ from: '12k', to: '11k', ts: queued[0].ts }]);
    expect(pushed.undoBank).toBe(3);
    expect(m.auto.useAutoPlayStore.getState().rungState).toEqual(st);
    expect(m.sync.useSyncStore.getState().baseRev).toBe(6);
    expect(m.sync.useSyncStore.getState().pendingResults).toEqual([]);
  });

  it('does not apply a queued result twice when its earlier push landed but the reply was lost', async () => {
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    server.rev = 3;
    vi.stubGlobal('fetch', server.fetch);
    loggedIn(m, 3);

    server.intercept = down;
    m.auto.useAutoPlayStore.getState().recordResult('win');
    await m.sync.syncIdle();
    server.intercept = undefined;
    server.state = m.sync.buildLocalDoc();
    server.rev = 4;
    await m.sync.useSyncStore.getState().sync();

    expect(server.slot().history).toHaveLength(1);
    expect(server.count('PUT', '/sync/state')).toBe(0);
    expect(m.sync.useSyncStore.getState().pendingResults).toEqual([]);
    expect(m.sync.useSyncStore.getState().baseRev).toBe(4);
  });

  it('keeps an avatar or name changed here when the server has moved on', async () => {
    const m = await load();
    m.profile.useProfileStore.getState().setHandle([1, 2]);
    const server = new FakeServer(m.sync.buildLocalDoc());
    server.rev = 2;
    vi.stubGlobal('fetch', server.fetch);
    loggedIn(m, 1);

    m.profile.useProfileStore.getState().setAvatar('prism');
    m.profile.useProfileStore.getState().setHandle([40, 41]);
    await m.sync.syncIdle();

    expect(m.profile.useProfileStore.getState().avatar).toBe('prism');
    expect(server.state.avatar).toBe('prism');
    expect(server.state.handle).toEqual([40, 41]);
  });

  it('rebases onto the state in a 409 and retries with its revision', async () => {
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    server.rev = 3;
    vi.stubGlobal('fetch', server.fetch);
    loggedIn(m, 3);

    const otherSlot = slotAt({ currentRung: '25k', winsAtCurrentRung: 1, lossStreak: 0 }, {
      history: [{ rung: '26k', bot: '18k', handicap: 8, result: 'win', ts: 42, undosUsed: 0 }],
    });
    let first = true;
    server.intercept = (c) => {
      if (first && c.method === 'PUT' && c.path === '/sync/state') {
        first = false;
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
    expect(m.learn.useLearnStore.getState().completed.has('other-lesson')).toBe(true);
    expect(m.sync.useSyncStore.getState().pendingResults).toEqual([]);
  });

  it('gives up after three 409 retries, keeps the queue, and lands it on a later pass', async () => {
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    server.rev = 3;
    vi.stubGlobal('fetch', server.fetch);
    loggedIn(m, 3);

    server.intercept = (c) => {
      if (c.method === 'PUT' && c.path === '/sync/state') {
        server.rev += 1;
        return json(409, { rev: server.rev, state: server.state });
      }
      return undefined;
    };
    m.auto.useAutoPlayStore.getState().recordResult('win');
    await m.sync.syncIdle();

    expect(server.count('PUT', '/sync/state')).toBe(1 + m.sync.MAX_CONFLICT_RETRIES);
    expect(m.sync.MAX_CONFLICT_RETRIES).toBe(3);
    expect(m.sync.useSyncStore.getState().pendingResults).toHaveLength(1);

    server.intercept = undefined;
    await m.sync.useSyncStore.getState().sync();
    expect(m.sync.useSyncStore.getState().pendingResults).toEqual([]);
    expect(server.slot().history).toHaveLength(1);
  });

  it('an offline pass leaves the queue intact and persisted; it lands once back online', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    server.rev = 3;
    vi.stubGlobal('fetch', server.fetch);
    loggedIn(m, 3);

    server.intercept = () => {
      throw new TypeError('Load failed');
    };
    m.auto.useAutoPlayStore.getState().recordResult('win');
    m.auto.useAutoPlayStore.getState().recordResult('loss');
    const idle = m.sync.syncIdle();
    await vi.runAllTimersAsync();
    await idle;

    expect(m.auto.useAutoPlayStore.getState().history).toHaveLength(2);
    expect(m.sync.useSyncStore.getState().pendingResults).toHaveLength(2);
    const stored = JSON.parse(localStorage.getItem('goforkids.sync.v1')!) as { pendingResults: unknown[] };
    expect(stored.pendingResults).toHaveLength(2);
    expect(m.sync.useSyncStore.getState().firstRun).toBe(false);

    vi.useRealTimers();
    server.intercept = undefined;
    await m.sync.useSyncStore.getState().sync();
    expect(m.sync.useSyncStore.getState().pendingResults).toEqual([]);
    expect(server.slot().history.map((h) => h.result)).toEqual(['win', 'loss']);
  });

  it('concurrent triggers never run two passes at once', async () => {
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    vi.stubGlobal('fetch', server.fetch);
    loggedIn(m, 1);
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
    expect(server.count('GET', '/sync/state')).toBe(2);
    expect(m.sync.useSyncStore.getState().pendingResults).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- *
 * Replays.
 * ------------------------------------------------------------------------- */

describe('replays', () => {
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
    loggedIn(m, 1, { syncedGameIds: ['B', 'D'] });

    await m.sync.useSyncStore.getState().sync();

    const putA = server.find('PUT', '/sync/games/A');
    expect(putA).toHaveLength(1);
    expect(putA[0].body!.date).toBe(minute(4));
    expect('selectorLog' in putA[0].body!.payload!).toBe(false);
    expect(server.count('GET', '/sync/games/C')).toBe(1);
    expect(server.count('DELETE', '/sync/games/B')).toBe(0);
    expect(lib.getState().games.map((g) => g.id)).toEqual(['C', 'A', 'D']);
    expect([...m.sync.useSyncStore.getState().syncedGameIds].sort()).toEqual(['A', 'C', 'D']);

    lib.getState().deleteGame('D');
    await m.sync.syncIdle();
    expect(server.count('DELETE', '/sync/games/D')).toBe(1);
    expect(lib.getState().games.map((g) => g.id)).toEqual(['C', 'A']);
  });

  it('remembers a replay the server refused (413) and does not send it again', async () => {
    const m = await load();
    const lib = m.library.useLibraryStore;
    lib.getState().replaceGames([game('BIG', minute(2)), game('OK', minute(1))]);
    const server = new FakeServer(m.sync.buildLocalDoc());
    vi.stubGlobal('fetch', server.fetch);
    loggedIn(m, 1);
    server.intercept = (c) =>
      c.method === 'PUT' && c.path === '/sync/games/BIG' ? json(413, { detail: 'too big' }) : undefined;

    await m.sync.useSyncStore.getState().sync();
    expect(server.count('PUT', '/sync/games/BIG')).toBe(1);
    expect(server.count('PUT', '/sync/games/OK')).toBe(1);
    expect(m.sync.useSyncStore.getState().refusedGameIds).toEqual(['BIG']);
    expect(JSON.parse(localStorage.getItem('goforkids.sync.v1')!).refusedGameIds).toEqual(['BIG']);

    await m.sync.useSyncStore.getState().sync();
    expect(server.count('PUT', '/sync/games/BIG')).toBe(1);
    expect(lib.getState().games.map((g) => g.id)).toEqual(['BIG', 'OK']); // still here, locally
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
    loggedIn(m, 1);

    await m.sync.useSyncStore.getState().sync();

    const games = lib.getState().games;
    expect(games).toHaveLength(100);
    const expected = Array.from({ length: 100 }, (_, k) => {
      const n = 119 - k;
      return `${n % 2 === 0 ? 'L' : 'R'}${String(Math.floor(n / 2)).padStart(2, '0')}`;
    });
    expect(games.map((g) => g.id)).toEqual(expected);
    for (let i = 0; i < 10; i++) {
      const s = String(i).padStart(2, '0');
      expect(server.count('GET', `/sync/games/R${s}`)).toBe(0);
      expect(server.count('PUT', `/sync/games/L${s}`)).toBe(0);
    }
    expect(server.games.size).toBe(100);
  });
});

describe('pairing codes', () => {
  it('normalises what was typed and shows the code in two groups of four', async () => {
    const { normalizePairingCode, formatPairingCode } = await import('../../api/sync');
    expect(normalizePairingCode(' abcd 2345 ')).toBe('ABCD2345');
    expect(normalizePairingCode('ab cd\t23 45')).toBe('ABCD2345');
    expect(formatPairingCode('abcd2345')).toBe('ABCD 2345');
  });
});
