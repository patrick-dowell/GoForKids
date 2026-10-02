import { test, expect, type Page } from '@playwright/test';

/**
 * Home, Profile and Friends as one layout (feature 32, revision 7): the
 * player's avatar with the two rank chips; the avatar opens the profile on
 * the active board's tab and a chip on its own board's; the tabs show each
 * board's ladder without changing which board Play plays next; a per-board
 * action on a tab lands on that board only; the Friends button where
 * Profile was, with a badge for requests; the Friends page, logged in or
 * not, and back home.
 *
 * Nothing leaves the browser: sync is aborted (as offline), or answered
 * here for the logged-in Friends page.
 */

const AUTOPLAY = {
  byBoardSize: {
    '9x9': { rungState: { currentRung: '15k', winsAtCurrentRung: 1, lossStreak: 0 }, history: [], promotionEvents: [] },
    '19x19': { rungState: { currentRung: '20k', winsAtCurrentRung: 0, lossStreak: 0 }, history: [], promotionEvents: [] },
  },
  undoBank: 3,
};

/** A player on this device with a ladder on each board; sync offline. */
async function seedPlayer(page: Page) {
  await page.route('**/api/sync/**', (route) => route.abort());
  await page.addInitScript((autoplay) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('goforkids.profile.v1', JSON.stringify({ avatar: 'comet', avatarPicked: true, handle: [2, 9] }));
    localStorage.setItem('goforkids.autoplay.v1', JSON.stringify(autoplay));
  }, AUTOPLAY);
}

/** The board Play plays next (the auto-play store's active board). */
const activeBoard = (page: Page) =>
  page.evaluate(() => (window as unknown as { __autoPlayStore: { getState: () => { boardSize: number } } }).__autoPlayStore.getState().boardSize);

const tab = (page: Page, name: '9×9' | '19×19') => page.getByRole('tab', { name: new RegExp(`^${name}`) });
const profileButton = (page: Page) => page.getByRole('button', { name: 'Profile', exact: true });

test('home: the avatar, then a chip per board; Friends where Profile was', async ({ page }) => {
  await seedPlayer(page);
  await page.goto('/');
  const row = page.locator('.home-rank-chips');
  await expect(row.locator(':scope > button')).toHaveCount(3);
  await expect(row.locator(':scope > button').first()).toHaveClass(/home-player-btn/);
  await expect(profileButton(page).locator('.avatar')).toHaveClass(/avatar-comet/);
  await expect(page.locator('.home-rank-chip-rank')).toHaveText(['15k', '20k']);
  // The action list: Friends last, no Profile button left.
  await expect(page.locator('.home-actions > button').last()).toHaveText(/Friends/);
  await expect(page.locator('.home-actions').getByText('Profile')).toHaveCount(0);
});

test('the avatar opens the profile on the active board; a chip on its own board; Play keeps its board', async ({ page }) => {
  await seedPlayer(page);
  await page.goto('/');
  expect(await activeBoard(page)).toBe(19);

  await profileButton(page).click();
  await expect(tab(page, '19×19')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, '9×9')).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('.profile-rank-big')).toHaveText('20k');
  await expect(page.locator('.profile-name-text')).toBeVisible();

  await page.getByRole('button', { name: 'Back to home' }).click();
  await page.getByRole('button', { name: /^Open 9×9 profile/ }).click();
  await expect(tab(page, '9×9')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.profile-rank-big')).toHaveText('15k');
  // Opening the 9×9 tab did not make 9×9 the board Play plays next.
  expect(await activeBoard(page)).toBe(19);

  await page.getByRole('button', { name: 'Back to home' }).click();
  await page.getByRole('button', { name: /^Open 19×19 profile/ }).click();
  await expect(tab(page, '19×19')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.profile-rank-big')).toHaveText('20k');

  // Play shows the 19×19 ladder, as before any of this.
  await page.getByRole('button', { name: 'Back to home' }).click();
  await page.getByRole('button', { name: /^▶/ }).click();
  await expect(page.locator('.autoplay-board-pill-active')).toHaveText('19×19');
});

