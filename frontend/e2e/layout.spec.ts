import { test, expect, type Page } from '@playwright/test';

/**
 * Layout-regression sweep: walk the device-viewport matrix on every major
 * screen and assert nothing critical is cut off. Codifies the manual sweep
 * from DEVJOURNAL Session 29 (2026-07-01).
 *
 * LAYOUT POLICY (Patrick, 2026-07-01): scrolling is allowed in exactly TWO
 * places — the Profile page and the Library's replay list. Every other
 * screen must fit the viewport entirely, at every supported viewport.
 * So STRICT is the default probe; REACHABLE (scrollable-ancestor allowed;
 * body scroll never counts — WKWebView, S17 lesson) exists only for the two
 * sanctioned screens.
 *
 * Viewports resize WITHOUT reloading, so each test navigates once and then
 * sweeps the whole matrix — fast, and exactly how the manual sweep worked.
 */

/** Real iOS safe-area insets per device (logical pts, viewport-fit=cover).
 *  Chromium reports env(safe-area-inset-*) as 0, so without emulating these
 *  the sweep audits a device that doesn't exist — every phone-portrait probe
 *  ran with ~93px more height than Patrick's actual phone. The app routes
 *  insets through the --safe-* custom properties (App.css:19), so sweep()
 *  overrides those per viewport. This is how the S34 highlight-note cutoff
 *  shipped through a green suite. */
interface Insets { top: number; bottom: number; left: number; right: number }
const PHONE_PORTRAIT: Insets = { top: 59, bottom: 34, left: 0, right: 0 };
const PHONE_LANDSCAPE: Insets = { top: 0, bottom: 21, left: 59, right: 59 };
const IPAD: Insets = { top: 24, bottom: 20, left: 0, right: 0 };
const IPAD_HOMEBUTTON: Insets = { top: 20, bottom: 0, left: 0, right: 0 };

const VIEWPORTS = [
  { name: 'iPhone Pro portrait', width: 393, height: 852, insets: PHONE_PORTRAIT },
  { name: 'iPhone Pro landscape', width: 852, height: 393, insets: PHONE_LANDSCAPE },
  { name: 'iPhone Pro Max portrait', width: 430, height: 932, insets: PHONE_PORTRAIT },
  { name: 'iPhone Pro Max landscape', width: 932, height: 430, insets: PHONE_LANDSCAPE },
  { name: 'iPad mini portrait', width: 744, height: 1133, insets: IPAD },
  { name: 'iPad mini landscape', width: 1133, height: 744, insets: IPAD },
  { name: 'iPad 10.2 portrait', width: 810, height: 1080, insets: IPAD_HOMEBUTTON },
  { name: 'iPad 10.2 landscape', width: 1080, height: 810, insets: IPAD_HOMEBUTTON }, // Roland's board bug (S29 #1)
  { name: 'iPad Air portrait', width: 820, height: 1180, insets: IPAD },
  { name: 'iPad Air landscape', width: 1180, height: 820, insets: IPAD }, // replay grid bug (S29 #2)
  { name: 'iPad Pro 12.9 portrait', width: 1024, height: 1366, insets: IPAD },
  { name: 'iPad Pro 12.9 landscape', width: 1366, height: 1024, insets: IPAD },
  { name: 'iPad Pro 13 portrait', width: 1032, height: 1376, insets: IPAD }, // replay-panel bug (S29 addendum)
  { name: 'iPad Pro 13 landscape', width: 1376, height: 1032, insets: IPAD },
];

/** Selector prefixed with `btn:` matches a button by exact trimmed text. */
interface ProbeSpec {
  strict?: string[];
  reachable?: string[];
  /** When true, page/body scrolling does NOT count toward reachability —
   *  only an explicit scrollable ancestor does. WKWebView body scrolling is
   *  unreliable (S17 profile bug; S29 addendum: 13" iPad Pro replay panel),
   *  so screens that depend on scrolling must own an explicit container. */
  noBodyScroll?: boolean;
  /** Elements that must render square (|w − h| ≤ 2px). Catches the class of
   *  bug where a stray width/height cap distorts the board canvas while
   *  every visibility check still passes (found 2026-07-01, phone-landscape
   *  replay). */
  square?: string[];
}

