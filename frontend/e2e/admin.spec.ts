import { test, expect, type Page, type Request } from '@playwright/test';

/**
 * The Profile page's Admin section (feature 32, revision 3), driven through
 * the real UI against a fake of the `/api/sync` contract answered by route
 * interception (no backend runs): shown only to an admin, hidden on a 403
 * without signing out, the list, one confirm before signing a profile's
 * devices out, nothing offered for this device, the code and its expiry,
 * New player, labels that never leave the device, and logging a fresh
 * device into a profile an admin made.
 *
 * Times are pinned to one zone so the 4:30 pm default reads the same on any
 * machine that runs the suite.
 */

test.use({ timezoneId: 'America/Los_Angeles', locale: 'en-US' });

const SELF_DEVICE = 'd-self';
const SELF_PLAYER = 'p-admin';

interface Device {
  device_id: string;
  created_at: string;
  last_seen_at: string | null;
}

interface Player {
  player_id: string;
  handle: [number, number] | null;
  boards: Record<string, { rung: string | null; games: number }>;
  devices: Device[];
  replays: number;
  created_at: string;
  updated_at: string;
  no_device_since: string | null;
  days_left: number | null;
}

interface Logged {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
  /** The request whole: URL, every header, raw body. */
  url: string;
  headers: Record<string, string>;
  raw: string | null;
}

function players(): Player[] {
  return [
    {
      player_id: SELF_PLAYER,
      handle: [2, 9], // Bright Koala
      boards: { '19x19': { rung: '9k', games: 40 } },
      devices: [{ device_id: SELF_DEVICE, created_at: '2026-09-01T16:00:00Z', last_seen_at: '2026-10-02T15:58:00Z' }],
      replays: 12,
      created_at: '2026-09-01T16:00:00Z',
      updated_at: '2026-10-02T15:58:00Z',
      no_device_since: null,
      days_left: null,
    },
    {
      player_id: 'p-two',
      handle: [26, 33], // Orbiting Voyager
      boards: { '19x19': { rung: '20k', games: 5 }, '9x9': { rung: '15k', games: 12 } },
      devices: [
        { device_id: 'd-a', created_at: '2026-09-10T16:00:00Z', last_seen_at: '2026-10-01T23:05:00Z' },
        { device_id: 'd-b', created_at: '2026-09-28T16:00:00Z', last_seen_at: null },
      ],
      replays: 7,
      created_at: '2026-09-10T16:00:00Z',
      updated_at: '2026-10-01T23:05:00Z',
      no_device_since: null,
      days_left: null,
    },
    {
      player_id: 'p-none',
      handle: [44, 18], // Speedy Phoenix
      boards: { '9x9': { rung: '25k', games: 3 } },
      devices: [],
      replays: 2,
      created_at: '2026-09-12T16:00:00Z',
      updated_at: '2026-09-14T16:00:00Z',
      no_device_since: '2026-09-14T16:00:00Z',
      days_left: 12,
    },
  ];
}

const OWN_STATE = {
  schema: 1,
  ladder: { byBoardSize: {}, undoBank: 3 },
  lessons: [],
  avatar: 'tide',
  avatarPicked: true,
  handle: [2, 9],
};

