import { test, expect, type Page } from '@playwright/test';

/**
 * The Profile page's Friends section (feature 32, revisions 4 and 5),
 * driven through the real UI against a fake of the `/api/sync` contract
 * answered by route interception (no backend runs): shown only on a
 * logged-in device, after Devices and before Admin; the friend code and New
 * code with its confirm; each answer to Add a friend; Accept and Decline;
 * the list and a friend's card; Remove friend with its confirm; revision 5's
 * feed first, the online dot and ranks, a friend's recent games opening in
 * the replay viewer; the lists loaded after the launch sync; a refresh on
 * open, after each action, from Refresh, every 30 seconds while open and
 * when the app comes back to the screen; nothing another player typed
 * shown; the data dropped on a 401 and on a log out.
 *
 * Every name here is generated from the word lists.
 */

test.use({ timezoneId: 'America/Los_Angeles', locale: 'en-US' });

const MY_CODE = 'K7QX2MPD';
const OTTER = '0a0a0a0a-0000-4000-8000-000000000002'; // Cosmic Otter, a friend
const FALCON = '0a0a0a0a-0000-4000-8000-000000000003'; // Swift Falcon, a friend
const OWL = '0a0a0a0a-0000-4000-8000-000000000004'; // Lucky Owl, a friend
const FOX = '0a0a0a0a-0000-4000-8000-000000000005'; // Shining Fox, asking
const TURTLE = '0a0a0a0a-0000-4000-8000-000000000006'; // Brave Turtle, asking

interface Person {
  player_id: string;
  handle: unknown;
  avatar: unknown;
}

interface Replay {
  id: string;
  date: string;
  board: string | null;
  outcome: string | null;
  opponent: string | null;
  payload: Record<string, unknown>;
}

/** The SGF the app writes, as the server serves a friend's replay. */
const APP_SGF = '(;GM[1]FF[4]CA[UTF-8]SZ[9]KM[6.5]RU[Japanese]RE[B+5.5];B[ee];W[cc];B[gc];W[])';

function falconReplays(): Replay[] {
  return [
    {
      id: 'a1b2c3d4',
      date: new Date(day(2, 16)).toISOString(),
      board: '9x9',
      outcome: 'win',
      opponent: '12k',
      payload: { sgf: APP_SGF, result: 'Black wins by 5.5', playerColor: 'black', opponentRank: '12k', moveCount: 4, isRanked: true },
    },
    {
      id: 'e5f6a7b8',
      date: new Date(day(1, 16)).toISOString(),
      board: '19x19',
      outcome: 'loss',
      opponent: '18k',
      payload: { sgf: APP_SGF.replace('SZ[9]', 'SZ[19]'), result: 'White wins (resignation)', playerColor: 'black', opponentRank: '18k' },
    },
  ];
}

/** The feed's events, newest first: Falcon's promotion and win today, Owl's loss yesterday. */
function feedEvents() {
  const falcon = { player_id: FALCON, handle: [3, 3], avatar: 'nova' };
  const owl = { player_id: OWL, handle: [8, 5], avatar: 'comet' };
  return [
    { kind: 'promotion', ...falcon, board: '9x9', from: '16k', to: '15k', ts: day(2, 18) },
    { kind: 'game', ...falcon, board: '9x9', result: 'win', rung: '16k', bot: '12k', ts: day(2, 18) },
    { kind: 'game', ...owl, board: '9x9', result: 'loss', rung: '25k', bot: '18k', ts: day(1, 17) },
  ];
}

interface Logged {
  method: string;
  path: string;
  raw: string | null;
  url: string;
}

const day = (d: number, h = 15) => Date.UTC(2026, 9, d, h, 42); // Oct d, 2026, an afternoon

function falconCard() {
  return {
    player_id: FALCON,
    handle: [3, 3],
    avatar: 'nova',
    boards: { '19x19': { rung: '20k', games: 5 }, '9x9': { rung: '15k', games: 12 } },
    games: 17,
    recent: [
      { board: '9x9', result: 'win', rung: '15k', ts: day(1) },
      { board: '9x9', result: 'loss', rung: '15k', ts: day(1, 9) },
      { board: '19x19', result: 'win', rung: '20k', ts: day(1, 2) },
      { board: '9x9', result: 'win', rung: '18k', ts: Date.UTC(2026, 8, 30, 18) },
      { board: '19x19', result: 'loss', rung: '20k', ts: Date.UTC(2026, 8, 28, 18) },
    ],
  };
}

