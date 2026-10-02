/**
 * Sync, revisions 4 and 5 (feature 32): the Friends section's data and
 * actions — the friend code and New code, each answer to Add a friend,
 * accept and decline, the list and the card, Remove friend, the feed, a
 * friend's replays and opening one in the replay viewer, the loads after a
 * sync pass and every 30 seconds while watched — and that the data lives in
 * memory only and is dropped on a log out and on a 401. Runs against an
 * in-memory fake of the contract in feature_plans/32_sync_foundation.md
 * behind a mocked `fetch` that records every request whole: URL, every
 * header, body.
 *
 * Project-wide vitest env is 'node'; localStorage is shimmed as in
 * syncStore.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FriendCard, FriendGame, FriendGameEntry, SyncStateDoc } from '../../api/sync';

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

interface Sent {
  url: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  rawBody: string | null;
  body: Record<string, unknown> | undefined;
}

interface FakePlayer {
  token: string | null;
  code: string;
  rev: number;
  state: SyncStateDoc;
  card: Omit<FriendCard, 'player_id'>;
}

interface Row {
  from: string;
  to: string;
  status: 'pending' | 'accepted' | 'declined';
  at: string;
}

/* Ids shaped like the server's (UUIDs); codes from the share-code alphabet. */
const ME = '0a0a0a0a-0000-4000-8000-000000000001';
const OTTER = '0a0a0a0a-0000-4000-8000-000000000002';
const FALCON = '0a0a0a0a-0000-4000-8000-000000000003';
const KOALA = '0a0a0a0a-0000-4000-8000-000000000004';
const STRANGER = '0a0a0a0a-0000-4000-8000-000000000005';

const MY_CODE = 'K7QX2MPD';
const CODES: Record<string, string> = {
  [OTTER]: 'HT4N9CWE',
  [FALCON]: 'RA3V8YGF',
  [KOALA]: 'J6DM5QXT',
  [STRANGER]: 'W2CE7HKN',
};

/** What `POST /friends/code` hands out, in order, on each new server. */
const NEW_CODES = ['PX5R3TGA', 'QY6T4VHC', 'CF7V5WJD'];

/** A fake of the server: this device's profile and four others. */
class FakeServer {
  players = new Map<string, FakePlayer>();
  rows: Row[] = [];
  /** Each player's replays as `GET /friends/{id}/games` lists them, and the
   *  payload `GET /friends/{id}/games/{game_id}` serves. */
  replays = new Map<string, Array<FriendGameEntry & { payload: FriendGame['payload'] }>>();
  /** Who is online now. */
  online = new Set<string>();
  sent: Sent[] = [];
  intercept?: (s: Sent) => Response | Promise<Response> | undefined;
  private newCodes = [...NEW_CODES];
  private clock = 0;

