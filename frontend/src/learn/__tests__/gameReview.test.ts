import { describe, it, expect } from 'vitest';
import { buildReview, type ScorePoint } from '../gameReview';
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

/** A 9-move game where Black captures White(2,2) on move 9. */
const CAPTURE_GAME = moves([
  [B, { row: 0, col: 0 }],
  [W, { row: 2, col: 2 }],
  [B, { row: 1, col: 2 }],
  [W, { row: 4, col: 4 }],
  [B, { row: 3, col: 2 }],
  [W, { row: 4, col: 3 }],
  [B, { row: 2, col: 1 }],
  [W, { row: 4, col: 2 }],
  [B, { row: 2, col: 3 }, [{ row: 2, col: 2 }]],
]);

/* ============================ handicap games ============================= */

describe('buildReview — handicap games (snapshots include the setup stones)', () => {
  // Handicap stone at an unused corner of the 5×5 board (far from the move-9
  // capture at 2,2). Bug: snapshots dropped Black's handicap setup entirely.
  const handicap: Point[] = [{ row: 0, col: 4 }];

  it('places handicap stones in the reconstructed snapshot board', () => {
    // Tactical-fallback path (no scores) yields the move-9 capture highlight.
    const cap = buildReview(CAPTURE_GAME, [], B, 5, handicap).find((h) => h.conceptId === 'capture');
    expect(cap).toBeDefined();
    expect(cap!.position.stones.some((s) => s.row === 0 && s.col === 4 && s.color === B)).toBe(true);
  });

  it('without handicap, the snapshot does not contain those points (regression baseline)', () => {
    const cap = buildReview(CAPTURE_GAME, [], B, 5, []).find((h) => h.conceptId === 'capture');
    expect(cap!.position.stones.some((s) => s.row === 0 && s.col === 4)).toBe(false);
  });
});

/* ============================ engine-swing selection ===================== */

describe('buildReview — engine-swing selection (the primary path)', () => {
  it('picks the biggest score swing and interprets the tactic on it', () => {
    const scores: ScorePoint[] = [
      { move: 0, lead: 0 }, { move: 1, lead: 0 }, { move: 2, lead: -1 },
      { move: 3, lead: 0 }, { move: 4, lead: -1 }, { move: 5, lead: 0 },
      { move: 6, lead: 1 }, { move: 7, lead: 2 }, { move: 8, lead: 1 },
      { move: 9, lead: 9 }, // +8 swing for Black (the player) — the capture
    ];
    const review = buildReview(CAPTURE_GAME, scores, B, 5);
    expect(review[0].moveNumber).toBe(9);
    expect(review[0].kind).toBe('good');
    expect(review[0].conceptId).toBe('capture'); // tactic interpreted
    expect(review[0].headline).toMatch(/about 8 point/);
    expect(review[0].swing).toBe(8);
  });

  it('a big swing with no tactic gets a generic headline + null concept', () => {
    const hist = moves([
      [B, { row: 0, col: 0 }], [W, { row: 4, col: 4 }], [B, { row: 0, col: 2 }],
      [W, { row: 4, col: 2 }], [B, { row: 2, col: 2 }], [W, { row: 4, col: 0 }],
    ]);
    const scores: ScorePoint[] = [
      { move: 0, lead: 0 }, { move: 1, lead: 0 }, { move: 2, lead: 0 },
      { move: 3, lead: 0 }, { move: 4, lead: 0 }, { move: 5, lead: 6 }, // +6, Black move, no capture/atari
    ];
    const review = buildReview(hist, scores, B, 5);
    expect(review[0].moveNumber).toBe(5);
    expect(review[0].conceptId).toBeNull();
    expect(review[0].kind).toBe('good');
    expect(review[0].headline).toMatch(/Strong move/);
  });

  it('a swing against the player on a bot move reads as "learn"', () => {
    const hist = moves([
      [B, { row: 0, col: 0 }], [W, { row: 4, col: 4 }], [B, { row: 0, col: 2 }],
      [W, { row: 2, col: 2 }],
    ]);
    const scores: ScorePoint[] = [
      { move: 0, lead: 0 }, { move: 1, lead: 0 }, { move: 2, lead: 0 },
      { move: 3, lead: 0 }, { move: 4, lead: -7 }, // White move, -7 for Black
    ];
    const review = buildReview(hist, scores, B, 5);
    expect(review[0].moveNumber).toBe(4);
    expect(review[0].kind).toBe('learn');
    expect(review[0].headline).toMatch(/strong move/i);
  });

  it('ignores sub-threshold swings and opening noise', () => {
    const scores: ScorePoint[] = [
      { move: 0, lead: 0 }, { move: 1, lead: 9 }, // big but move 1 (opening) — skipped
      { move: 2, lead: 11 }, // +2 swing — below MIN_SWING
    ];
    // No qualifying swing → falls back to tactical (capture at move 9 isn't in this short list).
    expect(buildReview(moves([[B, { row: 0, col: 0 }], [W, { row: 1, col: 1 }]]), scores, B, 5)).toEqual([]);
  });
});

/* ============================ tactical fallback ========================== */

describe('buildReview — tactical fallback (no score data)', () => {
  it('a player capture is a "good" capture highlight', () => {
    const review = buildReview(CAPTURE_GAME, [], B, 5);
    const cap = review.find((h) => h.conceptId === 'capture');
    expect(cap).toBeTruthy();
    expect(cap!.kind).toBe('good');
    expect(cap!.headline).toContain('captured 1 stone');
    expect(cap!.moveNumber).toBe(9);
  });

  it('an opponent capture of the player is a "learn" highlight', () => {
    const hist = moves([
      [W, { row: 0, col: 0 }], [B, { row: 2, col: 2 }], [W, { row: 1, col: 2 }],
      [B, { row: 4, col: 4 }], [W, { row: 3, col: 2 }], [B, { row: 4, col: 3 }],
      [W, { row: 2, col: 1 }], [B, { row: 4, col: 2 }],
      [W, { row: 2, col: 3 }, [{ row: 2, col: 2 }]],
    ]);
    const cap = buildReview(hist, [], B, 5).find((h) => h.conceptId === 'capture');
    expect(cap!.kind).toBe('learn');
    expect(cap!.headline).toContain('bot captured 1');
  });

  it('detects atari when there is no capture', () => {
    const hist = moves([
      [W, { row: 2, col: 2 }], [B, { row: 1, col: 2 }], [W, { row: 4, col: 4 }],
      [B, { row: 3, col: 2 }], [W, { row: 0, col: 0 }], [B, { row: 2, col: 1 }],
    ]);
    const atari = buildReview(hist, [], B, 5).find((h) => h.conceptId === 'atari');
    expect(atari).toBeTruthy();
    expect(atari!.kind).toBe('good');
  });

  it('returns nothing for a quiet game (no captures, no atari, no scores)', () => {
    const hist = moves([
      [B, { row: 0, col: 0 }], [W, { row: 4, col: 4 }],
      [B, { row: 0, col: 2 }], [W, { row: 4, col: 2 }],
    ]);
    expect(buildReview(hist, [], B, 5)).toEqual([]);
  });
});
