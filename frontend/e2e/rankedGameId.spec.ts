import { test, expect, type Page } from '@playwright/test';

/**
 * Feature 32, revision 8, the sending side of "a feed result opens its
 * game": when a ranked game ends, App's game-end effect records the result
 * with the id the finished game was just saved under (gameStore.savedGameId),
 * so the history entry sync pushes names the replay sync uploads, and a
 * friend's feed links the two by that id rather than by time.
 *
 * Driven through the real UI (home → Play → Play → Resign) on a logged-in
 * device, against fakes answered by route interception: the game backend
 * (`POST /api/games`, `POST /api/games/{id}/resign`) and the `/api/sync`
 * routes a push uses. No backend runs.
 */

const BACKEND_ID = 'c0ffee42';

interface Logged {
  method: string;
  path: string;
  raw: string | null;
}

/** Answer the game backend (or refuse it, `backendDown`) and the sync routes. */
async function fakeBackend(page: Page, opts: { backendDown?: boolean } = {}) {
  const log: Logged[] = [];
  let rev = 1;
  // Nothing in this spec ever reaches a deployed host.
  await page.route(/onrender\.com/, (route) => route.abort());
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, '');
    const method = req.method();
    const raw = req.postData();
    log.push({ method, path, raw });
    const reply = (status: number, json: unknown = {}) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });

    if (path === '/games' && method === 'POST') {
      if (opts.backendDown) return route.abort();
      return reply(200, { game_id: BACKEND_ID, board: [], current_color: 'black', phase: 'playing' });
    }
    if (path === `/games/${BACKEND_ID}/resign` && method === 'POST') return reply(200, { game_id: BACKEND_ID });
    if (method === 'GET' && path === '/sync/state') {
      return reply(200, {
        rev,
        state: { schema: 1, ladder: { byBoardSize: {}, undoBank: 3 }, lessons: [], avatar: 'tide', avatarPicked: true, handle: [2, 9] },
        admin: false,
        device_id: 'd-self',
      });
    }
    if (method === 'PUT' && path === '/sync/state') {
      rev = Number(JSON.parse(raw ?? '{}').base_rev) + 1;
      return reply(200, { rev });
    }
    if (method === 'GET' && path === '/sync/games') return reply(200, { games: [] });
    if (method === 'PUT' && path.startsWith('/sync/games/')) return reply(200, { kept: true });
    if (method === 'GET' && path === '/sync/friends') return reply(200, { friends: [], incoming: [] });
    return reply(404, { detail: 'no route' });
  });
  return log;
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

/** Home → Play → the match-picker's Play → Resign at once. */
async function playARankedGameAndResign(page: Page) {
  await page.goto('/');
  await page.locator('.home-btn-primary').click();
  const play = page.locator('.autoplay-play-btn');
  await expect(play).toBeEnabled();
  await play.click();
  await page.locator('.go-board-canvas').waitFor();
  // The board shows before the new game is set (it waits on the backend):
  // resign only once the ranked game itself is on the board.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = (window as unknown as GameHook).__gameStore.getState();
        return s.autoplayContext && s.phase === 'playing';
      }),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Resign' }).click();
}

interface GameHook {
  __gameStore: { getState: () => { phase: string; autoplayContext: boolean; savedGameId: string | null } };
}

/** What the finished game left behind: the id it was saved under, the
 *  Library's newest game, and the ranked history's newest entry. */
async function afterTheGame(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as GameHook & {
      __autoPlayStore: { getState: () => { history: { result: string; gameId?: string }[] } };
    };
    const history = w.__autoPlayStore.getState().history;
    const library = JSON.parse(localStorage.getItem('goforkids_library') ?? '[]') as { id: string }[];
    return {
      savedGameId: w.__gameStore.getState().savedGameId,
      libraryId: library[0]?.id ?? null,
      entries: history.length,
      entry: history[history.length - 1] ?? null,
    };
  });
}

/** Every history entry in the ladder of each `PUT /sync/state` sent. */
function pushedEntries(log: Logged[]) {
  return log
    .filter((l) => l.method === 'PUT' && l.path === '/sync/state')
    .flatMap((l) => {
      const ladder = JSON.parse(l.raw ?? '{}').state?.ladder?.byBoardSize ?? {};
      return Object.values(ladder).flatMap((slot) => (slot as { history?: { gameId?: string }[] }).history ?? []);
    });
}

for (const { name, backendDown, shape } of [
  { name: 'the backend game id', backendDown: false, shape: new RegExp(`^${BACKEND_ID}$`) },
  { name: 'a local id when the backend was out of reach', backendDown: true, shape: /^local-\d+$/ },
]) {
  test(`a finished ranked game's result names the replay it was saved as: ${name}`, async ({ page }) => {
    const log = await fakeBackend(page, { backendDown });
    await seedLoggedIn(page);
    await playARankedGameAndResign(page);

    // The game was saved, then its result recorded: one entry, a loss.
    await expect.poll(async () => (await afterTheGame(page)).entries).toBe(1);
    const after = await afterTheGame(page);
    expect(after.savedGameId).toMatch(shape);
    expect(after.libraryId).toBe(after.savedGameId);
    expect(after.entry).toMatchObject({ result: 'loss' });
    // THE point: the entry names the saved game.
    expect(after.entry?.gameId).toBe(after.savedGameId);

    // And that is what reaches the server: the replay uploaded under that
    // id, and a pushed history entry naming it.
    const id = after.savedGameId!;
    await expect.poll(() => log.some((l) => l.method === 'PUT' && l.path === `/sync/games/${encodeURIComponent(id)}`)).toBe(true);
    await expect.poll(() => pushedEntries(log).map((e) => e.gameId ?? null)).toContain(id);
  });
}