/** Returns [] when clean, else human-readable issue strings. */
async function probe(page: Page, spec: ProbeSpec): Promise<string[]> {
  return page.evaluate(({ strict = [], reachable = [], noBodyScroll = false, square = [] }) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const issues: string[] = [];

    const find = (sel: string): Element | undefined =>
      sel.startsWith('btn:')
        ? [...document.querySelectorAll('button')].find(
            (b) => (b.textContent || '').trim() === sel.slice(4),
          )
        : (document.querySelector(sel) ?? undefined);

    const scrollReachable = (el: Element): boolean => {
      let p: Element | null = el.parentElement;
      while (p) {
        const s = getComputedStyle(p);
        if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 1) return true;
        p = p.parentElement;
      }
      if (noBodyScroll) return false;
      return document.documentElement.scrollHeight > vh + 1;
    };

    const hOv = document.documentElement.scrollWidth - vw;
    if (hOv > 1) issues.push(`page horizontal overflow +${Math.round(hOv)}px`);

    for (const sel of strict) {
      const el = find(sel);
      if (!el) {
        issues.push(`${sel}: MISSING`);
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.bottom > vh + 1) issues.push(`${sel}: bottom +${Math.round(r.bottom - vh)}px past viewport`);
      if (r.top < -1) issues.push(`${sel}: top ${Math.round(r.top)}px above viewport`);
      if (r.right > vw + 1) issues.push(`${sel}: right +${Math.round(r.right - vw)}px past viewport`);
      if (r.left < -1) issues.push(`${sel}: left ${Math.round(r.left)}px off-screen`);
    }

    for (const sel of reachable) {
      const el = find(sel);
      if (!el) {
        issues.push(`${sel}: MISSING`);
        continue;
      }
      const r = el.getBoundingClientRect();
      const offscreen = r.bottom > vh + 1 || r.top < -1;
      if (offscreen && !scrollReachable(el)) {
        issues.push(`${sel}: off-screen and UNREACHABLE (no scrollable ancestor)`);
      }
      if (r.right > vw + 1) issues.push(`${sel}: right +${Math.round(r.right - vw)}px past viewport`);
    }

    for (const sel of square) {
      const el = find(sel);
      if (!el) continue; // absence is the strict/reachable lists' concern
      const r = el.getBoundingClientRect();
      if (Math.abs(r.width - r.height) > 2) {
        issues.push(`${sel}: NOT SQUARE (${Math.round(r.width)}x${Math.round(r.height)})`);
      }
    }

    return issues;
  }, spec as { strict?: string[]; reachable?: string[]; noBodyScroll?: boolean; square?: string[] });
}

/** Sweep all viewports on the current screen; fail with every issue listed. */
async function sweep(page: Page, screen: string, spec: ProbeSpec) {
  const failures: string[] = [];
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    // Emulate the device's safe-area insets (Chromium's env() is always 0).
    // Injected :root wins the cascade over App.css's declaration — same
    // specificity, later in document order.
    await page.evaluate((ins) => {
      let el = document.getElementById('e2e-safe-area') as HTMLStyleElement | null;
      if (!el) {
        el = document.createElement('style');
        el.id = 'e2e-safe-area';
        document.head.appendChild(el);
      }
      el.textContent = `:root { --safe-top: ${ins.top}px; --safe-bottom: ${ins.bottom}px; --safe-left: ${ins.left}px; --safe-right: ${ins.right}px; }`;
    }, vp.insets);
    // Let media queries, container queries, and canvas resize settle.
    await page.waitForTimeout(150);
    const issues = await probe(page, spec);
    if (issues.length) failures.push(`[${screen} @ ${vp.name} ${vp.width}x${vp.height}] ${issues.join(' | ')}`);
  }
  expect(failures, failures.join('\n')).toEqual([]);
}

// Sync (feature 32) never reaches a real server from this suite: a seeded
// player would otherwise create a profile on whatever backend answers at the
// API address. Aborted requests fail the way offline ones do — silently.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/sync/**', (route) => route.abort());
});