/** Answer `/api/sync/*` per the contract; abort every other API call. */
async function fakeSync(
  page: Page,
  opts: {
    admin?: boolean;
    adminStatus?: number;
    list?: Player[];
    redeem?: Record<string, unknown>;
    /** Leave `device_id` out of GET /state, as a server from before revision 3 would. */
    noDeviceId?: boolean;
  } = {},
) {
  const log: Logged[] = [];
  const list = opts.list ?? players();
  const ownState = (opts.redeem?.state as typeof OWN_STATE | undefined) ?? OWN_STATE;
  let rev = 1;
  let made = 0;
  // Match on the path, not a glob: Vite serves this app's own modules from
  // /src/api/*, which a '**/api/**' glob would catch too.
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, '');
    const method = req.method();
    const raw = req.postData();
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
    log.push({ method, path, body, url: req.url(), headers: await req.allHeaders(), raw });
    if (!path.startsWith('/sync/')) return route.abort();
    const reply = (status: number, json?: unknown) =>
      route.fulfill(
        status === 204
          ? { status }
          : { status, contentType: 'application/json', body: JSON.stringify(json ?? {}) },
      );

    if (method === 'POST' && path === '/sync/pairing-codes/redeem') {
      return opts.redeem ? reply(200, opts.redeem) : reply(404, { detail: 'unknown code' });
    }
    if (path.startsWith('/sync/admin/')) {
      if (opts.adminStatus) return reply(opts.adminStatus, { detail: 'refused' });
      if (method === 'GET' && path === '/sync/admin/players') return reply(200, { players: list });
      if (method === 'POST' && path === '/sync/admin/players') {
        const id = `p-made-${++made}`;
        const state = body!.state as { handle: [number, number] };
        list.unshift({
          player_id: id,
          handle: state.handle,
          boards: {},
          devices: [],
          replays: 0,
          created_at: '2026-10-02T16:00:00Z',
          updated_at: '2026-10-02T16:00:00Z',
          no_device_since: '2026-10-02T16:00:00Z',
          days_left: 30,
        });
        return reply(201, { player_id: id, rev: 1 });
      }
      if (method === 'POST' && /^\/sync\/admin\/players\/[^/]+\/pairing-codes$/.test(path)) {
        return reply(201, { code: 'K7QX2MPD', expires_at: String(body!.expires_at).replace(/\.\d+Z$/, 'Z') });
      }
      let m = /^\/sync\/admin\/devices\/([^/]+)$/.exec(path);
      if (m && method === 'DELETE' && m[1] === SELF_DEVICE) return reply(409, { detail: 'this device' });
      if (m && method === 'DELETE') {
        for (const p of list) p.devices = p.devices.filter((d) => d.device_id !== m![1]);
        return reply(204);
      }
      m = /^\/sync\/admin\/players\/([^/]+)\/devices$/.exec(path);
      if (m && method === 'DELETE') {
        const p = list.find((x) => x.player_id === m![1]);
        if (p) p.devices = [];
        return reply(204);
      }
      return reply(404, { detail: 'no route' });
    }
    if (method === 'GET' && path === '/sync/state') {
      return reply(200, {
        rev,
        state: ownState,
        admin: opts.admin ?? true,
        ...(opts.noDeviceId ? {} : { device_id: SELF_DEVICE }),
      });
    }
    if (method === 'PUT' && path === '/sync/state') {
      rev = Number(body!.base_rev) + 1;
      return reply(200, { rev });
    }
    if (method === 'GET' && path === '/sync/games') return reply(200, { games: [] });
    return reply(404, { detail: 'no route' });
  });
  return { log, list };
}

/** This device, logged into the admin profile, before the app starts. */
async function seedAdminDevice(page: Page, labels?: Record<string, string>) {
  await page.addInitScript((l) => {
    if (sessionStorage.getItem('seeded')) return; // only the first load
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem(
      'goforkids.profile.v1',
      JSON.stringify({ avatar: 'tide', avatarPicked: true, handle: [2, 9] }),
    );
    localStorage.setItem(
      'goforkids.sync.v1',
      JSON.stringify({ playerId: 'p-admin', deviceToken: 'tok-e2e', baseRev: 1 }),
    );
    if (l) localStorage.setItem('goforkids.admin.labels.v1', JSON.stringify(l));
  }, labels ?? null);
}

async function openProfile(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Profile/ }).click();
  await page.locator('.profile-devices').waitFor();
}

const row = (page: Page, id: string) => page.locator(`.profile-admin-row[data-player-id="${id}"]`);

test('not an admin: no Admin section, and no admin request', async ({ page }) => {
  const { log } = await fakeSync(page, { admin: false });
  await seedAdminDevice(page);
  await openProfile(page);
  await expect.poll(() => log.some((l) => l.path === '/sync/games')).toBe(true);
  await page.waitForTimeout(300);
  await expect(page.locator('.profile-admin')).toHaveCount(0);
  expect(log.filter((l) => l.path.startsWith('/sync/admin/'))).toEqual([]);
});

