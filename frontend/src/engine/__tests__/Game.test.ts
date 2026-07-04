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

    it('credits the winner correctly when an explicit loser is passed, even mid-bot-turn', () => {
      // Repro for the iPad resign bug: player (Black) clicks Resign while
      // the bot is mid-think — locally currentColor is White (already
      // flipped by the player's move). Without the explicit loser arg,
      // resign() would credit Black (the player) as the winner.
      const game = new Game();
      game.playMove({ row: 3, col: 3 }); // Black plays — currentColor flips to White
      expect(game.currentColor).toBe(Color.White);
      game.resign(Color.Black); // The player (Black) resigns — White should win
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

    it('preserves handicap stones across undo (TestFlight bug #8)', () => {
      const game = new Game(0.5, 19);
      game.setHandicap([
        { row: 15, col: 3 },
        { row: 3, col: 15 },
      ]);
      expect(game.currentColor).toBe(Color.White);

      // White plays first after handicap; then Black; then undo.
      game.playMove({ row: 4, col: 4 });   // W
      game.playMove({ row: 10, col: 10 }); // B
      expect(game.undo()).toBe(true);

      // White's move should be intact; Black's undone; handicap stones still there.
      expect(game.moveHistory).toHaveLength(1);
      expect(game.board.get({ row: 15, col: 3 })).toBe(Color.Black);
      expect(game.board.get({ row: 3, col: 15 })).toBe(Color.Black);
      expect(game.board.get({ row: 4, col: 4 })).toBe(Color.White);
      expect(game.board.get({ row: 10, col: 10 })).toBe(Color.Empty);
      expect(game.currentColor).toBe(Color.Black); // Black to play next
    });

    it('replays recorded move color, not currentColor (handicap White-first)', () => {
      const game = new Game(0.5, 9);
      game.setHandicap([{ row: 4, col: 4 }]);
      game.playMove({ row: 0, col: 0 }); // W
      game.playMove({ row: 8, col: 8 }); // B
      game.playMove({ row: 1, col: 1 }); // W
      game.undo();

      // After undoing W's last move, the first replayed move (originally W
      // at 0,0) must still be White, not Black.
      expect(game.board.get({ row: 0, col: 0 })).toBe(Color.White);
      expect(game.board.get({ row: 8, col: 8 })).toBe(Color.Black);
      expect(game.board.get({ row: 1, col: 1 })).toBe(Color.Empty);
      expect(game.currentColor).toBe(Color.White);
    });

    it('non-handicap undo unchanged: rebuilds from Black-first', () => {
      const game = new Game();
      game.playMove({ row: 3, col: 3 });   // B
      game.playMove({ row: 15, col: 15 }); // W
      game.playMove({ row: 3, col: 15 });  // B
      game.undo();
      expect(game.board.get({ row: 3, col: 3 })).toBe(Color.Black);
      expect(game.board.get({ row: 15, col: 15 })).toBe(Color.White);
      expect(game.board.get({ row: 3, col: 15 })).toBe(Color.Empty);
      expect(game.currentColor).toBe(Color.Black);
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

    it('emits HA + AB tags for handicap stones', () => {
      const game = new Game(0.5, 19);
      game.setHandicap([
        { row: 15, col: 3 },
        { row: 3, col: 15 },
        { row: 15, col: 15 },
      ]);
      game.playMove({ row: 4, col: 4 }); // W

      const sgf = game.toSGF();
      expect(sgf).toContain('HA[3]');
      expect(sgf).toContain('AB[dp][pd][pp]');
      expect(sgf).toContain(';W[ee]');
    });

    it('round-trips a handicap game (export → import)', () => {
      const original = new Game(0.5, 19);
      original.setHandicap([
        { row: 15, col: 3 },
        { row: 3, col: 15 },
      ]);
      original.playMove({ row: 4, col: 4 }); // W
      original.playMove({ row: 10, col: 10 }); // B

      const re = Game.fromSGF(original.toSGF());
      expect(re.handicapStones).toHaveLength(2);
      expect(re.board.get({ row: 15, col: 3 })).toBe(Color.Black);
      expect(re.board.get({ row: 3, col: 15 })).toBe(Color.Black);
      expect(re.board.get({ row: 4, col: 4 })).toBe(Color.White);
      expect(re.board.get({ row: 10, col: 10 })).toBe(Color.Black);
      expect(re.currentColor).toBe(Color.White); // W to play next
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

  describe('forceApplyServerMove (desync recovery)', () => {
    // Recovery path for the 888P9NXK silent-pass bug: the game server
    // committed a bot move our local board rejected. The server grid is
    // authoritative — apply it verbatim and keep the game moving.

    function emptyGrid(size: number): number[][] {
      return Array.from({ length: size }, () => new Array(size).fill(0));
    }

    it('applies the move, removes captures, and flips the turn', () => {
      const game = new Game(5.5, 9);
      game.playMove({ row: 0, col: 1 }); // B
      game.playMove({ row: 0, col: 0 }); // W (will be "captured" server-side)

      // Server committed B(1,0), capturing W(0,0).
      const serverGrid = emptyGrid(9);
      serverGrid[0][1] = Color.Black;
      serverGrid[1][0] = Color.Black;

      const removed = game.forceApplyServerMove({ row: 1, col: 0 }, serverGrid);

      expect(removed).toEqual([{ row: 0, col: 0 }]);
      expect(game.board.get({ row: 1, col: 0 })).toBe(Color.Black);
      expect(game.board.get({ row: 0, col: 0 })).toBe(Color.Empty);
      expect(game.currentColor).toBe(Color.White);
      expect(game.moveHistory).toHaveLength(3);
      expect(game.moveHistory[2].point).toEqual({ row: 1, col: 0 });
      expect(game.board.captures[Color.Black]).toBe(1);
      expect(game.consecutivePasses).toBe(0);
    });

    it('overwrites a desynced local board with the server grid', () => {
      const game = new Game(5.5, 9);
      game.playMove({ row: 4, col: 4 }); // B — but suppose the server never saw it
      // Server thinks the board has B(3,3) plus W's new move at (5,5).
      const serverGrid = emptyGrid(9);
      serverGrid[3][3] = Color.Black;
      serverGrid[5][5] = Color.White;

      game.forceApplyServerMove({ row: 5, col: 5 }, serverGrid);

      // Local board now matches the server exactly.
      expect(game.board.get({ row: 4, col: 4 })).toBe(Color.Empty);
      expect(game.board.get({ row: 3, col: 3 })).toBe(Color.Black);
      expect(game.board.get({ row: 5, col: 5 })).toBe(Color.White);
    });

    it('resets superko history so the synced position is re-playable', () => {
      const game = new Game(5.5, 9);
      game.playMove({ row: 0, col: 1 }); // B
      game.playMove({ row: 8, col: 8 }); // W
      const serverGrid = emptyGrid(9);
      serverGrid[0][1] = Color.Black;
      serverGrid[8][8] = Color.White;
      serverGrid[2][2] = Color.Black;
      game.forceApplyServerMove({ row: 2, col: 2 }, serverGrid);

      // A later move must not be rejected because of pre-sync hashes.
      const { result } = game.playMove({ row: 6, col: 6 });
      expect(result).toBe(MoveResult.Ok);
    });
  });
});