/** Mark the one-time avatar pick as done so tests land on their target
 *  screen instead of the ChooseAvatarScreen gate. (A picked avatar also
 *  makes this an existing player, so the first-run choice is skipped.) */
async function seedPickedProfile(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'goforkids.profile.v1',
      JSON.stringify({ avatar: 'tide', displayName: '', avatarPicked: true }),
    );
  });
}

test('game screen: board and controls fit at every viewport', async ({ page }) => {
  await seedPickedProfile(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Custom Match/ }).click();
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.locator('.go-board-canvas').waitFor();
  await sweep(page, 'game', {
    strict: ['.go-board-canvas', 'btn:Pass', 'btn:Resign', '.avatar-panel'],
    square: ['.go-board-canvas'],
  });
});

test('game screen, late-game worst case: full trays + graph + all buttons', async ({ page }) => {
  // Patrick's iPad Pro 13 landscape repro (2026-07-04): with enough captures
  // the two prisoner trays (up to 5 rows each) + komi tray + score graph +
  // all four control buttons push Resign off the bottom. The default game
  // sweep runs at move 0 where none of that is mounted — same blindness the
  // replay highlight-note bug exploited (S34 lesson: put the state in the
  // suite FIRST, then make it pay for itself).
  await seedPickedProfile(page);
  await page.addInitScript(() => {
    // Fake the iPad bridge so Finish Game mounts: the button is
    // on-device-only as of 2026-09-01 (cloud finish disabled server-side),
    // and this worst case is precisely the iPad scenario. The stub is never
    // invoked — the injected late-game state doesn't run the finish loop.
    (window as unknown as { kataGo: object }).kataGo = {};
    localStorage.setItem(
      'goforkids_settings',
      JSON.stringify({ themeId: 'cosmic', density: 'full', showScoreGraph: true }),
    );
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Custom Match/ }).click();
  // Local mode: no backend createGame in flight — the vs-AI default's failed
  // request resolves mid-sweep and clobbers the injected gameId, unmounting
  // Finish Game and turning the sweep flaky.
  await page.getByRole('button', { name: 'Local', exact: true }).click();
  await page.getByRole('button', { name: '19×19' }).click();
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.locator('.go-board-canvas').waitFor();
  // Late-game worst case via the dev store hook: both trays maxed (+N
  // overflow), Undo (moveCount>0) and Finish Game (gameId + >=20) mounted,
  // score-graph fed real-looking data.
  await page.evaluate(() => {
    (window as unknown as { __gameStore: { setState: (s: object) => void } }).__gameStore.setState({
      blackCaptures: 55,
      whiteCaptures: 52,
      moveCount: 180,
      gameId: 'layout-probe',
      scoreHistory: Array.from({ length: 40 }, (_, i) => ({ move: i, lead: Math.sin(i / 5) * 10 })),
    });
  });
  await page.getByRole('button', { name: 'Finish Game' }).waitFor();
  await sweep(page, 'game-late', {
    strict: ['.go-board-canvas', 'btn:Pass', 'btn:Resign', 'btn:Finish Game', '.avatar-panel'],
    square: ['.go-board-canvas'],
  });
});

test('replay: board fits, controls reachable at every viewport', async ({ page }) => {
  await seedPickedProfile(page);
  await page.goto('/?replay=demo');
  await page.locator('.go-board-canvas').waitFor();
  await page.locator('.replay-controls').waitFor();
  // Policy: replay is NOT one of the two sanctioned scroll screens — the
  // board and the full control panel must fit outright.
  await sweep(page, 'replay', {
    strict: ['.go-board-canvas', '.replay-controls', 'btn:Download SGF'],
    square: ['.go-board-canvas'],
  });
});