test('admin: the list, with nothing offered for this device', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-02T09:00:00-07:00'));
  await fakeSync(page);
  await seedAdminDevice(page, { 'p-two': 'Window seat' });
  await openProfile(page);
  await expect(row(page, 'p-two').locator('.profile-admin-label')).toHaveValue('Window seat');
  await expect(row(page, 'p-none').locator('.profile-admin-label')).toHaveValue('');
  await expect(page.locator('.profile-admin')).toBeVisible();
  await expect(page.locator('.profile-admin-row')).toHaveCount(3);

  // Own profile: this device marked, no Remove beside it, no sign-out.
  const own = row(page, SELF_PLAYER);
  await expect(own.locator('.profile-admin-name')).toHaveText('Bright Koala');
  await expect(own.locator('.profile-admin-ranks')).toContainText('19×19 9k · 40 games');
  await expect(own.locator('.profile-admin-device')).toHaveText(/^This device · Added Sep 1 · seen today at 8:58\sAM/);
  await expect(own.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  await expect(own.getByRole('button', { name: "Sign out this player's devices" })).toHaveCount(0);
  await expect(own.getByRole('button', { name: 'Code for this player' })).toBeVisible();

  // Two devices, each with when it was added and last seen, each removable.
  const two = row(page, 'p-two');
  await expect(two.locator('.profile-admin-name')).toHaveText('Orbiting Voyager');
  await expect(two.locator('.profile-admin-rank')).toHaveText(['9×9 15k · 12 games', '19×19 20k · 5 games']);
  await expect(two.locator('.profile-admin-device')).toHaveCount(2);
  await expect(two.locator('.profile-admin-device').nth(0)).toContainText(/Added Sep 10 · seen Oct 1 at 4:05\sPM/);
  await expect(two.locator('.profile-admin-device').nth(1)).toContainText(/Added Sep 28 · not seen yet/);
  await expect(two.getByRole('button', { name: 'Remove' })).toHaveCount(2);
  await expect(two.getByRole('button', { name: "Sign out this player's devices" })).toBeVisible();
  await expect(two).toContainText('7 replays');
  await expect(two.locator('.profile-admin-nodevice')).toHaveCount(0);

  // No device: the days left, nothing to sign out.
  const none = row(page, 'p-none');
  await expect(none.locator('.profile-admin-nodevice')).toHaveText('No device · 12 days left');
  await expect(none.getByRole('button', { name: "Sign out this player's devices" })).toHaveCount(0);
  await expect(none).toContainText('2 replays');
});

test('a 403 from an admin route hides the section and never signs the device out', async ({ page }) => {
  const { log } = await fakeSync(page, { adminStatus: 403 });
  await seedAdminDevice(page);
  await openProfile(page);
  await expect.poll(() => log.some((l) => l.path === '/sync/admin/players')).toBe(true);
  await expect(page.locator('.profile-admin')).toHaveCount(0);
  await expect(page.locator('.profile-devices')).toBeVisible();
  await expect(page.locator('.first-run')).toHaveCount(0);
  expect(log.filter((l) => l.method === 'DELETE')).toEqual([]);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('goforkids.sync.v1') ?? '{}'));
  expect(stored.deviceToken).toBe('tok-e2e');
  expect(stored.admin).toBe(false);
});

