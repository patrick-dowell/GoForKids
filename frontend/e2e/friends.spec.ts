import { test, expect, type Page } from '@playwright/test';

/**
 * The Friends section (feature 32, revision 4; on its own Friends page,
 * reached from the home screen's Friends button, since revision 7), driven
 * through the real UI against a fake of the `/api/sync` contract answered
 * by route interception (no backend runs): shown only on a logged-in
 * device, after Devices and before Admin; the friend code and New code with
 * its confirm; each answer to Add a friend; Accept and Decline; the list and
 * a friend's card; Remove friend with its confirm; a refresh on open and
 * after each action, and no polling; nothing another player typed shown;
 * the data dropped on a 401 and on a log out.
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

/** Revision 7: the section lives on the Friends page, behind the home
 *  screen's Friends button. */
async function openFriends(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Friends/ }).click();
  await page.locator('.friends-page').waitFor();
}

/** From the Friends page to the Profile page (Devices, Admin, Log out). */
async function friendsToProfile(page: Page) {
  await page.getByRole('button', { name: 'Go to the home screen' }).click();
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.locator('.profile-devices').waitFor();
}

const section = (page: Page) => page.locator('.profile-friends');
const friend = (page: Page, id: string) => page.locator(`.profile-friends-friend[data-player-id="${id}"]`);
const request = (page: Page, id: string) => page.locator(`.profile-friends-request[data-player-id="${id}"]`);

/** The friends data held in memory (the dev build's store hook). */
async function heldData(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __friendsStore: { getState: () => Record<string, unknown> } }).__friendsStore.getState();
    return { code: s.code, friends: s.friends, incoming: s.incoming, card: s.card, cardFor: s.cardFor };
  });
}

const DROPPED = { code: null, friends: null, incoming: null, card: null, cardFor: null };

test('not logged in: no Friends section, and no friends request', async ({ page }) => {
  // A player whose profile could not be created yet (the create keeps failing).
  const { log } = await fakeSync(page, { createStatus: 503 });
  await page.addInitScript(() => {
    localStorage.setItem('goforkids.profile.v1', JSON.stringify({ avatar: 'tide', avatarPicked: true, handle: [2, 9] }));
  });
  await openFriends(page);
  await expect.poll(() => log.some((l) => l.method === 'POST' && l.path === '/sync/players')).toBe(true);
  await page.waitForTimeout(300);
  await expect(page.locator('.friends-page-offline')).toBeVisible();
  await expect(section(page)).toHaveCount(0);
  expect(log.filter((l) => l.path.startsWith('/sync/friends'))).toEqual([]);
});

test('logged in: the section is on the Friends page, and the Profile page keeps Devices then Admin', async ({ page }) => {
  // Revision 7 moved the section off the Profile page.
  await fakeSync(page, { admin: true });
  await seedLoggedIn(page);
  await openFriends(page);
  await expect(section(page)).toBeVisible();
  await friendsToProfile(page);
  await expect(page.locator('.profile-admin')).toBeVisible();
  await expect(section(page)).toHaveCount(0);
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('.profile-main > section')].map((el) =>
      ['profile-devices', 'profile-friends', 'profile-admin'].find((c) => el.classList.contains(c)) ?? '',
    ).filter(Boolean),
  );
  expect(order).toEqual(['profile-devices', 'profile-admin']);
});

test('the code in two groups of four, a request with name and avatar, the friends with theirs', async ({ page }) => {
  await fakeSync(page);
  await seedLoggedIn(page);
  await openFriends(page);
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
  await openFriends(page);
  await expect(section(page)).toContainText('No friends yet. Give a friend your code, or add theirs.');
  await expect(section(page).locator('.profile-friends-request')).toHaveCount(0);
  await expect(section(page).getByText('Requests', { exact: true })).toHaveCount(0);
});

test("Add a friend: each answer in the plan's words, the code sent normalised", async ({ page }) => {
  const { log } = await fakeSync(page, { sendStatuses: [] });
  await seedLoggedIn(page);
  await openFriends(page);
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
  await openFriends(page);
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
  await openFriends(page);
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
  await openFriends(page);
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
  await openFriends(page);
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
  await openFriends(page);
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
  await openFriends(page);
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
  await openFriends(page);
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
  await openFriends(page);
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
  await openFriends(page);
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
  await openFriends(page);
  await expect(section(page)).toContainText("Couldn't load your friends. They'll show next time you're connected.");
  await expect(page.locator('.first-run')).toHaveCount(0);
});

