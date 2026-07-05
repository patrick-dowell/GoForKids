import { describe, it, expect, vi } from 'vitest';
import { boardFromGrid, selectAiMove, type PositionAnalysis, type MoveCandidate } from '../moveSelector';
import { Color } from '../../engine/types';
import type { RankProfile } from '../profileLoader';

/**
 * Pins sampler v2 (round 2, 2026-07-05): attention lapse makes the sampler
 * MISS high-prior vital points (temperature can't), and the sampling loss
 * cap keeps misses at a few points instead of game-ending collapses.
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
  reading_rate: 0,
  policy_temp: 1,
};

function emptyGrid(size: number): number[][] {
  return Array.from({ length: size }, () => new Array(size).fill(0));
}

function cand(row: number, col: number, order: number, scoreLead: number, prior: number): MoveCandidate {
  return { move: { row, col }, visits: Math.max(16 - order, 1), winrate: 0.5, scoreLead, prior, order };
}

function analyzeWith(candidates: MoveCandidate[]) {
  return async (): Promise<PositionAnalysis> => ({ rootVisits: 16, candidates });
}

const VITAL = cand(4, 4, 0, 5.0, 0.98);
const SIDE_A = cand(2, 2, 1, 4.0, 0.001);
const SIDE_B = cand(6, 6, 2, 3.5, 0.001);

async function countVital(runs: number): Promise<number> {
  const board = boardFromGrid(emptyGrid(9), 9);
  const analyze = analyzeWith([VITAL, SIDE_A, SIDE_B]);
  let vital = 0;
  for (let i = 0; i < runs; i++) {
    const move = await selectAiMove(board, Color.White, '15k', null, analyze);
    if (move?.row === 4 && move?.col === 4) vital++;
  }
  return vital;
}

describe('attention lapse', () => {
  it('lapse 0: the 0.98-prior vital point dominates', async () => {
    holder.profile = { ...BASE, sample_lapse: 0 };
    expect(await countVital(40)).toBeGreaterThanOrEqual(34);
  });

  it('lapse 0.6: the vital point gets MISSED regularly', async () => {
    holder.profile = { ...BASE, sample_lapse: 0.6 };
    expect(await countVital(40)).toBeLessThanOrEqual(30);
  });
});

describe('sampling loss cap', () => {
  it('capped: a catastrophic candidate is never sampled', async () => {
    // Uniform sampling (lapse 1) over: best 5.0, ok 2.0, disaster -20.
    holder.profile = { ...BASE, sample_lapse: 1, sample_loss_cap: 6 };
    const board = boardFromGrid(emptyGrid(9), 9);
    const analyze = analyzeWith([
      cand(4, 4, 0, 5.0, 0.5),
      cand(2, 2, 1, 2.0, 0.3),
      cand(6, 6, 2, -20.0, 0.2), // 25 points below best — excluded by cap
    ]);
    for (let i = 0; i < 60; i++) {
      const move = await selectAiMove(board, Color.White, '15k', null, analyze);
      expect(move).not.toEqual({ row: 6, col: 6 });
    }
  });

  it('uncapped: the catastrophe is reachable (regression guard for the knob)', async () => {
    holder.profile = { ...BASE, sample_lapse: 1 };
    const board = boardFromGrid(emptyGrid(9), 9);
    const analyze = analyzeWith([
      cand(4, 4, 0, 5.0, 0.5),
      cand(2, 2, 1, 2.0, 0.3),
      cand(6, 6, 2, -20.0, 0.2),
    ]);
    let disasters = 0;
    for (let i = 0; i < 60; i++) {
      const move = await selectAiMove(board, Color.White, '15k', null, analyze);
      if (move?.row === 6 && move?.col === 6) disasters++;
    }
    expect(disasters).toBeGreaterThan(0);
  });
});
