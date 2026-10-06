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
 * body scroll never counts — WKWebView, S17 lesson) exists only for the
 * sanctioned screens. Feature 32 revision 7 adds a third: the Friends page,
 * which scrolls like the Library list (fixed header, scrolling content).
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
  // The gear sat on Resign here in portrait (device pass, 2026-10-05).
  { name: 'iPhone 16 Pro Max portrait', width: 440, height: 956, insets: PHONE_PORTRAIT },
  { name: 'iPhone 16 Pro Max landscape', width: 956, height: 440, insets: PHONE_LANDSCAPE },
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
  /** Elements whose content must fit inside them (scrollHeight ≤
   *  clientHeight): a dialog that scrolls its own rows breaks the layout
   *  policy even when each row is on screen at the top of the scroll. */
  noOverflow?: string[];
  /** An element that must not overlap any tappable control inside `within`
   *  (itself aside): a floating button over Resign passes every visibility
   *  check above (the Settings gear, iPhone 16 Pro Max portrait). */
  apart?: { el: string; within: string }[];
}

/** Returns [] when clean, else human-readable issue strings. */
async function probe(page: Page, spec: ProbeSpec): Promise<string[]> {
  return page.evaluate(({ strict = [], reachable = [], noBodyScroll = false, square = [], noOverflow = [], apart = [] }) => {
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

    for (const sel of noOverflow) {
      const el = find(sel);
      if (!el) {
        issues.push(`${sel}: MISSING`);
        continue;
      }
      const over = el.scrollHeight - el.clientHeight;
      if (over > 1) issues.push(`${sel}: content overflows by ${over}px (it would scroll)`);
    }

    for (const { el: sel, within } of apart) {
      const el = find(sel);
      if (!el) {
        issues.push(`${sel}: MISSING`);
        continue;
      }
      const a = el.getBoundingClientRect();
      const controls = document.querySelectorAll(`${within} :is(button, a[href], input, select, textarea, [role="button"])`);
      for (const c of controls) {
        if (c === el || el.contains(c) || c.contains(el)) continue;
        const b = c.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
          const name = (c.textContent || c.getAttribute('aria-label') || c.tagName).trim();
          issues.push(`${sel}: OVERLAPS "${name}" by ${Math.round(Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))}px`);
        }
      }
    }

    return issues;
  }, spec as { strict?: string[]; reachable?: string[]; noBodyScroll?: boolean; square?: string[]; noOverflow?: string[]; apart?: { el: string; within: string }[] });
}

/** Resize to a viewport of the matrix, with its safe-area insets. */
async function applyViewport(page: Page, vp: (typeof VIEWPORTS)[number]) {
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
}

/** Sweep all viewports on the current screen; fail with every issue listed. */
async function sweep(page: Page, screen: string, spec: ProbeSpec) {
  const failures: string[] = [];
  for (const vp of VIEWPORTS) {
    await applyViewport(page, vp);
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
  // The game server's health route, answered up (a test may answer it
  // otherwise): ranked Play and the bot modes are open, nothing leaves.
  await page.route(
    (url) => url.pathname === '/health',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' }),
  );
});

/** On a phone held upright the game's gear sits under Resign, at its right
 *  edge, where the panel has room (the overlap check above holds anywhere). */