/** Answer `/api/sync/*` per the contract; abort every other API call. */
async function fakeSync(
  page: Page,
  opts: {
    admin?: boolean;
    friends?: Person[];
    incoming?: Person[];
    cards?: Record<string, unknown>;
    /** Codes that belong to a profile. */
    known?: Record<string, string>;
    /** Answer the next sends with these statuses, in order. */
    sendStatuses?: number[];
    /** Answer every friends route with this status. */
    friendsStatus?: number;
    /** Answer POST /players (a create) with this status. */
    createStatus?: number;
    /** The feed's events (default: feedEvents()). */
    events?: unknown[];
    /** Friends online now. */
    online?: string[];
    /** Each friend's replays (default: Falcon's two). */
    replays?: Record<string, Replay[]>;
  } = {},
) {
  const log: Logged[] = [];
  const state = {
    code: MY_CODE,
    newCodes: ['PX5R3TGA', 'QY6T4VHC'],
    friends: (opts.friends ?? [
      { player_id: OTTER, handle: [0, 0], avatar: 'tide' },
      { player_id: FALCON, handle: [3, 3], avatar: 'nova' },
      { player_id: OWL, handle: [8, 5], avatar: 'comet' },
    ]).map((p) => ({ ...p, since: '2026-10-01T16:00:00Z' })),
    incoming: (opts.incoming ?? [{ player_id: FOX, handle: [21, 4], avatar: 'prism' }]).map((p) => ({
      ...p,
      sent_at: '2026-10-02T15:00:00Z',
    })),
    cards: opts.cards ?? {
      [FALCON]: falconCard(),
      [OTTER]: { player_id: OTTER, handle: [0, 0], avatar: 'tide', boards: {}, games: 0, recent: [] },
      [OWL]: {
        player_id: OWL,
        handle: [8, 5],
        avatar: 'comet',
        boards: { '9x9': { rung: '25k', games: 1 } },
        games: 1,
        recent: [{ board: '9x9', result: 'loss', rung: '25k', ts: day(2) }],
      },
    } as Record<string, unknown>,
    sendStatuses: [...(opts.sendStatuses ?? [])],
    events: opts.events ?? (feedEvents() as unknown[]),
    online: new Set(opts.online ?? [FALCON]),
    replays: opts.replays ?? ({ [FALCON]: falconReplays() } as Record<string, Replay[]>),
    /** Every friends route answers 503 while set (the device is offline). */
    down: false,
  };
  const known = opts.known ?? { RA3V8YGF: TURTLE };
  let rev = 1;
  /** `METHOD /path` → a reply held until released. */
  const gates = new Map<string, Promise<void>>();
  /** `METHOD /path` → the next reply's status, once. */
  const once = new Map<string, number>();

  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, '');
    const method = req.method();
    const raw = req.postData();
    log.push({ method, path, raw, url: req.url() });
    if (!path.startsWith('/sync/')) return route.abort();
    const reply = (status: number, json?: unknown) =>
      route.fulfill(
        status === 204 ? { status } : { status, contentType: 'application/json', body: JSON.stringify(json ?? {}) },
      );
    const key = `${method} ${path}`;
    const gate = gates.get(key);
    if (gate) await gate;
    const forced = once.get(key);
    if (forced) {
      once.delete(key);
      return reply(forced, { detail: 'refused' });
    }

    if (path.startsWith('/sync/friends')) {
      if (opts.friendsStatus) return reply(opts.friendsStatus, { detail: 'refused' });
      if (state.down) return reply(503, { detail: 'down' });
      const isFriend = (id: string) => state.friends.some((f) => f.player_id === id);
      if (path === '/sync/friends/feed' && method === 'GET') {
        return reply(200, {
          friends: state.friends.map((f) => ({
            player_id: f.player_id,
            handle: f.handle,
            avatar: f.avatar,
            active_recently: state.online.has(f.player_id),
            boards: (state.cards[f.player_id] as { boards?: unknown } | undefined)?.boards ?? {},
          })),
          events: state.events.filter((e) => isFriend((e as { player_id: string }).player_id)),
        });
      }
      const g = /^\/sync\/friends\/([^/]+)\/games(?:\/([^/]+))?$/.exec(path);
      if (g && method === 'GET') {
        if (!isFriend(g[1])) return reply(404, { detail: 'Not Found' });
        const replays = state.replays[g[1]] ?? [];
        if (!g[2]) return reply(200, { games: replays.map(({ payload: _p, ...entry }) => entry) });
        const found = replays.find((r) => r.id === decodeURIComponent(g[2]));
        return found ? reply(200, { id: found.id, date: found.date, payload: found.payload }) : reply(404, { detail: 'Not Found' });
      }
      if (path === '/sync/friends/code') {
        if (method === 'GET') return reply(200, { code: state.code });
        state.code = state.newCodes.shift()!;
        return reply(201, { code: state.code });
      }
      if (path === '/sync/friends/requests' && method === 'POST') {
        const forced = state.sendStatuses.shift();
        if (forced) return reply(forced, forced === 202 ? {} : { detail: 'x' });
        const code = String(JSON.parse(raw ?? '{}').code);
        if (code === state.code) return reply(422, { detail: 'own code' });
        return known[code] ? reply(202, {}) : reply(404, { detail: 'no profile' });
      }
      if (path === '/sync/friends' && method === 'GET') {
        return reply(200, { friends: state.friends, incoming: state.incoming });
      }
      const m = /^\/sync\/friends\/requests\/([^/]+)\/(accept|decline)$/.exec(path);
      if (m && method === 'POST') {
        const asking = state.incoming.find((p) => p.player_id === m[1]);
        if (!asking) return reply(404, { detail: 'no request' });
        state.incoming = state.incoming.filter((p) => p !== asking);
        if (m[2] === 'accept') {
          state.friends.unshift({ player_id: asking.player_id, handle: asking.handle, avatar: asking.avatar, since: '2026-10-02T16:00:00Z' });
        }
        return reply(204);
      }
      const c = /^\/sync\/friends\/([^/]+)$/.exec(path);
      if (c && method === 'GET') {
        const card = state.friends.some((f) => f.player_id === c[1]) ? state.cards[c[1]] : undefined;
        return card ? reply(200, card) : reply(404, { detail: 'not found' });
      }
      if (c && method === 'DELETE') {
        state.friends = state.friends.filter((f) => f.player_id !== c[1]);
        return reply(204);
      }
      return reply(404, { detail: 'no route' });
    }
    if (method === 'POST' && path === '/sync/players') return reply(opts.createStatus ?? 503, { detail: 'down' });
    if (method === 'GET' && path === '/sync/state') {
      return reply(200, {
        rev,
        state: { schema: 1, ladder: { byBoardSize: {}, undoBank: 3 }, lessons: [], avatar: 'tide', avatarPicked: true, handle: [2, 9] },
        admin: opts.admin ?? false,
        device_id: 'd-self',
      });
    }
    if (method === 'PUT' && path === '/sync/state') {
      rev = Number(JSON.parse(raw ?? '{}').base_rev) + 1;
      return reply(200, { rev });
    }
    if (method === 'GET' && path === '/sync/games') return reply(200, { games: [] });
    if (method === 'GET' && path === '/sync/admin/players') return reply(200, { players: [] });
    if (method === 'DELETE' && path === '/sync/devices/current') return reply(204);
    return reply(404, { detail: 'no route' });
  });

  const count = (method: string, path: string) => log.filter((l) => l.method === method && l.path === path).length;
  /** Hold the replies to `METHOD /path` until the returned function runs. */
  const hold = (key: string) => {
    let release!: () => void;
    gates.set(key, new Promise<void>((r) => (release = r)));
    return () => {
      gates.delete(key);
      release();
    };
  };
  return { log, state, count, hold, once };
}

/** This device, logged in, before the app starts (only on the first load). */
async function seedLoggedIn(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('goforkids.profile.v1', JSON.stringify({ avatar: 'tide', avatarPicked: true, handle: [2, 9] }));
    localStorage.setItem('goforkids.sync.v1', JSON.stringify({ playerId: 'p-self', deviceToken: 'tok-e2e', baseRev: 1 }));
  });
}

async function openProfile(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Profile/ }).click();
  await page.locator('.profile-devices').waitFor();
}

const section = (page: Page) => page.locator('.profile-friends');
const friend = (page: Page, id: string) => page.locator(`.profile-friends-friend[data-player-id="${id}"]`);
const request = (page: Page, id: string) => page.locator(`.profile-friends-request[data-player-id="${id}"]`);

/** The friends data held in memory (the dev build's store hook). */
async function heldData(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __friendsStore: { getState: () => Record<string, unknown> } }).__friendsStore.getState();
    return {
      code: s.code,
      friends: s.friends,
      incoming: s.incoming,
      feed: s.feed,
      card: s.card,
      cardFor: s.cardFor,
      cardGames: s.cardGames,
    };
  });
}

const DROPPED = { code: null, friends: null, incoming: null, feed: null, card: null, cardFor: null, cardGames: null };

