import { describe, it, expect, vi } from 'vitest';
import {
  boardFromGrid,
  isOwnTerritoryFill,
  selectAiMove,
  type PositionAnalysis,
  type MoveCandidate,
} from '../moveSelector';
import { Color } from '../../engine/types';
import type { RankProfile } from '../profileLoader';

/**
 * Pins the endgame territory safety net (2026-07-05): the bot must not fill
 * its own territory instead of letting the game end — and the net must be
 * ko-safe by construction (a recapture region borders the opponent's stone).
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

/** White corner territory at (0,0) plus a Black stone so the open board
 *  isn't classified as anyone's territory. */
function cornerTerritoryBoard() {
  const grid = emptyGrid(9);
  grid[0][1] = Color.White;
  grid[1][0] = Color.White;
  grid[1][1] = Color.White;
  grid[8][8] = Color.Black;
  return boardFromGrid(grid, 9);
}

describe('isOwnTerritoryFill', () => {
  it('flags a point enclosed only by own stones', () => {
    expect(isOwnTerritoryFill(cornerTerritoryBoard(), Color.White, { row: 0, col: 0 })).toBe(true);
  });

  it('does not flag it for the opponent', () => {
    expect(isOwnTerritoryFill(cornerTerritoryBoard(), Color.Black, { row: 0, col: 0 })).toBe(false);
  });

  it('does not flag open-board points (region touches both colors)', () => {
    expect(isOwnTerritoryFill(cornerTerritoryBoard(), Color.White, { row: 5, col: 5 })).toBe(false);
  });

  it('does not flag anything on an empty board', () => {
    expect(isOwnTerritoryFill(boardFromGrid(emptyGrid(9), 9), Color.White, { row: 4, col: 4 })).toBe(false);
  });

  it('KO-SAFE: a ko recapture point is never a territory fill', () => {
    // Classic ko shape: (4,4) empty, three White walls plus Black's ko
    // stone at (4,5) — the region borders the opponent, so White's
    // recapture must stay playable.
    const grid = emptyGrid(9);
    grid[3][4] = Color.White;
    grid[5][4] = Color.White;
    grid[4][3] = Color.White;
    grid[4][5] = Color.Black;
    const board = boardFromGrid(grid, 9);
    expect(isOwnTerritoryFill(board, Color.White, { row: 4, col: 4 })).toBe(false);
  });
});

describe('selector endgame behavior', () => {
  it('the sampler never picks an own-territory fill, whatever its prior', async () => {
    holder.profile = { ...BASE, reading_rate: 0, policy_temp: 1 };
    const board = cornerTerritoryBoard();
    const analyze = analyzeWith([
      cand(0, 0, 0, 5.0, 0.9), // own-territory fill, dominant prior
      cand(5, 5, 1, 4.0, 0.05),
    ]);
    for (let run = 0; run < 25; run++) {
      const move = await selectAiMove(board, Color.White, '15k', null, analyze);
      expect(move).toEqual({ row: 5, col: 5 });
    }
  });

  it('rescues with a real move when candidates are degenerate but the board is live', async () => {
    holder.profile = { ...BASE, reading_rate: 0, policy_temp: 1 };
    const board = cornerTerritoryBoard(); // mostly-open board, plenty to play
    const analyze = analyzeWith([cand(0, 0, 0, 5.0, 0.9)]); // only a fill offered
    for (let run = 0; run < 10; run++) {
      const move = await selectAiMove(board, Color.White, '15k', null, analyze);
      expect(move).not.toBeNull();
      expect(move).not.toEqual({ row: 0, col: 0 });
    }
  });

  // White wall on column 4, Black solid on columns 5-8, columns 0-3 all
  // White territory: every legal White move is a self-fill.
  function sealedBoard() {
    const grid = emptyGrid(9);
    for (let r = 0; r < 9; r++) {
      grid[r][4] = Color.White;
      for (let c = 5; c < 9; c++) grid[r][c] = Color.Black;
    }
    return boardFromGrid(grid, 9);
  }

  // SETTLE-context passing (opponent passed → honest top is a fill → pass)
  // is exercised in moveSelector.settlePass.test.ts. Here we guard the
  // ACTIVE-play direction, which is where DX4QAWTT went wrong.
  it('ACTIVE play: does NOT pass on its own territory mid-game (DX4QAWTT)', async () => {
    holder.profile = { ...BASE, reading_rate: 0, policy_temp: 1 };
    const board = sealedBoard();
    const analyze = analyzeWith([cand(4, 2, 0, 5.0, 0.9)]);
    for (let run = 0; run < 10; run++) {
      const move = await selectAiMove(board, Color.White, '15k', null, analyze);
      expect(move).not.toBeNull(); // plays into its own area, never passes mid-game
    }
  });

  it('still plays the ko recapture when it is the only candidate', async () => {
    holder.profile = { ...BASE, reading_rate: 0, policy_temp: 1 };
    const grid = emptyGrid(9);
    grid[3][4] = Color.White;
    grid[5][4] = Color.White;
    grid[4][3] = Color.White;
    grid[4][5] = Color.Black;
    const board = boardFromGrid(grid, 9);
    const analyze = analyzeWith([cand(4, 4, 0, 5.0, 0.9)]);
    for (let run = 0; run < 10; run++) {
      const move = await selectAiMove(board, Color.White, '15k', null, analyze);
      expect(move).toEqual({ row: 4, col: 4 });
    }
  });
});
