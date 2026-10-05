import { describe, it, expect, afterEach } from 'vitest';
import {
  BORDER_MAX_QUERIES,
  borderMoves,
  countedMargin,
  deadStonesFromOwnership,
  selectWithHumanNet,
  type HumanNetEngine,
  type HumanNetProfile,
  type HumanPolicyAnswer,
  type ScoreAfterAnswer,
} from '../humanNetSelector';
import { Board } from '../../engine/Board';
import { Color, MoveResult, type Point, type Stone } from '../../engine/types';
import { localGameRouter, ownershipViaBridge } from '../../api/localGameRouter';
import type { KataGoBridge } from '../../api/nativeKataGo';

/**
 * The human path's border check, ported from backend/tests/test_human_net_border.py:
 * before it passes, the bot counts the board the way a finished game is
 * counted (dead stones off by the ownership read, then a flood fill in which
 * a region touching both colours counts for nobody) and plays a legal move
 * that raises its count by `human_border_gain` or more instead. Positions are
 * from three 9x9 games (komi 6.5, the bot White), each at the bot's pass.
 * On the device the ownership is a third engine call, made only when the
 * path is about to pass.
 */

const SIZE = 9;
const N = SIZE * SIZE;

// SGF coordinates (column letter, row letter from the top), Black first.
const GAME_12K = 'eeegcegdfgccecffefggfhdggffehgghhhedddfddccfdebebdafgbehgibccbbbdacdbafbfcgchbebfaeidb';
const DEAD_12K: Array<[number, number]> = [[1, 4], [1, 5], [2, 6], [3, 1], [3, 4], [3, 5], [3, 6], [4, 5], [5, 5]];
const GAME_18K = 'eeggeggccdgeecfhehcgbfbgcfdgdhchbicidfbhagahafaidififbfghbgfhdgdhcgbgaheieifidfcebeddd';
const DEAD_18K: Array<[number, number]> = [[6, 1], [6, 2], [6, 3], [7, 0], [7, 1], [7, 2], [8, 0], [8, 2]];
const GAME_15K = 'eeggeggecdfhehfgecfcfdgdfbgcgbfeedefdfffdghbhaibfigiei';

// The live 12k's knobs (data/profiles/b20.yaml, 9x9).
const PROFILE_12K: HumanNetProfile = {
  human_sl_profile: 'rank_20k',
  human_tilt: -4.0,
  human_tilt_from: 12,
  human_cand_min: 0.03,
  human_cand_max: 8,
  human_score_visits: 4,
  human_pass_margin: 0.5,
  human_small_gain: 2.0,
  human_confirm_visits: 12,
  human_confirm_margin: 0.75,
  human_loss_cap: 4.0,
};
const NO_CAP: HumanNetProfile = { ...PROFILE_12K, human_loss_cap: undefined };

const pt = (g: string): Point => ({ row: SIZE - Number(g.slice(1)), col: 'ABCDEFGHJ'.indexOf(g[0]) });
const idx = (g: string) => pt(g).row * SIZE + pt(g).col;
const gtp = (p: Point) => `${'ABCDEFGHJ'[p.col]}${SIZE - p.row}`;
const gtpI = (i: number) => gtp({ row: Math.floor(i / SIZE), col: i % SIZE });

function replay(sgf: string): { board: Board; moves: number } {
  const board = new Board(SIZE);
  for (let k = 0; k < sgf.length; k += 2) {
    const color = (k / 2) % 2 === 0 ? Color.Black : Color.White;
    const p = { row: sgf.charCodeAt(k + 1) - 97, col: sgf.charCodeAt(k) - 97 };
    expect(board.tryPlay(color, p).result).toBe(MoveResult.Ok);
  }
  return { board, moves: sgf.length / 2 };
}

/** A board from rows of X (Black), O (White) and . (empty). */
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

function policy(points: Record<string, number>, passProb = 0): number[] {
  const pol = new Array<number>(N + 1).fill(0.001);
  for (const [g, p] of Object.entries(points)) pol[idx(g)] = p;
  pol[N] = passProb;
  return pol;
}