test('not logged in: no Friends section, and no friends request', async ({ page }) => {
  // A player whose profile could not be created yet (the create keeps failing).
  const { log } = await fakeSync(page, { createStatus: 503 });
  await page.addInitScript(() => {
    localStorage.setItem('goforkids.profile.v1', JSON.stringify({ avatar: 'tide', avatarPicked: true, handle: [2, 9] }));
  });
  await openProfile(page);
  await expect.poll(() => log.some((l) => l.method === 'POST' && l.path === '/sync/players')).toBe(true);
  await page.waitForTimeout(300);
  await expect(page.locator('.profile-devices')).toBeVisible();
  await expect(section(page)).toHaveCount(0);
  expect(log.filter((l) => l.path.startsWith('/sync/friends'))).toEqual([]);
});

test('logged in: the section sits after Devices and before Admin', async ({ page }) => {
  await fakeSync(page, { admin: true });
  await seedLoggedIn(page);
  await openProfile(page);
  await expect(page.locator('.profile-admin')).toBeVisible();
  await expect(section(page)).toBeVisible();
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('.profile-main > section')].map((el) =>
      ['profile-devices', 'profile-friends', 'profile-admin'].find((c) => el.classList.contains(c)) ?? '',
    ).filter(Boolean),
  );
  expect(order).toEqual(['profile-devices', 'profile-friends', 'profile-admin']);
});

test('the code in two groups of four, a request with name and avatar, the friends with theirs', async ({ page }) => {
  await fakeSync(page);
  await seedLoggedIn(page);
  await openProfile(page);
  await expect(section(page).locator('.profile-friends-code')).toHaveText('K7QX 2MPD');
  await expect(section(page).locator('.profile-friends-code')).toHaveAttribute('aria-label', 'Friend code K 7 Q X 2 M P D');

  const fox = request(page, FOX);
  await expect(fox.locator('.profile-friends-name')).toHaveText('Shining Fox');
  await expect(fox.locator('.avatar')).toHaveClass(/avatar-prism/);
  await expect(fox.getByRole('button', { name: 'Accept' })).toBeVisible();
  await expect(fox.getByRole('button', { name: 'Decline' })).toBeVisible();

  await expect(section(page).locator('.profile-friends-friend .profile-friends-name')).toHaveText([
    'Cosmic Otter',
    'Swift Falcon',
    'Lucky Owl',
  ]);
  await expect(friend(page, OTTER).locator('.avatar')).toHaveClass(/avatar-tide/);
  await expect(friend(page, FALCON).locator('.avatar')).toHaveClass(/avatar-nova/);
  await expect(friend(page, OWL).locator('.avatar')).toHaveClass(/avatar-comet/);
  // No card until one is tapped.
  await expect(section(page).locator('.profile-friends-card')).toHaveCount(0);
  await expect(section(page).locator('.profile-friends-person[aria-expanded="false"]')).toHaveCount(3);
});

test('no friends and no requests yet', async ({ page }) => {
  await fakeSync(page, { friends: [], incoming: [] });
  await seedLoggedIn(page);
  await openProfile(page);
  await expect(section(page)).toContainText('No friends yet. Give a friend your code, or add theirs.');
  await expect(section(page).locator('.profile-friends-request')).toHaveCount(0);
  await expect(section(page).getByText('Requests', { exact: true })).toHaveCount(0);
});

test("Add a friend: each answer in the plan's words, the code sent normalised", async ({ page }) => {
  const { log } = await fakeSync(page, { sendStatuses: [] });
  await seedLoggedIn(page);
  await openProfile(page);
  const field = section(page).locator('.profile-friends-input');
  const sendBtn = section(page).getByRole('button', { name: 'Send' });
  const line = section(page).locator('.profile-friends-outcome');
  const sends = () => log.filter((l) => l.method === 'POST' && l.path === '/sync/friends/requests');

  await expect(sendBtn).toBeDisabled();

  // 202, typed lower case with a hyphen and spaces.
  await field.fill(' ra3v - 8ygf ');
  await sendBtn.click();
  await expect(line).toHaveText('Request sent');
  expect(sends().map((l) => l.raw)).toEqual([JSON.stringify({ code: 'RA3V8YGF' })]);
  await expect(field).toHaveValue('');

  // 404.
  await field.fill('XY23 4567');
  await expect(line).toHaveCount(0); // typing clears the last answer
  await sendBtn.click();
  await expect(line).toHaveText('No player has that code');
  await expect(field).toHaveValue('XY23 4567');

  // 422: this device's own code.
  await field.fill('k7qx-2mpd');
  await sendBtn.click();
  await expect(line).toHaveText("That's your own code");
  expect(sends().map((l) => l.raw)).toEqual([
    JSON.stringify({ code: 'RA3V8YGF' }),
    JSON.stringify({ code: 'XY234567' }),
    JSON.stringify({ code: 'K7QX2MPD' }),
  ]);

  // 422's other case, caught here: no request.
  for (const typed of ['RA3V8YG', 'RA3V8YGFF', 'RA3V 8YG0', 'RA3V_8YGF']) {
    await field.fill(typed);
    await sendBtn.click();
    await expect(line).toHaveText("That isn't a friend code");
  }
  expect(sends()).toHaveLength(3);
});

test('Add a friend: 429 says try later; a server that is down says so', async ({ page }) => {
  await fakeSync(page, { sendStatuses: [429, 503] });
  await seedLoggedIn(page);
  await openProfile(page);
  const field = section(page).locator('.profile-friends-input');
  const line = section(page).locator('.profile-friends-outcome');
  await field.fill('RA3V8YGF');
  await section(page).getByRole('button', { name: 'Send' }).click();
  await expect(line).toHaveText('Too many tries. Wait a little, then try again.');
  await section(page).getByRole('button', { name: 'Send' }).click();
  await expect(line).toHaveText("Couldn't connect. Try again in a minute.");
});

test('Accept makes a friend; Decline removes the request', async ({ page }) => {
  const { log, count } = await fakeSync(page, {
    incoming: [
      { player_id: FOX, handle: [21, 4], avatar: 'prism' },
      { player_id: TURTLE, handle: [6, 6], avatar: 'eclipse' },
    ],
  });
  await seedLoggedIn(page);
  await openProfile(page);
  await expect(section(page).locator('.profile-friends-request')).toHaveCount(2);
  const lists = count('GET', '/sync/friends');

  await request(page, FOX).getByRole('button', { name: 'Accept' }).click();
  await expect(request(page, FOX)).toHaveCount(0);
  await expect(friend(page, FOX).locator('.profile-friends-name')).toHaveText('Shining Fox');
  expect(count('POST', `/sync/friends/requests/${FOX}/accept`)).toBe(1);
  expect(count('GET', '/sync/friends')).toBe(lists + 1);

  await request(page, TURTLE).getByRole('button', { name: 'Decline' }).click();
  await expect(section(page).locator('.profile-friends-request')).toHaveCount(0);
  await expect(friend(page, TURTLE)).toHaveCount(0);
  expect(count('POST', `/sync/friends/requests/${TURTLE}/decline`)).toBe(1);
  expect(count('GET', '/sync/friends')).toBe(lists + 2);
  await expect(section(page).getByText('Requests', { exact: true })).toHaveCount(0);
  expect(log.filter((l) => l.path.includes('/requests/') && l.raw)).toEqual([]);
});