test('switching tabs shows each board and leaves the active board alone', async ({ page }) => {
  await seedPlayer(page);
  await page.goto('/');
  await profileButton(page).click();
  await expect(tab(page, '9×9')).toContainText('15k');
  await expect(tab(page, '19×19')).toContainText('20k');

  await tab(page, '9×9').click();
  await expect(page.locator('.profile-rank-big')).toHaveText('15k');
  await expect(page.locator('.profile-rank-card .profile-section-eyebrow')).toHaveText('9×9 — Auto-play');
  expect(await activeBoard(page)).toBe(19);

  await tab(page, '19×19').click();
  await expect(page.locator('.profile-rank-big')).toHaveText('20k');
  expect(await activeBoard(page)).toBe(19);

  // The board-independent sections sit below the tabs, once.
  await expect(page.locator('.profile-board-panel .profile-avatar-grid')).toHaveCount(0);
  await expect(page.locator('.profile-avatar-grid')).toHaveCount(1);
  await expect(page.locator('.profile-devices')).toHaveCount(1);
  await expect(page.locator('.profile-friends')).toHaveCount(0);
});

test('derank on the 9×9 tab moves 9×9 down only; Play still plays 19×19', async ({ page }) => {
  await seedPlayer(page);
  await page.goto('/');
  await profileButton(page).click();
  await tab(page, '9×9').click();
  await page.getByRole('button', { name: 'Too tough? Move down a rank…' }).click();
  await page.getByRole('button', { name: /^Tap again to move down to/ }).click();
  await expect(page.locator('.profile-rank-big')).toHaveText('16k');
  await expect(tab(page, '9×9')).toContainText('16k');
  await expect(tab(page, '19×19')).toContainText('20k');
  expect(await activeBoard(page)).toBe(19);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('goforkids.autoplay.v1') ?? '{}'));
  expect(stored.byBoardSize['9x9'].rungState.currentRung).toBe('16k');
  expect(stored.byBoardSize['19x19'].rungState.currentRung).toBe('20k');

  await page.getByRole('button', { name: 'Back to home' }).click();
  await expect(page.locator('.home-rank-chip-rank')).toHaveText(['16k', '20k']);
});