interface FakeOpts {
  main?: number[];
  own?: number[] | null | (() => never);
  leads?: Record<string, number>;
  deepLeads?: Record<string, number>;
  defaultLead?: number;
  noOwnershipCall?: boolean;
}

/** The human-policy query, a Black-perspective lead after each scored move
 *  (`leads`, else `defaultLead`; at 12 visits `deepLeads` first), and the
 *  ownership read. */
class FakeEngine implements HumanNetEngine {
  calls: Array<{ kind: 'human' | 'after' | 'ownership'; move?: string; visits?: number }> = [];
  ownership?: () => Promise<number[] | null | undefined>;

  constructor(
    private human: number[],
    private opts: FakeOpts = {},
  ) {
    if (!opts.noOwnershipCall) {
      this.ownership = async () => {
        this.calls.push({ kind: 'ownership' });
        const own = this.opts.own;
        return typeof own === 'function' ? own() : own;
      };
    }
  }

  async humanPolicy(_profile: string, visits: number): Promise<HumanPolicyAnswer> {
    this.calls.push({ kind: 'human', visits });
    return { humanPolicy: this.human, policy: this.opts.main ?? policy({}), scoreLead: 1.5 };
  }

  async scoreAfter(move: Point | 'pass', visits: number): Promise<ScoreAfterAnswer> {
    const name = move === 'pass' ? 'pass' : gtp(move);
    this.calls.push({ kind: 'after', move: name, visits });
    const deep = visits === 12 ? this.opts.deepLeads?.[name] : undefined;
    return { scoreLead: deep ?? this.opts.leads?.[name] ?? this.opts.defaultLead ?? -26.0, winrate: 0.5 };
  }

  scored(): string[] {
    return this.calls.flatMap((c) => (c.kind === 'after' ? [c.move!] : []));
  }

  ownershipReads(): number {
    return this.calls.filter((c) => c.kind === 'ownership').length;
  }
}

// The human net's likeliest moves at the 12k's pass: none gains over passing.
const HUMAN_12K = policy({ D4: 0.3, F1: 0.25, J1: 0.2, J9: 0.1, A8: 0.02 });

async function select(
  engine: HumanNetEngine,
  board: Board,
  moves: number,
  profile: HumanNetProfile = PROFILE_12K,
  opponentPassed = false,
  color: Stone = Color.White,
) {
  return selectWithHumanNet(engine, board, color, profile, moves, { opponentPassed, rng: () => 0.5 });
}

const sorted = (xs: string[]) => [...xs].sort();

// Two pockets of White's, each open to Black through one point (E7, E3): closing either gains 16
// (F7 or F3, one point inside, 15).
const TWO_POCKETS = [
  '...XO....',
  '...XO....',
  '...X.....',
  '...XO....',
  '...XOOOOO',
  '...XO....',
  '...X.....',
  '...XO....',
  '...XO....',
];

