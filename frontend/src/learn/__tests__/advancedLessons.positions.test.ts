import { describe, it, expect } from 'vitest';
import { Board } from '../../engine/Board';
import { Color, MoveResult, type Point } from '../../engine/types';

/**
 * Position-truth tests for the advanced lessons (fp 03 §B: ko, ladders,
 * nets, snapback). Every "forced" sequence a lesson shows or asks for is
 * verified against the real engine here — ataris are really ataris,
 * captures really capture, and the ko retake is really illegal. If a
 * lesson position is ever edited, these tests keep the story honest.
 */

const B = Color.Black;
const W = Color.White;

function build(size: number, stones: Array<{ row: number; col: number; color: Color }>): Board {
  const board = new Board(size);
  for (const s of stones) board.grid[s.row * size + s.col] = s.color;
  return board;
}

function play(board: Board, color: Color, p: Point) {
  const { result, captures } = board.tryPlay(color as Color.Black | Color.White, p);
  return { result, captures };
}

function groupLibs(board: Board, color: Color): number[] {
  return board
    .getAllGroups()
    .filter((g) => g.color === color)
    .map((g) => g.liberties);
}

/* ---------------------------------------------------------------- SNAPBACK */

export const SNAPBACK = {
  size: 5,
  initial: [
    { row: 0, col: 2, color: W },
    { row: 1, col: 0, color: W },
    { row: 1, col: 1, color: W },
    { row: 1, col: 2, color: W },
    { row: 0, col: 3, color: B },
    { row: 1, col: 3, color: B },
    { row: 2, col: 0, color: B },
    { row: 2, col: 1, color: B },
    { row: 2, col: 2, color: B },
  ],
  throwIn: { row: 0, col: 1 } as Point,
  whiteBites: { row: 0, col: 0 } as Point,
  recapture: { row: 0, col: 1 } as Point,
};

describe('snapback lesson position', () => {
  it('throw-in is legal, captures nothing, and puts White in atari', () => {
    const b = build(SNAPBACK.size, SNAPBACK.initial);
    const r = play(b, B, SNAPBACK.throwIn);
    expect(r.result).toBe(MoveResult.Ok);
    expect(r.captures.length).toBe(0);
    expect(groupLibs(b, W)).toEqual([1]); // white group now has one liberty
  });

  it('White captures the bait, but is left in atari (self-set snapback)', () => {
    const b = build(SNAPBACK.size, SNAPBACK.initial);
    play(b, B, SNAPBACK.throwIn);
    const r = play(b, W, SNAPBACK.whiteBites);
    expect(r.result).toBe(MoveResult.Ok);
    expect(r.captures.length).toBe(1); // just the bait stone
    expect(groupLibs(b, W)).toEqual([1]); // whole white group: one liberty
  });

  it('Black recaptures the entire five-stone group', () => {
    const b = build(SNAPBACK.size, SNAPBACK.initial);
    play(b, B, SNAPBACK.throwIn);
    play(b, W, SNAPBACK.whiteBites);
    const r = play(b, B, SNAPBACK.recapture);
    expect(r.result).toBe(MoveResult.Ok);
    expect(r.captures.length).toBe(5);
    expect(groupLibs(b, W)).toEqual([]); // no white left
  });
});

/* ---------------------------------------------------------------------- KO */

export const KO = {
  size: 5,
  initial: [
    { row: 1, col: 1, color: B },
    { row: 3, col: 1, color: B },
    { row: 2, col: 0, color: B },
    { row: 2, col: 1, color: W }, // the ko stone
    { row: 1, col: 2, color: W },
    { row: 3, col: 2, color: W },
    { row: 2, col: 3, color: W },
  ],
  take: { row: 2, col: 2 } as Point,
  retake: { row: 2, col: 1 } as Point, // illegal for White right after
  fill: { row: 2, col: 1 } as Point, // Black finishes the ko
};

describe('ko lesson position', () => {
  it('Black takes the ko: captures exactly the ko stone', () => {
    const b = build(KO.size, KO.initial);
    const r = play(b, B, KO.take);
    expect(r.result).toBe(MoveResult.Ok);
    expect(r.captures.length).toBe(1);
  });

  it("White's immediate retake is illegal (superko)", () => {
    const b = build(KO.size, KO.initial);
    // build() writes the grid directly, so seed the history with the initial
    // position the way live play would have (positionHistory is private —
    // reach in for the test).
    (b as unknown as { positionHistory: Set<string> }).positionHistory.add(b.hash());
    play(b, B, KO.take);
    const r = play(b, W, KO.retake);
    expect(r.result).not.toBe(MoveResult.Ok);
  });

  it('Black can fill to finish the ko (after White plays elsewhere)', () => {
    const b = build(KO.size, KO.initial);
    play(b, B, KO.take);
    play(b, W, { row: 0, col: 4 }); // ko-banned White plays away
    const r = play(b, B, KO.fill);
    expect(r.result).toBe(MoveResult.Ok);
    expect(groupLibs(b, B).every((l) => l >= 2)).toBe(true); // solid, ko over
  });
});

