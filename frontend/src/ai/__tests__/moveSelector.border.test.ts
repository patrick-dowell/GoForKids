import { describe, it, expect, vi } from 'vitest';
import {
  selectAiMove,
  _resetReadCooldowns,
  type BorderEngine,
  type MoveCandidate,
  type PositionAnalysis,
} from '../moveSelector';
import { BORDER_MAX_QUERIES, borderMoves } from '../humanNetSelector';
import { Board } from '../../engine/Board';
import { Color, MoveResult, type Point, type Stone } from '../../engine/types';
import type { RankProfile } from '../profileLoader';
import { clearSelectorLog, snapshotSelectorLog } from '../selectorLog';

/**
 * The standard selector's border check (ported from
 * backend/tests/test_standard_border.py and the standard-path half of
 * test_border_check_limits.py): wherever the standard path would pass, it
 * first counts the board the way a finished game is counted and plays the
 * best move that raises its count by `human_border_gain` (default 1) or more.
 * The qualifying moves (at most BORDER_MAX_QUERIES, the largest gains first,
 * ties to the search's prior) and the pass are scored at 4 visits, and a move
 * is played only if it loses no more than its own gain against the pass.
 * Positions are the human path's border tests' (9x9, komi 6.5, the bot White).
 */

const holder = vi.hoisted(() => ({ profile: {} as RankProfile }));
vi.mock('../profileLoader', () => ({ getProfile: () => holder.profile }));

const SIZE = 9;
const N = SIZE * SIZE;

// SGF coordinates (column letter, row letter from the top), Black first.
const GAME_12K = 'eeegcegdfgccecffefggfhdggffehgghhhedddfddccfdebebdafgbehgibccbbbdacdbafbfcgchbebfaeidb';
const DEAD_12K: Array<[number, number]> = [[1, 4], [1, 5], [2, 6], [3, 1], [3, 4], [3, 5], [3, 6], [4, 5], [5, 5]];
const GAME_18K = 'eeggeggccdgeecfhehcgbfbgcfdgdhchbicidfbhagahafaidififbfghbgfhdgdhcgbgaheieifidfcebeddd';
const DEAD_18K: Array<[number, number]> = [[6, 1], [6, 2], [6, 3], [7, 0], [7, 1], [7, 2], [8, 0], [8, 2]];
const GAME_15K = 'eeggeggecdfhehfgecfcfdgdfbgcgbfeedefdfffdghbhaibfigiei';

// White's one-point pockets on the top and bottom edges, each open to a region that touches Black
// through a gap: a stone in the gap's second row gains one, in the third row two.
const POCKETS = [
  '.O.O.O.O.',
  '.O.O.O.O.',
  '.........',
  'XXXXXXXXX',
  '.........',
  'XXXXXXXXX',
  '.........',
  '.O.O.O.O.',
  '.O.O.O.O.',
];

// A standard 9x9 rung with every random branch closed, so each test reaches the pass route it names.
const PROFILE: RankProfile = {
  max_point_loss: 10,
  mistake_freq: 0,
  policy_weight: 1,
  randomness: 0,
  random_move_chance: 0,
  local_bias: 0,
  first_line_chance: 0,
  visits: 16,
  min_candidates: 5,
  opening_moves: 0,
  pass_threshold: 0.1,
  clarity_prior: 1.1,
  clarity_score_gap: 999,
};

const pt = (g: string): Point =>
  g === 'pass' ? { row: -1, col: -1 } : { row: SIZE - Number(g.slice(1)), col: 'ABCDEFGHJ'.indexOf(g[0]) };
const gtp = (p: Point) => `${'ABCDEFGHJ'[p.col]}${SIZE - p.row}`;

function replay(sgf: string): Board {
  const board = new Board(SIZE);
  for (let k = 0; k < sgf.length; k += 2) {
    const color = (k / 2) % 2 === 0 ? Color.Black : Color.White;
    const p = { row: sgf.charCodeAt(k + 1) - 97, col: sgf.charCodeAt(k) - 97 };
    expect(board.tryPlay(color, p).result).toBe(MoveResult.Ok);
  }
  return board;
}