test('Advanced: per-board blocks in the tab, the all-boards tools below', async ({ page }) => {
  await seedPlayer(page);
  await page.goto('/');
  await profileButton(page).click();
  await tab(page, '9×9').click();
  await page.locator('.profile-advanced-toggle').click();
  await expect(page.locator('.profile-advanced-toggle')).toHaveText(/Advanced · 9×9/);
  const panel = page.locator('.profile-board-panel');
  await expect(panel.getByText('Glicko-2 (shadow)')).toBeVisible();
  await expect(panel.getByText('Matchmaker decision')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Set rung' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Reset to 30k…' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Export JSON' })).toHaveCount(0);
  const all = page.locator('.profile-advanced-all');
  await expect(all.getByRole('button', { name: 'Export JSON' })).toBeVisible();
  await expect(all.getByRole('button', { name: 'Import JSON' })).toBeVisible();
  // The rung picker lists the tab's ladder (9×9 has a 28k rung; 19×19 doesn't).
  await expect(panel.locator('#profile-manual-rank option[value="28k"]')).toHaveCount(1);
  await tab(page, '19×19').click();
  await expect(page.locator('.profile-advanced-toggle')).toHaveText(/Advanced · 19×19/);
  await expect(page.locator('#profile-manual-rank option[value="28k"]')).toHaveCount(0);
});

test('Friends button: a badge only while requests wait', async ({ page }) => {
  await seedPlayer(page);
  await page.goto('/');
  const friends = page.locator('.home-btn-friends');
  await expect(friends).toBeVisible();
  await expect(friends.locator('.home-btn-badge')).toHaveCount(0);

  const setIncoming = (n: number) =>
    page.evaluate((count) => {
      const store = (window as unknown as { __friendsStore: { setState: (s: object) => void } }).__friendsStore;
      store.setState({
        incoming: Array.from({ length: count }, (_, i) => ({
          player_id: `0a0a0a0a-0000-4000-8000-00000000000${i}`,
          handle: [i, i],
          avatar: 'nova',
          sent_at: '2026-10-02T15:00:00Z',
        })),
      });
    }, n);

  await setIncoming(2);
  await expect(friends.locator('.home-btn-badge')).toHaveText('2');
  await expect(page.getByRole('button', { name: 'Friends, 2 requests' })).toBeVisible();
  await setIncoming(1);
  await expect(page.getByRole('button', { name: 'Friends, 1 request' })).toBeVisible();
  // The badge caps at "9+"; the accessible name keeps the count.
  await setIncoming(12);
  await expect(friends.locator('.home-btn-badge')).toHaveText('9+');
  await expect(page.getByRole('button', { name: 'Friends, 12 requests' })).toBeVisible();
  await setIncoming(0);
  await expect(friends.locator('.home-btn-badge')).toHaveCount(0);
});

test('the avatar opens the profile on the active board when that board is 9×9', async ({ page }) => {
  await seedPlayer(page);
  await page.goto('/');
  // Pick 9×9 on Play's match-picker, which is what sets the board Play plays.
  await page.getByRole('button', { name: /^▶/ }).click();
  await page.locator('.autoplay-board-pill', { hasText: '9×9' }).click();
  await expect(page.locator('.autoplay-board-pill-active')).toHaveText('9×9');
  expect(await activeBoard(page)).toBe(9);
  await page.getByRole('button', { name: 'Back to home' }).click();

  await profileButton(page).click();
  await expect(tab(page, '9×9')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.profile-rank-big')).toHaveText('15k');
});

test('Friends page, not logged in: says so, offers nothing else, and the home button goes back', async ({ page }) => {
  await seedPlayer(page);
  await page.goto('/');
  await page.locator('.home-btn-friends').click();
  const note = page.locator('.friends-page-offline');
  await expect(note).toHaveText('Friends need your player saved online first. That will happen next time this device is connected.');
  await expect(page.locator('.profile-friends')).toHaveCount(0);
  // Nothing to press but the home button (and the app's floating controls).
  await expect(page.locator('.friends-page button')).toHaveCount(1);
  await page.getByRole('button', { name: 'Go to the home screen' }).click();
  await expect(page.locator('.home-page')).toBeVisible();
});

test('Friends page, logged in: the Friends section, as on the profile before', async ({ page }) => {
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => {
      const path = new URL(route.request().url()).pathname;
      const body =
        path === '/api/sync/state'
          ? { rev: 1, state: { schema: 1, ladder: { byBoardSize: {} }, lessons: [], avatar: 'comet', avatarPicked: true, handle: [2, 9] }, admin: false, device_id: 'd-self' }
          : path === '/api/sync/games'
            ? { games: [] }
            : path === '/api/sync/friends/code'
              ? { code: 'K7QX2MPD' }
              : path === '/api/sync/friends'
                ? { friends: [], incoming: [{ player_id: '0a0a0a0a-0000-4000-8000-000000000005', handle: [21, 4], avatar: 'prism', sent_at: '2026-10-02T15:00:00Z' }] }
                : null;
      return body ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }) : route.abort();
    },
  );
  await page.addInitScript(() => {
    localStorage.setItem('goforkids.profile.v1', JSON.stringify({ avatar: 'comet', avatarPicked: true, handle: [2, 9] }));
    localStorage.setItem('goforkids.sync.v1', JSON.stringify({ playerId: 'p-self', deviceToken: 'tok-e2e', baseRev: 1 }));
  });
  await page.goto('/');
  await page.locator('.home-btn-friends').click();
  const section = page.locator('.friends-page .profile-friends');
  await expect(section.locator('.profile-friends-code')).toHaveText('K7QX 2MPD');
  await expect(section.locator('.profile-friends-request')).toHaveCount(1);
  await expect(page.locator('.friends-page-offline')).toHaveCount(0);
  // Back home, the request shows on the button.
  await page.getByRole('button', { name: 'Go to the home screen' }).click();
  await expect(page.locator('.home-btn-friends .home-btn-badge')).toHaveText('1');
});

test('deep links still land: a lesson and the demo replay', async ({ page }) => {
  await seedPlayer(page);
  await page.goto('/?learn=1');
  await expect(page.locator('.learn-back-btn')).toBeVisible();
  await page.goto('/?replay=demo');
  await expect(page.locator('.replay-controls')).toBeVisible();
});