test('replay on a key move: highlight note fits at every viewport', async ({ page }) => {
  // The default replay sweep runs at move 0, where the key-move explanation
  // card (.replay-highlight-note) never mounts — which is exactly how the
  // iPhone Pro Max PORTRAIT cutoff shipped (S34 known bug): the note only
  // appears when the cursor is ON a key move, adding a row to a panel that
  // fits with zero slack. Same lesson as game-late: put the state in the
  // suite FIRST, then make it pay for itself. §4a raises the stakes — the
  // quick-replay entry lands users directly on key moves.
  await seedPickedProfile(page);
  await page.goto('/?replay=demo');
  await page.locator('.go-board-canvas').waitFor();
  await page.locator('.replay-controls').waitFor();
  // Seek onto the demo's key move via the dev store hook (the demo review
  // game's capture at move 9 is its one guaranteed highlight) — and dress
  // the panel up to a REAL game's height: the demo fixture has no meta row
  // (vs rank · result) and no share button, so without these the sweep runs
  // 2 rows short of what a device actually shows and false-passes.
  await page.evaluate(() => {
    const store = (window as unknown as {
      __replayStore: {
        getState: () => { highlights: Array<{ moveNumber: number }>; goToMove: (n: number) => void };
        setState: (s: object) => void;
      };
    }).__replayStore;
    // returnToReview mounts the §4a back button — the widest header the
    // panel ever shows (back + Close side by side on a 393px phone).
    store.setState({ gameResult: 'B+8.5', opponentRank: '15k', sharedId: 'DEMO1234', returnToReview: 'demo' });
    const st = store.getState();
    st.goToMove(st.highlights[0].moveNumber);
    // Worst-case note: the better-move star row on top of the headline +
    // glossary link (4 wrapped lines on phones — the S48 cutoff). Must be
    // set AFTER goToMove, which clears it (no bridge in Chromium).
    store.setState({ betterMove: { row: 2, col: 2 } });
  });
  await page.locator('.replay-highlight-note').waitFor();
  await sweep(page, 'replay-key-move', {
    strict: ['.go-board-canvas', '.replay-controls', '.replay-highlight-note', 'btn:Download SGF', 'btn:← ★ Back to Highlights'],
    square: ['.go-board-canvas'],
  });
});

test('lesson: board fits at every viewport', async ({ page }) => {
  await seedPickedProfile(page);
  await page.goto('/?learn=1');
  await page.locator('.go-board-canvas').waitFor();
  await sweep(page, 'lesson', {
    strict: ['.go-board-canvas', '.learn-back-btn'],
    square: ['.go-board-canvas'],
  });
});

test('choose-avatar gate: confirm button reachable at every viewport', async ({ page }) => {
  // Fresh install — the first-run choice comes first; New player then leads
  // into the one-time character select.
  await page.goto('/?learn=1');
  await page.getByRole('button', { name: 'New player' }).click();
  await page.getByRole('button', { name: "Let's go →" }).click();
  await page.locator('.choose-avatar-grid').waitFor();
  await sweep(page, 'choose-avatar', {
    strict: ['.choose-avatar-back', "btn:That's me! →", '.learn-reward-title'],
  });
});

test('ranked match-picker: start button reachable at every viewport', async ({ page }) => {
  await seedPickedProfile(page);
  await page.goto('/');
  // Home's ranked entry is "▶Play" (distinct from "✨Learn to Play").
  await page.getByRole('button', { name: /^▶/ }).click();
  await page.locator('.autoplay-view').waitFor();
  await sweep(page, 'ranked-picker', {
    strict: ['btn:▶Play'],
  });
});

test('home: primary navigation reachable at every viewport', async ({ page }) => {
  await seedPickedProfile(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Learn to Play/ }).waitFor();
  await sweep(page, 'home', {
    strict: ['btn:✨Learn to Play', 'btn:▶Play', 'btn:👤Profile'],
  });
});

test('advanced-lessons menu: cards and title fit at every viewport', async ({ page }) => {
  await seedPickedProfile(page);
  await page.goto('/?learn=advanced');
  await page.locator('.advanced-menu-grid').waitFor();
  await sweep(page, 'advanced-menu', {
    strict: ['.learn-reward-title', '.advanced-menu-grid', '.choose-avatar-back'],
  });
});