function fromRows(rows: string[]): Board {
  const board = new Board(SIZE);
  rows.forEach((r, row) =>
    [...r].forEach((c, col) => {
      if (c !== '.') board.grid[row * SIZE + col] = c === 'X' ? Color.Black : Color.White;
    }),
  );
  return board;
}

/** A canned ownership read (Black +): stones and territory by the recorded
 *  count, the dead stones given to the other side, the open points 0. */
function ownership(board: Board, dead: Array<[number, number]>): number[] {
  const deadIdx = dead.map(([r, c]) => r * SIZE + c);
  const counted = board.clone();
  for (const i of deadIdx) counted.grid[i] = Color.Empty;
  const { blackTerritory, whiteTerritory } = counted.scoreTerritory();
  const own: number[] = board.grid.map((c) => (c === Color.Black ? 0.9 : c === Color.White ? -0.9 : 0));
  for (const i of deadIdx) own[i] = -own[i];
  for (const i of blackTerritory) own[i] = 0.9;
  for (const i of whiteTerritory) own[i] = -0.9;
  return own;
}

const cand = (g: string, prior: number, scoreLead: number, visits = 20): MoveCandidate => ({
  move: pt(g), visits, winrate: 0.5, scoreLead, prior, order: 0,
});

/** The ownership read answers `own` (a function may throw); a scoring query
 *  answers a Black-perspective lead from `leads` by move, else `defaultLead`. */
class FakeBorder implements BorderEngine {
  calls: Array<{ kind: 'ownership' | 'after'; move?: string; visits?: number }> = [];
  constructor(
    private own: number[] | null | (() => never),
    private leads: Record<string, number> = {},
    private defaultLead = -26.0,
    private failScore = false,
  ) {}

  async ownership() {
    this.calls.push({ kind: 'ownership' });
    return typeof this.own === 'function' ? this.own() : this.own;
  }

  async scoreAfter(move: Point | 'pass', visits: number) {
    const name = move === 'pass' ? 'pass' : gtp(move);
    this.calls.push({ kind: 'after', move: name, visits });
    if (this.failScore) throw new Error('bridge down');
    return { scoreLead: this.leads[name] ?? this.defaultLead, winrate: 0.5 };
  }

  reads(): number {
    return this.calls.filter((c) => c.kind === 'ownership').length;
  }

  scored(): string[] {
    return this.calls.flatMap((c) => (c.kind === 'after' ? [c.move!] : []));
  }
}

async function select(
  cands: MoveCandidate[],
  border: BorderEngine | undefined,
  board: Board = replay(GAME_12K),
  { profile = PROFILE, color = Color.White as Stone, opponentPassed = false } = {},
) {
  holder.profile = profile;
  _resetReadCooldowns();
  const analyze = async (): Promise<PositionAnalysis> => ({
    rootVisits: 100,
    candidates: cands.map((c, order) => ({ ...c, order })),
  });
  return selectAiMove(board, color, '9k', null, analyze, { opponentPassed, border });
}

const own12 = () => ownership(replay(GAME_12K), DEAD_12K);
// KataGo's top move is a pass, with nothing else on offer.
const TOP_PASS = [cand('pass', 0.6, -26.0, 50)];

