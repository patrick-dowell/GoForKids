/**
 * Sync, revision 3 (feature 32): the admin standing a pass reads from
 * `GET /state`, the admin routes behind the Admin section, the labels that
 * never leave the device, and logging into a profile an admin made. Runs
 * against an in-memory fake of the contract in
 * feature_plans/32_sync_foundation.md behind a mocked `fetch` that records
 * every request whole: URL, every header, body.
 *
 * Project-wide vitest env is 'node'; localStorage is shimmed as in
 * syncStore.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminPlayer, SyncStateDoc } from '../../api/sync';
import { freshPlayerState } from '../../profile/admin';
import type { SavedGame } from '../libraryStore';

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

function json(status: number, body?: unknown): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body ?? {}), { status, headers: { 'Content-Type': 'application/json' } });
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** One request exactly as it left the app. */
interface Sent {
  url: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  rawBody: string | null;
  body: Record<string, unknown> | undefined;
}

interface FakeDevice {
  device_id: string;
  token: string;
}

interface FakePlayer {
  rev: number;
  state: SyncStateDoc;
  devices: FakeDevice[];
}

const ADMIN_ID = 'p-admin';
const SELF_DEVICE = 'd-self';

/** A fake of the server: one admin profile (this device's), and others. */
class FakeServer {
  players = new Map<string, FakePlayer>();
  admins = new Set<string>([ADMIN_ID]);
  sent: Sent[] = [];
  codes = new Map<string, { playerId: string; used: boolean; expires_at: string }>();
  games = new Map<string, { id: string; date: string; payload: unknown }>();
  intercept?: (s: Sent) => Response | Promise<Response> | undefined;
  private nextId = 1;

  constructor(adminState: SyncStateDoc) {
    this.players.set(ADMIN_ID, { rev: 1, state: clone(adminState), devices: [{ device_id: SELF_DEVICE, token: 'tok-1' }] });
  }

  fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const u = new URL(url);
    const headers = { ...((init.headers ?? {}) as Record<string, string>) };
    const rawBody = typeof init.body === 'string' ? init.body : init.body == null ? null : String(init.body);
    const s: Sent = {
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      path: u.pathname.replace(/^\/api/, ''),
      headers,
      rawBody,
      body: rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : undefined,
    };
    this.sent.push(s);
    return (await this.intercept?.(s)) ?? this.handle(s);
  });

  count(method: string, pathRe: RegExp | string): number {
    return this.find(method, pathRe).length;
  }

  find(method: string, pathRe: RegExp | string): Sent[] {
    return this.sent.filter(
      (s) => s.method === method && (typeof pathRe === 'string' ? s.path === pathRe : pathRe.test(s.path)),
    );
  }

  /** Everything every request carried, as one string. */
  everything(): string {
    return JSON.stringify(this.sent.map((s) => [s.url, s.method, s.headers, s.rawBody]));
  }

  addPlayer(id: string, state: SyncStateDoc, deviceIds: string[]): void {
    this.players.set(id, {
      rev: 3,
      state: clone(state),
      devices: deviceIds.map((d) => ({ device_id: d, token: `tok-${d}` })),
    });
  }

  private who(s: Sent): { playerId: string; device: FakeDevice } | null {
    const token = s.headers.Authorization?.replace(/^Bearer /, '');
    for (const [playerId, p] of this.players) {
      const device = p.devices.find((d) => d.token === token);
      if (device) return { playerId, device };
    }
    return null;
  }

  private entry(id: string, p: FakePlayer): AdminPlayer {
    const boards: AdminPlayer['boards'] = {};
    for (const [k, slot] of Object.entries(p.state.ladder.byBoardSize ?? {})) {
      boards[k] = { rung: slot?.rungState?.currentRung ?? null, games: slot?.history?.length ?? 0 };
    }
    return {
      player_id: id,
      handle: p.state.handle ?? null,
      boards,
      devices: p.devices.map((d) => ({ device_id: d.device_id, created_at: '2026-10-01T09:00:00Z', last_seen_at: null, kind: null })),
      replays: 0,
      created_at: '2026-10-01T09:00:00Z',
      updated_at: '2026-10-01T09:00:00Z',
      no_device_since: p.devices.length ? null : '2026-10-01T09:00:00Z',
      days_left: p.devices.length ? null : 30,
    };
  }

  handle(s: Sent): Response {
    if (s.method === 'POST' && s.path === '/sync/pairing-codes/redeem') {
      const c = this.codes.get(String(s.body?.code ?? ''));
      if (!c || c.used) return json(404, { detail: 'unknown code' });
      c.used = true;
      const p = this.players.get(c.playerId)!;
      const device = { device_id: `d-${this.nextId++}`, token: `tok-new-${this.nextId}` };
      p.devices.push(device);
      return json(200, { player_id: c.playerId, device_token: device.token, rev: p.rev, state: clone(p.state) });
    }
    const me = this.who(s);
    if (!me) return json(401, { detail: 'unauthorized' });
    const mine = this.players.get(me.playerId)!;

    if (s.path.startsWith('/sync/admin/')) {
      if (!this.admins.has(me.playerId)) return json(403, { detail: 'not an admin' });
      if (s.method === 'GET' && s.path === '/sync/admin/players') {
        return json(200, { players: [...this.players].map(([id, p]) => this.entry(id, p)) });
      }
      if (s.method === 'POST' && s.path === '/sync/admin/players') {
        const id = `p-made-${this.nextId++}`;
        this.players.set(id, { rev: 1, state: clone(s.body!.state as SyncStateDoc), devices: [] });
        return json(201, { player_id: id, rev: 1 });
      }
      let m = /^\/sync\/admin\/players\/([^/]+)\/pairing-codes$/.exec(s.path);
      if (m && s.method === 'POST') {
        const id = decodeURIComponent(m[1]);
        if (!this.players.has(id)) return json(404, { detail: 'unknown player' });
        const code = `C${String(this.nextId++).padStart(7, '2')}`;
        const expires_at = String(s.body?.expires_at);
        this.codes.set(code, { playerId: id, used: false, expires_at });
        return json(201, { code, expires_at });
      }
      m = /^\/sync\/admin\/players\/([^/]+)\/devices$/.exec(s.path);
      if (m && s.method === 'DELETE') {
        const id = decodeURIComponent(m[1]);
        if (!this.players.has(id)) return json(404, { detail: 'unknown player' });
        if (id === me.playerId) return json(409, { detail: 'your own profile' });
        this.players.get(id)!.devices = [];
        return json(204);
      }
      m = /^\/sync\/admin\/devices\/([^/]+)$/.exec(s.path);
      if (m && s.method === 'DELETE') {
        const id = decodeURIComponent(m[1]);
        if (id === me.device.device_id) return json(409, { detail: 'this device' });
        for (const p of this.players.values()) {
          const before = p.devices.length;
          p.devices = p.devices.filter((d) => d.device_id !== id);
          if (p.devices.length !== before) return json(204);
        }
        return json(404, { detail: 'unknown device' });
      }
      return json(404, { detail: 'no route' });
    }

    if (s.path === '/sync/state' && s.method === 'GET') {
      return json(200, {
        rev: mine.rev,
        state: clone(mine.state),
        admin: this.admins.has(me.playerId),
        device_id: me.device.device_id,
      });
    }
    if (s.path === '/sync/state' && s.method === 'PUT') {
      if (s.body?.base_rev !== mine.rev) return json(409, { rev: mine.rev, state: clone(mine.state) });
      mine.rev += 1;
      mine.state = clone(s.body!.state as SyncStateDoc);
      return json(200, { rev: mine.rev });
    }
    if (s.path === '/sync/games' && s.method === 'GET') {
      return json(200, { games: [...this.games.values()].map(({ id, date }) => ({ id, date })) });
    }
    const g = /^\/sync\/games\/(.+)$/.exec(s.path);
    if (g && s.method === 'PUT') {
      const id = decodeURIComponent(g[1]);
      this.games.set(id, { id, date: String(s.body?.date), payload: s.body?.payload });
      return json(200, { kept: true });
    }
    if (s.method === 'DELETE' && s.path === '/sync/devices/current') {
      mine.devices = mine.devices.filter((d) => d !== me.device);
      return json(204);
    }
    return json(404, { detail: 'no route' });
  }
}

