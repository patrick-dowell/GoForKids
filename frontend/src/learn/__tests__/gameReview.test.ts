import { describe, it, expect } from 'vitest';
import { buildReview } from '../gameReview';
import { Color, type MoveRecord, type Point } from '../../engine/types';

/** Build a MoveRecord list from (color, point) pairs; captures default to []. */
function moves(seq: Array<[Color, Point | null, Point[]?]>): MoveRecord[] {
  return seq.map(([color, point, captures], i) => ({
    color,
    point,
    captures: captures ?? [],
    moveNumber: i + 1,
  }));
}

const B = Color.Black;
const W = Color.White;

describe('buildReview — capture detection', () => {
  it('frames a player capture as a "good" highlight linking to the capture concept', () => {
    // Black surrounds and captures the White stone at (2,2) on move 9.
    const hist = moves([
      [B, { row: 0, col: 0 }],
      [W, { row: 2, col: 2 }],
      [B, { row: 1, col: 2 }],
      [W, { row: 4, col: 4 }],
      [B, { row: 3, col: 2 }],
      [W, { row: 4, col: 3 }],
      [B, { row: 2, col: 1 }],
      [W, { row: 4, col: 2 }],
      [B, { row: 2, col: 3 }, [{ row: 2, col: 2 }]], // captures W(2,2)
    ]);
    const review = buildReview(hist, B, 5);
    expect(review.length).toBeGreaterThanOrEqual(1);
    const cap = review.find((h) => h.conceptId === 'capture');
    expect(cap).toBeTruthy();
    expect(cap!.kind).toBe('good');
    expect(cap!.headline).toContain('captured 1 stone');
    expect(cap!.moveNumber).toBe(9);
    // The captured point is marked on the snapshot, and is empty there.
    expect(cap!.position.highlight).toEqual([{ row: 2, col: 2 }]);
    expect(cap!.position.stones.find((s) => s.row === 2 && s.col === 2)).toBeUndefined();
  });

  it('frames an opponent capture of the player as a "learn" highlight', () => {
    // White captures a Black stone — same shape, colors swapped, player is Black.
    const hist = moves([
      [W, { row: 0, col: 0 }],
      [B, { row: 2, col: 2 }],
      [W, { row: 1, col: 2 }],
      [B, { row: 4, col: 4 }],
      [W, { row: 3, col: 2 }],
      [B, { row: 4, col: 3 }],
      [W, { row: 2, col: 1 }],
      [B, { row: 4, col: 2 }],
      [W, { row: 2, col: 3 }, [{ row: 2, col: 2 }]], // captures B(2,2)
    ]);
    const review = buildReview(hist, B, 5);
    const cap = review.find((h) => h.conceptId === 'capture');
    expect(cap).toBeTruthy();
    expect(cap!.kind).toBe('learn');
    expect(cap!.headline).toContain('bot captured 1');
  });
});

describe('buildReview — atari detection (no capture)', () => {
  it('detects the player putting the bot in atari', () => {
    // Black reduces White(2,2) to one liberty without capturing.
    const hist = moves([
      [W, { row: 2, col: 2 }],
      [B, { row: 1, col: 2 }],
      [W, { row: 4, col: 4 }],
      [B, { row: 3, col: 2 }],
      [W, { row: 0, col: 0 }],
      [B, { row: 2, col: 1 }], // White(2,2) now has 1 liberty at (2,3)
    ]);
    const review = buildReview(hist, B, 5);
    const atari = review.find((h) => h.conceptId === 'atari');
    expect(atari).toBeTruthy();
    expect(atari!.kind).toBe('good');
    expect(atari!.headline.toLowerCase()).toContain('atari');
  });
});

describe('buildReview — selection', () => {
  it('returns nothing for a quiet game (no captures, no atari)', () => {
    const hist = moves([
      [B, { row: 0, col: 0 }],
      [W, { row: 4, col: 4 }],
      [B, { row: 0, col: 2 }],
      [W, { row: 4, col: 2 }],
    ]);
    expect(buildReview(hist, B, 5)).toEqual([]);
  });

  it('caps at `max` and leads with a good moment when one exists', () => {
    // Player captures (good) AND gets captured (learn) in one game.
    const hist = moves([
      [B, { row: 0, col: 0 }],
      [W, { row: 2, col: 2 }],
      [B, { row: 1, col: 2 }],
      [W, { row: 0, col: 1 }],
      [B, { row: 3, col: 2 }],
      [W, { row: 0, col: 3 }],
      [B, { row: 2, col: 1 }],
      [W, { row: 1, col: 0 }],
      [B, { row: 2, col: 3 }, [{ row: 2, col: 2 }]], // player captures W
      [W, { row: 4, col: 4 }],
      [B, { row: 4, col: 0 }],
      [W, { row: 4, col: 1 }],
      [B, { row: 4, col: 4 }, undefined], // filler
    ]);
    const review = buildReview(hist, B, 5, 2);
    expect(review.length).toBeLessThanOrEqual(2);
    expect(review[0].kind).toBe('good');
  });
});