describe("the standard path's border check before a pass", () => {
  it('a top pass becomes the border move', async () => {
    expect(await select(TOP_PASS, new FakeBorder(own12()))).toEqual(pt('A8'));
    // without the engine calls, or without a read, it passes as before
    clearSelectorLog();
    expect(await select(TOP_PASS, undefined)).toBeNull();
    expect(snapshotSelectorLog().filter((l) => l.includes('border'))).toEqual([]); // skipped, not failed
    expect(await select(TOP_PASS, new FakeBorder(null))).toBeNull();
  });

  it('one ownership read, then each qualifying move and the pass scored once at 4 visits', async () => {
    const engine = new FakeBorder(own12());
    await select(TOP_PASS, engine);
    expect(engine.calls[0]).toEqual({ kind: 'ownership' });
    expect(engine.reads()).toBe(1);
    // the largest gains first (A8 four, A7 three, A6 two), then the pass
    expect(engine.scored()).toEqual(['A8', 'A7', 'A6', 'pass']);
    expect(engine.calls.filter((c) => c.kind === 'after').map((c) => c.visits)).toEqual([4, 4, 4, 4]);
  });

  it('a move that does not pass makes no read', async () => {
    const engine = new FakeBorder(own12());
    expect(await select([cand('D4', 0.5, -28.0), cand('pass', 0.1, -26.0, 2)], engine)).toEqual(pt('D4'));
    expect(engine.calls).toEqual([]);
  });

  it('no border open still passes, after the one read', async () => {
    const board = replay(GAME_15K);
    const engine = new FakeBorder(ownership(board, []));
    expect(await select(TOP_PASS, engine, board)).toBeNull();
    expect(engine.reads()).toBe(1);
    expect(engine.scored()).toEqual([]);
  });

  it('a gain under the knob still passes', async () => {
    // F5 makes F6 White's: one point.
    const board = replay(GAME_18K);
    const own = ownership(board, DEAD_18K);
    expect(await select(TOP_PASS, new FakeBorder(own), board)).toEqual(pt('F5'));
    const two = { ...PROFILE, human_border_gain: 2.0 };
    expect(await select(TOP_PASS, new FakeBorder(own), board, { profile: two })).toBeNull();
  });

  it('the knob at Infinity switches it off with no read', async () => {
    const engine = new FakeBorder(own12());
    expect(await select(TOP_PASS, engine, undefined, { profile: { ...PROFILE, human_border_gain: Infinity } })).toBeNull();
    expect(engine.calls).toEqual([]);
    // a finite knob is still on: 4.0 reaches A8's four points, 5.0 does not
    const four = { ...PROFILE, human_border_gain: 4.0 };
    expect(await select(TOP_PASS, new FakeBorder(own12()), undefined, { profile: four })).toEqual(pt('A8'));
    const five = { ...PROFILE, human_border_gain: 5.0 };
    expect(await select(TOP_PASS, new FakeBorder(own12()), undefined, { profile: five })).toBeNull();
  });

  it('a failed read, a failed scoring query or a short read leaves the pass', async () => {
    const throws = () => {
      throw new Error('bridge down');
    };
    expect(await select(TOP_PASS, new FakeBorder(throws))).toBeNull();
    expect(await select(TOP_PASS, new FakeBorder(own12(), {}, -26.0, true))).toBeNull();
    const short = new FakeBorder(own12().slice(0, N - 1));
    expect(await select(TOP_PASS, short)).toBeNull();
    expect(short.scored()).toEqual([]);
  });

  it('every pass route of the path goes through the check', async () => {
    // the opening, with only a pass on offer
    const opening = { ...PROFILE, opening_moves: 999 };
    expect(await select([cand('pass', 0.9, -26.0)], new FakeBorder(own12()), undefined, { profile: opening }))
      .toEqual(pt('A8'));
    // a pass within the threshold
    expect(await select([cand('D4', 0.5, -26.0, 40), cand('pass', 0.3, -26.0, 30)], new FakeBorder(own12())))
      .toEqual(pt('A8'));
    // after the opponent's pass the honest top fills White's own territory (B3); it beats the
    // pass by 4 for White (leads are Black's), so the pass check lets it through
    expect(
      await select([cand('B3', 0.5, -30.0, 60), cand('pass', 0.3, -26.0, 30)], new FakeBorder(own12()),
        undefined, { opponentPassed: true }),
    ).toEqual(pt('A8'));
  });
});