/* ------------------------------------------------------------------ LADDER */

export const LADDER = {
  size: 7,
  initial: [
    // Black wall on row 1 — the rail the ladder runs along.
    { row: 1, col: 2, color: B },
    { row: 1, col: 3, color: B },
    { row: 1, col: 4, color: B },
    { row: 1, col: 5, color: B },
    { row: 1, col: 6, color: B },
    { row: 2, col: 1, color: B },
    { row: 2, col: 2, color: W }, // the runner
  ],
  firstAtari: { row: 3, col: 2 } as Point,
  // The forced chase the lesson plays out after the kid's first atari.
  chase: [
    { color: W, point: { row: 2, col: 3 } },
    { color: B, point: { row: 3, col: 3 } },
    { color: W, point: { row: 2, col: 4 } },
    { color: B, point: { row: 3, col: 4 } },
    { color: W, point: { row: 2, col: 5 } },
    { color: B, point: { row: 3, col: 5 } },
  ],
  kill: { row: 2, col: 6 } as Point, // the kid's finishing capture (4 stones)
};

describe('ladder lesson position', () => {
  it('first atari really is atari, and every chase step stays forced', () => {
    const b = build(LADDER.size, LADDER.initial);
    expect(play(b, B, LADDER.firstAtari).result).toBe(MoveResult.Ok);
    expect(groupLibs(b, W)).toEqual([1]); // atari

    for (const step of LADDER.chase) {
      const r = play(b, step.color, step.point);
      expect(r.result).toBe(MoveResult.Ok);
      expect(r.captures.length).toBe(0);
      if (step.color === B) {
        expect(groupLibs(b, W)).toEqual([1]); // every Black reply re-ataris
      }
    }
  });

  it('the finishing move captures the whole four-stone chain at the edge', () => {
    const b = build(LADDER.size, LADDER.initial);
    play(b, B, LADDER.firstAtari);
    for (const step of LADDER.chase) play(b, step.color, step.point);
    const r = play(b, B, LADDER.kill);
    expect(r.result).toBe(MoveResult.Ok);
    expect(r.captures.length).toBe(4);
    expect(groupLibs(b, W)).toEqual([]);
  });
});

/* --------------------------------------------------------------------- NET */

export const NET = {
  size: 7,
  initial: [
    { row: 1, col: 2, color: B },
    { row: 1, col: 3, color: B },
    { row: 2, col: 1, color: B },
    { row: 2, col: 0, color: B },
    { row: 2, col: 2, color: W }, // the trapped stone
  ],
  netMove: { row: 3, col: 3 } as Point, // the loose diagonal — a true geta
  // The demonstrated refutation: White bounces around inside the net and
  // every Black reply is atari, ending in a dead crawl at the left edge.
  // (Each White extension momentarily has two liberties — that looseness is
  // what makes it a net rather than a ladder; the replies still close it.)
  escape: [
    { color: W, point: { row: 2, col: 3 } },
    { color: B, point: { row: 2, col: 4 } },
    { color: W, point: { row: 3, col: 2 } },
    { color: B, point: { row: 4, col: 2 } },
    { color: W, point: { row: 3, col: 1 } },
    { color: B, point: { row: 4, col: 1 } },
  ],
  kill: { row: 3, col: 0 } as Point, // the kid's finishing capture (4 stones)
};

describe('net lesson position', () => {
  it('the net move does not touch the white stone (a true loose trap)', () => {
    const dr = Math.abs(NET.netMove.row - 2);
    const dc = Math.abs(NET.netMove.col - 2);
    expect(dr + dc).toBeGreaterThan(1); // not adjacent
  });

  it('the escape crawl is legal, every Black reply re-ataris, and the kill takes four', () => {
    const b = build(NET.size, NET.initial);
    expect(play(b, B, NET.netMove).result).toBe(MoveResult.Ok);
    for (const step of NET.escape) {
      const r = play(b, step.color, step.point);
      expect(r.result).toBe(MoveResult.Ok);
      expect(r.captures.length).toBe(0);
      if (step.color === B) {
        expect(groupLibs(b, W)).toEqual([1]);
      }
    }
    const kill = play(b, B, NET.kill);
    expect(kill.result).toBe(MoveResult.Ok);
    expect(kill.captures.length).toBe(4);
    expect(groupLibs(b, W)).toEqual([]);
  });
});
