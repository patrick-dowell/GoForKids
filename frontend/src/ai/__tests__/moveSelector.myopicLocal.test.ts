import { describe, it, expect, vi } from 'vitest';
import { boardFromGrid, selectAiMove, type PositionAnalysis, type MoveCandidate } from '../moveSelector';
import { Color } from '../../engine/types';
import type { RankProfile } from '../profileLoader';

/**
 * Pins the §3 9×9 retune mechanics (2026-07-04):
 *  - `local_bias_from_candidates` plays the strongest KataGo candidate near
 *    the anchor (myopic-but-real move), falls through when nothing is local,
 *    and leaves legacy random-nearby behavior untouched when unset.
 *  - explicit `clarity_prior` overrides the 0.5 default the 9×9 mid rungs
 *    were accidentally running on.
 */

const holder = vi.hoisted(() => ({ profile: {} as RankProfile }));

vi.mock('../profileLoader', () => ({
  getProfile: () => holder.profile,
}));

// KataGo path, no opening phase, dice-branches pinned off unless a test
// turns them on. Clarity gates disabled the same way 30k disables them.
const BASE: RankProfile = {
  max_point_loss: 28,
  mistake_freq: 0.72,
  policy_weight: 0.12,
  randomness: 0.78,
  random_move_chance: 0,
  local_bias: 1.0,
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
  return { move: { row, col }, visits: 16 - order, winrate: 0.5, scoreLead, prior, order };
}

function analyzeWith(candidates: MoveCandidate[]) {
  return async (): Promise<PositionAnalysis> => ({ rootVisits: 16, candidates });
}

const ANCHOR = { row: 4, col: 4 };

describe('local_bias_from_candidates (myopic mode)', () => {
  it('plays the strongest candidate near the anchor, not the global best', async () => {
    holder.profile = { ...BASE, local_bias_from_candidates: true };
    const board = boardFromGrid(emptyGrid(9), 9);
    const analyze = analyzeWith([
      cand(0, 0, 0, 5.0, 0.4), // global best, far from the anchor
      cand(4, 5, 1, 3.0, 0.3), // weaker but adjacent to the anchor
      cand(8, 8, 2, 2.0, 0.2), // far again
    ]);
    // local_bias=1.0 makes the branch deterministic — every run must produce
    // the myopic pick, never the global best and never random-nearby noise.
    for (let run = 0; run < 25; run++) {
      const move = await selectAiMove(board, Color.White, '15k', ANCHOR, analyze);
      expect(move).toEqual({ row: 4, col: 5 });
    }
  });

  it('falls through to normal selection when no candidate is near the anchor', async () => {
    holder.profile = { ...BASE, local_bias_from_candidates: true };
    const board = boardFromGrid(emptyGrid(9), 9);
    const far = [cand(0, 0, 0, 5.0, 0.4), cand(8, 8, 1, 4.0, 0.3)];
    const analyze = analyzeWith(far);
    for (let run = 0; run < 25; run++) {
      const move = await selectAiMove(board, Color.White, '15k', ANCHOR, analyze);
      // Must come from the candidate pool — the myopic branch may not invent
      // a random board point the way legacy local-bias does.
      expect([
        { row: 0, col: 0 },
        { row: 8, col: 8 },
      ]).toContainEqual(move);
    }
  });

  it('legacy profiles (knob unset) keep random-nearby behavior', async () => {
    holder.profile = { ...BASE }; // no local_bias_from_candidates
    const board = boardFromGrid(emptyGrid(9), 9);
    const analyze = analyzeWith([cand(0, 0, 0, 5.0, 0.4)]);
    for (let run = 0; run < 25; run++) {
      const move = await selectAiMove(board, Color.White, '30k', ANCHOR, analyze);
      expect(move).not.toBeNull();
      const d = Math.max(Math.abs(move!.row - ANCHOR.row), Math.abs(move!.col - ANCHOR.col));
      expect(d).toBeLessThanOrEqual(2);
    }
  });
});

describe('explicit clarity_prior on mid rungs', () => {
  it('a super-obvious move (prior above the gate) bypasses the myopic branch', async () => {
    holder.profile = { ...BASE, local_bias_from_candidates: true, clarity_prior: 0.87 };
    const board = boardFromGrid(emptyGrid(9), 9);
    const analyze = analyzeWith([
      cand(0, 0, 0, 5.0, 0.95), // forced move — KataGo's policy is near-certain
      cand(4, 5, 1, 3.0, 0.02),
    ]);
    for (let run = 0; run < 25; run++) {
      const move = await selectAiMove(board, Color.White, '15k', ANCHOR, analyze);
      expect(move).toEqual({ row: 0, col: 0 });
    }
  });

  it('a merely-good move (prior below the gate) does NOT bypass it', async () => {
    holder.profile = { ...BASE, local_bias_from_candidates: true, clarity_prior: 0.87 };
    const board = boardFromGrid(emptyGrid(9), 9);
    const analyze = analyzeWith([
      cand(0, 0, 0, 5.0, 0.7), // would have cleared the old 0.5 default
      cand(4, 5, 1, 3.0, 0.2),
    ]);
    for (let run = 0; run < 25; run++) {
      const move = await selectAiMove(board, Color.White, '15k', ANCHOR, analyze);
      expect(move).toEqual({ row: 4, col: 5 }); // myopic pick, not the gated top
    }
  });
});