test('profile: sanctioned scroll screen — everything reachable', async ({ page }) => {
  await seedPickedProfile(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Profile/ }).click();
  await page.locator('.profile-avatar-grid').waitFor();
  await sweep(page, 'profile', {
    reachable: ['.profile-avatar-grid', '.profile-devices'],
    noBodyScroll: true, // WKWebView: must be an explicit container (S17 fix)
  });
});

test('profile with the Admin section (an admin device): everything reachable, nothing wider than the screen', async ({ page }) => {
  // Feature 32, revision 3: the pass says this device's profile is an admin,
  // and the list holds a profile with two devices, one with none, and this
  // device's own. Answered here; nothing leaves the browser.
  const device = (id: string, seen: string | null) => ({ device_id: id, created_at: '2026-09-10T16:00:00Z', last_seen_at: seen });
  const entry = (id: string, handle: [number, number], devices: ReturnType<typeof device>[], days: number | null) => ({
    player_id: id,
    handle,
    boards: { '9x9': { rung: '15k', games: 12 }, '19x19': { rung: '20k', games: 5 } },
    devices,
    replays: 7,
    created_at: '2026-09-10T16:00:00Z',
    updated_at: '2026-10-01T16:00:00Z',
    no_device_since: days === null ? null : '2026-09-14T16:00:00Z',
    days_left: days,
  });
  const list = [
    entry('p-own', [26, 33], [device('d-self', '2026-10-01T16:00:00Z')], null),
    entry('p-two', [44, 18], [device('d-a', '2026-10-01T16:00:00Z'), device('d-b', null)], null),
    entry('p-none', [7, 13], [], 12),
  ];
  await page.route(
    (url) => url.pathname.startsWith('/api/sync/'),
    (route) => {
      const path = new URL(route.request().url()).pathname;
      const body =
        path === '/api/sync/state'
          ? { rev: 1, state: { schema: 1, ladder: { byBoardSize: {} }, lessons: [], avatar: 'tide', avatarPicked: true, handle: [26, 33] }, admin: true, device_id: 'd-self' }
          : path === '/api/sync/games'
            ? { games: [] }
            : path === '/api/sync/admin/players'
              ? { players: list }
              : path.endsWith('/pairing-codes')
                ? { code: 'K7QX2MPD', expires_at: '2026-10-02T23:30:00Z' }
                : null;
      return body ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }) : route.abort();
    },
  );
  await page.addInitScript(() => {
    localStorage.setItem('goforkids.profile.v1', JSON.stringify({ avatar: 'tide', avatarPicked: true, handle: [26, 33] }));
    localStorage.setItem('goforkids.sync.v1', JSON.stringify({ playerId: 'p-own', deviceToken: 'layout-probe', baseRev: 1 }));
    localStorage.setItem('goforkids.admin.labels.v1', JSON.stringify({ 'p-two': 'A label as long as one may be, forty' }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Profile/ }).click();
  await page.locator('.profile-admin-row').nth(2).waitFor();
  // A code on show in the last row.
  const last = page.locator('.profile-admin-row').nth(2);
  await last.getByRole('button', { name: 'Code for this player' }).click();
  await last.getByRole('button', { name: 'Make code' }).click();
  await last.locator('.profile-devices-code').waitFor();
  await sweep(page, 'profile-admin-code', {
    reachable: [
      '.profile-devices',
      '.profile-admin',
      '.profile-admin-row:nth-child(2) .profile-admin-device:last-child',
      '.profile-admin-row:last-child .profile-devices-code',
    ],
    noBodyScroll: true,
  });
  // The New player step.
  await last.getByRole('button', { name: 'Done' }).click();
  await page.locator('.profile-admin').getByRole('button', { name: 'New player' }).click();
  await sweep(page, 'profile-admin-new', {
    reachable: ['.profile-admin-new', 'btn:Create player', '.profile-admin-row:last-child'],
    noBodyScroll: true,
  });
});

