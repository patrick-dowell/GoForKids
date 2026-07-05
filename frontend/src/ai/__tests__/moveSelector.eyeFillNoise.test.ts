import { describe, it, expect, vi } from 'vitest';
import {
  boardFromGrid,
  isEyeFill,
  selectAiMove,
  type PositionAnalysis,
  type MoveCandidate,
} from '../moveSelector';
import { Color } from '../../engine/types';
import type { RankProfile } from '../profileLoader';

/**
 * Pins the JEA338QQ fixes + the score_noise mechanism (§3 iter 2, 2026-07-04):
 *  - edge false-eye: an enemy diagonal on an edge point makes it a
 *    CONNECTION, not an eye — the old rule flagged it and the bot passed a
 *    won game away while its group sat in atari.
 *  - the eye-fill wrapper plays a legal fallback instead of passing when
 *    5 retries all produce eye-flagged picks.
 *  - score_noise: tiny sigma ≈ best move; large sigma flips close calls;
 *    the myopic local pick stays local under noise.
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

function cand(row: number, col: number, order: number, scoreLead: number, prior = 0.3): MoveCandidate {
  return { move: { row, col }, visits: 16 - order, winrate: 0.5, scoreLead, prior, order };
}

function analyzeWith(candidates: MoveCandidate[]) {
  return async (): Promise<PositionAnalysis> => ({ rootVisits: 16, candidates });
}

describe('isEyeFill edge rule (JEA338QQ regression)', () => {
  it('an edge point with an enemy diagonal is a false eye — playable', () => {
    // The exact move-36 shape: White orthogonals (7,4),(8,3),(8,5); Black
    // diagonal at (7,5); White diagonal at (7,3). (8,4) is the connection
    // that saves the atari'd group — must NOT be flagged.
    const grid = emptyGrid(9);
    grid[7][3] = Color.White;
    grid[7][4] = Color.White;
    grid[8][3] = Color.White;
    grid[8][5] = Color.White;
    grid[7][5] = Color.Black;
    const board = boardFromGrid(grid, 9);
    expect(isEyeFill(board, Color.White, { row: 8, col: 4 })).toBe(false);
  });

  it('an edge point with all on-board diagonals friendly is still a real eye', () => {
    const grid = emptyGrid(9);
    grid[7][3] = Color.White;
    grid[7][4] = Color.White;
    grid[7][5] = Color.White;
    grid[8][3] = Color.White;
    grid[8][5] = Color.White;
    const board = boardFromGrid(grid, 9);
    expect(isEyeFill(board, Color.White, { row: 8, col: 4 })).toBe(true);
  });

  it('a center point still tolerates one enemy diagonal', () => {
    const grid = emptyGrid(9);
    for (const [r, c] of [[3, 4], [5, 4], [4, 3], [4, 5], [3, 3], [3, 5], [5, 3]]) {
      grid[r][c] = Color.White;
    }
    grid[5][5] = Color.Black; // one enemy diagonal of 4
    const board = boardFromGrid(grid, 9);
    expect(isEyeFill(board, Color.White, { row: 4, col: 4 })).toBe(true);
  });
});

describe('eye-fill wrapper fallback', () => {
  it('plays a legal move instead of passing when every retry is eye-flagged', async () => {
    holder.profile = { ...BASE };
    // Real White eye at (8,4) — all orthogonals + on-board diagonals White —
    // and KataGo's ONLY candidate is that eye point, so all 5 retries
    // re-pick it. The old wrapper passed here. The Black stone keeps the
    // open board from counting as White territory (territory-net rule).
    const grid = emptyGrid(9);
    for (const [r, c] of [[7, 3], [7, 4], [7, 5], [8, 3], [8, 5]]) {
      grid[r][c] = Color.White;
    }
    grid[0][0] = Color.Black;
    const board = boardFromGrid(grid, 9);
    const analyze = analyzeWith([cand(8, 4, 0, 5.0)]);
    for (let run = 0; run < 10; run++) {
      const move = await selectAiMove(board, Color.White, '15k', null, analyze);
      expect(move).not.toBeNull();
      expect(move).not.toEqual({ row: 8, col: 4 });
    }
  });
});

describe('score_noise selection', () => {
  it('tiny sigma plays the best candidate', async () => {
    holder.profile = { ...BASE, score_noise: 0.001 };
    const board = boardFromGrid(emptyGrid(9), 9);
    const analyze = analyzeWith([cand(0, 0, 0, 10.0), cand(8, 8, 1, 0.0)]);
    for (let run = 0; run < 25; run++) {
      const move = await selectAiMove(board, Color.White, '15k', null, analyze);
      expect(move).toEqual({ row: 0, col: 0 });
    }
  });

  it('large sigma flips close calls (non-best moves appear)', async () => {
    holder.profile = { ...BASE, score_noise: 50 };
    const board = boardFromGrid(emptyGrid(9), 9);
    const analyze = analyzeWith([cand(0, 0, 0, 10.0), cand(8, 8, 1, 0.0)]);
    const picks = new Set<string>();
    for (let run = 0; run < 60; run++) {
      const move = await selectAiMove(board, Color.White, '15k', null, analyze);
      picks.add(`${move!.row},${move!.col}`);
    }
    expect(picks.has('8,8')).toBe(true);
  });

  it('myopic local pick stays local under noise', async () => {
    holder.profile = {
      ...BASE,
      local_bias: 1.0,
      local_bias_from_candidates: true,
      score_noise: 50,
    };
    const board = boardFromGrid(emptyGrid(9), 9);
    const anchor = { row: 4, col: 4 };
    const analyze = analyzeWith([
      cand(0, 0, 0, 10.0), // far global best
      cand(4, 5, 1, 3.0),
      cand(4, 3, 2, 2.0),
    ]);
    const picks = new Set<string>();
    for (let run = 0; run < 60; run++) {
      const move = await selectAiMove(board, Color.White, '15k', anchor, analyze);
      picks.add(`${move!.row},${move!.col}`);
      expect([
        { row: 4, col: 5 },
        { row: 4, col: 3 },
      ]).toContainEqual(move);
    }
    expect(picks.size).toBe(2); // noise actually varies the local pick
  });
});