test("signing a profile's devices out takes one confirm", async ({ page }) => {
  const { log } = await fakeSync(page);
  await seedAdminDevice(page);
  await openProfile(page);
  const two = row(page, 'p-two');
  const signOuts = () => log.filter((l) => l.method === 'DELETE' && l.path === '/sync/admin/players/p-two/devices');

  await two.getByRole('button', { name: "Sign out this player's devices" }).click();
  await expect(two.locator('.profile-devices-warning')).toContainText('Sign out all 2 devices on Orbiting Voyager?');
  await two.getByRole('button', { name: 'Cancel' }).click();
  await expect(two.locator('.profile-devices-warning')).toHaveCount(0);
  expect(signOuts()).toHaveLength(0);

  await two.getByRole('button', { name: "Sign out this player's devices" }).click();
  expect(signOuts()).toHaveLength(0);
  await two.getByRole('button', { name: 'Yes, sign out' }).click();
  await expect.poll(() => signOuts().length).toBe(1);
  await expect(two.locator('.profile-admin-nodevice')).toBeVisible();
  await expect(two.locator('.profile-devices-warning')).toHaveCount(0);
  // Never this device's own session.
  expect(log.filter((l) => l.path === '/sync/devices/current')).toEqual([]);
});

test('Remove signs one device out at once', async ({ page }) => {
  const { log } = await fakeSync(page);
  await seedAdminDevice(page);
  await openProfile(page);
  const two = row(page, 'p-two');
  await two.getByRole('button', { name: 'Remove' }).first().click();
  await expect.poll(() => log.filter((l) => l.method === 'DELETE').map((l) => l.path)).toEqual(['/sync/admin/devices/d-a']);
  await expect(two.locator('.profile-admin-device')).toHaveCount(1);
});

test('a code: 4:30 pm today by default, sent as toISOString, shown in two groups of four', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-02T09:00:00-07:00'));
  const { log } = await fakeSync(page);
  await seedAdminDevice(page);
  await openProfile(page);
  const none = row(page, 'p-none');
  await none.getByRole('button', { name: 'Code for this player' }).click();

  const select = none.locator('select');
  await expect(select.locator('option:checked')).toHaveText(/^4:30\sPM today$/);
  // Nothing past 24 hours: the last offered is 9:00 AM tomorrow.
  await expect(select.locator('option').last()).toHaveText(/^9:00\sAM tomorrow$/);

  await expect(page.locator('.profile-admin-code')).toHaveCount(1); // in its own row only
  await expect(none.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(none.getByRole('button', { name: 'Done' })).toHaveCount(0);
  await none.getByRole('button', { name: 'Make code' }).click();
  await expect(none.locator('.profile-devices-code')).toHaveText('K7QX 2MPD');
  await expect(none.locator('.profile-admin-code')).toContainText(/Use it before 4:30\sPM today/);
  await expect(none.getByRole('button', { name: 'Make code' })).toHaveCount(0);
  await none.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.profile-admin-code')).toHaveCount(0);
  const sent = log.filter((l) => l.method === 'POST' && l.path === '/sync/admin/players/p-none/pairing-codes');
  expect(sent.map((l) => l.body)).toEqual([{ expires_at: '2026-10-02T23:30:00.000Z' }]);
});

test('a code after 4:30 pm: one hour from now by default; another pick sends that time', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-02T17:10:00-07:00'));
  const { log } = await fakeSync(page);
  await seedAdminDevice(page);
  await openProfile(page);
  const two = row(page, 'p-two');
  await two.getByRole('button', { name: 'Code for this player' }).click();
  const select = two.locator('select');
  await expect(select.locator('option:checked')).toHaveText(/^6:10\sPM today$/);
  await expect(select.locator('option').last()).toHaveText(/^5:00\sPM tomorrow$/);
  await select.selectOption({ label: (await select.locator('option').last().textContent())! });
  await two.getByRole('button', { name: 'Make code' }).click();
  await expect(two.locator('.profile-devices-code')).toHaveText('K7QX 2MPD');
  const sent = log.filter((l) => l.method === 'POST' && l.path === '/sync/admin/players/p-two/pairing-codes');
  expect(sent.map((l) => l.body)).toEqual([{ expires_at: '2026-10-04T00:00:00.000Z' }]);
});