describe("the standard path's border limits: the ceiling and the loss against the pass", () => {
  // A pass within the threshold, with the search's priors on A8 (one point), J3 and G3 (two each).
  const PRIORS = [
    cand('A8', 0.5, 0.0, 40), cand('J3', 0.3, 0.0), cand('G3', 0.2, 0.0), cand('pass', 0.1, 0.0, 30),
  ];

  it('the pockets board has twenty qualifying moves', () => {
    const board = fromRows(POCKETS);
    expect(borderMoves(board, Color.White, ownership(board, []), 1.0)).toHaveLength(20);
    expect(BORDER_MAX_QUERIES).toBe(8);
  });

  it('many qualifying moves make at most the ceiling of queries', async () => {
    const board = fromRows(POCKETS);
    const found = new Set(borderMoves(board, Color.White, ownership(board, []), 1.0).map(([, i]) => i));
    const engine = new FakeBorder(ownership(board, []), {}, 0.0);
    const move = await select(TOP_PASS, engine, board);
    expect(found.has(move!.row * SIZE + move!.col)).toBe(true);
    expect(engine.scored()).toHaveLength(BORDER_MAX_QUERIES + 1);
    expect(engine.scored().filter((m) => m === 'pass')).toHaveLength(1);
  });

  it("the largest gains are scored first, ties to the search's prior, then index order", async () => {
    // A8 is the likeliest move but gains one; of the ten two-point moves J3 and G3 come first by
    // prior, then index order to the ceiling: C3 and E3 are left out.
    const board = fromRows(POCKETS);
    const engine = new FakeBorder(ownership(board, []), {}, 0.0);
    expect(await select(PRIORS, engine, board)).toEqual(pt('J3'));
    expect(engine.scored()).toEqual(['J3', 'G3', 'A7', 'C7', 'E7', 'G7', 'J7', 'A3', 'pass']);
  });

  it('a move past the ceiling is not considered when every scored one fails', async () => {
    // Every scored two-point move loses three against the pass; C3 and E3 are never asked about.
    const board = fromRows(POCKETS);
    const engine = new FakeBorder(ownership(board, []), { pass: 0.0 }, 3.0);
    expect(await select(PRIORS, engine, board)).toBeNull();
    expect(engine.scored()).not.toContain('C3');
    expect(engine.scored()).not.toContain('E3');
  });

  it('a border move losing more than its gain against the pass is not played', async () => {
    const leads = { A8: -21.0, A7: -22.0, A6: -23.0 }; // each loses one more than it gains
    expect(await select(TOP_PASS, new FakeBorder(own12(), leads))).toBeNull();
    expect(await select(TOP_PASS, new FakeBorder(own12(), { ...leads, A7: -23.0 }))).toEqual(pt('A7'));
    // A8 losing exactly its four is played
    expect(await select(TOP_PASS, new FakeBorder(own12(), { ...leads, A8: -22.0 }))).toEqual(pt('A8'));
    // a far better reading of a border move does not matter beyond passing the check: the largest gain wins
    expect(await select(TOP_PASS, new FakeBorder(own12(), { A6: -40.0 }))).toEqual(pt('A8'));
  });

  it('Black counts from its own side', async () => {
    // The pockets board with the colours swapped and Black to move; leads are still Black's.
    const swapped = POCKETS.map((r) => r.replace(/[XO]/g, (c) => (c === 'X' ? 'O' : 'X')));
    const board = fromRows(swapped);
    const own = ownership(board, []);
    const black = { color: Color.Black as Stone };
    // every scored move loses three against the pass for Black: pass
    expect(await select(PRIORS, new FakeBorder(own, { pass: 0.0 }, -3.0), board, black)).toBeNull();
    // each gains three for Black: J3, first by prior among the two-point moves
    expect(await select(PRIORS, new FakeBorder(own, { pass: 0.0 }, 3.0), board, black)).toEqual(pt('J3'));
  });
});