async function expectGearUnderResign(page: Page) {
  for (const vp of VIEWPORTS.filter((v) => v.width < 700)) {
    await applyViewport(page, vp);
    const [gear, resign] = await page.evaluate(() =>
      [
        document.querySelector('.settings-gear')!,
        [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Resign')!,
      ].map((el) => el.getBoundingClientRect().toJSON() as DOMRect),
    );
    expect(gear.top - resign.bottom, `${vp.name}: the gear under Resign`).toBeGreaterThanOrEqual(4);
    expect(Math.abs(gear.right - resign.right), `${vp.name}: at Resign's right edge`).toBeLessThanOrEqual(1);
  }
}

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
  // The vs-AI default creates its game on the server: answered here.
  await page.route(
    (url) => url.pathname === '/api/games',
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ game_id: 'e2e00001', move_number: 1, phase: 'playing' }) }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: /Custom Match/ }).click();
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.locator('.go-board-canvas').waitFor();
  await sweep(page, 'game', {
    strict: ['.go-board-canvas', 'btn:Pass', 'btn:Resign', '.avatar-panel', '.settings-gear'],
    square: ['.go-board-canvas'],
    apart: [{ el: '.settings-gear', within: '.side-panel' }],
  });
  await expectGearUnderResign(page);
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
    // and shows for a game that lives on the device; this worst case is
    // precisely the iPad scenario. The stub is never invoked — the player
    // moves first and the injected late-game state doesn't run the finish
    // loop.
    (window as unknown as { kataGo: object }).kataGo = {};
    localStorage.setItem(
      'goforkids_settings',
      JSON.stringify({ themeId: 'cosmic', density: 'full', showScoreGraph: true }),
    );
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Custom Match/ }).click();
  // The vs-AI default: with the bridge, its game is created on the device
  // (no request), and Finish Game follows where the game lives.
  await page.getByRole('button', { name: '19×19' }).click();
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.locator('.go-board-canvas').waitFor();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __gameStore: { getState: () => { gameId: string | null } } }).__gameStore.getState().gameId))
    .toMatch(/^[0-9a-f]{8}$/);
  // Late-game worst case via the dev store hook: both trays maxed (+N
  // overflow), Undo (moveCount>0) and Finish Game (a device game + >=20)
  // mounted, score-graph fed real-looking data.
  await page.evaluate(() => {
    (window as unknown as { __gameStore: { setState: (s: object) => void } }).__gameStore.setState({
      blackCaptures: 55,
      whiteCaptures: 52,
      moveCount: 180,
      scoreHistory: Array.from({ length: 40 }, (_, i) => ({ move: i, lead: Math.sin(i / 5) * 10 })),
    });
  });
  await page.getByRole('button', { name: 'Finish Game' }).waitFor();
  await sweep(page, 'game-late', {
    strict: ['.go-board-canvas', 'btn:Pass', 'btn:Resign', 'btn:Finish Game', '.avatar-panel', '.settings-gear'],
    square: ['.go-board-canvas'],
    apart: [{ el: '.settings-gear', within: '.side-panel' }],
  });
  // All four buttons share one row on a phone, so the gear's line fits.
  await expectGearUnderResign(page);
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
  // Revision 7: the avatar and the two rank chips on one row; Friends where
  // Profile was. The badge is the worst case (requests waiting).
  await page.evaluate(() => {
    const req = (n: number) => ({ player_id: `0a0a0a0a-0000-4000-8000-00000000000${n}`, handle: [n, n], avatar: 'nova', sent_at: '2026-10-02T15:00:00Z' });
    (window as unknown as { __friendsStore: { setState: (s: object) => void } }).__friendsStore.setState({
      incoming: [req(1), req(2), req(3)],
    });
  });
  await page.locator('.home-btn-badge').waitFor();
  await sweep(page, 'home', {
    strict: [
      '.home-player-btn',
      'button[aria-label^="Open 9×9"]',
      'button[aria-label^="Open 19×19"]',
      'btn:✨Learn to Play',
      'btn:▶Play',
      '.home-btn-friends',
      '.home-btn-badge',
    ],
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

test('profile: sanctioned scroll screen — everything reachable, both tabs', async ({ page }) => {
  await seedPickedProfile(page);
  await page.addInitScript(() => {
    // Both ladders with games, so each tab draws its graph and results.
    const hist = (rung: string) =>
      Array.from({ length: 30 }, (_, i) => ({ rung, bot: rung, handicap: 0, result: i % 3 ? 'win' : 'loss', ts: 1_759_000_000_000 + i * 60_000 }));
    localStorage.setItem(
      'goforkids.autoplay.v1',
      JSON.stringify({
        byBoardSize: {
          '9x9': { rungState: { currentRung: '15k', winsAtCurrentRung: 1, lossStreak: 0 }, history: hist('15k'), promotionEvents: [] },
          '19x19': { rungState: { currentRung: '20k', winsAtCurrentRung: 2, lossStreak: 0 }, history: hist('20k'), promotionEvents: [] },
        },
        undoBank: 3,
      }),
    );
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.locator('.profile-avatar-grid').waitFor();
  await sweep(page, 'profile', {
    reachable: ['.profile-board-tabs', '.profile-rank-card', '.profile-graph', '.profile-avatar-grid', '.profile-devices'],
    noBodyScroll: true, // WKWebView: must be an explicit container (S17 fix)
  });
  // The other tab, with Advanced open: the per-board blocks in the tab and
  // the all-boards tools below.
  await page.getByRole('tab', { name: /9×9/ }).click();
  await page.locator('.profile-advanced-toggle').click();
  await page.locator('.profile-advanced-all').waitFor();
  await sweep(page, 'profile-9x9-advanced', {
    reachable: [
      '.profile-board-tabs',
      '.profile-derank-btn',
      '.profile-graph',
      '.profile-results-list',
      'btn:Set rung',
      'btn:Reset to 30k…',
      '.profile-devices',
      'btn:Import JSON',
    ],
    noBodyScroll: true,
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

test('friends page (a logged-in device): sanctioned scroll screen — everything reachable, nothing wider than the screen', async ({ page }) => {
  // Feature 32, revisions 4, 5 and 8: a feed with two friends online and its
  // first eight lines (most of them buttons that open the game), a code, two requests and four friends with the
  // longest generated names (online dots and three ranks each), a send
  // answered and a card open with its recent games. Answered here; nothing
  // leaves the browser. Revision 7 moved the section from the Profile page
  // to its own page, which scrolls like the Library list: the home button
  // stays on screen, the content scrolls in its container.
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
  const feed = {
    friends: friends.map((f, i) => ({ ...f, active_recently: i < 2, boards: card.boards })),
    events: Array.from({ length: 12 }, (_, i) => ({
      kind: i % 4 === 0 ? 'promotion' : 'game',
      ...friends[i % 4],
      board: ['9x9', '13x13', '19x19'][i % 3],
      result: i % 2 ? 'loss' : 'win',
      rung: '15k',
      bot: '12k',
      from: '16k',
      to: '15k',
      ts: Date.UTC(2025, 11, 31 - i, 18),
      // Revision 8: most results open their game (a button line, with ▶).
      game_id: i % 4 === 0 || i === 6 ? null : `g${i}`,
    })),
  };
  const replays = {
    games: Array.from({ length: 20 }, (_, i) => ({
      id: `g${i}`,
      date: new Date(Date.UTC(2025, 11, 31 - i, 18)).toISOString(),
      board: ['9x9', '13x13', '19x19'][i % 3],
      outcome: ['win', 'loss', 'watched'][i % 3],
      opponent: '12k',
    })),
  };
  await page.route(
    (url) => url.pathname.startsWith('/api/sync/'),
    (route) => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      const body =
        path === '/api/sync/friends/feed'
          ? feed
          : path === `/api/sync/friends/${card.player_id}/games`
            ? replays
            : path === '/api/sync/state'
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
  await page.getByRole('button', { name: /Friends/ }).click();
  await page.locator('.profile-friends-friend').nth(3).waitFor();
  await page.locator('.profile-friends-input').fill('ra3v-8ygf');
  await page.locator('.profile-friends').getByRole('button', { name: 'Send' }).click();
  await page.locator('.profile-friends-outcome').waitFor();
  await page.locator('.profile-friends-person').first().click();
  await page.locator('.profile-friends-result').nth(9).waitFor();
  await page.locator('.profile-friends-game').nth(19).waitFor();
  await page.locator('.profile-friends-card').getByRole('button', { name: 'Remove friend' }).click();
  await sweep(page, 'friends-page', {
    strict: ['.friends-page-home .home-button', '.friends-page-title'],
    reachable: [
      'btn:Refresh',
      '.profile-friends-feed-item:last-child',
      '.profile-friends-feed-watch',
      'btn:Show more',
      '.profile-friends-code',
      'btn:New code',
      '.profile-friends-input',
      'btn:Send',
      '.profile-friends-outcome',
      '.profile-friends-request:last-child',
      '.profile-friends-card-ranks',
      '.profile-friends-result:last-child',
      '.profile-friends-games li:last-child',
      'btn:Yes, remove',
      '.profile-friends-friend:last-child',
    ],
    noBodyScroll: true,
  });
});

test('friends page, not logged in: the note and the home button fit at every viewport', async ({ page }) => {
  // A player whose profile isn't saved online yet (sync aborted above).
  await seedPickedProfile(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Friends/ }).click();
  await page.locator('.friends-page-offline').waitFor();
  await sweep(page, 'friends-offline', {
    strict: ['.friends-page-home .home-button', '.friends-page-title', '.friends-page-offline'],
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

test('settings: every row fits without scrolling at every viewport, the human-style row included', async ({ page }) => {
  // The tallest Settings: a native build whose engine reported the human SL
  // net, so the "Human-style bots" row is mounted beside the cloud row. The
  // fake bridge only answers capabilities(); nothing here asks it to play.
  await seedPickedProfile(page);
  await page.addInitScript(() => {
    (window as unknown as { kataGo: object }).kataGo = {
      ping: async () => ({ pong: true }),
      capabilities: async () => ({ localBots: true, evalsPerSecond: 40, humanModel: true }),
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Learn to Play/ }).waitFor();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('.settings-human-bots').waitFor();
  await sweep(page, 'settings', {
    strict: ['.dialog', '.dialog h2', 'btn:Close', '.theme-picker', '.mode-picker', '.settings-cloud-bot', '.settings-human-bots'],
    noOverflow: ['.dialog'],
    noBodyScroll: true,
  });
  // The rows keep the dialog's spacing in both layouts (one column, and two
  // on a phone held sideways).
  for (const size of [{ width: 820, height: 1180 }, { width: 852, height: 393 }]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(150);
    const gap = await page.evaluate(
      () =>
        document.querySelector('.settings-human-bots')!.getBoundingClientRect().top -
        document.querySelector('.settings-cloud-bot')!.getBoundingClientRect().bottom,
    );
    expect(gap, `row gap at ${size.width}x${size.height}`).toBeGreaterThanOrEqual(12);
  }
  // Sideways, the theme cards and the other rows split the dialog evenly.
  const [theme, toggles] = await page.evaluate(() =>
    ['.settings-theme', '.settings-toggles'].map((s) => document.querySelector(s)!.getBoundingClientRect().width),
  );
  expect(Math.abs(theme - toggles), `columns ${theme} and ${toggles}`).toBeLessThanOrEqual(2);
});

test('settings: the human-style row turns the setting on, and it is kept', async ({ page }) => {
  await seedPickedProfile(page);
  await page.addInitScript(() => {
    (window as unknown as { kataGo: object }).kataGo = {
      ping: async () => ({ pong: true }),
      capabilities: async () => ({ localBots: true, evalsPerSecond: 40, humanModel: true }),
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Learn to Play/ }).waitFor();
  await page.getByRole('button', { name: 'Settings' }).click();
  const box = page.getByRole('checkbox', { name: 'Human-style bots' });
  await expect(box).not.toBeChecked();
  await box.click();
  await expect(box).toBeChecked();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('goforkids_settings') ?? '{}'));
  expect(saved.humanBots).toBe(true);
  expect(saved.cloudBot).toBe(false);
  await page.reload();
  await page.getByRole('button', { name: /Learn to Play/ }).waitFor();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('checkbox', { name: 'Human-style bots' })).toBeChecked();
});

test('settings without the human model: the human-style row stays, greyed, saying so', async ({ page }) => {
  await seedPickedProfile(page);
  await page.addInitScript(() => {
    (window as unknown as { kataGo: object }).kataGo = {
      ping: async () => ({ pong: true }),
      capabilities: async () => ({ localBots: true, evalsPerSecond: 40, humanModel: false }),
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Learn to Play/ }).waitFor();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('.settings-human-bots .settings-note')).toHaveText('Not available on this device.');
  await expect(page.getByRole('checkbox', { name: 'Human-style bots' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Human-style bots' })).not.toBeChecked();
});

test('settings before the capabilities answer: the human-style row is there at once, greyed, until the answer', async ({ page }) => {
  // A version's first launch: the answer waits on the engine's start. The
  // fake bridge answers when the test says so.
  await seedPickedProfile(page);
  await page.addInitScript(() => {
    const w = window as unknown as { kataGo: object; answerCaps: () => void };
    let answer: (c: object) => void = () => {};
    w.answerCaps = () => answer({ localBots: true, evalsPerSecond: 40, humanModel: true });
    w.kataGo = { ping: async () => ({ pong: true }), capabilities: () => new Promise((r) => (answer = r)) };
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Learn to Play/ }).waitFor();
  await page.getByRole('button', { name: 'Settings' }).click();
  const box = page.getByRole('checkbox', { name: 'Human-style bots' });
  await expect(page.locator('.settings-human-bots .settings-note')).toHaveText('Starting the bots…');
  await expect(box).toBeDisabled();
  await sweep(page, 'settings-starting', {
    strict: ['.dialog', 'btn:Close', '.settings-cloud-bot', '.settings-human-bots', '.settings-human-bots .settings-note'],
    noOverflow: ['.dialog'],
    noBodyScroll: true,
  });
  await page.evaluate(() => (window as unknown as { answerCaps: () => void }).answerCaps());
  await expect(box).toBeEnabled();
  await expect(page.locator('.settings-human-bots .settings-note')).toHaveCount(0);
});

// Where the bots can only play online (the web, or a device whose engine
// reported localBots: false), "Bot plays online" is on and stays on; a tap
// shows one sentence and stores nothing. The sentence must not make the
// dialog scroll anywhere.
for (const where of ['the web', 'a device too slow for its own bots'] as const) {
  test(`settings on ${where}: the online row is locked on, a tap shows why, and it fits at every viewport`, async ({ page }) => {
    await seedPickedProfile(page);
    if (where !== 'the web') {
      await page.addInitScript(() => {
        (window as unknown as { kataGo: object }).kataGo = {
          ping: async () => ({ pong: true }),
          capabilities: async () => ({ localBots: false, evalsPerSecond: 3, humanModel: true }),
        };
      });
    }
    await page.goto('/');
    await page.getByRole('button', { name: /Learn to Play/ }).waitFor();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.locator('.settings-cloud-bot.locked').waitFor();
    const box = page.getByRole('checkbox', { name: 'Bot plays online' });
    await expect(box).toBeChecked();
    await expect(page.locator('.settings-cloud-bot .settings-note')).toHaveCount(0);
    await box.click();
    await expect(box).toBeChecked();
    await expect(page.locator('.settings-cloud-bot .settings-note')).toHaveText('The bot always plays online here.');
    // the person's own choice underneath is untouched
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('goforkids_settings') ?? '{}'));
    expect(saved.cloudBot).not.toBe(true);
    // the web has no human-style row; a device held to the online bots says why it is off
    if (where === 'the web') {
      await expect(page.locator('.settings-human-bots')).toHaveCount(0);
    } else {
      await expect(page.locator('.settings-human-bots .settings-note')).toHaveText('This device plays the online bots.');
      await expect(page.getByRole('checkbox', { name: 'Human-style bots' })).toBeDisabled();
    }
    // the sentence sits right under its label and ends the row
    const [labelBottom, noteTop, noteBottom, rowBottom] = await page.evaluate(() => {
      const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      return [r('.settings-cloud-bot label').bottom, r('.settings-cloud-bot .settings-note').top, r('.settings-cloud-bot .settings-note').bottom, r('.settings-cloud-bot').bottom];
    });
    expect(noteTop - labelBottom, 'label to sentence').toBeLessThanOrEqual(8);
    expect(rowBottom - noteBottom, 'sentence to row end').toBeLessThanOrEqual(1);
    await sweep(page, 'settings-locked', {
      strict: [
        '.dialog', '.dialog h2', 'btn:Close', '.theme-picker', '.mode-picker', '.settings-cloud-bot', '.settings-cloud-bot .settings-note',
        ...(where === 'the web' ? [] : ['.settings-human-bots .settings-note']),
      ],
      noOverflow: ['.dialog'],
      noBodyScroll: true,
    });
  });
}

test('settings during a game: the online row says a change waits for the next game, and the tallest Settings fits', async ({ page }) => {
  // The tallest Settings: a game in progress (the next-game line under
  // "Bot plays online") while the capabilities answer has not come, so the
  // human-style row says the bots are starting. The game starts on the
  // device once the wait for the answer runs out (10 s).
  await seedPickedProfile(page);
  await page.addInitScript(() => {
    (window as unknown as { kataGo: object }).kataGo = { ping: async () => ({ pong: true }), capabilities: () => new Promise(() => {}) };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('.settings-cloud-bot .settings-note')).toHaveCount(0); // no game yet
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: /Custom Match/ }).click();
  await page.getByRole('button', { name: 'Start Game' }).click();
  await expect(page.locator('.game-starting')).toHaveCount(0, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Resign' }).waitFor();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('.settings-cloud-bot .settings-note')).toHaveText('Takes effect from your next game.');
  await expect(page.locator('.settings-human-bots .settings-note')).toHaveText('Starting the bots…');
  await sweep(page, 'settings-mid-game', {
    strict: ['.dialog', 'btn:Close', '.settings-cloud-bot .settings-note', '.settings-human-bots .settings-note'],
    noOverflow: ['.dialog'],
    noBodyScroll: true,
  });
  // the line goes with the game
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Resign' }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click(); // the end card
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('.settings-cloud-bot').waitFor();
  await expect(page.locator('.settings-cloud-bot .settings-note')).toHaveCount(0);
});

test('a device too slow for its own bots: no Finish Game', async ({ page }) => {
  // The late-game state of the worst-case test above, on a device whose
  // engine reported localBots: false: Finish Game (on-device only) stays off.
  await seedPickedProfile(page);
  await page.addInitScript(() => {
    (window as unknown as { kataGo: object }).kataGo = {
      ping: async () => ({ pong: true }),
      capabilities: async () => ({ localBots: false, evalsPerSecond: 3, humanModel: false }),
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Custom Match/ }).click();
  await page.getByRole('button', { name: 'Local', exact: true }).click();
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.locator('.go-board-canvas').waitFor();
  await page.evaluate(() => {
    (window as unknown as { __gameStore: { setState: (s: object) => void } }).__gameStore.setState({
      moveCount: 180,
      gameId: 'layout-probe',
    });
  });
  await page.getByRole('button', { name: 'Resign' }).waitFor();
  await expect(page.getByRole('button', { name: 'Finish Game' })).toHaveCount(0);
});

test('a game asked for before the device answers: a waiting card that fits, no stone, then the game', async ({ page }) => {
  // The capabilities answer is held until the test gives it, so Start Game
  // lands in the wait (up to 10 s) with the last board still on screen.
  await seedPickedProfile(page);
  await page.addInitScript(() => {
    (window as unknown as { kataGo: object }).kataGo = {
      ping: async () => ({ pong: true }),
      capabilities: () =>
        new Promise((resolve) => {
          (window as unknown as { __answerCaps: (c: object) => void }).__answerCaps = resolve;
        }),
    };
  });
  const moveCount = () =>
    page.evaluate(() => (window as unknown as { __gameStore: { getState: () => { moveCount: number } } }).__gameStore.getState().moveCount);
  await page.goto('/');
  await page.getByRole('button', { name: /Custom Match/ }).click();
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.locator('.go-board-canvas').waitFor();
  const box = (await page.locator('.go-board-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  expect(await moveCount()).toBe(0);
  const card = page.locator('.game-starting');
  await expect(card).toContainText('Getting your game ready');
  await sweep(page, 'game-starting', { strict: ['.game-starting .scoring-card', '.game-starting .scoring-title'] });

  await page.evaluate(() =>
    (window as unknown as { __answerCaps: (c: object) => void }).__answerCaps({ localBots: true, evalsPerSecond: 40, humanModel: false }),
  );
  await expect(card).toHaveCount(0);
  const ready = (await page.locator('.go-board-canvas').boundingBox())!;
  await page.mouse.click(ready.x + ready.width / 2, ready.y + ready.height / 2);
  await expect.poll(moveCount).toBe(1);
});

test('a device too slow for its own bots still offers the share sheet in a replay', async ({ page }) => {
  await seedPickedProfile(page);
  await page.addInitScript(() => {
    (window as unknown as { kataGo: object }).kataGo = {
      ping: async () => ({ pong: true }),
      capabilities: async () => ({ localBots: false, evalsPerSecond: 3, humanModel: false }),
    };
  });
  await page.goto('/?replay=demo');
  await page.locator('.replay-controls').waitFor();
  await expect(page.getByRole('button', { name: 'Share SGF' })).toBeVisible();
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

// --- No bots, no frozen board ----------------------------------------------
// While the bots play online, a server that does not answer its health route
// greys every game against a bot, with one sentence and a Try again; lessons
// and play with a friend stay open. A game whose bot stops answering waits
// under a card with Try again and Leave. The sentence, the card and the
// greyed screens must fit at every viewport.

const BOTS_AWAY = "The bots can't play right now. You can still do lessons, or play with a friend next to you.";

/** The game server, answered here: its health route (`up` false: no
 *  connection) and one game's routes. `dropMoves`: a player's move gets no
 *  answer. `hold()` keeps the next health answers waiting until `release()`. */
async function gameServer(page: Page, up: boolean) {
  const s = { up, dropMoves: false, health: 0, moves: 0, aiMoves: 0 };
  let held: Promise<void> | null = null;
  let release = () => {};
  await page.route(
    (url) => url.pathname === '/health',
    async (route) => {
      s.health++;
      if (held) await held;
      return s.up ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' }) : route.abort('connectionrefused');
    },
  );
  await page.route(
    (url) => url.pathname.startsWith('/api/games'),
    (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname.replace(/^\/api/, '');
      if (!s.up || (s.dropMoves && path.endsWith('/move'))) return route.abort('connectionrefused');
      const reply = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      // move_number is the next move's number, as the server sends it
      const state = () => ({ game_id: 'e2e00001', move_number: s.moves + 1, phase: 'playing', last_move: null });
      if (path.endsWith('/ai-move')) {
        s.moves++;
        return reply({ point: { row: s.aiMoves++, col: 0 }, captures: [], score_lead: 0 });
      }
      if (req.method() === 'POST' && path !== '/games') s.moves++;
      return reply(state());
    },
  );
  return {
    s,
    hold: () => void (held = new Promise((r) => (release = r))),
    release: () => {
      held = null;
      release();
    },
  };
}

interface GameView {
  gameId: string | null;
  aiThinking: boolean;
  currentColor: number;
  playerColor: number;
  moveCount: number;
  gameMode: string;
  boardSize: number;
}
const gameView = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __gameStore: { getState: () => GameView } }).__gameStore.getState();
    return { gameId: s.gameId, aiThinking: s.aiThinking, currentColor: s.currentColor, playerColor: s.playerColor, moveCount: s.moveCount, gameMode: s.gameMode, boardSize: s.boardSize };
  });
const playAt = (page: Page, row: number, col: number) =>
  page.evaluate(([r, c]) => (window as unknown as { __gameStore: { getState: () => { playMove: (p: object) => void } } }).__gameStore.getState().playMove({ row: r, col: c }), [row, col]);
const foreground = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

/** How far `sel`'s content overflows it (px it would scroll) at each viewport. */
async function overflowByViewport(page: Page, sel: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.evaluate((ins) => {
      let el = document.getElementById('e2e-safe-area') as HTMLStyleElement | null;
      if (!el) {
        el = document.createElement('style');
        el.id = 'e2e-safe-area';
        document.head.appendChild(el);
      }
      el.textContent = `:root { --safe-top: ${ins.top}px; --safe-bottom: ${ins.bottom}px; --safe-left: ${ins.left}px; --safe-right: ${ins.right}px; }`;
    }, vp.insets);
    await page.waitForTimeout(150);
    out[vp.name] = await page.evaluate((s) => {
      const el = document.querySelector(s)!;
      return Math.max(0, el.scrollHeight - el.clientHeight);
    }, sel);
  }
  return out;
}

test('the bots away on the web: home greys Play with why, keeps lessons and Custom Match, fits, and Try again un-greys', async ({ page }) => {
  await seedPickedProfile(page);
  const server = await gameServer(page, false);
  await page.goto('/');
  const note = page.locator('.home-bots-away');
  await expect(note).toContainText(BOTS_AWAY);
  await expect(page.locator('.home-btn-primary')).toBeDisabled();
  await expect(page.getByRole('button', { name: /Learn to Play/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Custom Match/ })).toBeEnabled();
  await expect(page.locator('.home-bots')).toHaveCount(0);
  const home = ['.home-player-btn', 'button[aria-label^="Open 9×9"]', 'button[aria-label^="Open 19×19"]', 'btn:✨Learn to Play', 'btn:▶Play', 'btn:⚙Custom Match', '.home-btn-friends'];
  await sweep(page, 'home-bots-away', { strict: [...home, '.home-bots-away', 'btn:Try again'] });

  // Try again, while the answer is on its way, then the server is back.
  server.s.up = true;
  server.hold();
  await note.getByRole('button', { name: 'Try again' }).click();
  await expect(note.getByRole('button', { name: 'Checking…' })).toBeDisabled();
  await sweep(page, 'home-bots-checking', { strict: [...home, '.home-bots-away', 'btn:Checking…'] });
  server.release();
  await expect(page.locator('.home-btn-primary')).toBeEnabled();
  await expect(note).toHaveCount(0);
  await page.locator('.home-bots').waitFor();
});

test('the home screen appearing asks again, and un-greys when the server is back', async ({ page }) => {
  await seedPickedProfile(page);
  const server = await gameServer(page, false);
  await page.goto('/');
  await page.locator('.home-bots-away').waitFor();
  const asked = server.s.health;
  server.s.up = true;
  await page.getByRole('button', { name: /Friends/ }).click();
  await page.locator('.friends-page-home .home-button').click();
  await expect(page.locator('.home-btn-primary')).toBeEnabled();
  expect(server.s.health).toBeGreaterThan(asked);
});

test('the bots away on the ranked picker: Play greyed with why, fits, and the return to the foreground re-checks', async ({ page }) => {
  await seedPickedProfile(page);
  const server = await gameServer(page, true);
  await page.goto('/');
  await page.getByRole('button', { name: /^▶/ }).click();
  await page.locator('.autoplay-view').waitFor();
  server.s.up = false;
  await foreground(page);
  const note = page.locator('.autoplay-bots-away');
  await expect(note).toContainText(BOTS_AWAY);
  await expect(page.locator('.autoplay-play-btn')).toBeDisabled();
  await sweep(page, 'ranked-picker-bots-away', { strict: ['.autoplay-back-btn', 'btn:▶Play', '.autoplay-bots-away', 'btn:Try again'] });
  server.s.up = true;
  await foreground(page);
  await expect(page.locator('.autoplay-play-btn')).toBeEnabled();
  await expect(note).toHaveCount(0);
});

test('the bots away in Custom Match: the bot modes greyed with why, a friend on this device open, and no more scrolling than before', async ({ page }) => {
  await seedPickedProfile(page);
  const server = await gameServer(page, true);
  // The dialog as it opens with the bots there (vs AI): it already scrolls
  // in its own container on a phone held sideways, and nowhere else.
  await page.goto('/');
  await page.getByRole('button', { name: /Custom Match/ }).click();
  const before = await overflowByViewport(page, '.dialog');
  // Open on vs AI when the answer turns: Start greys until Local is picked.
  server.s.up = false;
  await foreground(page);
  await expect(page.locator('.new-game-bots-away')).toContainText(BOTS_AWAY);
  await expect(page.getByRole('button', { name: 'Start Game' })).toBeDisabled();
  await page.getByRole('button', { name: 'Local', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start Game' })).toBeEnabled();

  await page.goto('/');
  await page.locator('.home-bots-away').waitFor();
  await page.getByRole('button', { name: /Custom Match/ }).click();
  const dialog = page.locator('.dialog');
  await expect(dialog.locator('.new-game-bots-away')).toContainText(BOTS_AWAY);
  await expect(dialog.getByRole('button', { name: 'Play vs AI' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Bot vs Bot' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Local', exact: true })).toHaveClass(/selected/);
  const after = await overflowByViewport(page, '.dialog');
  for (const vp of VIEWPORTS) expect(after[vp.name], `${vp.name}: ${before[vp.name]}px before`).toBeLessThanOrEqual(before[vp.name]);
  await sweep(page, 'new-game-bots-away', {
    strict: ['.dialog h2'],
    reachable: ['.new-game-bots-away', 'btn:Try again', 'btn:Start Game', 'btn:Cancel'],
    noBodyScroll: true,
  });
  await dialog.getByRole('button', { name: 'Start Game' }).click();
  await page.locator('.go-board-canvas').waitFor();
  expect((await gameView(page)).gameMode).toBe('local');
});

test("the bots away at a lesson's game: Let's Go! greyed with why, it fits, and Try again un-greys", async ({ page }) => {
  await seedPickedProfile(page);
  const server = await gameServer(page, false);
  await page.goto('/?learn=4');
  await expect(page.locator('.learn-game-title')).toHaveText('First Battle Time!');
  const note = page.locator('.learn-game-card .bots-away');
  await expect(note).toContainText(BOTS_AWAY);
  await expect(page.getByRole('button', { name: "Let's Go!" })).toBeDisabled();
  await sweep(page, 'lesson-game-bots-away', {
    strict: ['.learn-back-btn', '.learn-game-title', '.learn-game-btn', '.learn-game-card .bots-away', 'btn:Try again'],
  });
  server.s.up = true;
  await note.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: "Let's Go!" })).toBeEnabled();
  await expect(note).toHaveCount(0);
});

test('a ranked game whose server drops: the card fits, Try again plays on once it is back, Leave goes home and records nothing', async ({ page }) => {
  await seedPickedProfile(page);
  const server = await gameServer(page, true);
  await page.goto('/');
  await page.getByRole('button', { name: /^▶/ }).click();
  await page.locator('.autoplay-play-btn').click();
  const playersTurn = async () => {
    const g = await gameView(page);
    return g.gameId === 'e2e00001' && !g.aiThinking && g.currentColor === g.playerColor;
  };
  await expect.poll(playersTurn).toBe(true);
  const last = (await gameView(page)).boardSize - 1;

  server.s.dropMoves = true;
  await playAt(page, 2, last);
  const card = page.locator('.bot-trouble');
  await expect(card).toContainText("The bot isn't answering");
  await expect(card).toContainText("You can try again, or leave. Leaving won't count as a loss.");
  await sweep(page, 'bot-trouble', { strict: ['.bot-trouble .bot-passed-card', 'btn:Try again', 'btn:Leave'] });

  server.s.dropMoves = false;
  const before = (await gameView(page)).moveCount;
  await card.getByRole('button', { name: 'Try again' }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(async () => (await gameView(page)).moveCount).toBe(before + 1); // the bot answered
  await expect.poll(playersTurn).toBe(true);

  server.s.dropMoves = true;
  await playAt(page, 4, last);
  await card.getByRole('button', { name: 'Leave' }).click();
  await page.getByRole('button', { name: /Learn to Play/ }).waitFor();
  const history = await page.evaluate(
    () => (window as unknown as { __autoPlayStore: { getState: () => { history: unknown[] } } }).__autoPlayStore.getState().history.length,
  );
  expect(history).toBe(0);
  // The game left is gone: no card waits over the next screen.
  await page.getByRole('button', { name: /Custom Match/ }).click();
  await page.locator('.dialog').waitFor();
  await expect(card).toHaveCount(0);
});

// A game left by any way home is gone: Custom Match then Cancel goes back
// home rather than to its board, and the dropped game takes no stone (one
// that landed would wait forever on a bot that no longer answers it). A
// game still being played keeps its board after Cancel, and plays on.
for (const via of ['Home', "the card's Leave"] as const) {
  test(`after ${via}, Custom Match then Cancel shows no board for the game left; a live game plays on after Cancel`, async ({ page }) => {
    await seedPickedProfile(page);
    const server = await gameServer(page, true);
    const playersTurn = async () => {
      const g = await gameView(page);
      return g.gameId === 'e2e00001' && !g.aiThinking && g.currentColor === g.playerColor;
    };
    await page.goto('/');
    await page.getByRole('button', { name: /Custom Match/ }).click();
    await page.getByRole('button', { name: '9×9' }).click();
    await page.getByRole('button', { name: 'Start Game' }).click();
    await expect.poll(playersTurn).toBe(true);

    // a live game: New Game, Cancel, and the bot still answers
    await page.getByRole('button', { name: 'New Game' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await playAt(page, 2, 8);
    await expect.poll(async () => (await gameView(page)).moveCount).toBe(2);
    await expect.poll(playersTurn).toBe(true);

    if (via === 'Home') {
      await page.getByRole('button', { name: 'Go to the home screen' }).click();
      await page.locator('.home-confirm-card').getByRole('button', { name: 'Leave' }).click();
    } else {
      server.s.dropMoves = true;
      await playAt(page, 4, 8);
      await page.locator('.bot-trouble').getByRole('button', { name: 'Leave' }).click();
      server.s.dropMoves = false;
    }
    await page.getByRole('button', { name: /Learn to Play/ }).waitFor();
    await page.getByRole('button', { name: /Custom Match/ }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();

    // whatever reaches the dropped game, it takes nothing and nothing waits
    const before = await gameView(page);
    await playAt(page, 6, 8);
    await page.evaluate(() => (window as unknown as { __gameStore: { getState: () => { pass: () => void } } }).__gameStore.getState().pass());
    await page.waitForTimeout(3000);
    const after = await gameView(page);
    expect({ moves: after.moveCount, thinking: after.aiThinking }).toEqual({ moves: before.moveCount, thinking: false });
    await expect(page.getByRole('button', { name: /Learn to Play/ })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.go-board-canvas')).toHaveCount(0);
  });
}

test('a device whose own bots could play, with "Bot plays online" on: greyed while the server is away, open as soon as the setting is off', async ({ page }) => {
  await seedPickedProfile(page);
  await page.addInitScript(() => {
    (window as unknown as { kataGo: object }).kataGo = {
      ping: async () => ({ pong: true }),
      capabilities: async () => ({ localBots: true, evalsPerSecond: 40, humanModel: false }),
    };
    localStorage.setItem('goforkids_settings', JSON.stringify({ themeId: 'cosmic', cloudBot: true }));
  });
  await gameServer(page, false);
  await page.goto('/');
  await page.locator('.home-bots-away').waitFor();
  await expect(page.locator('.home-btn-primary')).toBeDisabled();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('checkbox', { name: 'Bot plays online' }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.home-btn-primary')).toBeEnabled();
  await expect(page.locator('.home-bots-away')).toHaveCount(0);
});

test('a device that plays its own bots: never greyed, and never asks the server', async ({ page }) => {
  await seedPickedProfile(page);
  await page.addInitScript(() => {
    (window as unknown as { kataGo: object }).kataGo = {
      ping: async () => ({ pong: true }),
      capabilities: async () => ({ localBots: true, evalsPerSecond: 40, humanModel: false }),
    };
  });
  const server = await gameServer(page, false);
  await page.goto('/');
  await page.getByRole('button', { name: /Learn to Play/ }).waitFor();
  await foreground(page);
  await expect(page.locator('.home-btn-primary')).toBeEnabled();
  await expect(page.locator('.home-bots-away')).toHaveCount(0);
  await page.getByRole('button', { name: /Custom Match/ }).click();
  await expect(page.getByRole('button', { name: 'Play vs AI' })).toBeEnabled();
  await page.waitForTimeout(300);
  expect(server.s.health).toBe(0);
});

test('Finish Game follows where the game lives, not a later flip of "Bot plays online"', async ({ page }) => {
  await seedPickedProfile(page);
  await page.addInitScript(() => {
    (window as unknown as { kataGo: object }).kataGo = {
      ping: async () => ({ pong: true }),
      capabilities: async () => ({ localBots: true, evalsPerSecond: 40, humanModel: false }),
    };
    if (!sessionStorage.getItem('seeded-settings')) {
      sessionStorage.setItem('seeded-settings', '1');
      localStorage.setItem('goforkids_settings', JSON.stringify({ themeId: 'cosmic', cloudBot: true }));
    }
  });
  await gameServer(page, true);
  const lateGame = () =>
    page.evaluate(() => (window as unknown as { __gameStore: { setState: (s: object) => void } }).__gameStore.setState({ moveCount: 180 }));
  const flipOnline = async () => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('checkbox', { name: 'Bot plays online' }).click();
    await page.getByRole('button', { name: 'Close' }).click();
  };
  const finish = page.getByRole('button', { name: 'Finish Game' });

  // A game on the server ("Bot plays online" on), then the setting off.
  await page.goto('/');
  await page.getByRole('button', { name: /Custom Match/ }).click();
  await page.getByRole('button', { name: 'Start Game' }).click();
  await expect.poll(async () => (await gameView(page)).gameId).toBe('e2e00001');
  await lateGame();
  await page.getByRole('button', { name: 'Resign' }).waitFor();
  await expect(finish).toHaveCount(0);
  await flipOnline();
  await lateGame();
  await expect(finish).toHaveCount(0);

  // A game on the device, then the setting on.
  await page.getByRole('button', { name: 'New Game' }).click();
  await page.getByRole('button', { name: 'Start Game' }).click();
  await expect.poll(async () => (await gameView(page)).gameId).toMatch(/^[0-9a-f]{8}$/);
  await lateGame();
  await expect(finish).toBeVisible();
  await flipOnline();
  await lateGame();
  await expect(finish).toBeVisible();
});