test('New player: a generated name with Shuffle, created with the fresh state, then in the list', async ({ page }) => {
  const { log } = await fakeSync(page);
  await seedAdminDevice(page);
  await openProfile(page);
  await expect(page.locator('.profile-admin-row')).toHaveCount(3);

  // Cancel leaves without making anything.
  await page.locator('.profile-admin').getByRole('button', { name: 'New player' }).click();
  await page.locator('.profile-admin-new').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.profile-admin-new')).toHaveCount(0);

  // Hold the create's reply, to see the step wait for it.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(
    (url) => url.pathname === '/api/sync/admin/players',
    async (route) => {
      if (route.request().method() === 'POST') await held;
      return route.fallback();
    },
  );

  await page.locator('.profile-admin').getByRole('button', { name: 'New player' }).click();
  const name = page.locator('.profile-admin-new-name');
  const first = (await name.textContent())!;
  expect(first).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  await page.locator('.profile-admin-new').getByRole('button', { name: 'Shuffle' }).click();
  await expect(name).not.toHaveText(first);
  const chosen = (await name.textContent())!;
  expect(log.filter((l) => l.method === 'POST' && l.path === '/sync/admin/players')).toEqual([]);

  await page.getByRole('button', { name: 'Create player' }).click();
  // One create at a time: the step waits, and nothing in it can be pressed again.
  const step = page.locator('.profile-admin-new');
  await expect(step.getByRole('button', { name: 'Creating…' })).toBeDisabled();
  await expect(step.getByRole('button', { name: 'Shuffle' })).toBeDisabled();
  release();
  await expect(page.locator('.profile-admin-row')).toHaveCount(4);
  await expect(page.locator('.profile-admin-new')).toHaveCount(0);
  const created = log.filter((l) => l.method === 'POST' && l.path === '/sync/admin/players');
  expect(created).toHaveLength(1);
  const state = created[0].body!.state as { handle: [number, number] };
  expect(created[0].body).toStrictEqual({
    state: {
      schema: 1,
      ladder: { byBoardSize: {} },
      lessons: [],
      avatar: 'blackhole',
      avatarPicked: false,
      handle: state.handle,
    },
  });
  const fresh = row(page, 'p-made-1');
  await expect(fresh).toHaveClass(/profile-admin-row-new/);
  await expect(fresh.locator('.profile-admin-name')).toHaveText(chosen);
  await expect(fresh.locator('.profile-admin-ranks')).toHaveText('No ranked games yet');
  await expect(fresh.locator('.profile-admin-nodevice')).toHaveText('No device · 30 days left');
  await expect(fresh.getByRole('button', { name: 'Code for this player' })).toBeVisible();
});

