import { test, expect, type Page } from '@playwright/test';
import { CANVAS_SIZE, geometry } from '../src/board/geometry';
import { Color } from '../src/engine/types';

/**
 * Local (pass-and-play) regression: BOTH colors must be able to place stones
 * by tapping. Broke publicly at the Dawson camp session (2026-07-13): the
 * canClick turn gate in GoBoard.tsx required currentColor === playerColor —
 * right for vs-AI (stops the White player tapping during the window before
 * the bot's opening Black move), but in local mode playerColor is fixed at
 * game creation while currentColor alternates, so after Black's move 1 the
 * board went dead for White.
 *
 * Drives the REAL tap path (pointer events on the canvas → canClick →
 * commitMove → playMove), not the store directly — the store was never
 * broken; the UI gate was. Local mode needs no backend, and `playwright
 * test` (npm run test:layout, the pre-camp-build gate) picks this up along
 * with the layout sweep.
 */

const SIZE = 9;

// Same seeding as layout.spec.ts — skip the first-run avatar picker.
async function seedPickedProfile(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'goforkids.profile.v1',
      JSON.stringify({ avatar: 'tide', displayName: '', avatarPicked: true }),
    );
  });
}

/** Click intersection (row, col) via the same geometry the renderer uses,
 *  scaled from canvas-internal coords (700×700) to the displayed rect. */
async function clickIntersection(page: Page, row: number, col: number) {
  const canvas = page.locator('.go-board-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('board canvas not visible');
  const { x, y } = geometry(SIZE).toScreen(row, col);
  await canvas.click({
    position: { x: (x / CANVAS_SIZE) * box.width, y: (y / CANVAS_SIZE) * box.height },
  });
}

function gameState(page: Page) {
  return page.evaluate(() => {
    const s = (
      window as unknown as {
        __gameStore: {
          getState: () => { gameMode: string; currentColor: number; moveCount: number };
        };
      }
    ).__gameStore.getState();
    return { gameMode: s.gameMode, currentColor: s.currentColor, moveCount: s.moveCount };
  });
}

test('local mode: both colors can place stones by tapping', async ({ page }) => {
  await seedPickedProfile(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Custom Match/ }).click();
  await page.getByRole('button', { name: 'Local', exact: true }).click();
  await page.getByRole('button', { name: '9×9' }).click();
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.locator('.go-board-canvas').waitFor();

  expect(await gameState(page)).toEqual({
    gameMode: 'local',
    currentColor: Color.Black,
    moveCount: 0,
  });

  // Black's opening move (center).
  await clickIntersection(page, 4, 4);
  await expect.poll(async () => (await gameState(page)).moveCount).toBe(1);
  expect((await gameState(page)).currentColor).toBe(Color.White);

  // THE regression: White — the side that isn't playerColor — must also be
  // able to place by tapping. Before the fix, canClick swallowed this tap.
  await clickIntersection(page, 2, 6);
  await expect.poll(async () => (await gameState(page)).moveCount).toBe(2);
  expect((await gameState(page)).currentColor).toBe(Color.Black);

  // And back to Black, so alternation keeps working past one round trip.
  await clickIntersection(page, 6, 2);
  await expect.poll(async () => (await gameState(page)).moveCount).toBe(3);
  expect((await gameState(page)).currentColor).toBe(Color.White);
});