test('refreshes when the Friends page opens and after each action, and never polls', async ({ page }) => {
  await page.clock.install();
  const { count } = await fakeSync(page);
  await seedLoggedIn(page);
  // Nothing is asked before the Friends page opens.
  await page.goto('/');
  await page.getByRole('button', { name: /Friends/ }).waitFor();
  await page.waitForTimeout(300);
  expect(count('GET', '/sync/friends')).toBe(0);

  // Opening it loads the section. (The dev build's StrictMode runs the
  // opening effect twice; a production build asks once. Counted, not assumed.)
  await page.getByRole('button', { name: /Friends/ }).click();
  await expect(friend(page, OTTER)).toBeVisible();
  await page.waitForTimeout(300);
  const onOpen = count('GET', '/sync/friends');
  expect(onOpen).toBeGreaterThanOrEqual(1);
  expect(count('GET', '/sync/friends/code')).toBe(onOpen);

  // Ten minutes on the page: nothing more is asked.
  await page.clock.runFor(10 * 60_000);
  await page.waitForTimeout(200);
  expect(count('GET', '/sync/friends')).toBe(onOpen);
  expect(count('GET', '/sync/friends/code')).toBe(onOpen);

  // An action: one refresh.
  await section(page).locator('.profile-friends-input').fill('RA3V8YGF');
  await section(page).getByRole('button', { name: 'Send' }).click();
  await expect(section(page).locator('.profile-friends-outcome')).toHaveText('Request sent');
  await expect.poll(() => count('GET', '/sync/friends')).toBe(onOpen + 1);
  expect(count('GET', '/sync/friends/code')).toBe(onOpen + 1);
  // Opening a card is not an action on the list.
  await friend(page, FALCON).locator('.profile-friends-person').click();
  await expect(friend(page, FALCON).locator('.profile-friends-card-name')).toBeVisible();
  expect(count('GET', '/sync/friends')).toBe(onOpen + 1);

  // Leaving the page and coming back: loaded again.
  await page.getByRole('button', { name: 'Go to the home screen' }).click();
  await page.waitForTimeout(300);
  expect(count('GET', '/sync/friends')).toBe(onOpen + 1);
  await page.getByRole('button', { name: /Friends/ }).click();
  await expect.poll(() => count('GET', '/sync/friends')).toBe(2 * onOpen + 1);
  // It opens on the list, not on the card left open.
  await expect(section(page).locator('.profile-friends-card')).toHaveCount(0);
  await page.clock.runFor(10 * 60_000);
  await page.waitForTimeout(200);
  expect(count('GET', '/sync/friends')).toBe(2 * onOpen + 1);
});

test('nothing another player typed is shown: text in the list and the card never appears', async ({ page }) => {
  const INJ = 'INJ Visit example.com';
  await fakeSync(page, {
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
  await openFriends(page);
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
  const html = await page.content();
  expect(html).not.toContain('INJ');
  expect(html).not.toContain('example.com');
});

test('a 401 from a friends route: the first-run choice with its line, and the friends data gone', async ({ page }) => {
  await fakeSync(page, { friendsStatus: 401 });
  await seedLoggedIn(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Friends/ }).click();
  await expect(page.locator('.first-run')).toBeVisible();
  await expect(page.locator('.first-run-notice')).toBeVisible();
  expect(await heldData(page)).toEqual(DROPPED);
  const stored = await page.evaluate(() => localStorage.getItem('goforkids.sync.v1'));
  expect(stored ?? '').not.toContain('tok-e2e');
});

test('Log out drops the friends data, and nothing of it was ever stored', async ({ page }) => {
  await fakeSync(page);
  await seedLoggedIn(page);
  await openFriends(page);
  await friend(page, FALCON).locator('.profile-friends-person').click();
  await expect(friend(page, FALCON).locator('.profile-friends-card-name')).toHaveText('Swift Falcon');
  const held = await heldData(page);
  expect(held.code).toBe(MY_CODE);
  expect(held.cardFor).toBe(FALCON);

  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  for (const v of [MY_CODE, OTTER, FALCON, OWL, FOX]) expect(storage).not.toContain(v);

  await friendsToProfile(page);
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.getByRole('button', { name: 'Yes, log out' }).click();
  await expect(page.locator('.first-run')).toBeVisible();
  await expect(page.locator('.first-run-notice')).toHaveCount(0);
  expect(await heldData(page)).toEqual(DROPPED);
});