  constructor(myState: SyncStateDoc) {
    this.players.set(ME, { token: 'tok-1', code: MY_CODE, rev: 1, state: clone(myState), card: emptyCard([2, 9]) });
    const handles: Record<string, [number, number]> = {
      [OTTER]: [0, 0],
      [FALCON]: [3, 3],
      [KOALA]: [8, 9],
      [STRANGER]: [6, 5],
    };
    for (const [id, code] of Object.entries(CODES)) {
      this.players.set(id, {
        token: null,
        code,
        rev: 1,
        state: clone(myState),
        card: {
          ...emptyCard(handles[id]),
          boards: { '9x9': { rung: '18k', games: 12 }, '19x19': { rung: '20k', games: 3 } },
          games: 15,
          recent: [
            { board: '9x9', result: 'win', rung: '18k', ts: 1759363200000 },
            { board: '19x19', result: 'loss', rung: '20k', ts: 1759276800000 },
          ],
        },
      });
    }
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

  everything(): string {
    return JSON.stringify(this.sent.map((s) => [s.url, s.method, s.headers, s.rawBody]));
  }

  /** A request from `from` to this device's profile. */
  requestFrom(from: string): void {
    this.rows.push({ from, to: ME, status: 'pending', at: this.tick() });
  }

  befriend(other: string): void {
    this.rows.push({ from: other, to: ME, status: 'accepted', at: this.tick() });
  }

  between(a: string, b: string): Row[] {
    return this.rows.filter((r) => (r.from === a && r.to === b) || (r.from === b && r.to === a));
  }

  private tick(): string {
    this.clock += 1;
    return `2026-10-01T09:${String(this.clock).padStart(2, '0')}:00Z`;
  }

  private who(s: Sent): string | null {
    const token = s.headers.Authorization?.replace(/^Bearer /, '');
    for (const [id, p] of this.players) if (p.token && p.token === token) return id;
    return null;
  }

  private entry(id: string) {
    const c = this.players.get(id)!.card;
    return { player_id: id, handle: c.handle, avatar: c.avatar };
  }

  handle(s: Sent): Response {
    const me = this.who(s);
    if (!me) return json(401, { detail: 'unauthorized' });
    const mine = this.players.get(me)!;

    if (s.path === '/sync/friends/code') {
      if (s.method === 'GET') return json(200, { code: mine.code });
      if (s.method === 'POST') {
        mine.code = this.newCodes.shift()!;
        return json(201, { code: mine.code });
      }
    }
    if (s.path === '/sync/friends/requests' && s.method === 'POST') {
      const code = String(s.body?.code ?? '').replace(/[ -]/g, '').toUpperCase();
      if (!/^[23456789ACDEFGHJKMNPQRTVWXY]{8}$/.test(code)) return json(422, { detail: 'malformed' });
      if (code === mine.code) return json(422, { detail: 'own code' });
      const target = [...this.players].find(([, p]) => p.code === code)?.[0];
      if (!target) return json(404, { detail: 'no profile' });
      const rows = this.between(me, target);
      if (rows.some((r) => r.status === 'accepted')) return json(202, {});
      const theirs = rows.find((r) => r.from === target && r.status === 'pending');
      if (theirs) {
        this.rows = this.rows.filter((r) => !rows.includes(r));
        this.rows.push({ from: target, to: me, status: 'accepted', at: this.tick() });
        return json(202, {});
      }
      if (!rows.some((r) => r.from === me)) this.rows.push({ from: me, to: target, status: 'pending', at: this.tick() });
      return json(202, {});
    }
    if (s.path === '/sync/friends' && s.method === 'GET') {
      const friends = this.rows
        .filter((r) => r.status === 'accepted' && (r.from === me || r.to === me))
        .reverse()
        .map((r) => ({ ...this.entry(r.from === me ? r.to : r.from), since: r.at }));
      const incoming = this.rows
        .filter((r) => r.status === 'pending' && r.to === me)
        .reverse()
        .map((r) => ({ ...this.entry(r.from), sent_at: r.at }));
      return json(200, { friends, incoming });
    }
    let m = /^\/sync\/friends\/requests\/([^/]+)\/(accept|decline)$/.exec(s.path);
    if (m && s.method === 'POST') {
      const other = decodeURIComponent(m[1]);
      const rows = this.between(me, other);
      const pending = rows.find((r) => r.from === other && r.to === me && r.status === 'pending');
      if (m[2] === 'accept') {
        if (rows.some((r) => r.status === 'accepted')) return json(204);
        if (!pending) return json(404, { detail: 'no request' });
        this.rows = this.rows.filter((r) => !rows.includes(r));
        this.rows.push({ from: other, to: me, status: 'accepted', at: this.tick() });
        return json(204);
      }
      const declined = rows.find((r) => r.from === other && r.to === me && r.status === 'declined');
      if (declined) return json(204);
      if (!pending) return json(404, { detail: 'no request' });
      pending.status = 'declined';
      return json(204);
    }
    if (s.path === '/sync/friends/feed' && s.method === 'GET') {
      const ids = this.rows
        .filter((r) => r.status === 'accepted' && (r.from === me || r.to === me))
        .reverse()
        .map((r) => (r.from === me ? r.to : r.from));
      const friends = ids.map((id) => {
        const c = this.players.get(id)!.card;
        return { ...this.entry(id), active_recently: this.online.has(id), boards: clone(c.boards) };
      });
      const events = ids
        .flatMap((id) =>
          this.players.get(id)!.card.recent.map((r) => ({ kind: 'game', ...this.entry(id), ...r, bot: r.rung })),
        )
        .sort((a, b) => b.ts - a.ts);
      return json(200, { friends, events });
    }
    m = /^\/sync\/friends\/([^/]+)\/games(?:\/([^/]+))?$/.exec(s.path);
    if (m && s.method === 'GET') {
      const other = decodeURIComponent(m[1]);
      if (!this.between(me, other).some((r) => r.status === 'accepted')) return json(404, { detail: 'Not Found' });
      const replays = this.replays.get(other) ?? [];
      if (!m[2]) return json(200, { games: replays.map(({ payload: _p, ...entry }) => entry) });
      const found = replays.find((g) => g.id === decodeURIComponent(m![2]));
      return found ? json(200, { id: found.id, date: found.date, payload: clone(found.payload) }) : json(404, { detail: 'Not Found' });
    }
    m = /^\/sync\/friends\/([^/]+)$/.exec(s.path);
    if (m) {
      const other = decodeURIComponent(m[1]);
      const friends = this.between(me, other).some((r) => r.status === 'accepted');
      if (s.method === 'GET') {
        if (!friends) return json(404, { detail: 'not found' });
        return json(200, { player_id: other, ...clone(this.players.get(other)!.card) });
      }
      if (s.method === 'DELETE') {
        this.rows = this.rows.filter((r) => !(this.between(me, other).includes(r) && r.status === 'accepted'));
        return json(204);
      }
    }

    if (s.path === '/sync/state' && s.method === 'GET') {
      return json(200, { rev: mine.rev, state: clone(mine.state), admin: false, device_id: 'd-self' });
    }
    if (s.path === '/sync/state' && s.method === 'PUT') {
      if (s.body?.base_rev !== mine.rev) return json(409, { rev: mine.rev, state: clone(mine.state) });
      mine.rev += 1;
      mine.state = clone(s.body!.state as SyncStateDoc);
      return json(200, { rev: mine.rev });
    }
    if (s.path === '/sync/games' && s.method === 'GET') return json(200, { games: [] });
    if (s.method === 'DELETE' && s.path === '/sync/devices/current') {
      mine.token = null;
      return json(204);
    }
    return json(404, { detail: 'no route' });
  }
}

function emptyCard(handle: [number, number]): Omit<FriendCard, 'player_id'> {
  return { handle, avatar: 'nova', boards: {}, games: 0, recent: [] };
}

/* ------------------------------------------------------------------------- *
 * Fixtures.
 * ------------------------------------------------------------------------- */

async function load() {
  vi.resetModules();
  const sync = await import('../syncStore');
  const friends = await import('../friendsStore');
  const profile = await import('../profileStore');
  const replay = await import('../replayStore');
  return { sync, friends, profile, replay };
}
type Mods = Awaited<ReturnType<typeof load>>;

function loggedIn(m: Mods) {
  m.sync.useSyncStore.setState({ playerId: ME, deviceToken: 'tok-1', baseRev: 1, dirty: false });
}

/** This device logged in, with one friend (Falcon) and one request (Otter),
 *  and the section loaded. */
async function friendsDevice() {
  const m = await load();
  m.profile.useProfileStore.getState().setHandle([2, 9]);
  const server = new FakeServer(m.sync.buildLocalDoc());
  server.befriend(FALCON);
  server.requestFrom(OTTER);
  vi.stubGlobal('fetch', server.fetch);
  loggedIn(m);
  await m.friends.useFriendsStore.getState().refresh();
  return { m, server, f: () => m.friends.useFriendsStore.getState() };
}

const ids = (list: { player_id: string }[] | null) => (list ?? []).map((x) => x.player_id);

beforeEach(() => {
  installLocalStorage();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------------- *
 * Loading.
 * ------------------------------------------------------------------------- */

describe('the friend code and the lists', () => {
  it("load with this device's token: the code, the friends, the requests", async () => {
    const { server, f } = await friendsDevice();
    expect(f().code).toBe(MY_CODE);
    expect(ids(f().friends)).toEqual([FALCON]);
    expect(ids(f().incoming)).toEqual([OTTER]);
    expect(f().incoming![0]).toMatchObject({ handle: [0, 0], avatar: 'nova' });
    expect(f().loading).toBe(false);
    expect(f().loadFailed).toBe(false);
    const reads = [...server.find('GET', '/sync/friends/code'), ...server.find('GET', '/sync/friends')];
    expect(reads).toHaveLength(2);
    for (const r of reads) expect(r.headers.Authorization).toBe('Bearer tok-1');
  });

  it('not logged in: no request at all, from any action', async () => {
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    vi.stubGlobal('fetch', server.fetch);
    m.sync.useSyncStore.setState({ deviceToken: null, pendingCreate: 'new' });
    const f = m.friends.useFriendsStore.getState();
    await f.refresh();
    expect(await f.send('HT4N9CWE')).toBe('failed');
    await expect(f.newCode()).rejects.toThrow();
    await expect(f.accept(OTTER)).rejects.toThrow();
    await expect(f.decline(OTTER)).rejects.toThrow();
    await expect(f.openCard(FALCON)).rejects.toThrow();
    await expect(f.remove(FALCON)).rejects.toThrow();
    await expect(m.sync.useSyncStore.getState().friendsRequest(() => Promise.resolve(1))).rejects.toThrow();
    expect(server.sent).toEqual([]);
    expect(m.friends.useFriendsStore.getState().loading).toBe(false);
    expect(m.friends.useFriendsStore.getState().loadFailed).toBe(false);
    expect(m.sync.useSyncStore.getState().pendingCreate).toBe('new');
  });

  it('loading shows while the lists are on their way', async () => {
    const { server, f } = await friendsDevice();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    server.intercept = (s) => (s.path === '/sync/friends' ? held.then(() => server.handle(s)) : undefined);
    const p = f().refresh();
    expect(f().loading).toBe(true);
    release();
    await p;
    expect(f().loading).toBe(false);
  });

  it('a failed load is flagged and keeps what it had; the code still lands when only the list fails', async () => {
    const { server, f } = await friendsDevice();
    server.intercept = (s) => (s.path === '/sync/friends' ? json(503, { detail: 'down' }) : undefined);
    server.players.get(ME)!.code = 'CF7V5WJD';
    await f().refresh();
    expect(f().loadFailed).toBe(true);
    expect(ids(f().friends)).toEqual([FALCON]);
    expect(ids(f().incoming)).toEqual([OTTER]);
    expect(f().code).toBe('CF7V5WJD');

    // And the other way round: the code fails, the lists land.
    server.intercept = (s) => (s.path === '/sync/friends/code' ? json(503, { detail: 'down' }) : undefined);
    server.befriend(KOALA);
    await f().refresh();
    expect(f().loadFailed).toBe(true);
    expect(ids(f().friends)).toEqual([KOALA, FALCON]);
    expect(f().code).toBe('CF7V5WJD');

    server.intercept = undefined;
    await f().refresh();
    expect(f().loadFailed).toBe(false);
  });

  it('a code reply without a code leaves the code as it was', async () => {
    const { server, f } = await friendsDevice();
    server.intercept = (s) => (s.path === '/sync/friends/code' ? json(200, { code: 7 }) : undefined);
    await f().refresh();
    expect(f().code).toBe(MY_CODE);
  });

  it('a list reply without arrays reads as empty lists', async () => {
    const { server, f } = await friendsDevice();
    server.intercept = (s) => (s.path === '/sync/friends' ? json(200, { friends: 'none' }) : undefined);
    await f().refresh();
    expect(f().friends).toEqual([]);
    expect(f().incoming).toEqual([]);
  });

  it('an older reply never lands over a newer one', async () => {
    const { server, f } = await friendsDevice();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let calls = 0;
    server.intercept = (s) => {
      if (s.path !== '/sync/friends' || ++calls > 1) return undefined;
      const stale = server.handle(s); // the list as it was: Falcon only
      return held.then(() => stale);
    };
    const slow = f().refresh();
    server.befriend(KOALA);
    await f().refresh();
    expect(ids(f().friends)).toEqual([KOALA, FALCON]);
    release();
    await slow;
    expect(ids(f().friends)).toEqual([KOALA, FALCON]);
    expect(f().loading).toBe(false);
  });
});

/* ------------------------------------------------------------------------- *
 * Add a friend.
 * ------------------------------------------------------------------------- */

describe('Add a friend', () => {
  it('sends the code normalised: spaces and hyphens removed, uppercased', async () => {
    const { server, f } = await friendsDevice();
    for (const typed of ['ra3v8ygf', 'RA3V 8YGF', 'ra3v-8ygf', ' Ra3V - 8yGf ', 'r a 3 v 8 y g f']) {
      server.sent = [];
      expect(await f().send(typed)).toBe('sent');
      const sends = server.find('POST', '/sync/friends/requests');
      expect(sends).toHaveLength(1);
      expect(sends[0].rawBody).toBe(JSON.stringify({ code: 'RA3V8YGF' }));
      expect(sends[0].headers.Authorization).toBe('Bearer tok-1');
      expect(sends[0].url).not.toMatch(/RA3V|ra3v/i);
    }
  });

  it("a code that isn't one is caught here, with no request", async () => {
    const { server, f } = await friendsDevice();
    server.sent = [];
    for (const typed of ['RA3V8YG', 'RA3V8YGFF', 'RA3V8YG0', 'RA3V8YG1', 'RA3V8YGB', 'RA3V_8YGF', 'RA3V\t8YGF', 'RA3V.8YGF', '', '   ', '-']) {
      expect(await f().send(typed), JSON.stringify(typed)).toBe('not-a-code');
    }
    expect(server.sent).toEqual([]);
  });

  it('202: Request sent, and the section refreshes', async () => {
    const { server, f } = await friendsDevice();
    const lists = server.count('GET', '/sync/friends');
    expect(await f().send(CODES[KOALA])).toBe('sent');
    expect(server.count('GET', '/sync/friends')).toBe(lists + 1);
    expect(server.count('GET', '/sync/friends/code')).toBe(lists + 1);
    // A request this device sent is not listed anywhere.
    expect(ids(f().friends)).toEqual([FALCON]);
    expect(ids(f().incoming)).toEqual([OTTER]);
  });

  it('202 to a player who already asked: friends at once, shown by the refresh', async () => {
    const { f } = await friendsDevice();
    expect(await f().send(CODES[OTTER])).toBe('sent');
    expect(ids(f().friends)).toEqual([OTTER, FALCON]);
    expect(f().incoming).toEqual([]);
  });

  it('404: No player has that code', async () => {
    const { server, f } = await friendsDevice();
    expect(await f().send('XY23 4567')).toBe('not-found');
    expect(server.find('POST', '/sync/friends/requests')[0].body).toEqual({ code: 'XY234567' });
  });

  it("422 for this device's own code: That's your own code", async () => {
    const { server, f } = await friendsDevice();
    expect(await f().send(MY_CODE.toLowerCase())).toBe('own-code');
    expect(server.count('POST', '/sync/friends/requests')).toBe(1);
  });

  it("422 for a code the server finds malformed although this field didn't: own code by the contract", async () => {
    const { server, f } = await friendsDevice();
    server.intercept = (s) => (s.path === '/sync/friends/requests' ? json(422, { detail: 'malformed' }) : undefined);
    expect(await f().send(CODES[KOALA])).toBe('own-code');
  });

  it('429: the try-later line; any other failure: the connect line', async () => {
    const { server, f } = await friendsDevice();
    server.intercept = (s) => (s.path === '/sync/friends/requests' ? json(429, { detail: 'slow down' }) : undefined);
    expect(await f().send(CODES[KOALA])).toBe('too-many');
    server.intercept = (s) => (s.path === '/sync/friends/requests' ? json(503, { detail: 'down' }) : undefined);
    expect(await f().send(CODES[KOALA])).toBe('failed');
  });

  it('every answer refreshes the section', async () => {
    const { server, f } = await friendsDevice();
    for (const status of [404, 422, 429, 503]) {
      server.intercept = (s) => (s.path === '/sync/friends/requests' ? json(status, { detail: 'x' }) : undefined);
      const before = server.count('GET', '/sync/friends');
      await f().send(CODES[KOALA]);
      expect(server.count('GET', '/sync/friends'), String(status)).toBe(before + 1);
    }
  });
});

/* ------------------------------------------------------------------------- *
 * Requests, New code, the card, Remove friend.
 * ------------------------------------------------------------------------- */

describe('requests', () => {
  it('Accept: the request becomes a friend, after a refresh', async () => {
    const { server, f } = await friendsDevice();
    await f().accept(OTTER);
    const sent = server.find('POST', `/sync/friends/requests/${OTTER}/accept`);
    expect(sent).toHaveLength(1);
    expect(sent[0].rawBody).toBeNull();
    expect(sent[0].headers.Authorization).toBe('Bearer tok-1');
    expect(ids(f().friends)).toEqual([OTTER, FALCON]);
    expect(f().incoming).toEqual([]);
  });

  it('Decline: the request is gone, and the sender is not a friend', async () => {
    const { server, f } = await friendsDevice();
    await f().decline(OTTER);
    expect(server.count('POST', `/sync/friends/requests/${OTTER}/decline`)).toBe(1);
    expect(f().incoming).toEqual([]);
    expect(ids(f().friends)).toEqual([FALCON]);
    expect(server.between(ME, OTTER).map((r) => r.status)).toEqual(['declined']);
  });

  it('a request that is gone: the 404 reaches the caller and the list catches up', async () => {
    const { server, f } = await friendsDevice();
    server.rows = server.rows.filter((r) => r.from !== OTTER);
    await expect(f().accept(OTTER)).rejects.toMatchObject({ status: 404 });
    expect(f().incoming).toEqual([]);
    server.requestFrom(KOALA);
    await f().refresh();
    server.rows = server.rows.filter((r) => r.from !== KOALA);
    await expect(f().decline(KOALA)).rejects.toMatchObject({ status: 404 });
    expect(f().incoming).toEqual([]);
  });
});

describe('New code', () => {
  it('replaces the code: the new one shows, the old one finds nobody', async () => {
    const { server, f } = await friendsDevice();
    const lists = server.count('GET', '/sync/friends');
    await f().newCode();
    expect(server.count('POST', '/sync/friends/code')).toBe(1);
    expect(f().code).toBe('PX5R3TGA');
    expect(server.count('GET', '/sync/friends')).toBe(lists + 1);
    // Friends and requests stay.
    expect(ids(f().friends)).toEqual([FALCON]);
    expect(ids(f().incoming)).toEqual([OTTER]);
  });

  it("shows the POST's code even when the refresh after it fails", async () => {
    const { server, f } = await friendsDevice();
    server.intercept = (s) => (s.method === 'GET' && s.path.startsWith('/sync/friends') ? json(503, {}) : undefined);
    await f().newCode();
    expect(f().code).toBe('PX5R3TGA');
  });

  it('a failure leaves the code as it was', async () => {
    const { server, f } = await friendsDevice();
    server.intercept = (s) => (s.method === 'POST' && s.path === '/sync/friends/code' ? json(503, {}) : undefined);
    await expect(f().newCode()).rejects.toMatchObject({ status: 503 });
    expect(f().code).toBe(MY_CODE);
  });
});

describe("a friend's card and Remove friend", () => {
  it('opens with the checked values the server sends', async () => {
    const { server, f } = await friendsDevice();
    await f().openCard(FALCON);
    expect(server.count('GET', `/sync/friends/${FALCON}`)).toBe(1);
    expect(f().cardFor).toBe(FALCON);
    expect(f().card).toMatchObject({
      player_id: FALCON,
      handle: [3, 3],
      avatar: 'nova',
      games: 15,
      boards: { '9x9': { rung: '18k', games: 12 } },
    });
    expect(f().card!.recent).toHaveLength(2);
    f().closeCard();
    expect(f().cardFor).toBeNull();
    expect(f().card).toBeNull();
  });

  it('is empty while it is on its way, and a card for someone else never lands', async () => {
    const { server, f } = await friendsDevice();
    server.befriend(KOALA);
    await f().refresh();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    server.intercept = (s) => (s.path === `/sync/friends/${FALCON}` ? held.then(() => server.handle(s)) : undefined);
    const slow = f().openCard(FALCON);
    expect(f().cardFor).toBe(FALCON);
    expect(f().card).toBeNull();
    await f().openCard(KOALA);
    release();
    await slow;
    expect(f().cardFor).toBe(KOALA);
    expect(f().card!.player_id).toBe(KOALA);
  });

  it("opening another card never shows the last one's while it loads", async () => {
    const { server, f } = await friendsDevice();
    server.befriend(KOALA);
    await f().refresh();
    await f().openCard(FALCON);
    expect(f().card!.player_id).toBe(FALCON);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    server.intercept = (s) => (s.path === `/sync/friends/${KOALA}` ? held.then(() => server.handle(s)) : undefined);
    const slow = f().openCard(KOALA);
    expect(f().cardFor).toBe(KOALA);
    expect(f().card).toBeNull();
    release();
    await slow;
    expect(f().card!.player_id).toBe(KOALA);
  });

  it('a card that fails after another was opened leaves the other one open', async () => {
    const { server, f } = await friendsDevice();
    server.befriend(KOALA);
    await f().refresh();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    server.intercept = (s) => (s.path === `/sync/friends/${FALCON}` ? held.then(() => json(503, {})) : undefined);
    const slow = f().openCard(FALCON).catch(() => 'failed');
    await f().openCard(KOALA);
    release();
    expect(await slow).toBe('failed');
    expect(f().cardFor).toBe(KOALA);
    expect(f().card!.player_id).toBe(KOALA);
  });

  it('a 404 (no longer friends) closes it and the list catches up', async () => {
    const { server, f } = await friendsDevice();
    server.rows = server.rows.filter((r) => r.from !== FALCON);
    await expect(f().openCard(FALCON)).rejects.toMatchObject({ status: 404 });
    expect(f().cardFor).toBeNull();
    expect(f().card).toBeNull();
    expect(f().friends).toEqual([]);
  });

  it('a failure that is not a 404 closes it and leaves the list alone', async () => {
    const { server, f } = await friendsDevice();
    server.intercept = (s) => (s.path === `/sync/friends/${FALCON}` ? json(503, {}) : undefined);
    const lists = server.count('GET', '/sync/friends');
    await expect(f().openCard(FALCON)).rejects.toMatchObject({ status: 503 });
    expect(f().cardFor).toBeNull();
    expect(server.count('GET', '/sync/friends')).toBe(lists);
  });

  it('a refresh that no longer lists the friend closes their card', async () => {
    const { server, f } = await friendsDevice();
    await f().openCard(FALCON);
    server.rows = server.rows.filter((r) => r.from !== FALCON);
    await f().refresh();
    expect(f().cardFor).toBeNull();
    expect(f().card).toBeNull();
    // While the friend is still listed, the card stays.
    server.befriend(KOALA);
    await f().refresh();
    await f().openCard(KOALA);
    await f().refresh();
    expect(f().cardFor).toBe(KOALA);
  });

  it('Remove friend: DELETE, the card closes, the friend is gone from the list', async () => {
    const { server, f } = await friendsDevice();
    await f().openCard(FALCON);
    await f().remove(FALCON);
    const sent = server.find('DELETE', `/sync/friends/${FALCON}`);
    expect(sent).toHaveLength(1);
    expect(sent[0].headers.Authorization).toBe('Bearer tok-1');
    expect(f().cardFor).toBeNull();
    expect(f().card).toBeNull();
    expect(f().friends).toEqual([]);
  });

  it('Remove friend closes the card even when the refresh after it fails', async () => {
    const { server, f } = await friendsDevice();
    await f().openCard(FALCON);
    server.intercept = (s) => (s.method === 'GET' && s.path === '/sync/friends' ? json(503, {}) : undefined);
    await f().remove(FALCON);
    expect(f().loadFailed).toBe(true);
    expect(f().cardFor).toBeNull();
    expect(f().card).toBeNull();
  });

  it("removing one friend leaves another's open card alone", async () => {
    const { server, f } = await friendsDevice();
    server.befriend(KOALA);
    await f().refresh();
    await f().openCard(KOALA);
    await f().remove(FALCON);
    expect(f().cardFor).toBe(KOALA);
    expect(ids(f().friends)).toEqual([KOALA]);
  });
});

/* ------------------------------------------------------------------------- *
 * In memory only; dropped on a log out and on a 401.
 * ------------------------------------------------------------------------- */

/** Every value in storage, as one string. */
function storage(): string {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    out.push(k, localStorage.getItem(k) ?? '');
  }
  return out.join('\n');
}

function expectDropped(m: Mods) {
  const f = m.friends.useFriendsStore.getState();
  expect(f.code).toBeNull();
  expect(f.friends).toBeNull();
  expect(f.incoming).toBeNull();
  expect(f.feed).toBeNull();
  expect(f.card).toBeNull();
  expect(f.cardFor).toBeNull();
  expect(f.cardGames).toBeNull();
  expect(f.cardGamesFailed).toBe(false);
  expect(f.loading).toBe(false);
  expect(f.loadFailed).toBe(false);
}

describe('friends data: in memory only, dropped on a log out and on a 401', () => {
  it('is never written to storage, through every action', async () => {
    const { m, f } = await friendsDevice();
    await f().send(CODES[KOALA]);
    await f().accept(OTTER);
    await f().openCard(FALCON);
    await f().newCode();
    await f().remove(OTTER);
    await m.sync.useSyncStore.getState().sync();
    expect(f().code).toBe('PX5R3TGA');
    const all = storage();
    expect(all).not.toBe('');
    for (const v of [MY_CODE, 'PX5R3TGA', ...Object.values(CODES), OTTER, FALCON, KOALA, 'friend']) {
      expect(all, v).not.toContain(v);
    }
    // The only way in from storage is the token: a relaunch has no friends data.
    const m2 = await load();
    m2.sync.useSyncStore.getState().loadFromStorage();
    expect(m2.sync.useSyncStore.getState().deviceToken).toBe('tok-1');
    expectDropped(m2);
  });

  it('is dropped on a log out', async () => {
    const { m, server, f } = await friendsDevice();
    await f().openCard(FALCON);
    await m.sync.useSyncStore.getState().logOut();
    expect(m.sync.useSyncStore.getState().firstRun).toBe(true);
    expectDropped(m);
    expect(server.count('DELETE', '/sync/devices/current')).toBe(1);
  });

  it('is kept when a log out is refused', async () => {
    const { m, server, f } = await friendsDevice();
    server.intercept = (s) => (s.method === 'DELETE' && s.path === '/sync/devices/current' ? json(503) : undefined);
    await expect(m.sync.useSyncStore.getState().logOut()).rejects.toBeTruthy();
    expect(f().code).toBe(MY_CODE);
    expect(ids(f().friends)).toEqual([FALCON]);
  });

  it('a reply on its way during a log out never lands', async () => {
    const { m, server, f } = await friendsDevice();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    server.intercept = (s) =>
      s.method === 'GET' && s.path.startsWith('/sync/friends') ? held.then(() => server.handle(s)) : undefined;
    const slowList = f().refresh();
    const slowCard = f().openCard(FALCON).catch(() => undefined);
    // The server still knows the token while it answers the held replies.
    const out = m.sync.useSyncStore.getState().logOut();
    await out;
    server.players.get(ME)!.token = 'tok-1';
    release();
    await slowList;
    await slowCard;
    expectDropped(m);
  });

  it('an action on its way during a log out neither lands nor refreshes', async () => {
    const { m, server, f } = await friendsDevice();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    server.intercept = (s) =>
      s.method === 'POST' && s.path === '/sync/friends/code' ? held.then(() => server.handle(s)) : undefined;
    const slow = f().newCode();
    await m.sync.useSyncStore.getState().logOut();
    server.players.get(ME)!.token = 'tok-1';
    server.sent = [];
    release();
    await slow;
    expectDropped(m);
    expect(server.sent.filter((s) => s.path.startsWith('/sync/friends') && s.method === 'GET')).toEqual([]);
  });

  it('is dropped on a 401 in a sync pass', async () => {
    const { m, server } = await friendsDevice();
    server.players.get(ME)!.token = null; // logged out elsewhere
    await m.sync.useSyncStore.getState().sync();
    expect(m.sync.useSyncStore.getState().firstRunNotice).toBe('logged-out');
    expectDropped(m);
  });

  it('a 401 from a friends route takes the 401 path and drops it, from every action', async () => {
    const actions = {
      refresh: (f: Mods['friends']['useFriendsStore']) => f.getState().refresh(),
      send: (f: Mods['friends']['useFriendsStore']) => f.getState().send(CODES[KOALA]),
      newCode: (f: Mods['friends']['useFriendsStore']) => f.getState().newCode(),
      accept: (f: Mods['friends']['useFriendsStore']) => f.getState().accept(OTTER),
      decline: (f: Mods['friends']['useFriendsStore']) => f.getState().decline(OTTER),
      openCard: (f: Mods['friends']['useFriendsStore']) => f.getState().openCard(FALCON),
      remove: (f: Mods['friends']['useFriendsStore']) => f.getState().remove(FALCON),
    };
    for (const [name, run] of Object.entries(actions)) {
      installLocalStorage();
      const { m, server } = await friendsDevice();
      server.players.get(ME)!.token = null;
      server.sent = [];
      await run(m.friends.useFriendsStore).catch(() => undefined);
      const s = m.sync.useSyncStore.getState();
      expect(s.deviceToken, name).toBeNull();
      expect(s.firstRun, name).toBe(true);
      expect(s.firstRunNotice, name).toBe('logged-out');
      expectDropped(m);
      // Nothing more is asked once the device is signed out: no refresh
      // after the action (a refresh is itself three reads at once: the
      // code, the lists and the feed).
      expect(server.sent.filter((x) => x.path.startsWith('/sync/friends')).length, name).toBe(name === 'refresh' ? 3 : 1);
    }
  });

  it('a 401 sends: the connect line, and the device is signed out', async () => {
    const { m, server, f } = await friendsDevice();
    server.players.get(ME)!.token = null;
    expect(await f().send(CODES[KOALA])).toBe('failed');
    expect(m.sync.useSyncStore.getState().firstRunNotice).toBe('logged-out');
  });

  it('a 403 or a 404 from a friends route never signs the device out', async () => {
    const { m, server, f } = await friendsDevice();
    server.intercept = (s) => (s.path === '/sync/friends' ? json(403, {}) : undefined);
    await f().refresh();
    await expect(f().openCard(STRANGER)).rejects.toMatchObject({ status: 404 });
    expect(m.sync.useSyncStore.getState().deviceToken).toBe('tok-1');
    expect(m.sync.useSyncStore.getState().firstRun).toBe(false);
    expect(f().code).toBe(MY_CODE);
  });

  it('a log in to another profile starts with nothing', async () => {
    const { m, f } = await friendsDevice();
    m.sync.useSyncStore.setState({ deviceToken: 'tok-other', playerId: KOALA });
    expectDropped(m);
    expect(f().friends).toBeNull();
  });
});

describe('the routes', () => {
  it("a player id goes into the path encoded, whatever it holds", async () => {
    const { server, f } = await friendsDevice();
    const odd = 'a b/c?d';
    await f().accept(odd).catch(() => undefined);
    await f().decline(odd).catch(() => undefined);
    await f().openCard(odd).catch(() => undefined);
    await f().remove(odd);
    const enc = encodeURIComponent(odd);
    expect(server.sent.filter((s) => s.url.includes(enc)).map((s) => `${s.method} ${s.path}`)).toEqual([
      `POST /sync/friends/requests/${enc}/accept`,
      `POST /sync/friends/requests/${enc}/decline`,
      `GET /sync/friends/${enc}`,
      `DELETE /sync/friends/${enc}`,
    ]);
    expect(server.sent.some((s) => s.url.includes(odd))).toBe(false);
  });
});

describe('nothing typed reaches another player', () => {
  it('the typed code goes only into the body of the one send, normalised', async () => {
    const { server, f } = await friendsDevice();
    server.sent = [];
    await f().send(' ht4n-9cwe ');
    const carrying = server.sent.filter((s) => JSON.stringify([s.url, s.headers, s.rawBody]).toUpperCase().includes('HT4N'));
    expect(carrying.map((s) => [s.method, s.path, s.rawBody])).toEqual([
      ['POST', '/sync/friends/requests', '{"code":"HT4N9CWE"}'],
    ]);
    expect(server.everything()).not.toContain('ht4n');
  });
});

/* ------------------------------------------------------------------------- *
 * Revision 5: the feed, the loads after a sync pass and while watched, and a
 * friend's replays.
 * ------------------------------------------------------------------------- */

/** A replay as the server serves a friend's: the SGF the app writes. */
const APP_SGF = '(;GM[1]FF[4]CA[UTF-8]SZ[9]KM[6.5]RU[Japanese]RE[B+5.5];B[ee];W[cc];B[gc];W[])';

function falconReplays(server: FakeServer) {
  server.replays.set(FALCON, [
    {
      id: 'a1b2c3d4',
      date: '2026-10-01T16:00:00.000Z',
      board: '9x9',
      outcome: 'win',
      opponent: '12k',
      payload: {
        sgf: APP_SGF,
        result: 'Black wins by 5.5',
        playerColor: 'black',
        opponentRank: '12k',
        moveCount: 4,
        isRanked: true,
        scoreHistory: [
          { move: 0, lead: -6.5 },
          { move: 1, lead: 2 },
        ],
        deadStones: [{ row: 2, col: 2, color: 2 }],
      },
    },
    { id: 'e5f6a7b8', date: '2026-09-30T16:00:00.000Z', board: '19x19', outcome: 'loss', opponent: '18k', payload: { sgf: APP_SGF } },
  ]);
}

describe('revision 5: the feed', () => {
  it('loads with the code and the lists: every friend, and what they did', async () => {
    const { server, f } = await friendsDevice();
    server.online.add(FALCON);
    await f().refresh();
    expect(f().feed!.friends).toEqual([
      expect.objectContaining({ player_id: FALCON, handle: [3, 3], active_recently: true }),
    ]);
    expect(f().feed!.events.map((e) => [e.kind, e.player_id, e.ts])).toEqual([
      ['game', FALCON, 1759363200000],
      ['game', FALCON, 1759276800000],
    ]);
    const feeds = server.find('GET', '/sync/friends/feed');
    expect(feeds.length).toBeGreaterThanOrEqual(2);
    for (const r of feeds) expect(r.headers.Authorization).toBe('Bearer tok-1');
  });

  it('a feed that fails is flagged and keeps the feed it had; the lists still land', async () => {
    const { server, f } = await friendsDevice();
    const before = f().feed;
    expect(before).not.toBeNull();
    server.intercept = (s) => (s.path === '/sync/friends/feed' ? json(429, { detail: 'slow down' }) : undefined);
    server.befriend(KOALA);
    await f().refresh();
    expect(f().loadFailed).toBe(true);
    expect(f().feed).toBe(before);
    expect(ids(f().friends)).toEqual([KOALA, FALCON]);
    server.intercept = undefined;
    await f().refresh();
    expect(f().loadFailed).toBe(false);
    expect(f().feed!.friends.map((x) => x.player_id)).toEqual([KOALA, FALCON]);
  });

  it('an older feed never lands over a newer one', async () => {
    const { server, f } = await friendsDevice();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let calls = 0;
    server.intercept = (s) => {
      if (s.path !== '/sync/friends/feed' || ++calls > 1) return undefined;
      const stale = server.handle(s);
      return held.then(() => stale);
    };
    const slow = f().refresh();
    server.befriend(KOALA);
    await f().refresh();
    release();
    await slow;
    expect(f().feed!.friends.map((x) => x.player_id)).toEqual([KOALA, FALCON]);
  });

  it('refreshList asks for the lists only', async () => {
    const { server, f } = await friendsDevice();
    server.sent = [];
    server.requestFrom(KOALA);
    await f().refreshList();
    expect(server.sent.map((x) => `${x.method} ${x.path}`)).toEqual(['GET /sync/friends']);
    expect(ids(f().incoming)).toEqual([KOALA, OTTER]);
  });

  it('not logged in: no feed, no replays, no game, and a watch asks nothing', async () => {
    vi.useFakeTimers();
    try {
      const m = await load();
      const server = new FakeServer(m.sync.buildLocalDoc());
      vi.stubGlobal('fetch', server.fetch);
      m.sync.useSyncStore.setState({ deviceToken: null, pendingCreate: 'new' });
      const f = m.friends.useFriendsStore.getState();
      await f.refreshList();
      await expect(f.openGame(FALCON, 'a1b2c3d4')).rejects.toThrow();
      const stop = m.friends.watchFriends(['code', 'list', 'feed']);
      await vi.advanceTimersByTimeAsync(5 * 30_000);
      stop();
      expect(server.sent).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('revision 5: the lists load after every sync pass that ends logged in', () => {
  async function launched() {
    const m = await load();
    m.profile.useProfileStore.getState().setHandle([2, 9]);
    const server = new FakeServer(m.sync.buildLocalDoc());
    server.requestFrom(OTTER);
    vi.stubGlobal('fetch', server.fetch);
    loggedIn(m);
    return { m, server, f: () => m.friends.useFriendsStore.getState() };
  }

  it('a pass that ends logged in loads the lists, so the requests received are known', async () => {
    const { m, server, f } = await launched();
    expect(f().incoming).toBeNull();
    await m.sync.useSyncStore.getState().sync();
    await vi.waitFor(() => expect(ids(f().incoming)).toEqual([OTTER]));
    expect(server.count('GET', '/sync/friends')).toBe(1);
    // The lists only: the code and the feed wait for the Friends section.
    expect(server.count('GET', '/sync/friends/code')).toBe(0);
    expect(server.count('GET', '/sync/friends/feed')).toBe(0);
    // Every later pass catches up again.
    server.requestFrom(KOALA);
    await m.sync.useSyncStore.getState().sync();
    await vi.waitFor(() => expect(ids(f().incoming)).toEqual([KOALA, OTTER]));
    expect(server.count('GET', '/sync/friends')).toBe(2);
  });

  it('a pass that ends logged out asks nothing', async () => {
    const { m, server } = await launched();
    server.players.get(ME)!.token = null; // logged out elsewhere: the pass meets a 401
    await m.sync.useSyncStore.getState().sync();
    await new Promise((r) => setTimeout(r, 0));
    expect(m.sync.useSyncStore.getState().deviceToken).toBeNull();
    expect(server.sent.filter((x) => x.path.startsWith('/sync/friends'))).toEqual([]);
    expectDropped(m);
  });

  it('a device waiting for its profile asks nothing after a failed create', async () => {
    const m = await load();
    const server = new FakeServer(m.sync.buildLocalDoc());
    vi.stubGlobal('fetch', server.fetch);
    m.sync.useSyncStore.setState({ deviceToken: null, pendingCreate: 'new' });
    await m.sync.useSyncStore.getState().sync();
    await new Promise((r) => setTimeout(r, 0));
    expect(server.count('POST', '/sync/players')).toBe(1);
    expect(server.sent.filter((x) => x.path.startsWith('/sync/friends'))).toEqual([]);
  });
});

describe('revision 5: watching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes what is watched every 30 seconds, and stops when nothing is', async () => {
    const { m, server } = await friendsDevice();
    const reads = () => ['/sync/friends/code', '/sync/friends', '/sync/friends/feed'].map((p) => server.count('GET', p));
    const start = reads();
    const stopBadge = m.friends.watchFriends(['list']);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reads()).toEqual([start[0], start[1] + 1, start[2]]);
    const stopSection = m.friends.watchFriends(['code', 'list', 'feed']);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reads()).toEqual([start[0] + 1, start[1] + 2, start[2] + 1]);
    stopSection();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reads()).toEqual([start[0] + 1, start[1] + 3, start[2] + 1]);
    stopBadge();
    await vi.advanceTimersByTimeAsync(10 * 30_000);
    expect(reads()).toEqual([start[0] + 1, start[1] + 3, start[2] + 1]);
  });

  it('a refresh shows a friend who accepted, and a request that arrived', async () => {
    const { m, server, f } = await friendsDevice();
    const stop = m.friends.watchFriends(['code', 'list', 'feed']);
    server.befriend(KOALA);
    server.requestFrom(STRANGER);
    await vi.advanceTimersByTimeAsync(30_000);
    stop();
    expect(ids(f().friends)).toEqual([KOALA, FALCON]);
    expect(ids(f().incoming)).toEqual([STRANGER, OTTER]);
  });

  it('stops asking once the device logs out, while still watched', async () => {
    const { m, server } = await friendsDevice();
    const stop = m.friends.watchFriends(['code', 'list', 'feed']);
    m.sync.useSyncStore.setState({ deviceToken: null });
    server.sent = [];
    await vi.advanceTimersByTimeAsync(3 * 30_000);
    stop();
    expect(server.sent).toEqual([]);
  });
});

describe("revision 5: a friend's replays", () => {
  it('load once the card has come, newest first', async () => {
    const { server, f } = await friendsDevice();
    falconReplays(server);
    await f().openCard(FALCON);
    await vi.waitFor(() => expect(f().cardGames).not.toBeNull());
    expect(f().cardGames!.map((g) => g.id)).toEqual(['a1b2c3d4', 'e5f6a7b8']);
    expect(f().cardGamesFailed).toBe(false);
    expect(server.find('GET', `/sync/friends/${FALCON}/games`)[0].headers.Authorization).toBe('Bearer tok-1');
  });

  it('a friend with no replays has an empty list; a failure is flagged and the card stays', async () => {
    const { server, f } = await friendsDevice();
    await f().openCard(FALCON);
    await vi.waitFor(() => expect(f().cardGames).toEqual([]));
    server.intercept = (s) => (s.path.endsWith('/games') ? json(503, {}) : undefined);
    f().closeCard();
    await f().openCard(FALCON);
    await vi.waitFor(() => expect(f().cardGamesFailed).toBe(true));
    expect(f().cardGames).toBeNull();
    expect(f().cardFor).toBe(FALCON);
    expect(f().card!.player_id).toBe(FALCON);
  });

  it("another card opened meanwhile never shows the last one's replays", async () => {
    const { server, f } = await friendsDevice();
    falconReplays(server);
    server.befriend(KOALA);
    await f().refresh();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    server.intercept = (s) => (s.path === `/sync/friends/${FALCON}/games` ? held.then(() => server.handle(s)) : undefined);
    await f().openCard(FALCON);
    await f().openCard(KOALA);
    await vi.waitFor(() => expect(f().cardGames).toEqual([]));
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(f().cardFor).toBe(KOALA);
    expect(f().cardGames).toEqual([]);
  });

  it('a friend removed while their card is open: the replays answer 404 and the card closes', async () => {
    const { server, f } = await friendsDevice();
    falconReplays(server);
    server.intercept = (s) => {
      if (s.path !== `/sync/friends/${FALCON}/games`) return undefined;
      server.rows = server.rows.filter((r) => r.from !== FALCON); // removed from the other side
      return undefined;
    };
    await f().openCard(FALCON);
    await vi.waitFor(() => expect(f().cardFor).toBeNull());
    expect(f().card).toBeNull();
    expect(f().friends).toEqual([]);
  });

  it("opens one in the replay viewer with the Library's meta and no library id", async () => {
    const { m, server, f } = await friendsDevice();
    falconReplays(server);
    await f().openCard(FALCON);
    await f().openGame(FALCON, 'a1b2c3d4');
    const r = m.replay.useReplayStore.getState();
    expect(r.active).toBe(true);
    expect(r.sgf).toBe(APP_SGF);
    expect(r.boardSize).toBe(9);
    expect(r.totalMoves).toBe(4);
    expect(r.gameResult).toBe('Black wins by 5.5');
    expect(r.opponentRank).toBe('12k');
    expect(r.playerColor).toBe('black');
    expect(r.scoreHistory).toEqual([
      { move: 0, lead: -6.5 },
      { move: 1, lead: 2 },
    ]);
    expect(r.libraryId).toBeNull();
    expect(r.sharedId).toBeNull();
    // Nothing of it reaches this device's Library or storage.
    expect(storage()).not.toContain('a1b2c3d4');
  });

  it('a game that is gone: the 404 reaches the caller, the replays reload, nothing opens', async () => {
    const { m, server, f } = await friendsDevice();
    falconReplays(server);
    await f().openCard(FALCON);
    await vi.waitFor(() => expect(f().cardGames).toHaveLength(2));
    server.replays.set(FALCON, server.replays.get(FALCON)!.slice(1)); // deleted on their device
    await expect(f().openGame(FALCON, 'a1b2c3d4')).rejects.toMatchObject({ status: 404 });
    expect(f().cardFor).toBe(FALCON);
    expect(f().cardGames!.map((g) => g.id)).toEqual(['e5f6a7b8']);
    expect(m.replay.useReplayStore.getState().active).toBe(false);
  });

  it('a friend who is gone: the 404 reaches the caller and the card closes', async () => {
    const { m, server, f } = await friendsDevice();
    falconReplays(server);
    await f().openCard(FALCON);
    server.rows = server.rows.filter((r) => r.from !== FALCON);
    await expect(f().openGame(FALCON, 'a1b2c3d4')).rejects.toMatchObject({ status: 404 });
    expect(f().cardFor).toBeNull();
    expect(f().friends).toEqual([]);
    expect(m.replay.useReplayStore.getState().active).toBe(false);
  });

  it('a replay the viewer cannot take opens nothing', async () => {
    const { m, server, f } = await friendsDevice();
    for (const payload of [
      { sgf: APP_SGF.replace(';B[ee]', ';B[ee]C[INJ]') },
      { sgf: '(;GM[1]FF[4]CA[UTF-8]SZ[9]PB[INJ]RU[Japanese];B[ee])' },
      { sgf: 7 },
      {},
    ]) {
      server.replays.set(FALCON, [
        { id: 'x1', date: '2026-10-01T16:00:00.000Z', board: '9x9', outcome: 'win', opponent: null, payload: payload as never },
      ]);
      await expect(f().openGame(FALCON, 'x1')).rejects.toBeInstanceOf(m.friends.FriendReplayUnreadable);
    }
    expect(m.replay.useReplayStore.getState().active).toBe(false);
  });

  it('logged out while a game is on its way: nothing opens', async () => {
    const { m, server, f } = await friendsDevice();
    falconReplays(server);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    server.intercept = (s) =>
      s.path === `/sync/friends/${FALCON}/games/a1b2c3d4` ? held.then(() => server.handle(s)) : undefined;
    const slow = f().openGame(FALCON, 'a1b2c3d4');
    await m.sync.useSyncStore.getState().logOut();
    server.players.get(ME)!.token = 'tok-1';
    release();
    await slow;
    expect(m.replay.useReplayStore.getState().active).toBe(false);
    expectDropped(m);
  });

  it('ids go into the path encoded', async () => {
    const { server, f } = await friendsDevice();
    const odd = 'a b/c?d';
    await f().openGame(odd, odd).catch(() => undefined);
    const enc = encodeURIComponent(odd);
    expect(server.sent.filter((s) => s.url.includes(enc)).map((s) => `${s.method} ${s.path}`)).toEqual([
      `GET /sync/friends/${enc}/games/${enc}`,
    ]);
    expect(server.sent.some((s) => s.url.includes(odd))).toBe(false);
  });
});
