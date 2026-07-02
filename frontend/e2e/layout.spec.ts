import { test, expect, type Page } from '@playwright/test';

/**
 * Layout-regression sweep: walk the device-viewport matrix on every major
 * screen and assert nothing critical is cut off. Codifies the manual sweep
 * from DEVJOURNAL Session 29 (2026-07-01), which found five real cut-offs —
 * including Roland's iPad-landscape board and a phone-landscape ranked
 * picker whose Play button was unreachable.
 *
 * Probe semantics:
 *  - STRICT: the element must be entirely inside the viewport. Used for the
 *    board during play (you can never scroll mid-game) and primary actions.
 *  - REACHABLE: the element may extend past the viewport IF the page or a
 *    scrollable ancestor can bring it into view. Used for long control
 *    stacks (replay panel, profile page).
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
];

/** Selector prefixed with `btn:` matches a button by exact trimmed text. */
interface ProbeSpec {
  strict?: string[];
  reachable?: string[];
}

/** Returns [] when clean, else human-readable issue strings. */
async function probe(page: Page, spec: ProbeSpec): Promise<string[]> {
  return page.evaluate(({ strict = [], reachable = [] }) => {
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

    return issues;
  }, spec as { strict?: string[]; reachable?: string[] });
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
  });
});

test('replay: board fits, controls reachable at every viewport', async ({ page }) => {
  await seedPickedProfile(page);
  await page.goto('/?replay=demo');
  await page.locator('.go-board-canvas').waitFor();
  await page.locator('.replay-controls').waitFor();
  await sweep(page, 'replay', {
    strict: ['.go-board-canvas'],
    reachable: ['.replay-controls', 'btn:Download SGF'],
  });
});

test('lesson: board fits at every viewport', async ({ page }) => {
  await seedPickedProfile(page);
  await page.goto('/?learn=1');
  await page.locator('.go-board-canvas').waitFor();
  await sweep(page, 'lesson', {
    strict: ['.go-board-canvas'],
    reachable: ['.learn-back-btn'],
  });
});

test('choose-avatar gate: confirm button reachable at every viewport', async ({ page }) => {
  // Fresh profile — the one-time character select must appear.
  await page.goto('/?learn=1');
  await page.locator('.choose-avatar-grid').waitFor();
  await sweep(page, 'choose-avatar', {
    strict: ['.choose-avatar-back'],
    reachable: ["btn:That's me! →", '.learn-reward-title'],
  });
});

test('ranked match-picker: start button reachable at every viewport', async ({ page }) => {
  await seedPickedProfile(page);
  await page.goto('/');
  // Home's ranked entry is "▶Play" (distinct from "✨Learn to Play").
  await page.getByRole('button', { name: /^▶/ }).click();
  await page.locator('.autoplay-view').waitFor();
  await sweep(page, 'ranked-picker', {
    reachable: ['btn:▶Play'],
  });
});

test('home: primary navigation reachable at every viewport', async ({ page }) => {
  await seedPickedProfile(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Learn to Play/ }).waitFor();
  await sweep(page, 'home', {
    reachable: ['btn:✨Learn to Play', 'btn:▶Play', 'btn:👤Profile'],
  });
});