test('a failed Accept or Decline says why; a request that is gone says so, and the list catches up', async ({ page }) => {
  const { state, once } = await fakeSync(page, {
    incoming: [
      { player_id: FOX, handle: [21, 4], avatar: 'prism' },
      { player_id: TURTLE, handle: [6, 6], avatar: 'eclipse' },
    ],
  });
  await seedLoggedIn(page);
  await openProfile(page);
  const alert = section(page).getByRole('alert');

  // The server is down for one decline.
  once.set(`POST /sync/friends/requests/${TURTLE}/decline`, 503);
  await request(page, TURTLE).getByRole('button', { name: 'Decline' }).click();
  await expect(alert).toHaveText("Couldn't connect. Try again in a minute.");
  await expect(request(page, TURTLE)).toBeVisible();

  // Fox withdrew meanwhile (the request is gone on the server).
  state.incoming = state.incoming.filter((p) => p.player_id !== FOX);
  await request(page, FOX).getByRole('button', { name: 'Accept' }).click();
  await expect(alert).toHaveText("That request isn't there any more.");
  await expect(request(page, FOX)).toHaveCount(0);

  // The next action clears the line.
  await request(page, TURTLE).getByRole('button', { name: 'Decline' }).click();
  await expect(section(page).locator('.profile-friends-request')).toHaveCount(0);
  await expect(alert).toHaveCount(0);
});

test("a friend's card: name, avatar, rank per board, games, recent results with board, win or loss and the date", async ({ page }) => {
  const { count } = await fakeSync(page);
  await seedLoggedIn(page);
  await openProfile(page);
  await friend(page, FALCON).locator('.profile-friends-person').click();
  const card = friend(page, FALCON).locator('.profile-friends-card');
  await expect(card.locator('.profile-friends-card-name')).toHaveText('Swift Falcon');
  await expect(card.locator('.avatar')).toHaveClass(/avatar-nova/);
  await expect(card.locator('.profile-friends-card-games')).toHaveText('17 ranked games');
  await expect(card.locator('.profile-friends-card-rank')).toHaveText(['9×9 15k · 12 games', '19×19 20k · 5 games']);
  await expect(card.locator('.profile-friends-result')).toHaveText([
    '9×9WinOct 1',
    '9×9LossOct 1',
    '19×19WinSep 30',
    '9×9WinSep 30',
    '19×19LossSep 28',
  ]);
  // The date only: no time of day anywhere on the card, and no rung per result.
  await expect(card).not.toContainText(/\d:\d\d|AM|PM/);
  await expect(card.locator('.profile-friends-results')).not.toContainText(/\d+k/);
  expect(count('GET', `/sync/friends/${FALCON}`)).toBe(1);
  await expect(friend(page, FALCON).locator('.profile-friends-person')).toHaveAttribute('aria-expanded', 'true');

  // Tapping the open friend again shuts the card.
  await friend(page, FALCON).locator('.profile-friends-person').click();
  await expect(section(page).locator('.profile-friends-card')).toHaveCount(0);
  await friend(page, FALCON).locator('.profile-friends-person').click();
  await expect(card.locator('.profile-friends-card-name')).toHaveText('Swift Falcon');

  // One card at a time; Close shuts it.
  await friend(page, OTTER).locator('.profile-friends-person').click();
  await expect(section(page).locator('.profile-friends-card')).toHaveCount(1);
  const otter = friend(page, OTTER).locator('.profile-friends-card');
  await expect(otter.locator('.profile-friends-card-name')).toHaveText('Cosmic Otter');
  await expect(otter.locator('.profile-friends-card-games')).toHaveText('0 ranked games');
  await expect(otter.locator('.profile-friends-card-ranks')).toHaveText('No ranked games yet');
  await expect(otter.locator('.profile-friends-result')).toHaveCount(0);
  await expect(otter).not.toContainText('Recent results');
  // One of each.
  await friend(page, OWL).locator('.profile-friends-person').click();
  const owl = friend(page, OWL).locator('.profile-friends-card');
  await expect(owl.locator('.profile-friends-card-games')).toHaveText('1 ranked game');
  await expect(owl.locator('.profile-friends-card-rank')).toHaveText('9×9 25k · 1 game');
  await expect(owl.locator('.profile-friends-result')).toHaveText(['9×9LossOct 2']);
  await friend(page, FALCON).locator('.profile-friends-person').click();
  await expect(card.locator('.profile-friends-card-name')).toHaveText('Swift Falcon');
  await card.getByRole('button', { name: 'Close' }).click();
  await expect(section(page).locator('.profile-friends-card')).toHaveCount(0);
});

test('a card for someone who is no longer a friend says so, and the list catches up', async ({ page }) => {
  const { state } = await fakeSync(page);
  await seedLoggedIn(page);
  await openProfile(page);
  await expect(friend(page, OWL)).toBeVisible();
  state.friends = state.friends.filter((f) => f.player_id !== OWL);
  await friend(page, OWL).locator('.profile-friends-person').click();
  await expect(section(page).getByRole('alert')).toHaveText("That player isn't your friend any more.");
  await expect(friend(page, OWL)).toHaveCount(0);
  await expect(section(page).locator('.profile-friends-card')).toHaveCount(0);
  // A send clears the line.
  await section(page).locator('.profile-friends-input').fill('RA3V8YGF');
  await section(page).getByRole('button', { name: 'Send' }).click();
  await expect(section(page).locator('.profile-friends-outcome')).toHaveText('Request sent');
  await expect(section(page).getByRole('alert')).toHaveCount(0);
});

