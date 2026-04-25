import { describe, it, expect } from 'vitest';
import { Board } from '../Board';
import { Game } from '../Game';
import { Color, MoveResult } from '../types';

describe('Board with non-19 sizes', () => {
  describe('9x9', () => {
    it('initializes a 9x9 grid', () => {
      const b = new Board(9);
      expect(b.size).toBe(9);
      expect(b.grid.length).toBe(81);
    });

    it('accepts a stone at the corner (8,8)', () => {
      const b = new Board(9);
      const { result } = b.tryPlay(Color.Black, { row: 8, col: 8 });
      expect(result).toBe(MoveResult.Ok);
    });

    it('rejects a stone outside the 9x9 board (row 9)', () => {
      const b = new Board(9);
      const { result } = b.tryPlay(Color.Black, { row: 9, col: 0 });
      expect(result).toBe(MoveResult.Occupied);
    });

    it('captures a single stone on 9x9', () => {
      const b = new Board(9);
      // Surround a black stone at (4,4) with white
      b.tryPlay(Color.Black, { row: 4, col: 4 });
      b.tryPlay(Color.White, { row: 3, col: 4 });
      b.tryPlay(Color.Black, { row: 0, col: 0 }); // filler
      b.tryPlay(Color.White, { row: 5, col: 4 });
      b.tryPlay(Color.Black, { row: 0, col: 1 }); // filler
      b.tryPlay(Color.White, { row: 4, col: 3 });
      b.tryPlay(Color.Black, { row: 0, col: 2 }); // filler
      const { result, captures } = b.tryPlay(Color.White, { row: 4, col: 5 });
      expect(result).toBe(MoveResult.Ok);
      expect(captures).toHaveLength(1);
      expect(b.get({ row: 4, col: 4 })).toBe(Color.Empty);
    });

    it('scores territory on 9x9 with black + white walls', () => {
      const b = new Board(9);
      // Black wall on column 3, white wall on column 5
      for (let row = 0; row < 9; row++) {
        b.grid[row * 9 + 3] = Color.Black;
        b.grid[row * 9 + 5] = Color.White;
      }
      const { blackTerritory, whiteTerritory, neutral } = b.scoreTerritory();
      // Black territory = cols 0-2 across 9 rows = 27
      expect(blackTerritory.size).toBe(27);
      // White territory = cols 6-8 across 9 rows = 27
      expect(whiteTerritory.size).toBe(27);
      // Col 4 = 9 cells, neutral (touches both walls)
      expect(neutral.size).toBe(9);
    });
  });

  describe('13x13', () => {
    it('initializes a 13x13 grid', () => {
      const b = new Board(13);
      expect(b.size).toBe(13);
      expect(b.grid.length).toBe(169);
    });

    it('accepts a stone at corner (12,12) and rejects (13,0)', () => {
      const b = new Board(13);
      expect(b.tryPlay(Color.Black, { row: 12, col: 12 }).result).toBe(MoveResult.Ok);
      expect(b.tryPlay(Color.White, { row: 13, col: 0 }).result).toBe(MoveResult.Occupied);
    });
  });
});

describe('Game SGF round-trip preserves board size', () => {
  it('encodes SZ[9] when board is 9x9', () => {
    const g = new Game(7.0, 9);
    g.playMove({ row: 4, col: 4 });
    expect(g.toSGF()).toContain('SZ[9]');
  });

  it('encodes SZ[13] when board is 13x13', () => {
    const g = new Game(7.0, 13);
    expect(g.toSGF()).toContain('SZ[13]');
  });

  it('parses a 9x9 SGF and replays moves', () => {
    const sgf = '(;GM[1]FF[4]SZ[9]KM[7]RU[Japanese];B[ee];W[gg])';
    const g = Game.fromSGF(sgf);
    expect(g.board.size).toBe(9);
    expect(g.moveHistory).toHaveLength(2);
    // 'ee' = (4,4), 'gg' = (6,6)
    expect(g.board.get({ row: 4, col: 4 })).toBe(Color.Black);
    expect(g.board.get({ row: 6, col: 6 })).toBe(Color.White);
  });
});
