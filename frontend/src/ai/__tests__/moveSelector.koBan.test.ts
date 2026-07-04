import { describe, it, expect } from 'vitest';
import {
  boardFromGrid,
  pickLegalNonEyeMove,
  selectAiMove,
  type PositionAnalysis,
} from '../moveSelector';
import { Color, MoveResult } from '../../engine/types';

/**
 * Pins the 888P9NXK ko-fight fix: a board reconstructed from a server grid
 * has no move history, so positional superko can't see the ko — the injected
 * koBan has to stop every selector branch (KataGo candidate filter,
 * local-bias, random, fallback pickers) from proposing the banned recapture.
 */

function emptyGrid(size: number): number[][] {
  return Array.from({ length: size }, () => new Array(size).fill(0));
}

describe('boardFromGrid koBan', () => {
  it('threads the ban into tryPlay', () => {
    const grid = emptyGrid(9);
    const board = boardFromGrid(grid, 9, {
      point: { row: 4, col: 4 },
      color: Color.White,
    });
    expect(board.tryPlay(Color.White, { row: 4, col: 4 }).result).toBe(MoveResult.Ko);
    expect(board.tryPlay(Color.Black, { row: 4, col: 4 }).result).toBe(MoveResult.Ok);
  });

  it('defaults to no ban', () => {
    const board = boardFromGrid(emptyGrid(9), 9);
    expect(board.koBan).toBeNull();
    expect(board.tryPlay(Color.White, { row: 4, col: 4 }).result).toBe(MoveResult.Ok);
  });
});

describe('selectAiMove with koBan', () => {
  it('never returns the banned recapture, even when KataGo offers nothing else', async () => {
    const banned = { row: 4, col: 4 };
    // KataGo's entire candidate list is the (locally illegal) recapture —
    // the worst case that used to end in a bot pass.
    const analyze = async (): Promise<PositionAnalysis> => ({
      rootVisits: 100,
      candidates: [
        { move: banned, visits: 100, winrate: 0.9, scoreLead: 5, prior: 0.9, order: 0 },
      ],
    });

    // The selector's random/local-bias branches roll dice, so exercise the
    // whole distribution — no run may ever produce the banned point.
    for (let run = 0; run < 25; run++) {
      const grid = emptyGrid(9);
      grid[4][5] = Color.Black; // the opponent stone that just took the ko
      const board = boardFromGrid(grid, 9, { point: banned, color: Color.White });
      const move = await selectAiMove(
        board,
        Color.White,
        '6k',
        { row: 4, col: 5 }, // lastOpponentMove right next to the ban — tempts local_bias
        analyze,
      );
      // A pass (null) would also be acceptable here; playing the banned
      // recapture is the only failure.
      if (move !== null) {
        expect(move).not.toEqual(banned);
      }
    }
  });
});

describe('pickLegalNonEyeMove exclusions', () => {
  it('skips excluded points (the commit-rejection retry contract)', () => {
    const board = boardFromGrid(emptyGrid(9), 9);
    const excluded = { row: 2, col: 2 };
    for (let run = 0; run < 25; run++) {
      const move = pickLegalNonEyeMove(board, Color.White, [excluded]);
      expect(move).not.toBeNull();
      expect(move).not.toEqual(excluded);
    }
  });
});