test('Remove friend takes one confirm', async ({ page }) => {
  const { count } = await fakeSync(page);
  await seedLoggedIn(page);
  await openProfile(page);
  const falcon = friend(page, FALCON);
  await falcon.locator('.profile-friends-person').click();
  await falcon.getByRole('button', { name: 'Remove friend' }).click();
  await expect(falcon.locator('.profile-devices-warning')).toHaveText(
    'Remove Swift Falcon from your friends? You can add each other again later with a code.',
  );
  expect(count('DELETE', `/sync/friends/${FALCON}`)).toBe(0);
  await falcon.getByRole('button', { name: 'Cancel' }).click();
  await expect(falcon.locator('.profile-devices-warning')).toHaveCount(0);
  await expect(falcon.getByRole('button', { name: 'Remove friend' })).toBeVisible();
  expect(count('DELETE', `/sync/friends/${FALCON}`)).toBe(0);

  const lists = count('GET', '/sync/friends');
  await falcon.getByRole('button', { name: 'Remove friend' }).click();
  await falcon.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(falcon).toHaveCount(0);
  expect(count('DELETE', `/sync/friends/${FALCON}`)).toBe(1);
  expect(count('GET', '/sync/friends')).toBe(lists + 1);
  await expect(section(page).locator('.profile-friends-friend')).toHaveCount(2);

  // A confirm left armed on one card never carries to the next.
  const otter = friend(page, OTTER);
  await otter.locator('.profile-friends-person').click();
  await expect(otter.getByRole('button', { name: 'Remove friend' })).toBeVisible();
  await otter.getByRole('button', { name: 'Remove friend' }).click();
  await friend(page, OWL).locator('.profile-friends-person').click();
  await expect(friend(page, OWL).getByRole('button', { name: 'Remove friend' })).toBeVisible();
  await expect(section(page).getByRole('button', { name: 'Yes, remove' })).toHaveCount(0);
  await friend(page, OWL).getByRole('button', { name: 'Remove friend' }).click();
  await friend(page, OWL).locator('.profile-friends-person').click(); // shut while armed
  await friend(page, OWL).locator('.profile-friends-person').click();
  await expect(friend(page, OWL).getByRole('button', { name: 'Remove friend' })).toBeVisible();
  await expect(section(page).getByRole('button', { name: 'Yes, remove' })).toHaveCount(0);
  expect(count('DELETE', `/sync/friends/${OTTER}`) + count('DELETE', `/sync/friends/${OWL}`)).toBe(0);
});

test('New code takes one confirm that says the old code stops working', async ({ page }) => {
  const { count } = await fakeSync(page);
  await seedLoggedIn(page);
  await openProfile(page);
  const code = section(page).locator('.profile-friends-code');
  await expect(code).toHaveText('K7QX 2MPD');

  await section(page).getByRole('button', { name: 'New code' }).click();
  const confirm = section(page).locator('.profile-friends-newcode');
  await expect(confirm).toContainText('Your old code will stop working');
  expect(count('POST', '/sync/friends/code')).toBe(0);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  expect(count('POST', '/sync/friends/code')).toBe(0);
  await expect(code).toHaveText('K7QX 2MPD');

  const lists = count('GET', '/sync/friends');
  await section(page).getByRole('button', { name: 'New code' }).click();
  await confirm.getByRole('button', { name: 'Yes, new code' }).click();
  await expect(code).toHaveText('PX5R 3TGA');
  await expect(confirm).toHaveCount(0);
  expect(count('POST', '/sync/friends/code')).toBe(1);
  expect(count('GET', '/sync/friends')).toBe(lists + 1);
});

test('a New code that fails says so, keeps the old code, and asking again clears the line', async ({ page }) => {
  const { once } = await fakeSync(page);
  await seedLoggedIn(page);
  await openProfile(page);
  const code = section(page).locator('.profile-friends-code');
  const confirm = section(page).locator('.profile-friends-newcode');
  once.set('POST /sync/friends/code', 503);
  await section(page).getByRole('button', { name: 'New code' }).click();
  await confirm.getByRole('button', { name: 'Yes, new code' }).click();
  await expect(section(page).getByRole('alert')).toHaveText("Couldn't connect. Try again in a minute.");
  await expect(code).toHaveText('K7QX 2MPD');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await section(page).getByRole('button', { name: 'New code' }).click();
  await expect(section(page).getByRole('alert')).toHaveCount(0);
  await confirm.getByRole('button', { name: 'Yes, new code' }).click();
  await expect(code).toHaveText('PX5R 3TGA');
});