test('labels stay on this device: no request carries one, through every admin action and a sync pass', async ({ page }) => {
  // Every request the page makes, API or not (the API ones again, whole, in `log`).
  const sent: { url: string; headers: Record<string, string>; body: string | null }[] = [];
  page.on('request', (r: Request) => {
    sent.push({ url: r.url(), headers: r.headers(), body: r.postData() });
  });
  const { log } = await fakeSync(page);
  await seedAdminDevice(page);
  await openProfile(page);

  await row(page, SELF_PLAYER).locator('.profile-admin-label').fill('LBL Front table');
  await row(page, 'p-two').locator('.profile-admin-label').fill('LBL Window seat');
  await row(page, 'p-none').locator('.profile-admin-label').fill('LBL New iPad');

  // Every admin action.
  const lists = () => log.filter((l) => l.method === 'GET' && l.path === '/sync/admin/players').length;
  const before = lists();
  await page.locator('.profile-admin').getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(lists).toBe(before + 1);
  await page.locator('.profile-admin').getByRole('button', { name: 'New player' }).click();
  await page.getByRole('button', { name: 'Create player' }).click();
  await row(page, 'p-made-1').locator('.profile-admin-label').fill('LBL Made here');
  await row(page, 'p-none').getByRole('button', { name: 'Code for this player' }).click();
  await row(page, 'p-none').getByRole('button', { name: 'Make code' }).click();
  await expect(row(page, 'p-none').locator('.profile-devices-code')).toBeVisible();
  await row(page, 'p-two').getByRole('button', { name: 'Remove' }).first().click();
  await expect(row(page, 'p-two').locator('.profile-admin-device')).toHaveCount(1);
  await row(page, 'p-two').getByRole('button', { name: "Sign out this player's devices" }).click();
  // The confirm names the profile by its label: shown here, never sent.
  await expect(row(page, 'p-two').locator('.profile-devices-warning')).toContainText(
    'Sign out the 1 device on LBL Window seat?',
  );
  await row(page, 'p-two').getByRole('button', { name: 'Yes, sign out' }).click();
  await expect(row(page, 'p-two').locator('.profile-admin-nodevice')).toBeVisible();
  // A sync pass that pushes: a new avatar.
  await page.locator('.profile-avatar-option').nth(2).click();
  await expect.poll(() => log.some((l) => l.method === 'PUT' && l.path === '/sync/state')).toBe(true);

  for (const kind of [
    ['GET', '/sync/admin/players'],
    ['POST', '/sync/admin/players'],
    ['POST', '/sync/admin/players/p-none/pairing-codes'],
    ['DELETE', '/sync/admin/devices/d-a'],
    ['DELETE', '/sync/admin/players/p-two/devices'],
    ['GET', '/sync/state'],
  ]) {
    expect(log.some((l) => l.method === kind[0] && l.path === kind[1]), kind.join(' ')).toBe(true);
  }
  const everything = JSON.stringify([sent, log]);
  expect(everything).not.toContain('LBL');
  expect(everything).not.toContain('Front table');
  expect(everything).not.toContain('Window seat');
  expect(everything).not.toContain('New iPad');
  expect(everything).not.toContain('Made here');

  const labels = await page.evaluate(() => JSON.parse(localStorage.getItem('goforkids.admin.labels.v1') ?? '{}'));
  expect(labels).toEqual({
    [SELF_PLAYER]: 'LBL Front table',
    'p-two': 'LBL Window seat',
    'p-none': 'LBL New iPad',
    'p-made-1': 'LBL Made here',
  });
});

test('a failed action says why beside its row, and a stale or gone one is put right', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-02T09:00:00-07:00'));
  const { log, list } = await fakeSync(page);
  await seedAdminDevice(page);
  let codeTries = 0;
  // Remove answers 404 (the device went meanwhile); the code route is down.
  await page.route(
    (url) => /\/api\/sync\/admin\/(devices\/d-a|players\/p-none\/pairing-codes)$/.test(url.pathname),
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/devices/d-a')) {
        list[1].devices = list[1].devices.filter((d) => d.device_id !== 'd-a');
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"unknown device"}' });
      }
      // The first try finds the server down; the next, a time it refuses.
      return (codeTries += 1) === 1
        ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"down"}' })
        : route.fulfill({ status: 422, contentType: 'application/json', body: '{"detail":"expiry"}' });
    },
  );
  await openProfile(page);
  const lists = () => log.filter((l) => l.method === 'GET' && l.path === '/sync/admin/players').length;
  const two = row(page, 'p-two');
  await expect(two.locator('.profile-admin-device')).toHaveCount(2);
  const loaded = lists();

  await two.getByRole('button', { name: 'Remove' }).first().click();
  await expect(two.getByRole('alert')).toHaveText('That player or device is gone. The list is up to date now.');
  await expect(page.getByRole('alert')).toHaveCount(1); // beside its own row only
  await expect.poll(lists).toBe(loaded + 1);
  await expect(two.locator('.profile-admin-device')).toHaveCount(1);

  const none = row(page, 'p-none');
  await none.getByRole('button', { name: 'Code for this player' }).click();
  await none.getByRole('button', { name: 'Make code' }).click();
  await expect(none.getByRole('alert')).toHaveText("Couldn't connect. Try again in a minute.");
  await expect(none.locator('.profile-devices-code')).toHaveCount(0);
  await none.getByRole('button', { name: 'Make code' }).click();
  await expect.poll(() => codeTries).toBe(2);
  await expect(none.getByRole('alert')).toHaveText('That time has passed. Pick a later one.');
  await expect(none.locator('.profile-devices-code')).toHaveCount(0);

  // The dialog left open past the time picked: fresh times, and no request.
  const codes = () => log.filter((l) => l.path.endsWith('/pairing-codes')).length;
  const sentCodes = codes();
  await page.clock.setFixedTime(new Date('2026-10-02T16:40:00-07:00'));
  await none.getByRole('button', { name: 'Make code' }).click();
  await expect(none.getByRole('alert')).toHaveText('That time has passed. Pick a later one.');
  await expect(none.locator('select option:checked')).toHaveText(/^5:40\sPM today$/);
  expect(codes()).toBe(sentCodes);
});

