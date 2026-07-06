import { describe, it, expect, beforeEach } from 'vitest';
import {
  boardFromGrid,
  selectWithKataGo,
  _resetReadCooldowns,
  type PositionAnalysis,
} from '../moveSelector';
import type { RankProfile } from '../profileLoader';
import { Color } from '../../engine/types';

/**
 * Sampler v3 (S50, from Patrick's uploads 2J77PPVC/N76NV5W6): unread moves
 * must be mildly imperfect BY CONSTRUCTION (sample_min_loss — never
 * accidentally the engine's top pick), and a read move arms a cooldown so
 * the bot can't produce several engine-quality moves in a row
 * (read_cooldown — Patrick's streak observation).
 */

function emptyGrid(size: number): number[][] {
  return Array.from({ length: size }, () => new Array(size).fill(0));
}

const BEST = { row: 4, col: 4 };

/** Wide pool: best at scoreLead 5.0, alternatives spread 0.4..8 below. */
const analysis: PositionAnalysis = {
  rootVisits: 16,
  candidates: [
    { move: BEST, visits: 8, winrate: 0.6, scoreLead: 5.0, prior: 0.95, order: 0 },
    { move: { row: 2, col: 2 }, visits: 3, winrate: 0.55, scoreLead: 4.6, prior: 0.02, order: 1 }, // -0.4: inside the floor
    { move: { row: 3, col: 5 }, visits: 2, winrate: 0.5, scoreLead: 4.2, prior: 0.01, order: 2 },  // -0.8
    { move: { row: 6, col: 3 }, visits: 1, winrate: 0.5, scoreLead: 2.5, prior: 0.01, order: 3 },  // -2.5
    { move: { row: 7, col: 7 }, visits: 1, winrate: 0.4, scoreLead: -4.0, prior: 0.005, order: 4 }, // -9: past the cap
  ],
};

function profile(overrides: Partial<RankProfile>): RankProfile {
  return {
    max_point_loss: 26,
    mistake_freq: 0.72,
    policy_weight: 0.12,
    randomness: 0.78,
    random_move_chance: 0, // deterministic: no random-move branch
    local_bias: 0,
    first_line_chance: 0,
    visits: 16,
    min_candidates: 10,
    opening_moves: 0, // not opening — skip the top-3 branch
    clarity_prior: 0.87,
    clarity_score_gap: 15,
    policy_temp: 2.3,
    sample_lapse: 0.1,
    sample_loss_cap: 6.0,
    sample_min_loss: 0.5,
    ...overrides,
  };
}

function board() {
  const g = emptyGrid(9);
  // A couple of stones so countStones > opening_moves(0) trivially holds.
  g[0][0] = Color.Black;
  g[8][8] = Color.White;
  return boardFromGrid(g, 9);
}

describe('sample_min_loss (never accidentally perfect)', () => {
  beforeEach(() => _resetReadCooldowns());

  it('unread moves never return the pool-best candidate', () => {
    // reading_rate 0 → every move is sampled; min_loss 0.5 must exclude the
    // best (loss 0) AND the -0.4 near-best; cap 6 excludes the -9 blunder.
    const p = profile({ reading_rate: 0 });
    const allowed = new Set(['3,5', '6,3']);
    for (let i = 0; i < 60; i++) {
      const mv = selectWithKataGo(board(), Color.Black, p, analysis, null);
      expect(mv).not.toBeNull();
      expect(`${mv!.row},${mv!.col}`).not.toBe('4,4'); // never the best
      expect(`${mv!.row},${mv!.col}`).not.toBe('2,2'); // never inside the floor
      expect(allowed.has(`${mv!.row},${mv!.col}`)).toBe(true);
    }
  });

  it('FORCED positions escape the floor (the only correct move gets played)', () => {
    // Atari shape: the saving move towers +23 over the alternatives. The
    // floor would forbid it (it's pool-best with losers available) — the
    // S50b escape must play it anyway. Gap 23 >= clarity_score_gap 15.
    const forced: PositionAnalysis = {
      rootVisits: 16,
      candidates: [
        { move: BEST, visits: 10, winrate: 0.7, scoreLead: 12.0, prior: 0.6, order: 0 },
        { move: { row: 2, col: 2 }, visits: 3, winrate: 0.3, scoreLead: -11.0, prior: 0.2, order: 1 },
        { move: { row: 3, col: 5 }, visits: 2, winrate: 0.25, scoreLead: -13.0, prior: 0.1, order: 2 },
      ],
    };
    const p = profile({ reading_rate: 0 });
    for (let i = 0; i < 20; i++) {
      expect(selectWithKataGo(board(), Color.Black, p, forced, null)).toEqual(BEST);
    }
    // White-perspective sign flip: same gap magnitude must still trip it.
    const forcedW: PositionAnalysis = {
      rootVisits: 16,
      candidates: [
        { move: BEST, visits: 10, winrate: 0.7, scoreLead: -12.0, prior: 0.6, order: 0 },
        { move: { row: 2, col: 2 }, visits: 3, winrate: 0.3, scoreLead: 11.0, prior: 0.2, order: 1 },
      ],
    };
    for (let i = 0; i < 20; i++) {
      expect(selectWithKataGo(board(), Color.White, p, forcedW, null)).toEqual(BEST);
    }
  });

  it('floor yields when it would empty the pool (near-equal candidates)', () => {
    const tight: PositionAnalysis = {
      rootVisits: 16,
      candidates: [
        { move: BEST, visits: 8, winrate: 0.6, scoreLead: 5.0, prior: 0.9, order: 0 },
        { move: { row: 2, col: 2 }, visits: 3, winrate: 0.55, scoreLead: 4.9, prior: 0.05, order: 1 },
      ],
    };
    const p = profile({ reading_rate: 0 });
    const mv = selectWithKataGo(board(), Color.Black, p, tight, null);
    expect(mv).not.toBeNull(); // still plays — the band relaxed instead of passing
  });
});

describe('read_cooldown (no great-move streaks)', () => {
  beforeEach(() => _resetReadCooldowns());

  it('a read move forces the next N moves onto the sampled path', () => {
    // reading_rate 1 → reads whenever allowed. clarity_prior 0.87 < best
    // prior 0.95 → the read path plays the engine's best move. With
    // cooldown 2 the pattern must be: read, sample, sample, read, ...
    const p = profile({ reading_rate: 1, read_cooldown: 2 });
    const got: string[] = [];
    for (let i = 0; i < 6; i++) {
      const mv = selectWithKataGo(board(), Color.Black, p, analysis, null);
      got.push(mv!.row === 4 && mv!.col === 4 ? 'read' : 'sample');
    }
    expect(got).toEqual(['read', 'sample', 'sample', 'read', 'sample', 'sample']);
  });

  it('cooldown state is per color', () => {
    const p = profile({ reading_rate: 1, read_cooldown: 2 });
    const black1 = selectWithKataGo(board(), Color.Black, p, analysis, null);
    const white1 = selectWithKataGo(board(), Color.White, p, analysis, null);
    // Black's read must not consume White's budget.
    expect(black1).toEqual(BEST);
    expect(white1).toEqual(BEST);
  });
});