/* ------------------------------------------------------------------------- *
 * Fixtures.
 * ------------------------------------------------------------------------- */

const LABELS_KEY = 'goforkids.admin.labels.v1';

async function load() {
  vi.resetModules();
  const sync = await import('../syncStore');
  const admin = await import('../adminStore');
  const labels = await import('../adminLabels');
  const auto = await import('../autoPlayStore');
  const learn = await import('../learnStore');
  const profile = await import('../profileStore');
  const library = await import('../libraryStore');
  return { sync, admin, labels, auto, learn, profile, library };
}
type Mods = Awaited<ReturnType<typeof load>>;

function loggedIn(m: Mods) {
  m.sync.useSyncStore.setState({ playerId: ADMIN_ID, deviceToken: 'tok-1', baseRev: 1, dirty: false });
}

/** This device logged into the admin profile, a pass run, the list loaded,
 *  with two other profiles on the server: one with two devices, one with
 *  none. */
async function adminDevice() {
  const m = await load();
  m.profile.useProfileStore.getState().setHandle([2, 9]);
  const server = new FakeServer(m.sync.buildLocalDoc());
  server.addPlayer('p-two', freshPlayerState([4, 2]), ['d-a', 'd-b']);
  server.addPlayer('p-none', freshPlayerState([7, 7]), []);
  vi.stubGlobal('fetch', server.fetch);
  loggedIn(m);
  await m.sync.useSyncStore.getState().sync();
  await m.admin.useAdminStore.getState().refresh();
  return { m, server };
}

function game(id: string): SavedGame {
  return {
    id,
    sgf: '(;GM[1]SZ[9];B[ee])',
    date: '2026-10-02T09:00:00.000Z',
    playerColor: 'black',
    opponentRank: '30k',
    result: 'Black wins by 5.5',
    moveCount: 1,
    isRanked: true,
    gameId: id,
  };
}

