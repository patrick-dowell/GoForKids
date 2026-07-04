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

const VIEWPORTS = [
  { name: 'iPhone Pro portrait', width: 393, height: 852 },
  { name: 'iPhone Pro landscape', width: 852, height: 393 },
  { name: 'iPhone Pro Max portrait', width: 430, height: 932 },
  { name: 'iPhone Pro Max landscape', width: 932, height: 430 },
  { name: 'iPad mini portrait', width: 744, height: 1133 },
  { name: 'iPad mini landscape', width: 1133, height: 744 },
  { name: 'iPad 10.2 portrait', width: 810, height: 1080 },
  { name: 'iPad 10.2 landscape', width: 1080, height: 810 }, // Roland's board bug (S29 #1)
  { name: 'iPad Air portrait', width: 820, height: 1180 },
  { name: 'iPad Air landscape', width: 1180, height: 820 }, // replay grid bug (S29 #2)
  { name: 'iPad Pro 12.9 portrait', width: 1024, height: 1366 },
  { name: 'iPad Pro 12.9 landscape', width: 1366, height: 1024 },
  { name: 'iPad Pro 13 portrait', width: 1032, height: 1376 }, // replay-panel bug (S29 addendum)
  { name: 'iPad Pro 13 landscape', width: 1376, height: 1032 },
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
    // Let media queries, container queries, and canvas resize settle.
    await page.waitForTimeout(150);
    const issues = await probe(page, spec);
    if (issues.length) failures.push(`[${screen} @ ${vp.name} ${vp.width}x${vp.height}] ${issues.join(' | ')}`);
  }
  expect(failures, failures.join('\n')).toEqual([]);
}

/** Mark the one-time avatar pick as done so tests land on their target
 *  screen instead of the ChooseAvatarScreen gate. */
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
  // Fresh profile — the one-time character select must appear.
  await page.goto('/?learn=1');
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
    reachable: ['.profile-avatar-grid'],
    noBodyScroll: true, // WKWebView: must be an explicit container (S17 fix)
  });
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