test('while anything is on its way: loading lines, and nothing can be pressed twice', async ({ page }) => {
  const { hold, count } = await fakeSync(page, { sendStatuses: [404] });
  const releaseCode = hold('GET /sync/friends/code');
  const releaseList = hold('GET /sync/friends');
  await seedLoggedIn(page);
  await openProfile(page);
  const s = section(page);
  // Opening: the lists and the code are on their way.
  await expect(s.locator('.profile-friends-empty')).toHaveText('Loading…');
  await expect(s.locator('.profile-friends-code')).toHaveText('···· ····');
  await expect(s.getByRole('button', { name: 'New code' })).toBeDisabled(); // no code to replace yet
  releaseList();
  releaseCode();
  await expect(friend(page, OTTER)).toBeVisible();
  await expect(s.locator('.profile-friends-code')).toHaveText('K7QX 2MPD');
  await expect(s.getByRole('button', { name: 'New code' })).toBeEnabled();

  // A card on its way.
  const releaseCard = hold(`GET /sync/friends/${FALCON}`);
  await friend(page, FALCON).locator('.profile-friends-person').click();
  await expect(friend(page, FALCON).locator('.profile-friends-card')).toHaveText('Loading…');
  releaseCard();
  const card = friend(page, FALCON).locator('.profile-friends-card');
  await expect(card.locator('.profile-friends-card-name')).toHaveText('Swift Falcon');

  // An Accept on its way: every action waits, the card's too.
  const releaseAccept = hold(`POST /sync/friends/requests/${FOX}/accept`);
  await request(page, FOX).getByRole('button', { name: 'Accept' }).click();
  for (const name of ['Accept', 'Decline']) await expect(request(page, FOX).getByRole('button', { name })).toBeDisabled();
  await expect(s.getByRole('button', { name: 'New code' })).toBeDisabled();
  await expect(card.getByRole('button', { name: 'Remove friend' })).toBeDisabled();
  await expect(card.getByRole('button', { name: 'Close' })).toBeDisabled();
  await s.locator('.profile-friends-input').fill('RA3V8YGF');
  await expect(s.getByRole('button', { name: 'Send' })).toBeDisabled();
  releaseAccept();
  await expect(request(page, FOX)).toHaveCount(0);
  await expect(s.getByRole('button', { name: 'New code' })).toBeEnabled();
  expect(count('POST', `/sync/friends/requests/${FOX}/accept`)).toBe(1);

  // A send on its way: the last answer goes, and Send waits.
  await s.getByRole('button', { name: 'Send' }).click();
  await expect(s.locator('.profile-friends-outcome')).toHaveText('No player has that code');
  const releaseSend = hold('POST /sync/friends/requests');
  await s.getByRole('button', { name: 'Send' }).click();
  await expect(s.locator('.profile-friends-outcome')).toHaveCount(0);
  await expect(s.getByRole('button', { name: 'Send' })).toBeDisabled();
  releaseSend();
  await expect(s.locator('.profile-friends-outcome')).toHaveText('Request sent');

  // A removal on its way.
  const releaseRemove = hold(`DELETE /sync/friends/${FALCON}`);
  await card.getByRole('button', { name: 'Remove friend' }).click();
  await card.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(card.getByRole('button', { name: 'Removing…' })).toBeDisabled();
  await expect(card.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  releaseRemove();
  await expect(friend(page, FALCON)).toHaveCount(0);

  // A new code on its way.
  const releaseNew = hold('POST /sync/friends/code');
  await s.getByRole('button', { name: 'New code' }).click();
  await s.locator('.profile-friends-newcode').getByRole('button', { name: 'Yes, new code' }).click();
  await expect(s.getByRole('button', { name: 'Making…' })).toBeDisabled();
  await expect(s.locator('.profile-friends-newcode').getByRole('button', { name: 'Cancel' })).toBeDisabled();
  releaseNew();
  await expect(s.locator('.profile-friends-code')).toHaveText('PX5R 3TGA');
  expect(count('POST', '/sync/friends/code')).toBe(1);
});

test("a section that won't load says so", async ({ page }) => {
  await fakeSync(page, { friendsStatus: 503 });
  await seedLoggedIn(page);
  await openProfile(page);
  await expect(section(page)).toContainText("Couldn't load your friends. They'll show next time you're connected.");
  await expect(page.locator('.first-run')).toHaveCount(0);
});

test('the lists load after the launch sync; the section refreshes on open, after each action, from Refresh, every 30 seconds while open, and when the app comes back', async ({ page }) => {
  await page.clock.install();
  const { count, state } = await fakeSync(page);
  await seedLoggedIn(page);
  const reads = () => ['/sync/friends/code', '/sync/friends', '/sync/friends/feed'].map((p) => count('GET', p));

  // The launch pass ends logged in: the lists (the requests badge), and
  // nothing else before the Friends section opens. (The dev build's
  // StrictMode runs the launch effect twice, so two passes may run; a
  // production build runs one. Counted, not assumed.)
  await page.goto('/');
  await page.getByRole('button', { name: /Profile/ }).waitFor();
  await expect.poll(() => count('GET', '/sync/friends')).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(300);
  const launch = count('GET', '/sync/friends');
  expect(launch).toBeLessThanOrEqual(2);
  expect(reads()).toEqual([0, launch, 0]);
  expect(await page.evaluate(() => (window as unknown as { __friendsStore: { getState: () => { incoming: unknown[] | null } } }).__friendsStore.getState().incoming?.length)).toBe(1);

  // Opening it loads everything (the opening effect runs twice in the dev
  // build too).
  await page.getByRole('button', { name: /Profile/ }).click();
  await expect(friend(page, OTTER)).toBeVisible();
  await page.waitForTimeout(300);
  const [c0, l0, f0] = reads();
  expect(c0).toBeGreaterThanOrEqual(1);
  expect(l0).toBe(launch + c0);
  expect(f0).toBe(c0);

  // Every 30 seconds while open: everything once.
  await page.clock.runFor(30_000);
  await expect.poll(reads).toEqual([c0 + 1, l0 + 1, f0 + 1]);
  await page.clock.runFor(29_000);
  await page.waitForTimeout(200);
  expect(reads()).toEqual([c0 + 1, l0 + 1, f0 + 1]);
  await page.clock.runFor(1_000);
  await expect.poll(reads).toEqual([c0 + 2, l0 + 2, f0 + 2]);

  // A friend who accepted meanwhile shows on the next one.
  state.friends.unshift({ player_id: FOX, handle: [21, 4], avatar: 'prism', since: '2026-10-02T16:00:00Z' });
  state.incoming = [];
  await page.clock.runFor(30_000);
  await expect(friend(page, FOX).locator('.profile-friends-name')).toHaveText('Shining Fox');
  await expect(request(page, FOX)).toHaveCount(0);
  const [c1, l1, f1] = reads();

  // An action: one refresh.
  await section(page).locator('.profile-friends-input').fill('RA3V8YGF');
  await section(page).getByRole('button', { name: 'Send' }).click();
  await expect(section(page).locator('.profile-friends-outcome')).toHaveText('Request sent');
  await expect.poll(reads).toEqual([c1 + 1, l1 + 1, f1 + 1]);

  // Refresh: one refresh.
  await section(page).getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(reads).toEqual([c1 + 2, l1 + 2, f1 + 2]);
  await expect(section(page).getByRole('button', { name: 'Refresh' })).toBeEnabled();

  // The app comes back to the screen: one refresh.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(reads).toEqual([c1 + 3, l1 + 3, f1 + 3]);

  // Opening a card is not a refresh of the list.
  await friend(page, FALCON).locator('.profile-friends-person').click();
  await expect(friend(page, FALCON).locator('.profile-friends-card-name')).toBeVisible();
  expect(reads()).toEqual([c1 + 3, l1 + 3, f1 + 3]);

  // Leaving the page stops the section's refreshes; coming back loads again,
  // on the list rather than on the card left open.
  await page.getByRole('button', { name: 'Back to home' }).click();
  await page.waitForTimeout(300);
  const [c2, , f2] = reads();
  await page.clock.runFor(10 * 60_000);
  await page.waitForTimeout(200);
  expect([reads()[0], reads()[2]]).toEqual([c2, f2]);
  await page.getByRole('button', { name: /Profile/ }).click();
  await expect.poll(() => reads()[2]).toBeGreaterThan(f2);
  await expect(section(page).locator('.profile-friends-card')).toHaveCount(0);
});

test('nothing another player typed is shown: text in the list, the card, the feed and a replay never appears', async ({ page }) => {
  const INJ = 'INJ Visit example.com';
  await fakeSync(page, {
    online: [FALCON],
    events: [
      { kind: 'game', player_id: FALCON, handle: INJ, avatar: INJ, board: '9x9', result: 'win', rung: INJ, bot: INJ, ts: day(2) },
      { kind: 'promotion', player_id: FALCON, handle: [3, 3], avatar: 'nova', board: '9x9', from: INJ, to: INJ, ts: day(2) },
      { kind: INJ, player_id: FALCON, handle: [3, 3], avatar: 'nova', board: INJ, result: INJ, ts: day(2) },
    ],
    replays: {
      [FALCON]: [
        { id: 'inj1', date: new Date(day(2)).toISOString(), board: INJ, outcome: INJ, opponent: INJ, payload: { sgf: `(;GM[1]FF[4]CA[UTF-8]SZ[9]PB[${INJ}]RU[Japanese];B[ee])`, result: INJ } },
      ],
    },
    friends: [{ player_id: FALCON, handle: INJ, avatar: INJ }],
    incoming: [{ player_id: FOX, handle: [64, 1], avatar: `${INJ} nova` }],
    cards: {
      [FALCON]: {
        player_id: FALCON,
        handle: INJ,
        avatar: INJ,
        boards: { [INJ]: { rung: '1d', games: 2 }, '9x9': { rung: INJ, games: INJ }, '7x7': { rung: '15k', games: 1 } },
        games: INJ,
        recent: [
          { board: INJ, result: 'win', rung: '15k', ts: day(1) },
          { board: '9x9', result: INJ, rung: '15k', ts: day(1) },
          { board: '9x9', result: 'win', rung: INJ, ts: INJ },
          { board: '9x9', result: 'loss', rung: INJ, ts: day(1) },
        ],
      },
    },
  });
  await seedLoggedIn(page);
  await openProfile(page);
  await friend(page, FALCON).locator('.profile-friends-person').click();
  const card = friend(page, FALCON).locator('.profile-friends-card');
  await expect(card.locator('.profile-friends-card-name')).toHaveText('No name');
  await expect(request(page, FOX).locator('.profile-friends-name')).toHaveText('No name');
  await expect(card.locator('.avatar')).toHaveClass(/avatar-blackhole/);
  await expect(request(page, FOX).locator('.avatar')).toHaveClass(/avatar-blackhole/);
  await expect(card.locator('.profile-friends-card-games')).toHaveText('0 ranked games');
  await expect(card.locator('.profile-friends-card-rank')).toHaveCount(1);
  await expect(card.locator('.profile-friends-card-rank')).toHaveText(/^9×9 \d{1,2}[kdp] · 0 games$/);
  await expect(card.locator('.profile-friends-result')).toHaveText(['9×9LossOct 1']);
  await expect(section(page).locator('.profile-friends-feed-item:not(.profile-friends-feed-online) .profile-friends-feed-text')).toHaveText([
    'A friend won a game on 9×9',
  ]);
  await expect(section(page).locator('.profile-friends-feed-online')).toHaveText('A friend is online now');
  await expect(card.locator('.profile-friends-game')).toHaveText(/^Played a game/);
  // A replay whose SGF carries text opens nothing, and says so.
  await card.locator('.profile-friends-game').click();
  await expect(card.getByRole('alert')).toHaveText("That game can't be shown.");
  await expect(page.locator('.replay-controls')).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toContain('INJ');
  expect(html).not.toContain('example.com');
});

test('a 401 from a friends route: the first-run choice with its line, and the friends data gone', async ({ page }) => {
  await fakeSync(page, { friendsStatus: 401 });
  await seedLoggedIn(page);
  // The lists load after the launch sync, so the 401 comes before any tap.
  await page.goto('/');
  await expect(page.locator('.first-run')).toBeVisible();
  await expect(page.locator('.first-run-notice')).toBeVisible();
  expect(await heldData(page)).toEqual(DROPPED);
  const stored = await page.evaluate(() => localStorage.getItem('goforkids.sync.v1'));
  expect(stored ?? '').not.toContain('tok-e2e');
});

test('Log out drops the friends data, and nothing of it was ever stored', async ({ page }) => {
  await fakeSync(page);
  await seedLoggedIn(page);
  await openProfile(page);
  await friend(page, FALCON).locator('.profile-friends-person').click();
  await expect(friend(page, FALCON).locator('.profile-friends-card-name')).toHaveText('Swift Falcon');
  const held = await heldData(page);
  expect(held.code).toBe(MY_CODE);
  expect(held.cardFor).toBe(FALCON);

  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  for (const v of [MY_CODE, OTTER, FALCON, OWL, FOX]) expect(storage).not.toContain(v);

  await page.getByRole('button', { name: 'Log out' }).click();
  await page.getByRole('button', { name: 'Yes, log out' }).click();
  await expect(page.locator('.first-run')).toBeVisible();
  await expect(page.locator('.first-run-notice')).toHaveCount(0);
  expect(await heldData(page)).toEqual(DROPPED);
});

/* ------------------------------------------------------------------------- *
 * Revision 5: the feed, and a friend's games in the replay viewer.
 * ------------------------------------------------------------------------- */

/** The page's now in the tests below that show a day: Oct 2, 2026, 1 PM in
 *  Los Angeles, so the feed's "Today" and "Yesterday" never drift. */
const NOW = new Date(Date.UTC(2026, 9, 2, 20, 0));

const feedText = (page: Page) =>
  section(page).locator('.profile-friends-feed-item:not(.profile-friends-feed-online) .profile-friends-feed-text');

test('the feed comes first: who is online, then what friends did, in sentences', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await fakeSync(page);
  await seedLoggedIn(page);
  await openProfile(page);
  // First in the section, before the code.
  const blocks = await section(page).locator('.profile-friends-label').allTextContents();
  expect(blocks.slice(0, 2)).toEqual(['What your friends are up to', 'Your friend code']);

  await expect(section(page).locator('.profile-friends-feed-online')).toHaveText(['Swift Falcon is online now']);
  await expect(feedText(page)).toHaveText([
    'Swift Falcon was promoted to 15k on 9×9',
    'Swift Falcon beat the 12k bot on 9×9',
    'Lucky Owl lost to the 18k bot on 9×9',
  ]);
  await expect(section(page).locator('.profile-friends-feed-when')).toHaveText(['Today', 'Today', 'Yesterday']);
  // The online dot on Falcon's lines and in the list, nowhere else.
  const falconLines = section(page).locator(`.profile-friends-feed-item[data-player-id="${FALCON}"]`);
  await expect(falconLines.locator('.profile-friends-dot')).toHaveCount(3);
  await expect(section(page).locator(`.profile-friends-feed-item[data-player-id="${OWL}"] .profile-friends-dot`)).toHaveCount(0);
  await expect(friend(page, FALCON).locator('.profile-friends-dot')).toHaveAttribute('aria-label', 'Online now');
  await expect(friend(page, OWL).locator('.profile-friends-dot')).toHaveCount(0);
  // Each friend's ranks under their name; online now first.
  await expect(friend(page, FALCON).locator('.profile-friends-status')).toHaveText('Online now · 9×9 15k · 19×19 20k');
  await expect(friend(page, OWL).locator('.profile-friends-status')).toHaveText('9×9 25k');
  await expect(friend(page, OTTER).locator('.profile-friends-status')).toHaveCount(0);
  // A day, never a time.
  await expect(section(page).locator('.profile-friends-feed')).not.toContainText(/\d:\d\d|AM|PM/);
});