test('profile with the Friends section (a logged-in device): everything reachable, nothing wider than the screen', async ({ page }) => {
  // Feature 32, revision 4: a code, two requests and four friends with the
  // longest generated names, a send answered and a card open. Answered
  // here; nothing leaves the browser.
  const person = (n: number, handle: [number, number], avatar: string) => ({
    player_id: `0a0a0a0a-0000-4000-8000-00000000000${n}`,
    handle,
    avatar,
  });
  const friends = [
    person(1, [22, 25], 'tide'), // Twinkling Satellite
    person(2, [20, 34], 'nova'), // Sparkling Explorer
    person(3, [40, 26], 'comet'), // Wandering Asteroid
    person(4, [3, 3], 'prism'),
  ].map((p) => ({ ...p, since: '2026-10-01T16:00:00Z' }));
  const incoming = [person(5, [21, 4], 'eclipse'), person(6, [41, 25], 'blackhole')].map((p) => ({
    ...p,
    sent_at: '2026-10-02T15:00:00Z',
  }));
  const card = {
    ...friends[0],
    boards: { '9x9': { rung: '15k', games: 120 }, '13x13': { rung: '18k', games: 40 }, '19x19': { rung: '20k', games: 40 } },
    games: 200,
    recent: Array.from({ length: 10 }, (_, i) => ({
      board: ['9x9', '13x13', '19x19'][i % 3],
      result: i % 2 ? 'loss' : 'win',
      rung: '15k',
      ts: Date.UTC(2025, 11, 31 - i, 18),
    })),
  };
  await page.route(
    (url) => url.pathname.startsWith('/api/sync/'),
    (route) => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      const body =
        path === '/api/sync/state'
          ? { rev: 1, state: { schema: 1, ladder: { byBoardSize: {} }, lessons: [], avatar: 'tide', avatarPicked: true, handle: [26, 33] }, admin: false, device_id: 'd-self' }
          : path === '/api/sync/games'
            ? { games: [] }
            : path === '/api/sync/friends/code'
              ? { code: 'K7QX2MPD' }
              : path === '/api/sync/friends'
                ? { friends, incoming }
                : path === '/api/sync/friends/requests' && method === 'POST'
                  ? {}
                  : path === `/api/sync/friends/${card.player_id}`
                    ? card
                    : null;
      if (!body) return route.abort();
      return route.fulfill({ status: path.endsWith('/requests') ? 202 : 200, contentType: 'application/json', body: JSON.stringify(body) });
    },
  );
  await page.addInitScript(() => {
    localStorage.setItem('goforkids.profile.v1', JSON.stringify({ avatar: 'tide', avatarPicked: true, handle: [26, 33] }));
    localStorage.setItem('goforkids.sync.v1', JSON.stringify({ playerId: 'p-own', deviceToken: 'layout-probe', baseRev: 1 }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Profile/ }).click();
  await page.locator('.profile-friends-friend').nth(3).waitFor();
  await page.locator('.profile-friends-input').fill('ra3v-8ygf');
  await page.locator('.profile-friends').getByRole('button', { name: 'Send' }).click();
  await page.locator('.profile-friends-outcome').waitFor();
  await page.locator('.profile-friends-person').first().click();
  await page.locator('.profile-friends-result').nth(9).waitFor();
  await page.locator('.profile-friends-card').getByRole('button', { name: 'Remove friend' }).click();
  await sweep(page, 'profile-friends', {
    reachable: [
      '.profile-devices',
      '.profile-friends-code',
      'btn:New code',
      '.profile-friends-input',
      'btn:Send',
      '.profile-friends-outcome',
      '.profile-friends-request:last-child',
      '.profile-friends-card-ranks',
      '.profile-friends-result:last-child',
      'btn:Yes, remove',
      '.profile-friends-friend:last-child',
    ],
    noBodyScroll: true,
  });
});

test('first-run choice: fits without scrolling at every viewport, all three steps', async ({ page }) => {
  // Fresh install: nothing stored, so the first-run choice is the first screen.
  await page.goto('/');
  await page.locator('.first-run').waitFor();
  await sweep(page, 'first-run', {
    strict: ['.first-run-title', 'btn:New player', 'btn:I already play on another device', 'btn:Privacy & Terms'],
    noBodyScroll: true,
  });

  await page.getByRole('button', { name: 'New player' }).click();
  await page.locator('.first-run-name').waitFor();
  await sweep(page, 'first-run-name', {
    strict: ['.first-run-name', 'btn:Shuffle', "btn:Let's go →", 'btn:← Back'],
    noBodyScroll: true,
  });

  await page.getByRole('button', { name: '← Back' }).click();
  await page.getByRole('button', { name: 'I already play on another device' }).click();
  await page.locator('.first-run-input').waitFor();
  await sweep(page, 'first-run-login', {
    strict: ['.first-run-title', '.first-run-input', 'btn:Log in', 'btn:Back'],
    noBodyScroll: true,
  });
});

test('name card (existing player, first launch with a profile): fits at every viewport', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'goforkids.profile.v1',
      JSON.stringify({ avatar: 'tide', avatarPicked: true, handle: [26, 33] }),
    );
    localStorage.setItem(
      'goforkids.sync.v1',
      JSON.stringify({ playerId: 'p', deviceToken: 'layout-probe', baseRev: 1, showIntro: true }),
    );
  });
  await page.goto('/');
  await page.locator('.name-intro-card').waitFor();
  await sweep(page, 'name-card', {
    strict: ['.name-intro-card', '.first-run-name', 'btn:Shuffle', 'btn:OK'],
    noBodyScroll: true,
  });
});