beforeEach(() => {
  installLocalStorage();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------------- *
 * The admin standing.
 * ------------------------------------------------------------------------- */

describe('admin and device_id from GET /state', () => {
  it('a pass keeps both in the sync state, persisted', async () => {
    const { m } = await adminDevice();
    const s = m.sync.useSyncStore.getState();
    expect(s.admin).toBe(true);
    expect(s.deviceId).toBe(SELF_DEVICE);
    const stored = JSON.parse(localStorage.getItem('goforkids.sync.v1')!);
    expect(stored.admin).toBe(true);
    expect(stored.deviceId).toBe(SELF_DEVICE);

    // An app relaunch on the same storage still knows, until the next pass says otherwise.
    const m2 = await load();
    m2.sync.useSyncStore.getState().loadFromStorage();
    expect(m2.sync.useSyncStore.getState().admin).toBe(true);
    expect(m2.sync.useSyncStore.getState().deviceId).toBe(SELF_DEVICE);
  });

  it('the latest pass decides: a pass that says false (or says nothing) turns it off', async () => {
    const { m, server } = await adminDevice();
    server.admins.clear();
    await m.sync.useSyncStore.getState().sync();
    expect(m.sync.useSyncStore.getState().admin).toBe(false);
    expect(m.admin.useAdminStore.getState().players).toBeNull();

    server.admins.add(ADMIN_ID);
    await m.sync.useSyncStore.getState().sync();
    expect(m.sync.useSyncStore.getState().admin).toBe(true);

    // A server from before revision 3 sends neither field.
    server.intercept = (s) =>
      s.method === 'GET' && s.path === '/sync/state'
        ? json(200, { rev: server.players.get(ADMIN_ID)!.rev, state: server.players.get(ADMIN_ID)!.state })
        : undefined;
    await m.sync.useSyncStore.getState().sync();
    expect(m.sync.useSyncStore.getState().admin).toBe(false);
    expect(m.sync.useSyncStore.getState().deviceId).toBeNull();
  });

  it('a non-admin device makes no admin request at all', async () => {
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    server.admins.clear();
    vi.stubGlobal('fetch', server.fetch);
    loggedIn(m);
    await m.sync.useSyncStore.getState().sync();
    expect(m.sync.useSyncStore.getState().admin).toBe(false);

    await m.admin.useAdminStore.getState().refresh();
    await expect(m.admin.useAdminStore.getState().createPlayer([1, 1])).rejects.toThrow();
    expect(server.count('GET', /^\/sync\/admin\//)).toBe(0);
    expect(server.count('POST', /^\/sync\/admin\//)).toBe(0);
    expect(m.admin.useAdminStore.getState().players).toBeNull();
  });

  it('no token, no admin request, whatever the flag says', async () => {
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    vi.stubGlobal('fetch', server.fetch);
    m.sync.useSyncStore.setState({ deviceToken: null, admin: true, pendingCreate: 'new' });
    await expect(m.sync.useSyncStore.getState().adminRequest(() => Promise.resolve(1))).rejects.toThrow();
    await m.admin.useAdminStore.getState().refresh();
    expect(server.sent).toEqual([]);
    expect(m.sync.useSyncStore.getState().pendingCreate).toBe('new');
  });

  it('log out clears both', async () => {
    const { m } = await adminDevice();
    await m.sync.useSyncStore.getState().logOut();
    const s = m.sync.useSyncStore.getState();
    expect(s.admin).toBe(false);
    expect(s.deviceId).toBeNull();
    expect(s.firstRun).toBe(true);
    expect(m.admin.useAdminStore.getState().players).toBeNull();
  });

  it('a 401 clears both', async () => {
    const { m, server } = await adminDevice();
    server.players.get(ADMIN_ID)!.devices = []; // signed out by another admin
    await m.sync.useSyncStore.getState().sync();
    const s = m.sync.useSyncStore.getState();
    expect(s.firstRunNotice).toBe('logged-out');
    expect(s.admin).toBe(false);
    expect(s.deviceId).toBeNull();
  });
});

describe('a 403 from an admin route', () => {
  it('hides the section and never signs the device out', async () => {
    const { m, server } = await adminDevice();
    expect(m.admin.useAdminStore.getState().players).not.toBeNull();
    server.admins.clear(); // taken off the admin list on the server

    await m.admin.useAdminStore.getState().refresh();

    const s = m.sync.useSyncStore.getState();
    expect(s.admin).toBe(false);
    expect(JSON.parse(localStorage.getItem('goforkids.sync.v1')!).admin).toBe(false);
    expect(m.admin.useAdminStore.getState().players).toBeNull();
    // Still logged in, with everything it held.
    expect(s.deviceToken).toBe('tok-1');
    expect(s.firstRun).toBe(false);
    expect(s.firstRunNotice).toBeNull();
    expect(m.profile.useProfileStore.getState().handle).toEqual([2, 9]);
    expect(server.count('DELETE', '/sync/devices/current')).toBe(0);
  });

  it('on every admin action', async () => {
    for (const action of ['create', 'code', 'remove', 'sign-out'] as const) {
      installLocalStorage();
      const { m, server } = await adminDevice();
      server.admins.clear();
      const a = m.admin.useAdminStore.getState();
      const run = {
        create: () => a.createPlayer([3, 3]),
        code: () => a.mintCode('p-two', new Date(Date.now() + 3_600_000)),
        remove: () => a.removeDevice('d-a'),
        'sign-out': () => a.signOutPlayer('p-two'),
      }[action];
      await expect(run()).rejects.toMatchObject({ status: 403 });
      expect(m.sync.useSyncStore.getState().admin).toBe(false);
      expect(m.sync.useSyncStore.getState().deviceToken).toBe('tok-1');
      expect(m.sync.useSyncStore.getState().firstRun).toBe(false);
    }
  });

  it('a 401 from an admin route takes the 401 path', async () => {
    const { m, server } = await adminDevice();
    server.players.get(ADMIN_ID)!.devices = [];
    await m.admin.useAdminStore.getState().refresh();
    const s = m.sync.useSyncStore.getState();
    expect(s.deviceToken).toBeNull();
    expect(s.firstRun).toBe(true);
    expect(s.firstRunNotice).toBe('logged-out');
  });
});

/* ------------------------------------------------------------------------- *
 * The list and the actions.
 * ------------------------------------------------------------------------- */

describe('admin actions', () => {
  it('the list comes back as the server sends it', async () => {
    const { m } = await adminDevice();
    const players = m.admin.useAdminStore.getState().players!;
    expect(players.map((p) => p.player_id)).toEqual([ADMIN_ID, 'p-two', 'p-none']);
    expect(players[1].devices.map((d) => d.device_id)).toEqual(['d-a', 'd-b']);
    expect(players[2].days_left).toBe(30);
  });

  it('New player sends exactly the fresh state with its name, then lists it', async () => {
    const { m, server } = await adminDevice();
    const id = await m.admin.useAdminStore.getState().createPlayer([12, 21]);

    const create = server.find('POST', '/sync/admin/players');
    expect(create).toHaveLength(1);
    expect(create[0].body).toStrictEqual({
      state: {
        schema: 1,
        ladder: { byBoardSize: {} },
        lessons: [],
        avatar: 'blackhole',
        avatarPicked: false,
        handle: [12, 21],
      },
    });
    expect(create[0].headers.Authorization).toBe('Bearer tok-1');
    const listed = m.admin.useAdminStore.getState().players!.find((p) => p.player_id === id)!;
    expect(listed.handle).toEqual([12, 21]);
    expect(listed.devices).toEqual([]);
  });

  it('a code: expires_at goes as toISOString(), and the code comes back', async () => {
    const { m, server } = await adminDevice();
    const expiry = new Date(Date.now() + 2 * 3_600_000);
    const code = await m.admin.useAdminStore.getState().mintCode('p-none', expiry);

    const sent = server.find('POST', '/sync/admin/players/p-none/pairing-codes');
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toEqual({ expires_at: expiry.toISOString() });
    expect(code.expires_at).toBe(expiry.toISOString());
    expect(code.code).toHaveLength(8);
  });

  it('a code past 24 hours, or already gone, is refused here without a request', async () => {
    const { m, server } = await adminDevice();
    const a = m.admin.useAdminStore.getState();
    await expect(a.mintCode('p-none', new Date(Date.now() + 24 * 3_600_000 + 60_000))).rejects.toThrow();
    await expect(a.mintCode('p-none', new Date(Date.now() - 1000))).rejects.toThrow();
    expect(server.count('POST', /pairing-codes$/)).toBe(0);
    // The bound itself is allowed.
    await a.mintCode('p-none', new Date(Date.now() + 24 * 3_600_000 - 1000));
    expect(server.count('POST', /pairing-codes$/)).toBe(1);
  });

  it('a list reply without a players array reads as an empty list', async () => {
    const { m, server } = await adminDevice();
    server.intercept = (s) => (s.path === '/sync/admin/players' ? json(200, { players: 'none' }) : undefined);
    await m.admin.useAdminStore.getState().refresh();
    expect(m.admin.useAdminStore.getState().players).toEqual([]);
  });

  it('a list that fails to load is flagged, and the last one kept', async () => {
    const { m, server } = await adminDevice();
    server.intercept = (s) => (s.path === '/sync/admin/players' ? json(503, { detail: 'down' }) : undefined);
    await m.admin.useAdminStore.getState().refresh();
    expect(m.admin.useAdminStore.getState().loadFailed).toBe(true);
    expect(m.admin.useAdminStore.getState().players).toHaveLength(3);
    server.intercept = undefined;
    await m.admin.useAdminStore.getState().refresh();
    expect(m.admin.useAdminStore.getState().loadFailed).toBe(false);
  });

  it('loading shows while the list is on its way; an older reply never lands over a newer one', async () => {
    const { m, server } = await adminDevice();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let calls = 0;
    server.intercept = (s) => {
      if (s.path !== '/sync/admin/players' || ++calls > 1) return undefined;
      // The first reload is slow and answers with the list as it was.
      const stale = server.handle(s);
      return held.then(() => stale);
    };
    const slow = m.admin.useAdminStore.getState().refresh();
    expect(m.admin.useAdminStore.getState().loading).toBe(true);
    server.players.delete('p-none');
    await m.admin.useAdminStore.getState().refresh();
    expect(m.admin.useAdminStore.getState().players).toHaveLength(2);
    release();
    await slow;
    expect(m.admin.useAdminStore.getState().players).toHaveLength(2);
    expect(m.admin.useAdminStore.getState().loading).toBe(false);
  });

  it('loading stays on until the newest load is back', async () => {
    const { m, server } = await adminDevice();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let calls = 0;
    server.intercept = (s) => {
      if (s.path !== '/sync/admin/players' || ++calls !== 2) return undefined;
      const reply = server.handle(s);
      return held.then(() => reply); // the second, newer load is the slow one
    };
    const older = m.admin.useAdminStore.getState().refresh();
    const newer = m.admin.useAdminStore.getState().refresh();
    await older;
    expect(m.admin.useAdminStore.getState().loading).toBe(true);
    release();
    await newer;
    expect(m.admin.useAdminStore.getState().loading).toBe(false);
  });

  it('a list still on its way when the device stops being an admin never lands', async () => {
    const { m, server } = await adminDevice();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    server.intercept = (s) => {
      if (s.path !== '/sync/admin/players') return undefined;
      const reply = server.handle(s);
      return held.then(() => reply);
    };
    const slow = m.admin.useAdminStore.getState().refresh();
    server.admins.clear();
    await m.sync.useSyncStore.getState().sync(); // the pass says: not an admin
    expect(m.admin.useAdminStore.getState().players).toBeNull();
    release();
    await slow;
    expect(m.admin.useAdminStore.getState().players).toBeNull();
    expect(m.admin.useAdminStore.getState().loading).toBe(false);
  });

  it('refuses, without a request, a name that is not a name and a profile not in the list', async () => {
    const { m, server } = await adminDevice();
    await expect(m.admin.useAdminStore.getState().createPlayer([64, 0])).rejects.toThrow(/^admin: /);
    await expect(m.admin.useAdminStore.getState().signOutPlayer('p-unknown')).rejects.toThrow(/^admin: /);
    expect(server.count('POST', '/sync/admin/players')).toBe(0);
    expect(server.count('DELETE', /^\/sync\/admin\//)).toBe(0);
  });

  it('Remove signs one device out; never this device', async () => {
    const { m, server } = await adminDevice();
    await m.admin.useAdminStore.getState().removeDevice('d-a');
    expect(server.count('DELETE', '/sync/admin/devices/d-a')).toBe(1);
    expect(m.admin.useAdminStore.getState().players!.find((p) => p.player_id === 'p-two')!.devices.map((d) => d.device_id)).toEqual(['d-b']);

    await expect(m.admin.useAdminStore.getState().removeDevice(SELF_DEVICE)).rejects.toThrow();
    expect(server.count('DELETE', `/sync/admin/devices/${SELF_DEVICE}`)).toBe(0);
    expect(m.sync.useSyncStore.getState().deviceToken).toBe('tok-1');
  });

  it("Sign out this player's devices; never this device's own profile", async () => {
    const { m, server } = await adminDevice();
    await m.admin.useAdminStore.getState().signOutPlayer('p-two');
    expect(server.count('DELETE', '/sync/admin/players/p-two/devices')).toBe(1);
    expect(m.admin.useAdminStore.getState().players!.find((p) => p.player_id === 'p-two')!.devices).toEqual([]);

    await expect(m.admin.useAdminStore.getState().signOutPlayer(ADMIN_ID)).rejects.toThrow();
    expect(server.count('DELETE', `/sync/admin/players/${ADMIN_ID}/devices`)).toBe(0);
  });
});

/* ------------------------------------------------------------------------- *
 * Labels.
 * ------------------------------------------------------------------------- */

/** Label sentinels: distinctive enough that any leak is unmistakable. */
const LABELS: Record<string, string> = {
  [ADMIN_ID]: 'LBL-Front-table-Q7',
  'p-two': 'LBL-Window-seat-Z3',
  'p-none': 'LBL-New-iPad-K9',
};

describe('labels', () => {
  it(`are kept only under ${LABELS_KEY}`, async () => {
    const { m } = await adminDevice();
    m.labels.useAdminLabels.getState().setLabel('p-two', 'Window seat');
    expect(JSON.parse(localStorage.getItem(LABELS_KEY)!)).toEqual({ 'p-two': 'Window seat' });
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k !== LABELS_KEY) expect(localStorage.getItem(k)).not.toContain('Window seat');
    }
    // Read back at the next app open.
    const m2 = await load();
    expect(m2.labels.useAdminLabels.getState().labels).toEqual({ 'p-two': 'Window seat' });
    // Clearing one leaves the rest.
    m2.labels.useAdminLabels.getState().setLabel('p-two', '');
    expect(localStorage.getItem(LABELS_KEY)).toBeNull();
  });

  it('no request carries a label: not in any body, URL or header, across every admin action and a sync pass', async () => {
    const { m, server } = await adminDevice();
    for (const [id, label] of Object.entries(LABELS)) m.labels.useAdminLabels.getState().setLabel(id, label);
    server.sent = [];

    const a = () => m.admin.useAdminStore.getState();
    await a().refresh();
    const made = await a().createPlayer([5, 5]);
    m.labels.useAdminLabels.getState().setLabel(made, 'LBL-Made-here-W4');
    await a().mintCode(made, new Date(Date.now() + 3_600_000));
    await a().mintCode('p-none', new Date(Date.now() + 3_600_000));
    await a().removeDevice('d-a');
    await a().signOutPlayer('p-two');
    // A sync pass that pushes state and sends a replay.
    m.auto.useAutoPlayStore.getState().recordResult('win');
    m.library.useLibraryStore.getState().replaceGames([game('g-1')]);
    await m.sync.useSyncStore.getState().sync();
    await m.sync.syncIdle();

    // Every kind of request happened.
    expect(server.count('GET', '/sync/admin/players')).toBeGreaterThan(0);
    expect(server.count('POST', '/sync/admin/players')).toBe(1);
    expect(server.count('POST', /^\/sync\/admin\/players\/.+\/pairing-codes$/)).toBe(2);
    expect(server.count('DELETE', /^\/sync\/admin\/devices\//)).toBe(1);
    expect(server.count('DELETE', /^\/sync\/admin\/players\/.+\/devices$/)).toBe(1);
    expect(server.count('GET', '/sync/state')).toBeGreaterThan(0);
    expect(server.count('PUT', '/sync/state')).toBeGreaterThan(0);
    expect(server.count('PUT', '/sync/games/g-1')).toBe(1);

    // And none of them carried a label, or any part of one.
    const all = server.everything();
    for (const label of [...Object.values(LABELS), 'LBL-Made-here-W4']) expect(all).not.toContain(label);
    expect(all).not.toContain('LBL-');
    expect(all).not.toContain(LABELS_KEY);
    // The labels are still here, on the device.
    expect(JSON.parse(localStorage.getItem(LABELS_KEY)!)).toMatchObject(LABELS);
  });

  it('a blank label is no label; a long one is cut to 40 characters', async () => {
    const m = await load();
    const l = m.labels.useAdminLabels.getState();
    l.setLabel('p-two', '   ');
    expect(m.labels.useAdminLabels.getState().labels).toEqual({});
    expect(localStorage.getItem(LABELS_KEY)).toBeNull();
    l.setLabel('p-two', 'x'.repeat(60));
    expect(m.labels.useAdminLabels.getState().labels['p-two']).toBe('x'.repeat(40));
    expect(JSON.parse(localStorage.getItem(LABELS_KEY)!)['p-two']).toBe('x'.repeat(40));
  });

  it('storage that is not a map of strings reads as no labels', async () => {
    for (const raw of ['not json', 'null', '"text"', '["a"]', '{"p-two": 5, "p-none": "Kept"}']) {
      localStorage.setItem(LABELS_KEY, raw);
      const m = await load();
      expect(m.labels.useAdminLabels.getState().labels).toEqual(raw.startsWith('{') ? { 'p-none': 'Kept' } : {});
    }
  });

  it('are cleared on log out', async () => {
    const { m } = await adminDevice();
    m.labels.useAdminLabels.getState().setLabel('p-two', 'Window seat');
    await m.sync.useSyncStore.getState().logOut();
    expect(localStorage.getItem(LABELS_KEY)).toBeNull();
    expect(m.labels.useAdminLabels.getState().labels).toEqual({});
  });

  it('stay when a log out is refused', async () => {
    const { m, server } = await adminDevice();
    m.labels.useAdminLabels.getState().setLabel('p-two', 'Window seat');
    server.intercept = (s) => (s.method === 'DELETE' && s.path === '/sync/devices/current' ? json(503) : undefined);
    await expect(m.sync.useSyncStore.getState().logOut()).rejects.toBeTruthy();
    expect(JSON.parse(localStorage.getItem(LABELS_KEY)!)).toEqual({ 'p-two': 'Window seat' });
  });

  it('are cleared on a 401 in a sync pass', async () => {
    const { m, server } = await adminDevice();
    m.labels.useAdminLabels.getState().setLabel('p-two', 'Window seat');
    server.players.get(ADMIN_ID)!.devices = [];
    await m.sync.useSyncStore.getState().sync();
    expect(m.sync.useSyncStore.getState().firstRun).toBe(true);
    expect(localStorage.getItem(LABELS_KEY)).toBeNull();
    expect(m.labels.useAdminLabels.getState().labels).toEqual({});
  });

  it('are cleared on a 401 from an admin route', async () => {
    const { m, server } = await adminDevice();
    m.labels.useAdminLabels.getState().setLabel('p-two', 'Window seat');
    server.players.get(ADMIN_ID)!.devices = [];
    await expect(m.admin.useAdminStore.getState().removeDevice('d-a')).rejects.toMatchObject({ status: 401 });
    expect(localStorage.getItem(LABELS_KEY)).toBeNull();
    expect(m.labels.useAdminLabels.getState().labels).toEqual({});
  });

  it('stay on a 403 (the device is still on its profile)', async () => {
    const { m, server } = await adminDevice();
    m.labels.useAdminLabels.getState().setLabel('p-two', 'Window seat');
    server.admins.clear();
    await m.admin.useAdminStore.getState().refresh();
    expect(m.sync.useSyncStore.getState().admin).toBe(false);
    expect(JSON.parse(localStorage.getItem(LABELS_KEY)!)).toEqual({ 'p-two': 'Window seat' });
  });
});

/* ------------------------------------------------------------------------- *
 * Logging into a profile an admin made.
 * ------------------------------------------------------------------------- */

describe('logging into an admin-created profile', () => {
  it('starts with a fresh ladder, no lessons and the default avatar, under the profile name', async () => {
    // The admin's device makes the profile and a code for it.
    const { m: adminM, server } = await adminDevice();
    const id = await adminM.admin.useAdminStore.getState().createPlayer([12, 21]);
    const { code } = await adminM.admin.useAdminStore.getState().mintCode(id, new Date(Date.now() + 3_600_000));

    // A shared iPad, logged out after its last player: the first-run choice.
    installLocalStorage();
    const m = await load();
    vi.stubGlobal('fetch', server.fetch);
    m.library.useLibraryStore.getState().loadFromStorage();
    m.auto.useAutoPlayStore.getState().loadFromStorage();
    m.profile.useProfileStore.getState().loadFromStorage();
    expect(m.sync.startSync()).toBe('first-run');

    await m.sync.useSyncStore.getState().logIn(code.toLowerCase());
    await m.sync.syncIdle();

    const auto = m.auto.useAutoPlayStore.getState();
    expect(auto.slots).toEqual({});
    expect(auto.history).toEqual([]);
    expect(auto.rungState).toEqual({ currentRung: '30k', winsAtCurrentRung: 0, lossStreak: 0 });
    expect(m.learn.useLearnStore.getState().completed.size).toBe(0);
    const p = m.profile.useProfileStore.getState();
    expect(p.avatar).toBe('blackhole');
    expect(p.avatarPicked).toBe(false);
    expect(p.handle).toEqual([12, 21]);
    expect(m.profile.currentPlayerName()).toBe('Silver Nebula');

    const s = m.sync.useSyncStore.getState();
    expect(s.firstRun).toBe(false);
    expect(s.playerId).toBe(id);
    expect(s.admin).toBe(false); // an admin-made profile is not an admin
    expect(s.deviceId).toBe(server.players.get(id)!.devices[0].device_id);
    // Its first pass found nothing to change on the server.
    expect(server.players.get(id)!.state).toStrictEqual(freshPlayerState([12, 21]));
  });
});