test('a long feed shows eight lines, then Show more', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  const events = Array.from({ length: 12 }, (_, i) => ({
    kind: 'game',
    player_id: OWL,
    handle: [8, 5],
    avatar: 'comet',
    board: '9x9',
    result: i % 2 ? 'loss' : 'win',
    rung: '25k',
    bot: '18k',
    ts: day(2, 23) - i * 3_600_000,
  }));
  await fakeSync(page, { events, online: [] });
  await seedLoggedIn(page);
  await openProfile(page);
  await expect(feedText(page)).toHaveCount(8);
  await section(page).getByRole('button', { name: 'Show more' }).click();
  await expect(feedText(page)).toHaveCount(12);
  await section(page).getByRole('button', { name: 'Show less' }).click();
  await expect(feedText(page)).toHaveCount(8);
});

test('an empty feed says why: no friends yet, or friends with no games yet', async ({ page }) => {
  await fakeSync(page, { friends: [], incoming: [], events: [], online: [] });
  await seedLoggedIn(page);
  await openProfile(page);
  await expect(section(page).locator('.profile-friends-feed-empty')).toHaveText("When you have friends, you'll see their games here.");
});

test('friends with no games yet', async ({ page }) => {
  await fakeSync(page, { events: [], online: [] });
  await seedLoggedIn(page);
  await openProfile(page);
  await expect(section(page).locator('.profile-friends-feed-empty')).toHaveText("Your friends haven't played any ranked games yet.");
  await expect(section(page).locator('.profile-friends-feed-item')).toHaveCount(0);
});