test('name card after a first-run name another profile had: fits at every viewport', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'goforkids.profile.v1',
      JSON.stringify({ avatar: 'blackhole', avatarPicked: false, handle: [26, 33] }),
    );
    localStorage.setItem(
      'goforkids.sync.v1',
      JSON.stringify({ playerId: 'p', deviceToken: 'layout-probe', baseRev: 1, showIntro: true, nameWasTaken: true }),
    );
  });
  await page.goto('/');
  const card = page.locator('.name-intro-card');
  await card.waitFor();
  await expect(card).toContainText('Someone already has that name');
  await sweep(page, 'name-card-taken', {
    strict: ['.name-intro-card', '.first-run-name', 'btn:Shuffle', 'btn:OK'],
    noBodyScroll: true,
  });
});

test('first-run name another profile has: the profile gets another, and the card that follows shows it', async ({ page }) => {
  // Overrides the abort-everything route for sync: the first create is
  // refused as taken (revision 6), the next lands.
  const posted: [number, number][] = [];
  let stored: unknown = null;
  await page.route(
    (url) => url.pathname.startsWith('/api/sync/'),
    async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname.replace(/^\/api/, '');
      const reply = (status: number, body: unknown) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (req.method() === 'POST' && path === '/sync/players') {
        const state = (JSON.parse(req.postData()!) as { state: { handle: [number, number] } }).state;
        posted.push(state.handle);
        if (posted.length === 1) return reply(409, { detail: 'handle_taken' });
        stored = state;
        return reply(201, { player_id: 'p-e2e', device_token: 'tok-e2e', rev: 1, state });
      }
      if (req.method() === 'GET' && path === '/sync/state') return reply(200, { rev: 1, state: stored });
      if (req.method() === 'GET' && path === '/sync/games') return reply(200, { games: [] });
      return route.abort();
    },
  );

  await page.goto('/');
  await page.getByRole('button', { name: 'New player' }).click();
  const shown = (await page.locator('.first-run-name').textContent())!;
  await page.getByRole('button', { name: "Let's go →" }).click();

  const card = page.locator('.name-intro-card');
  await card.waitFor();
  await expect(card).toContainText('Someone already has that name');
  const got = (await card.locator('.first-run-name').textContent())!;
  expect(got).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  expect(got).not.toBe(shown);
  expect(posted).toHaveLength(2);
  expect(posted[1]).not.toEqual(posted[0]);

  await card.getByRole('button', { name: 'OK' }).click();
  await expect(card).toHaveCount(0);
});

test('library: sanctioned scroll screen — list reachable, close visible', async ({ page }) => {
  await seedPickedProfile(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Library/ }).click();
  await page.locator('.game-library, [class*=library]').first().waitFor();
  await sweep(page, 'library', {
    // The close affordance must always be visible; the list itself may scroll.
    strict: ['btn:Close'],
  });
});