describe('the border check before a pass', () => {
  it('the 12k closes the border at A8 instead of passing', async () => {
    const { board, moves } = replay(GAME_12K);
    const own = ownership(board, DEAD_12K);
    const engine = new FakeEngine(HUMAN_12K, { own });
    expect(await select(engine, board, moves)).toEqual({ handled: true, move: pt('A8') });
    // A5, A6, A7 and B6 (a dead Black stone's point) are White's after it, by the game's count
    const after = board.clone();
    after.tryPlay(Color.White, pt('A8'));
    const dead = deadStonesFromOwnership(after, own);
    const counted = after.clone();
    for (const p of dead) counted.grid[p.row * SIZE + p.col] = Color.Empty;
    const { whiteTerritory, neutral } = counted.scoreTerritory();
    for (const g of ['A5', 'A6', 'A7', 'B6']) {
      expect(whiteTerritory.has(idx(g))).toBe(true);
      expect(neutral.has(idx(g))).toBe(false);
    }
    // A8 was not among the scored candidates, so it was scored for the loss cap, once, at the profile's visits
    const a8 = engine.calls.filter((c) => c.kind === 'after' && c.move === 'A8');
    expect(a8).toEqual([{ kind: 'after', move: 'A8', visits: 4 }]);
    // one ownership read, after the scoring said pass; the pass already scored is not asked again
    expect(engine.ownershipReads()).toBe(1);
    expect(engine.calls.findIndex((c) => c.kind === 'ownership')).toBe(1 + 5);
    expect(engine.scored().filter((m) => m === 'pass')).toHaveLength(1);
  });

  it('the border count matches the recorded game', () => {
    const { board } = replay(GAME_12K);
    const own = ownership(board, DEAD_12K);
    const dead = deadStonesFromOwnership(board, own).map((p) => [p.row, p.col]);
    expect(dead).toEqual([...DEAD_12K].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
    const found = Object.fromEntries(borderMoves(board, Color.White, own, 1.0).map(([g, i]) => [gtpI(i), g]));
    // A9 would gain five but is self-atari; A8 four, A7 three, A6 two
    expect(found).toEqual({ A8: 4, A7: 3, A6: 2 });
  });

  it('without an ownership read the same position passes, as before', async () => {
    const { board, moves } = replay(GAME_12K);
    for (const opts of [
      { own: null },
      { noOwnershipCall: true },
      { own: () => { throw new Error('bridge down'); } },
    ] as FakeOpts[]) {
      const engine = new FakeEngine(HUMAN_12K, opts);
      expect(await select(engine, board, moves)).toEqual({ handled: true, move: null });
      expect(sorted(engine.scored())).toEqual(['D4', 'F1', 'J1', 'J9', 'pass']);
    }
  });

  it('a border is also closed when the main net wants to pass', async () => {
    const { board, moves } = replay(GAME_12K);
    const engine = new FakeEngine(HUMAN_12K, { main: policy({}, 0.9), own: ownership(board, DEAD_12K) });
    expect((await select(engine, board, moves)).move).toEqual(pt('A8'));
    expect(sorted(engine.scored())).toEqual(['A6', 'A7', 'A8', 'pass']); // every qualifying border move, for the cap
    expect(engine.scored()).toEqual(['A8', 'A7', 'A6', 'pass']); // in the Python's order: by index, then the pass
  });

  it("a border is also closed in answer to the opponent's pass", async () => {
    const { board, moves } = replay(GAME_12K);
    const engine = new FakeEngine(HUMAN_12K, { own: ownership(board, DEAD_12K) });
    expect((await select(engine, board, moves + 1, PROFILE_12K, true)).move).toEqual(pt('A8'));
  });

  it('a border is closed after the second look says pass', async () => {
    // D4 reads 1.0 over passing at 4 visits (inside human_small_gain) and 0 at 12: the second look passes.
    const { board, moves } = replay(GAME_12K);
    const engine = new FakeEngine(HUMAN_12K, {
      own: ownership(board, DEAD_12K),
      leads: { D4: -27.0 },
      deepLeads: { D4: -26.0 },
    });
    expect((await select(engine, board, moves)).move).toEqual(pt('A8'));
    expect(engine.calls.filter((c) => c.visits === 12)).toHaveLength(2);
  });

  it('the 18k position plays F5 for one point', async () => {
    // E1, E4, F4, F5 and F6 count for nobody; White F5 makes F6 White's (+1). The rest gain nothing.
    const { board, moves } = replay(GAME_18K);
    const own = ownership(board, DEAD_18K);
    expect(borderMoves(board, Color.White, own, 1.0).map(([g, i]) => [g, gtpI(i)])).toEqual([[1, 'F5']]);
    let engine = new FakeEngine(policy({ E1: 0.4, J4: 0.3 }), { own, defaultLead: -31.0 });
    expect((await select(engine, board, moves)).move).toEqual(pt('F5'));
    // a profile that asks for two points or more passes there
    engine = new FakeEngine(policy({ E1: 0.4, J4: 0.3 }), { own, defaultLead: -31.0 });
    expect(await select(engine, board, moves, { ...PROFILE_12K, human_border_gain: 2.0 })).toEqual({
      handled: true,
      move: null,
    });
  });

  it('the 15k position still passes: J9 is a dame', async () => {
    const { board, moves } = replay(GAME_15K);
    const own = ownership(board, []);
    expect(borderMoves(board, Color.White, own, 1.0)).toEqual([]);
    let engine = new FakeEngine(policy({ J9: 0.4, J7: 0.3 }), { own, defaultLead: -21.0 });
    expect(await select(engine, board, moves)).toEqual({ handled: true, move: null });
    // no extra scoring when nothing qualifies
    expect(sorted(engine.scored())).toEqual(['J7', 'J9', 'pass']);
    // nor when the main net wants to pass, and with no loss cap it still passes
    engine = new FakeEngine(policy({ J9: 0.4 }), { main: policy({}, 0.9), own, defaultLead: -21.0 });
    expect(await select(engine, board, moves)).toEqual({ handled: true, move: null });
    expect(engine.scored()).toEqual([]);
    engine = new FakeEngine(policy({ J9: 0.4, J7: 0.3 }), { own, defaultLead: -21.0 });
    expect(await select(engine, board, moves, NO_CAP)).toEqual({ handled: true, move: null });
  });

  const SETTLED = Array.from({ length: SIZE }, () => '....XO...');

  it('a settled position still passes; the ownership read is the one extra query', async () => {
    const board = fromRows(SETTLED);
    expect(countedMargin(board, Color.White, ownership(board, [])).neutral.size).toBe(0);
    const engine = new FakeEngine(policy({ A1: 0.5, J9: 0.4 }), { own: ownership(board, []), defaultLead: 0.0 });
    expect(await select(engine, board, 14)).toEqual({ handled: true, move: null });
    expect(sorted(engine.scored())).toEqual(['A1', 'J9', 'pass']);
    expect(engine.ownershipReads()).toBe(1);
  });

  it('a move the path plays asks for no ownership read', async () => {
    const { board, moves } = replay(GAME_12K);
    const engine = new FakeEngine(HUMAN_12K, { own: ownership(board, DEAD_12K), leads: { D4: -32.0 } });
    expect((await select(engine, board, moves)).move).toEqual(pt('D4'));
    expect(engine.ownershipReads()).toBe(0);
  });

  it('the loss cap still applies to a border move', async () => {
    // The main net says A8 throws away five points: over the 12k's cap of 4, so pass.
    const { board, moves } = replay(GAME_12K);
    const own = ownership(board, DEAD_12K);
    let engine = new FakeEngine(HUMAN_12K, { own, leads: { A8: -21.0, A7: -21.0, A6: -21.0 } });
    expect(await select(engine, board, moves)).toEqual({ handled: true, move: null });
    // four is inside the cap: played
    engine = new FakeEngine(HUMAN_12K, { own, leads: { A8: -22.0 } });
    expect((await select(engine, board, moves)).move).toEqual(pt('A8'));
    // with no cap the main net is not asked about it
    engine = new FakeEngine(HUMAN_12K, { own, leads: { A8: -21.0 } });
    expect((await select(engine, board, moves, NO_CAP)).move).toEqual(pt('A8'));
    expect(engine.scored()).not.toContain('A8');
  });

  it('the loss cap counts from the best scored candidate', async () => {
    // D4 reads 0.4 over passing (under the pass margin); A8 loses 4.4 against it, past the cap of 4,
    // though only 4 against the pass. A7, a candidate itself, is scored once.
    const { board, moves } = replay(GAME_12K);
    const human = policy({ D4: 0.3, F1: 0.25, J1: 0.2, A7: 0.05, A8: 0.02 });
    const engine = new FakeEngine(human, { own: ownership(board, DEAD_12K), leads: { D4: -26.4, A8: -22.0 } });
    expect((await select(engine, board, moves)).move).toEqual(pt('A7'));
    expect(engine.scored().filter((m) => m === 'A7')).toHaveLength(1);
  });

  it('the loss cap is measured from the pass when it scored best', async () => {
    // Every candidate scores under the pass; A8 is 4 behind the pass (kept), A7 4.5 (dropped).
    const { board, moves } = replay(GAME_12K);
    const engine = new FakeEngine(HUMAN_12K, {
      own: ownership(board, DEAD_12K),
      leads: { pass: -20.0, A8: -16.0, A7: -15.5, A6: -15.5 },
      defaultLead: -15.0,
    });
    expect((await select(engine, board, moves)).move).toEqual(pt('A8'));
    // A8 4.1 behind the pass (past the cap and its gain of four), A7 3 (its own gain of three): A7.
    const engine2 = new FakeEngine(HUMAN_12K, {
      own: ownership(board, DEAD_12K),
      leads: { pass: -20.0, A8: -15.9, A7: -17.0, A6: -15.5 },
      defaultLead: -15.0,
    });
    expect((await select(engine2, board, moves)).move).toEqual(pt('A7'));
  });

  it('no legal move in the human policy still closes the border', async () => {
    const { board, moves } = replay(GAME_12K);
    const engine = new FakeEngine(new Array<number>(N + 1).fill(0), { own: ownership(board, DEAD_12K) });
    expect((await select(engine, board, moves)).move).toEqual(pt('A8'));
  });

  it('a short, long or missing ownership read leaves the pass alone', async () => {
    const { board, moves } = replay(GAME_12K);
    const full = ownership(board, DEAD_12K);
    for (const own of [null, undefined, [], new Array(10).fill(0), [...full, 0]]) {
      const engine = new FakeEngine(HUMAN_12K, { own });
      expect(await select(engine, board, moves)).toEqual({ handled: true, move: null });
    }
  });

  it("a stone in the opponent's territory is never a border move", () => {
    // Black's area is sealed; the read is unsure of one point inside it. Dropping a White stone
    // there would make Black's whole area count for nobody, but it is not a border.
    const board = fromRows(SETTLED);
    const own = ownership(board, []);
    own[idx('B5')] = 0.0;
    expect(borderMoves(board, Color.White, own, 1.0)).toEqual([]);
  });

  it("a dead stone's point is never a border move", () => {
    const { board } = replay(GAME_12K);
    const found = new Set(borderMoves(board, Color.White, ownership(board, DEAD_12K), 0.0).map(([, i]) => i));
    expect(found.has(idx('A5')) && found.has(idx('D4'))).toBe(true);
    expect(found.has(idx('B6'))).toBe(false); // the dead Black stone's point: occupied
  });

  it('a stone is dead only past the threshold', () => {
    const board = new Board(SIZE);
    board.grid[0] = Color.Black;
    board.grid[1] = Color.White;
    const own = new Array<number>(N).fill(0);
    [own[0], own[1]] = [-0.3, 0.3];
    expect(deadStonesFromOwnership(board, own)).toEqual([]);
    [own[0], own[1]] = [-0.31, 0.31];
    expect(deadStonesFromOwnership(board, own)).toEqual([{ row: 0, col: 0 }, { row: 0, col: 1 }]);
  });

  it('the loss cap drops one border move and keeps another', async () => {
    // A8 loses five (dropped); A7 gains three by the count and loses nothing: played.
    const { board, moves } = replay(GAME_12K);
    const engine = new FakeEngine(HUMAN_12K, { own: ownership(board, DEAD_12K), leads: { A8: -21.0 } });
    expect((await select(engine, board, moves)).move).toEqual(pt('A7'));
  });

  it("equal gains go to the human net's probability, then to the first point", async () => {
    const board = fromRows(TWO_POCKETS);
    const own = ownership(board, []);
    expect(borderMoves(board, Color.White, own, 1.0).map(([g, i]) => [g, gtpI(i)])).toEqual([
      [16, 'E7'],
      [15, 'F7'],
      [16, 'E3'],
      [15, 'F3'],
    ]);
    const main = policy({}, 0.9);
    const run = async (human: Record<string, number>) =>
      (await select(new FakeEngine(policy(human), { main, own }), board, 30)).move;
    expect(await run({ E7: 0.02, E3: 0.05 })).toEqual(pt('E3'));
    expect(await run({ E7: 0.05, E3: 0.02 })).toEqual(pt('E7'));
    expect(await run({})).toEqual(pt('E7'));
    // E7 dropped by the loss cap: E3's 16 wins over F7's 15, which comes first
    const engine = new FakeEngine(policy({}), { main, own, leads: { E7: -20.0 } });
    expect((await select(engine, board, 30)).move).toEqual(pt('E3'));
  });

  it('a larger gain wins over a likelier move', async () => {
    const { board, moves } = replay(GAME_12K);
    const engine = new FakeEngine(policy({ D4: 0.3, A6: 0.05, A8: 0.02 }), { own: ownership(board, DEAD_12K) });
    expect((await select(engine, board, moves)).move).toEqual(pt('A8'));
  });

  it('a stone dropped on a point the opponent owns counts as dead', () => {
    const { board } = replay(GAME_12K);
    const own = ownership(board, DEAD_12K);
    own[idx('A8')] = 0.5; // the read gives A8 to Black
    const found = new Set(borderMoves(board, Color.White, own, 1.0).map(([, i]) => i));
    expect(found.has(idx('A8'))).toBe(false);
    expect(found.has(idx('A7'))).toBe(true);
  });

  it('own-eye fills are never border moves', () => {
    // A9 is White's eye on the board; B9 is a dead White stone, so after it comes off A9 and B9
    // touch Black's C9 and count for nobody. Filling A9 is legal and not self-atari.
    const board = fromRows(['.OX......', 'OOX......', 'OO.......', ...Array(6).fill('.........')]);
    const own: number[] = board.grid.map((c) => (c === Color.Black ? 0.9 : c === Color.White ? -0.9 : 0));
    own[idx('B9')] = 0.9;
    const found = new Set(borderMoves(board, Color.White, own, -100).map(([, i]) => i));
    expect(countedMargin(board, Color.White, own).neutral.has(idx('A9'))).toBe(true);
    expect(found.has(idx('A9'))).toBe(false);
    expect(found.has(idx('A6'))).toBe(true);
  });

  it('the knob is read from the profile', async () => {
    const { board, moves } = replay(GAME_12K);
    const own = ownership(board, DEAD_12K);
    let engine = new FakeEngine(HUMAN_12K, { own });
    expect(await select(engine, board, moves, { ...PROFILE_12K, human_border_gain: 5.0 })).toEqual({
      handled: true,
      move: null,
    });
    engine = new FakeEngine(HUMAN_12K, { own });
    expect((await select(engine, board, moves, { ...PROFILE_12K, human_border_gain: 4.0 })).move).toEqual(pt('A8'));
  });

  it('Black counts from its own side', () => {
    // The same 12k position with Black to move: Black's border moves are its own, measured as Black's gain.
    const { board } = replay(GAME_12K);
    const own = ownership(board, DEAD_12K);
    const w = countedMargin(board, Color.White, own).margin;
    expect(countedMargin(board, Color.Black, own).margin).toBe(-w);
  });
});

// --- the border check's two limits (backend/tests/test_border_check_limits.py) --

describe("the border check's limits: the ceiling and the loss against the pass", () => {
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
  const CAP10: HumanNetProfile = { ...PROFILE_12K, human_loss_cap: 10.0 };
  const passing = policy({}, 0.9); // the main net on pass: straight to the border check

  it('the pockets board has twenty qualifying moves, ten of two points and ten of one', () => {
    const board = fromRows(POCKETS);
    const found = borderMoves(board, Color.White, ownership(board, []), 1.0);
    expect(found).toHaveLength(20);
    expect(found.filter(([g]) => g === 2).map(([, i]) => gtpI(i))).toEqual([
      'A7', 'C7', 'E7', 'G7', 'J7', 'A3', 'C3', 'E3', 'G3', 'J3',
    ]);
    expect(found.filter(([g]) => g === 1)).toHaveLength(10);
  });

  it('many qualifying moves make at most the ceiling of queries', async () => {
    const board = fromRows(POCKETS);
    const found = new Set(borderMoves(board, Color.White, ownership(board, []), 1.0).map(([, i]) => i));
    expect(BORDER_MAX_QUERIES).toBe(8);
    const engine = new FakeEngine(policy({}), { main: passing, own: ownership(board, []), defaultLead: 0.0 });
    const { handled, move } = await select(engine, board, 30, CAP10);
    expect(handled).toBe(true);
    expect(found.has(move!.row * SIZE + move!.col)).toBe(true);
    expect(engine.scored()).toHaveLength(BORDER_MAX_QUERIES + 1);
    expect(engine.scored().filter((m) => m === 'pass')).toHaveLength(1);
  });

  it('the largest gains are scored first, ties to the likelier, then index order', async () => {
    // A8 (one point) is the likeliest move on the board and is not scored; of the ten two-point moves
    // J3 and G3 come first by probability, then index order to the ceiling: C3 and E3 are left out.
    const board = fromRows(POCKETS);
    const engine = new FakeEngine(policy({ A8: 0.5, J3: 0.3, G3: 0.2 }), {
      main: passing,
      own: ownership(board, []),
      defaultLead: 0.0,
    });
    expect((await select(engine, board, 30, CAP10)).move).toEqual(pt('J3'));
    expect(engine.scored()).toEqual(['J3', 'G3', 'A7', 'C7', 'E7', 'G7', 'J7', 'A3', 'pass']);
  });

  it('a move past the ceiling is not considered when every scored one fails', async () => {
    // Every scored two-point move loses three against the pass; C3 and E3 are never asked about.
    const board = fromRows(POCKETS);
    const engine = new FakeEngine(policy({ J3: 0.3, G3: 0.2 }), {
      main: passing,
      own: ownership(board, []),
      leads: { pass: 0.0 },
      defaultLead: 3.0,
    });
    expect(await select(engine, board, 30, CAP10)).toEqual({ handled: true, move: null });
    expect(engine.scored()).not.toContain('C3');
    expect(engine.scored()).not.toContain('E3');
  });

  it('a border move losing more than its gain against the pass is not played', async () => {
    // A cap of 10: A8 (four points by the count) loses five against the pass, A7 (three) four, A6 (two) three.
    const { board, moves } = replay(GAME_12K);
    const own = ownership(board, DEAD_12K);
    const leads = { A8: -21.0, A7: -22.0, A6: -23.0 };
    let engine = new FakeEngine(HUMAN_12K, { own, leads });
    expect(await select(engine, board, moves, CAP10)).toEqual({ handled: true, move: null });
    // A8 losing exactly its four is played
    engine = new FakeEngine(HUMAN_12K, { own, leads: { ...leads, A8: -22.0 } });
    expect((await select(engine, board, moves, CAP10)).move).toEqual(pt('A8'));
    // A8 and A7 lose too much; A6 loses two, its own gain: played
    engine = new FakeEngine(HUMAN_12K, { own, leads: { ...leads, A6: -24.0 } });
    expect((await select(engine, board, moves, CAP10)).move).toEqual(pt('A6'));
  });

  it('the cap against the best still applies', async () => {
    // D4 reads 0.4 over the pass; A8 loses 0.4 against the pass and 0.8 against D4: played. When A8
    // loses its four against the pass (inside its gain) it loses 4.4 against D4, past the cap of 4.
    const { board, moves } = replay(GAME_12K);
    const human = policy({ D4: 0.3, F1: 0.25, J1: 0.2, A7: 0.05, A8: 0.02 });
    const leads = { D4: -26.4, A8: -25.6, A7: -25.0, A6: -25.0 };
    let engine = new FakeEngine(human, { own: ownership(board, DEAD_12K), leads });
    expect((await select(engine, board, moves)).move).toEqual(pt('A8'));
    engine = new FakeEngine(human, {
      own: ownership(board, DEAD_12K),
      leads: { ...leads, A8: -22.0, A7: -22.0, A6: -22.0 },
    });
    expect(await select(engine, board, moves)).toEqual({ handled: true, move: null });
  });

  it('the loss against the pass is measured from the pass, not from the best candidate', async () => {
    // D4 reads 0.4 over the pass (under the pass margin). A8 loses 3.8 against the pass, inside its
    // four, though 4.2 against D4; the cap of 10 holds both. A8, the larger gain, is played.
    const { board, moves } = replay(GAME_12K);
    const engine = new FakeEngine(policy({ D4: 0.3, F1: 0.25, J1: 0.2 }), {
      own: ownership(board, DEAD_12K),
      leads: { D4: -26.4, A8: -22.2 },
    });
    expect((await select(engine, board, moves, CAP10)).move).toEqual(pt('A8'));
  });

  it('with nothing scored equal gains still go to the likelier', async () => {
    // No loss cap: nothing is scored. E7 and E3 both gain 16; E7 comes first by index, E3 is likelier.
    const board = fromRows(TWO_POCKETS);
    const engine = new FakeEngine(policy({ E3: 0.05, E7: 0.02 }), { main: passing, own: ownership(board, []) });
    expect((await select(engine, board, 30, NO_CAP)).move).toEqual(pt('E3'));
    expect(engine.scored()).toEqual([]);
  });
});

// --- the device's scorer and the border check count alike -------------------

describe("the device's scorer counts the recorded games as the border check does", () => {
  afterEach(() => {
    localGameRouter._resetForTests();
    delete (globalThis as { window?: { kataGo?: unknown } }).window?.kataGo;
  });

  it("the read is in Black's frame, and null when the bridge sends none", async () => {
    const board = fromRows(Array.from({ length: SIZE }, () => '....XO...'));
    const own = ownership(board, []);
    const bridge = (sent: number[] | undefined) =>
      ({ analyze: async () => ({ candidates: [], rootVisits: 200, kataGoPlayedMove: 'pass', ownership: sent }) }) as unknown as KataGoBridge;
    expect(await ownershipViaBridge(bridge(own), board, 6.5, Color.Black)).toEqual(own);
    expect(await ownershipViaBridge(bridge(own.map((v) => -v)), board, 6.5, Color.White)).toEqual(own);
    expect(await ownershipViaBridge(bridge(undefined), board, 6.5, Color.White)).toBeNull();
  });

  it.each([
    ['12k', GAME_12K, DEAD_12K, 39, 19.5],
    ['18k', GAME_18K, DEAD_18K, 41, 16.5],
    ['15k', GAME_15K, [] as Array<[number, number]>, 37, 22.5],
  ])('the %s game', async (_name, sgf, dead, black, white) => {
    const { board } = replay(sgf);
    const own = ownership(board, dead);
    // The bridge answers from the side to move's view, as KataGo's GTP layer does.
    if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
      (globalThis as { window: object }).window = {};
    }
    (globalThis as { window: { kataGo?: unknown } }).window.kataGo = {
      ping: () => Promise.resolve({ pong: true }),
      analyze: (p: { color: 'B' | 'W' }) =>
        Promise.resolve({
          candidates: [],
          rootVisits: 200,
          kataGoPlayedMove: 'pass',
          ownership: p.color === 'W' ? own.map((v) => -v) : own,
        }),
    };
    const { game_id } = localGameRouter.createGame({ board_size: SIZE, komi: 6.5 });
    for (let k = 0; k < sgf.length; k += 2) {
      localGameRouter.playMove(game_id, sgf.charCodeAt(k + 1) - 97, sgf.charCodeAt(k) - 97);
    }
    await localGameRouter.pass(game_id);
    const final = (await localGameRouter.pass(game_id)) as { result: Record<string, number> | null };
    expect([final.result?.black_score, final.result?.white_score]).toEqual([black, white]);
    expect(countedMargin(board, Color.White, own).margin).toBe(white - 6.5 - black);
  });
});