test("offline: the feed stays as it was and the section says it couldn't load", async ({ page }) => {
  const { state } = await fakeSync(page);
  await seedLoggedIn(page);
  await openProfile(page);
  await expect(feedText(page)).toHaveCount(3);
  state.down = true;
  await section(page).getByRole('button', { name: 'Refresh' }).click();
  await expect(section(page)).toContainText("Couldn't load your friends. They'll show next time you're connected.");
  await expect(feedText(page)).toHaveCount(3);
  await expect(friend(page, FALCON)).toBeVisible();
  state.down = false;
  await section(page).getByRole('button', { name: 'Refresh' }).click();
  await expect(section(page)).not.toContainText("Couldn't load your friends");
});

test("a friend's recent games open in the replay viewer", async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  const { count } = await fakeSync(page);
  await seedLoggedIn(page);
  await openProfile(page);
  await friend(page, FALCON).locator('.profile-friends-person').click();
  const card = friend(page, FALCON).locator('.profile-friends-card');
  await expect(card.locator('.profile-friends-game')).toHaveText([/^Beat the 12k bot on 9×9Today/, /^Lost to the 18k bot on 19×19Yesterday/]);
  await expect(card.getByRole('button', { name: 'Watch: Beat the 12k bot on 9×9, Today' })).toBeVisible();
  expect(count('GET', `/sync/friends/${FALCON}/games`)).toBe(1);

  await card.getByRole('button', { name: 'Watch: Beat the 12k bot on 9×9, Today' }).click();
  // The Library's viewer: the Profile page gives way to it.
  await expect(page.locator('.replay-controls')).toBeVisible();
  await expect(page.locator('.profile-friends')).toHaveCount(0);
  await expect(page.locator('.replay-meta')).toHaveText('vs 12k · Black wins by 5.5');
  const replay = await page.evaluate(() => {
    const r = (window as unknown as { __replayStore: { getState: () => Record<string, unknown> } }).__replayStore.getState();
    return { sgf: r.sgf, totalMoves: r.totalMoves, libraryId: r.libraryId, sharedId: r.sharedId };
  });
  expect(replay).toEqual({ sgf: APP_SGF, totalMoves: 4, libraryId: null, sharedId: null });
  // It is not this player's game: no Share, and nothing lands in the Library.
  await expect(page.getByRole('button', { name: 'Share game' })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('goforkids_library') ?? '')).not.toContain('a1b2c3d4');
  // Close goes home, as from the Library.
  await page.locator('.replay-controls').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: /Profile/ })).toBeVisible();
});

test('a friend with no games yet, and games that will not load', async ({ page }) => {
  const { once } = await fakeSync(page, { replays: {} });
  await seedLoggedIn(page);
  await openProfile(page);
  await friend(page, OWL).locator('.profile-friends-person').click();
  await expect(friend(page, OWL).locator('.profile-friends-games-note')).toHaveText('No saved games yet.');
  once.set(`GET /sync/friends/${OTTER}/games`, 503);
  await friend(page, OTTER).locator('.profile-friends-person').click();
  await expect(friend(page, OTTER).locator('.profile-friends-games-note')).toHaveText("Couldn't load their games.");
  await expect(friend(page, OTTER).locator('.profile-friends-card-name')).toHaveText('Cosmic Otter');
});

test('a game that is gone says so; the list of games catches up', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  const { state } = await fakeSync(page);
  await seedLoggedIn(page);
  await openProfile(page);
  await friend(page, FALCON).locator('.profile-friends-person').click();
  const card = friend(page, FALCON).locator('.profile-friends-card');
  await expect(card.locator('.profile-friends-game')).toHaveCount(2);
  state.replays[FALCON] = state.replays[FALCON].slice(1); // deleted on their device
  await card.locator('.profile-friends-game').first().click();
  await expect(card.getByRole('alert')).toHaveText("That game isn't there any more.");
  await expect(card.locator('.profile-friends-game')).toHaveCount(1);
  await expect(page.locator('.replay-controls')).toHaveCount(0);
});

test('a friend removed while their card is open: a game tapped says so, and the card closes', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  const { state } = await fakeSync(page);
  await seedLoggedIn(page);
  await openProfile(page);
  await friend(page, FALCON).locator('.profile-friends-person').click();
  const card = friend(page, FALCON).locator('.profile-friends-card');
  await expect(card.locator('.profile-friends-game')).toHaveCount(2);
  state.friends = state.friends.filter((f) => f.player_id !== FALCON); // removed on their side
  await card.locator('.profile-friends-game').first().click();
  await expect(section(page).getByRole('alert')).toHaveText("That player isn't your friend any more.");
  await expect(friend(page, FALCON)).toHaveCount(0);
  await expect(section(page).locator('.profile-friends-card')).toHaveCount(0);
  await expect(page.locator('.replay-controls')).toHaveCount(0);
  // Gone from the feed too.
  await expect(section(page).locator(`.profile-friends-feed-item[data-player-id="${FALCON}"]`)).toHaveCount(0);
});

test('a friend removed while their card is open: the next 30-second refresh closes it', async ({ page }) => {
  await page.clock.install({ time: NOW });
  const { state } = await fakeSync(page);
  await seedLoggedIn(page);
  await openProfile(page);
  await friend(page, OWL).locator('.profile-friends-person').click();
  await expect(friend(page, OWL).locator('.profile-friends-card-name')).toHaveText('Lucky Owl');
  state.friends = state.friends.filter((f) => f.player_id !== OWL);
  await page.clock.runFor(30_000);
  await expect(friend(page, OWL)).toHaveCount(0);
  await expect(section(page).locator('.profile-friends-card')).toHaveCount(0);
});
