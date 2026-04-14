import { describe, it, expect } from 'vitest';
import { Game } from '../Game';
import { Color, MoveResult } from '../types';

describe('Game', () => {
  describe('basic game flow', () => {
    it('starts with black to play', () => {
      const game = new Game();
      expect(game.currentColor).toBe(Color.Black);
      expect(game.phase).toBe('playing');
    });

    it('alternates colors', () => {
      const game = new Game();
      game.playMove({ row: 3, col: 3 });
      expect(game.currentColor).toBe(Color.White);
      game.playMove({ row: 15, col: 15 });
      expect(game.currentColor).toBe(Color.Black);
    });

    it('tracks move history', () => {
      const game = new Game();
      game.playMove({ row: 3, col: 3 });
      game.playMove({ row: 15, col: 15 });
      expect(game.moveHistory).toHaveLength(2);
      expect(game.moveHistory[0].color).toBe(Color.Black);
      expect(game.moveHistory[1].color).toBe(Color.White);
    });

    it('rejects moves after game over', () => {
      const game = new Game();
      game.resign();
      const { result } = game.playMove({ row: 3, col: 3 });
      expect(result).toBe(MoveResult.GameOver);
    });
  });

  describe('passing', () => {
    it('records a pass', () => {
      const game = new Game();
      game.pass();
      expect(game.moveHistory).toHaveLength(1);
      expect(game.moveHistory[0].point).toBeNull();
      expect(game.currentColor).toBe(Color.White);
    });

    it('ends game after two consecutive passes', () => {
      const game = new Game();
      game.pass();
      game.pass();
      expect(game.phase).toBe('finished');
      expect(game.result).not.toBeNull();
    });

    it('does not end game after non-consecutive passes', () => {
      const game = new Game();
      game.pass();
      game.playMove({ row: 3, col: 3 });
      game.pass();
      expect(game.phase).toBe('playing');
    });
  });

  describe('resignation', () => {
    it('gives win to the other player', () => {
      const game = new Game();
      game.resign(); // Black resigns
      expect(game.phase).toBe('finished');
      expect(game.result!.winner).toBe(Color.White);
    });
  });

  describe('scoring', () => {
    it('applies komi to white score', () => {
      const game = new Game(7.5);
      game.pass();
      game.pass();
      // Empty board: all neutral, no territory for either side
      // White gets komi, so white wins
      expect(game.result!.winner).toBe(Color.White);
      expect(game.result!.whiteScore).toBe(7.5);
    });
  });

  describe('undo', () => {
    it('undoes the last move', () => {
      const game = new Game();
      game.playMove({ row: 3, col: 3 });
      game.playMove({ row: 15, col: 15 });
      expect(game.undo()).toBe(true);
      expect(game.moveHistory).toHaveLength(1);
      expect(game.currentColor).toBe(Color.White);
      expect(game.board.get({ row: 15, col: 15 })).toBe(Color.Empty);
    });

    it('returns false on empty history', () => {
      const game = new Game();
      expect(game.undo()).toBe(false);
    });
  });

  describe('SGF', () => {
    it('exports and re-imports a game', () => {
      const game = new Game();
      game.playMove({ row: 3, col: 3 });
      game.playMove({ row: 15, col: 15 });
      game.playMove({ row: 3, col: 15 });

      const sgf = game.toSGF();
      expect(sgf).toContain('GM[1]');
      expect(sgf).toContain(';B[dd]'); // (3,3) = d,d in SGF coords

      const reimported = Game.fromSGF(sgf);
      expect(reimported.moveHistory).toHaveLength(3);
      expect(reimported.board.get({ row: 3, col: 3 })).toBe(Color.Black);
      expect(reimported.board.get({ row: 15, col: 15 })).toBe(Color.White);
    });

    it('handles passes in SGF', () => {
      const game = new Game();
      game.playMove({ row: 3, col: 3 });
      game.pass();
      game.playMove({ row: 15, col: 15 });

      const sgf = game.toSGF();
      expect(sgf).toContain(';W[]');
    });
  });

  describe('legal moves', () => {
    it('returns legal moves for initial position', () => {
      const game = new Game();
      const moves = game.getLegalMoves();
      expect(moves).toHaveLength(19 * 19);
    });

    it('excludes occupied intersections', () => {
      const game = new Game();
      game.playMove({ row: 3, col: 3 });
      const moves = game.getLegalMoves();
      expect(moves).toHaveLength(19 * 19 - 1);
      expect(moves.find((m) => m.row === 3 && m.col === 3)).toBeUndefined();
    });
  });
});
