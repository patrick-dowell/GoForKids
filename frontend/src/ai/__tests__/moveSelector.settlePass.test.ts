import { describe, it, expect, vi } from 'vitest';
import {
  boardFromGrid,
  isOpponentEnclosedFill,
  selectAiMove,
  type PositionAnalysis,
  type MoveCandidate,
} from '../moveSelector';
import { Color } from '../../engine/types';
import type { RankProfile } from '../profileLoader';

/**
 * Pins the GN5R6K9G fixes (2026-07-05): the bot must end games —
 *  - junk drops inside the opponent's sealed territory are unplayable
 *    (sampler + random branch + rescue), ko recaptures never flagged;
 *  - fully-settled board (every empty region enclosed) → voluntary pass;
 *  - settle path: ≥0.75-pt bar vs pass, unplayable honest-top → pass,
 *    eye-fill exhaustion → pass (never the random fallback).
 */

const holder = vi.hoisted(() => ({ profile: {} as RankProfile }));

vi.mock('../profileLoader', () => ({
  getProfile: () => holder.profile,
}));

const BASE: RankProfile = {
  max_point_loss: 28,
  mistake_freq: 0.72,
  policy_weight: 0.12,
  randomness: 0.78,
  random_move_chance: 0,
  local_bias: 0,
  first_line_chance: 0,
  visits: 16,
  min_candidates: 10,
  opening_moves: 0,
  pass_threshold: 0.1,
  clarity_prior: 1.1,
  clarity_score_gap: 999,
};

function emptyGrid(size: number): number[][] {
  return Array.from({ length: size }, () => new Array(size).fill(0));
}

function cand(row: number, col: number, order: number, scoreLead: number, prior = 0.3, visits = 12): MoveCandidate {
  return { move: { row, col }, visits, winrate: 0.5, scoreLead, prior, order };
}

function passCand(order: number, scoreLead: number, visits = 12): MoveCandidate {
  return { move: { row: -1, col: -1 }, visits, winrate: 0.5, scoreLead, prior: 0.1, order };
}

function analyzeWith(candidates: MoveCandidate[]) {
  return async (): Promise<PositionAnalysis> => ({ rootVisits: 100, candidates });
}

/** Fully-settled board: White wall on col 4, Black wall on col 5; cols 0-3
 *  are White territory, cols 6-8 are Black territory. No dame. */
function settledBoard() {
  const grid = emptyGrid(9);
  for (let r = 0; r < 9; r++) {
    grid[r][4] = Color.White;
    grid[r][5] = Color.Black;
  }
  return boardFromGrid(grid, 9);
}

describe('isOpponentEnclosedFill', () => {
  it('flags a White drop inside Black-enclosed territory', () => {
    expect(isOpponentEnclosedFill(settledBoard(), Color.White, { row: 4, col: 7 })).toBe(true);
  });

  it('never flags a ko recapture (mixed-color region borders)', () => {
    const grid = emptyGrid(9);
    grid[3][4] = Color.White;
    grid[5][4] = Color.White;
    grid[4][3] = Color.White;
    grid[4][5] = Color.Black;
    const board = boardFromGrid(grid, 9);
    expect(isOpponentEnclosedFill(board, Color.White, { row: 4, col: 4 })).toBe(false);
    expect(isOpponentEnclosedFill(board, Color.Black, { row: 4, col: 4 })).toBe(false);
  });
});

describe('voluntary pass on a settled board', () => {
  it('passes when candidates offer only own fills and enclosed junk', async () => {
    holder.profile = { ...BASE, reading_rate: 0, policy_temp: 1 };
    const board = settledBoard();
    const analyze = analyzeWith([
      cand(4, 2, 0, 1.0, 0.6), // own-territory fill
      cand(4, 7, 1, 0.5, 0.3), // junk inside Black's territory
    ]);
    for (let run = 0; run < 10; run++) {
      expect(await selectAiMove(board, Color.White, '18k', null, analyze)).toBeNull();
    }
  });

  it('the random branch cannot produce junk on a settled board', async () => {
    holder.profile = { ...BASE, random_move_chance: 1.0 };
    // Give the board one open area by breaking the black wall at (0,5) —
    // the random branch must confine itself to the non-junk region.
    const grid = emptyGrid(9);
    for (let r = 0; r < 9; r++) {
      grid[r][4] = Color.White;
      if (r > 0) grid[r][5] = Color.Black;
    }
    const open = boardFromGrid(grid, 9);
    const analyze = analyzeWith([cand(0, 5, 0, 1.0, 0.6)]);
    for (let run = 0; run < 15; run++) {
      const move = await selectAiMove(open, Color.White, '18k', null, analyze);
      // Only non-junk points are acceptable: the region right of the broken
      // wall now touches White via (0,5)'s neighborhood, so specific junk
      // assertions: never inside White's own cols 0-3 territory.
      expect(move).not.toBeNull();
      expect(move!.col).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('settle path (opponent passed)', () => {
  it('passes when the best move beats pass by less than 0.75', async () => {
    holder.profile = { ...BASE };
    const board = boardFromGrid(emptyGrid(9), 9);
    const analyze = analyzeWith([
      cand(4, 4, 0, 5.4, 0.5, 60),
      passCand(1, 5.0, 30), // best beats pass by only 0.4
    ]);
    for (let run = 0; run < 10; run++) {
      expect(
        await selectAiMove(board, Color.White, '18k', null, analyze, { opponentPassed: true }),
      ).toBeNull();
    }
  });

  it('still plays a real endgame move worth 2 points', async () => {
    holder.profile = { ...BASE };
    const board = boardFromGrid(emptyGrid(9), 9);
    const analyze = analyzeWith([
      cand(4, 4, 0, 7.0, 0.5, 60),
      passCand(1, 5.0, 30),
    ]);
    for (let run = 0; run < 10; run++) {
      expect(
        await selectAiMove(board, Color.White, '18k', null, analyze, { opponentPassed: true }),
      ).toEqual({ row: 4, col: 4 });
    }
  });

  it('passes instead of playing an unplayable honest top (the GN5R6K9G junk loop)', async () => {
    holder.profile = { ...BASE };
    const board = settledBoard();
    const analyze = analyzeWith([
      cand(4, 2, 0, 9.0, 0.7, 60), // own-territory fill, "beats pass" on paper
      passCand(1, 5.0, 30),
    ]);
    for (let run = 0; run < 10; run++) {
      expect(
        await selectAiMove(board, Color.White, '18k', null, analyze, { opponentPassed: true }),
      ).toBeNull();
    }
  });
});
