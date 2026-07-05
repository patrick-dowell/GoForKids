import { describe, it, expect, vi } from 'vitest';
import {
  boardFromGrid,
  selectAiMove,
  type PositionAnalysis,
  type MoveCandidate,
  type AnalyzeOpts,
} from '../moveSelector';
import { Color } from '../../engine/types';
import type { RankProfile } from '../profileLoader';

/**
 * Pins the §3 out-of-pool mechanism (2026-07-05): reading_rate / policy_temp
 * sampling and the wide_root_noise analysis plumbing.
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

function cand(row: number, col: number, order: number, scoreLead: number, prior: number): MoveCandidate {
  return { move: { row, col }, visits: Math.max(16 - order, 1), winrate: 0.5, scoreLead, prior, order };
}

function analyzeWith(candidates: MoveCandidate[]) {
  return async (): Promise<PositionAnalysis> => ({ rootVisits: 16, candidates });
}

describe('reading_rate sampling (no-reading path)', () => {
  it('samples by PRIOR, ignoring scores — shape intuition without reading', async () => {
    holder.profile = { ...BASE, reading_rate: 0, policy_temp: 0.1 };
    const board = boardFromGrid(emptyGrid(9), 9);
    // Best-scored move has a modest prior; a worse-scored move has the big
    // prior. A non-reader plays the shape move.
    const analyze = analyzeWith([
      cand(0, 0, 0, 10.0, 0.2),
      cand(4, 4, 1, 2.0, 0.7),
    ]);
    for (let run = 0; run < 25; run++) {
      const move = await selectAiMove(board, Color.White, '15k', null, analyze);
      expect(move).toEqual({ row: 4, col: 4 });
    }
  });

  it('hot temperature reaches the prior tail (occasional big mistakes)', async () => {
    holder.profile = { ...BASE, reading_rate: 0, policy_temp: 3 };
    const board = boardFromGrid(emptyGrid(9), 9);
    const analyze = analyzeWith([
      cand(4, 4, 0, 5.0, 0.85),
      cand(0, 8, 1, -6.0, 0.03), // tail move — a real mistake
    ]);
    const picks = new Set<string>();
    for (let run = 0; run < 80; run++) {
      const move = await selectAiMove(board, Color.White, '15k', null, analyze);
      picks.add(`${move!.row},${move!.col}`);
    }
    expect(picks.has('0,8')).toBe(true);
  });

  it('reading_rate 1.0 never samples — machinery ignores the big-prior bad move', async () => {
    holder.profile = { ...BASE, reading_rate: 1.0, policy_temp: 3 };
    const board = boardFromGrid(emptyGrid(9), 9);
    // The bad move is outside max_point_loss, so the READING path filters it;
    // the sampling path would overwhelmingly pick it (prior 0.9).
    const analyze = analyzeWith([
      cand(0, 0, 0, 10.0, 0.05),
      cand(4, 4, 1, -50.0, 0.9),
    ]);
    for (let run = 0; run < 25; run++) {
      const move = await selectAiMove(board, Color.White, '15k', null, analyze);
      expect(move).toEqual({ row: 0, col: 0 });
    }
  });

  it('never samples an own-eye fill, whatever its prior', async () => {
    holder.profile = { ...BASE, reading_rate: 0, policy_temp: 1 };
    const grid = emptyGrid(9);
    // Real White eye at (8,4); the Black stone keeps the open board from
    // counting as White territory (territory-net rule).
    for (const [r, c] of [[7, 3], [7, 4], [7, 5], [8, 3], [8, 5]]) {
      grid[r][c] = Color.White;
    }
    grid[0][8] = Color.Black;
    const board = boardFromGrid(grid, 9);
    const analyze = analyzeWith([
      cand(8, 4, 0, 5.0, 0.99), // the eye — dominant prior
      cand(2, 2, 1, 1.0, 0.01),
    ]);
    for (let run = 0; run < 25; run++) {
      const move = await selectAiMove(board, Color.White, '15k', null, analyze);
      expect(move).toEqual({ row: 2, col: 2 });
    }
  });
});

describe('wide_root_noise analysis plumbing', () => {
  it('passes wideRootNoise to analyze for selection, but never on the settle path', async () => {
    holder.profile = { ...BASE, reading_rate: 0.5, policy_temp: 1.2, wide_root_noise: 0.6 };
    const board = boardFromGrid(emptyGrid(9), 9);
    const seen: Array<AnalyzeOpts | undefined> = [];
    const analyze = async (_visits: number, opts?: AnalyzeOpts): Promise<PositionAnalysis> => {
      seen.push(opts);
      return { rootVisits: 16, candidates: [cand(4, 4, 0, 5.0, 0.8)] };
    };

    await selectAiMove(board, Color.White, '15k', null, analyze);
    expect(seen[0]).toEqual({ wideRootNoise: 0.6 });

    seen.length = 0;
    await selectAiMove(board, Color.White, '15k', null, analyze, { opponentPassed: true });
    expect(seen[0]).toBeUndefined();
  });
});