test('before the server has said which device this is, its 409 explains', async ({ page }) => {
  const { log } = await fakeSync(page, { noDeviceId: true });
  await seedAdminDevice(page);
  await openProfile(page);
  const own = row(page, SELF_PLAYER);
  await own.getByRole('button', { name: 'Remove' }).click();
  await expect(own.getByRole('alert')).toHaveText('This device signs out with Log out, above.');
  expect(log.filter((l) => l.method === 'DELETE').map((l) => l.path)).toEqual([`/sync/admin/devices/${SELF_DEVICE}`]);
  await expect(page.locator('.first-run')).toHaveCount(0);
});

test('a profile with no name yet, one replay, and no device', async ({ page }) => {
  const own = players()[0];
  await fakeSync(page, {
    list: [
      own,
      {
        ...players()[2],
        player_id: 'p-odd',
        handle: null,
        boards: { '9x9': { rung: '25k', games: 1 } },
        replays: 1,
        days_left: null,
      },
    ],
  });
  await seedAdminDevice(page);
  await openProfile(page);
  const odd = row(page, 'p-odd');
  await expect(odd.locator('.profile-admin-name')).toHaveText('No name');
  await expect(odd.locator('.profile-admin-rank')).toHaveText('9×9 25k · 1 game');
  await expect(odd).toContainText('1 replay');
  await expect(odd).not.toContainText('1 replays');
  await expect(odd.locator('.profile-admin-nodevice')).toHaveText('No device');
});

test('a list that will not load says so', async ({ page }) => {
  await fakeSync(page);
  await seedAdminDevice(page);
  await page.route(
    (url) => url.pathname === '/api/sync/admin/players',
    (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"down"}' }),
  );
  await openProfile(page);
  await expect(page.locator('.profile-admin')).toContainText("Couldn't load the list. Try Refresh when you're connected.");
  await expect(page.locator('.profile-admin-row')).toHaveCount(0);
});

test('a new device logs into an admin-made profile on "I already play on another device"', async ({ page }) => {
  await fakeSync(page, {
    admin: false,
    redeem: {
      player_id: 'p-made-1',
      device_token: 'tok-new',
      rev: 1,
      state: {
        schema: 1,
        ladder: { byBoardSize: {} },
        lessons: [],
        avatar: 'blackhole',
        avatarPicked: false,
        handle: [7, 13],
      },
    },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'I already play on another device' }).click();
  await page.locator('.first-run-input').fill('k7qx 2mpd');
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page.locator('.first-run')).toHaveCount(0);
  await expect(page.locator('.home-rank-chip-rank')).toHaveText(['30k', '30k']);
  await page.getByRole('button', { name: /Profile/ }).click();
  await expect(page.locator('.profile-name-text')).toHaveText('Sunny Raven');
  await expect(page.locator('.profile-rank-big')).toHaveText('30k');
  await expect(page.locator('.profile-recent-empty')).toBeVisible();
  const stored = await page.evaluate(() => ({
    profile: JSON.parse(localStorage.getItem('goforkids.profile.v1') ?? '{}'),
    lessons: localStorage.getItem('goforkids-learn-progress'),
  }));
  expect(stored.profile).toEqual({ avatar: 'blackhole', avatarPicked: false, handle: [7, 13] });
  expect(JSON.parse(stored.lessons ?? '[]')).toEqual([]);
  await expect(page.locator('.profile-admin')).toHaveCount(0);
});
