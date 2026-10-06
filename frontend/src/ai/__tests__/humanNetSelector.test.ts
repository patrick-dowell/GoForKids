import { describe, it, expect } from 'vitest';
import {
  isSelfAtari,
  movesPlayedExcludingHandicap,
  selectWithHumanNet,
  type HumanNetEngine,
  type HumanNetEval,
  type HumanNetOptions,
  type HumanNetProfile,
  type HumanPolicyAnswer,
  type ScoreAfterAnswer,
} from '../humanNetSelector';
import { Board } from '../../engine/Board';
import { Color, type Point, type Stone } from '../../engine/types';
import b20Yaml from '../../../../data/profiles/b20.yaml';

/**
 * The human SL path, ported from backend/tests/test_human_net.py: one test
 * here per selector test there, same scenarios and fake numbers, plus the
 * handicap move count and the lines the Python tests leave open. The fake
 * engine keys its answers by GTP point, as the Python fake does.
 */

const SIZE = 9;
const N = SIZE * SIZE;

const pt = (row: number, col: number): Point => ({ row, col });
const C7 = pt(2, 2);
const G3 = pt(6, 6);
const G7 = pt(2, 6); // (row, col): transposing either gives the other
const C3 = pt(6, 2);
const E5 = pt(4, 4);

function gtp(p: Point): string {
  return `${'ABCDEFGHJ'[p.col]}${SIZE - p.row}`;
}

/** A policy list (row-major, pass last) with the given point -> p. */
function policy(points: Array<[Point, number]>, passProb = 0, dflt = 0): number[] {
  const pol = new Array<number>(N + 1).fill(dflt);
  for (const [p, prob] of points) pol[p.row * SIZE + p.col] = prob;
  pol[N] = passProb;
  return pol;
}

type Call =
  | { kind: 'human'; profile: string; visits: number }
  | { kind: 'after'; move: string; visits: number };

interface FakeOpts {
  main?: number[];
  leads?: Record<string, number>; // gtp of the move -> Black-perspective lead after it
  deepLeads?: Record<string, number>; // the same, as read at deepVisits
  deepVisits?: number;
  winrates?: Record<string, number>;
  fail?: boolean;
}

/** Answers the human-policy query, then one score per candidate move. */
class FakeEngine implements HumanNetEngine {
  calls: Call[] = [];
  human: number[] | null;
  opts: FakeOpts;

  constructor(human: number[] | null, opts: FakeOpts = {}) {
    this.human = human;
    this.opts = opts;
  }

  async humanPolicy(profile: string, visits: number): Promise<HumanPolicyAnswer> {
    this.calls.push({ kind: 'human', profile, visits });
    if (this.opts.fail) throw new Error('engine down');
    return { humanPolicy: this.human, policy: this.opts.main ?? policy([]), scoreLead: 1.5 };
  }

  async scoreAfter(move: Point | 'pass', visits: number): Promise<ScoreAfterAnswer> {
    const name = move === 'pass' ? 'pass' : gtp(move);
    this.calls.push({ kind: 'after', move: name, visits });
    if (this.opts.fail) throw new Error('engine down');
    const table =
      visits === (this.opts.deepVisits ?? 12) ? this.opts.deepLeads ?? {} : this.opts.leads ?? {};
    return { scoreLead: table[name] ?? 0, winrate: this.opts.winrates?.[name] ?? 0.5 };
  }

  /** The scoring queries, as the moves they scored. */
  scored(visits?: number): string[] {
    return this.calls.flatMap((c) =>
      c.kind === 'after' && (visits === undefined || c.visits === visits) ? [c.move] : [],
    );
  }
}

const PROFILE: HumanNetProfile = {
  human_sl_profile: 'rank_20k',
  human_tilt: 8.0,
  human_tilt_from: 12,
  human_cand_min: 0.03,
  human_cand_max: 8,
  human_score_visits: 4,
};

/** Moves played, in the server's sense (the Python's EARLY and LATE lists). */
const EARLY = 2;
const LATE = 12;

const fixed = (x: number) => () => x;
/** Draws spread over [0, 1), for "always" and "both seen" checks. */
const SWEEP = Array.from({ length: 40 }, (_, i) => (i + 0.5) / 40);

async function pick(
  engine: HumanNetEngine,
  profile: HumanNetProfile = PROFILE,
  moves: number = EARLY,
  color: Stone = Color.Black,
  opts: HumanNetOptions = {},
  board: Board = new Board(SIZE),
) {
  return selectWithHumanNet(engine, board, color, profile, moves, opts);
}

/** The move of every draw in SWEEP. */
async function sweep(
  engine: HumanNetEngine,
  profile: HumanNetProfile,
  moves: number,
  color: Stone = Color.Black,
  opts: HumanNetOptions = {},
  board?: Board,
): Promise<Array<Point | null>> {
  const out: Array<Point | null> = [];
  for (const x of SWEEP) out.push((await pick(engine, profile, moves, color, { ...opts, rng: fixed(x) }, board)).move);
  return out;
}

const keys = (moves: Array<Point | null>) => new Set(moves.map((m) => (m ? gtp(m) : 'pass')));

/** The stand-in for the Python tilt tests' _Capture, which records the
 *  weights handed to random.choices: a draw just inside either end of each
 *  expected weight's share of [0, 1) must pick that candidate, so every
 *  share, and with it each weight against their sum, is as expected. A
 *  zero weight has no share and is never picked. */
async function expectWeights(
  engine: HumanNetEngine,
  profile: HumanNetProfile,
  moves: number,
  expected: Array<[Point, number]>,
  opts: HumanNetOptions = {},
  color: Stone = Color.Black,
) {
  const total = expected.reduce((a, [, w]) => a + w, 0);
  let acc = 0;
  for (const [p, w] of expected) {
    const lo = acc / total;
    acc += w;
    const hi = acc / total;
    if (w === 0) continue;
    const inset = (hi - lo) * 1e-6;
    for (const x of [lo + inset, hi - inset]) {
      expect((await pick(engine, profile, moves, color, { ...opts, rng: fixed(x) })).move).toEqual(p);
    }
  }
}

describe('human net selector: the opening and the lean', () => {
  it('samples early moves from the human policy', async () => {
    const engine = new FakeEngine(policy([[C7, 0.7], [G3, 0.3]]));
    expect(keys(await sweep(engine, PROFILE, EARLY))).toEqual(new Set(['C7', 'G3']));
    // by probability: 70% of the draws land on C7
    expect((await pick(engine, PROFILE, EARLY, Color.Black, { rng: fixed(0.69) })).move).toEqual(C7);
    expect((await pick(engine, PROFILE, EARLY, Color.Black, { rng: fixed(0.71) })).move).toEqual(G3);
    // one query a move, carrying the profile, and no candidate scoring yet
    expect(engine.calls.every((c) => c.kind === 'human')).toBe(true);
    expect(engine.calls[0]).toEqual({ kind: 'human', profile: 'rank_20k', visits: 1 });
  });

  it("splits the draw as Python's random.choices does", async () => {
    // a draw exactly on a boundary goes to the next move (bisect_right)
    const engine = new FakeEngine(policy([[C7, 0.75], [G3, 0.25]]));
    expect((await pick(engine, PROFILE, EARLY, Color.Black, { rng: fixed(0) })).move).toEqual(C7);
    expect((await pick(engine, PROFILE, EARLY, Color.Black, { rng: fixed(0.75) })).move).toEqual(G3);
  });

  it('never plays an illegal point in the policy', async () => {
    const engine = new FakeEngine(policy([[C7, 0.9], [G3, 0.1]], 0, -1));
    expect(keys(await sweep(engine, PROFILE, EARLY))).toEqual(new Set(['C7', 'G3']));
  });

  it('leans toward the candidate that loses more', async () => {
    // C7 is the human net's first choice and the better move; G3 loses 12.
    const engine = new FakeEngine(policy([[C7, 0.6], [G3, 0.4]]), { leads: { C7: 5.0, G3: -7.0 } });
    const strongTilt = { ...PROFILE, human_tilt: 1.0 };
    expect(keys(await sweep(engine, strongTilt, LATE))).toEqual(new Set(['G3']));
    // each candidate, and a pass, was scored on the position after it, at the profile's visits
    expect(new Set(engine.scored())).toEqual(new Set(['C7', 'G3', 'pass']));
    expect(engine.calls.filter((c) => c.kind === 'after').every((c) => c.visits === 4)).toBe(true);
  });

  it("reads the lead from White's side for White", async () => {
    // For White a Black-perspective lead of +5 after the move is the loss.
    const engine = new FakeEngine(policy([[C7, 0.6], [G3, 0.4]]), { leads: { C7: 5.0, G3: -7.0 } });
    const strongTilt = { ...PROFILE, human_tilt: 1.0 };
    expect(keys(await sweep(engine, strongTilt, LATE + 1, Color.White))).toEqual(new Set(['C7']));
  });

  it('does not lean before the opening is over, or without the knob', async () => {
    const engine = new FakeEngine(policy([[C7, 0.6], [G3, 0.4]]), { leads: { C7: 5.0, G3: -7.0 } });
    await pick(engine, { ...PROFILE, human_tilt: 1.0 }, EARLY);
    await pick(engine, { ...PROFILE, human_tilt: 0.0 }, LATE);
    expect(engine.calls.every((c) => c.kind === 'human')).toBe(true);
  });

  it('weighs a single candidate against passing', async () => {
    const engine = new FakeEngine(policy([[C7, 0.98], [G3, 0.02]]), { leads: { C7: 3.0 } });
    expect(await pick(engine, PROFILE, LATE)).toEqual({ handled: true, move: C7 });
    expect(engine.scored().sort()).toEqual(['C7', 'pass']);
  });

  it('weights each candidate by p * exp(loss / tilt)', async () => {
    // G7 loses nothing at p=0.7; C3 loses 2 at p=0.3; tilt 8.
    const engine = new FakeEngine(policy([[G7, 0.7], [C3, 0.3]]), { leads: { G7: 12.0, C3: 10.0 } });
    const edge = 0.7 / (0.7 + 0.3 * Math.exp(2 / 8));
    expect((await pick(engine, PROFILE, LATE, Color.Black, { rng: fixed(edge * 0.999) })).move).toEqual(G7);
    expect((await pick(engine, PROFILE, LATE, Color.Black, { rng: fixed(edge * 1.001) })).move).toEqual(C3);
  });

  it('caps the lean at a fifteen-point loss', async () => {
    const engine = new FakeEngine(policy([[G7, 0.5], [C3, 0.5]]), { leads: { G7: 60.0, C3: 0.0 } });
    const profile = { ...PROFILE, human_tilt: 5.0 };
    // the weights are 0.5 and 0.5 * exp(15 / 5): the draw splits there
    const edge = 1 / (1 + Math.exp(15.0 / 5.0));
    expect((await pick(engine, profile, LATE, Color.Black, { rng: fixed(edge * 0.999) })).move).toEqual(G7);
    expect((await pick(engine, profile, LATE, Color.Black, { rng: fixed(edge * 1.001) })).move).toEqual(C3);
  });

  it('counts moves the way the server does: handicap stones are not moves', async () => {
    // A two-stone handicap game ten moves in: the app's bridge list has the
    // two stones first, so it holds twelve entries.
    const bridge = [
      { color: 'B', point: 'G7' },
      { color: 'B', point: 'C3' },
      ...Array.from({ length: 10 }, (_, i) => ({ color: i % 2 === 0 ? 'W' : 'B', point: 'pass' })),
    ];
    const played = movesPlayedExcludingHandicap(bridge, 2);
    expect(played).toBe(10);
    const engine = new FakeEngine(policy([[C7, 0.6], [G3, 0.4]]), { leads: { C7: 5.0, G3: -7.0 } });
    await pick(engine, PROFILE, played);
    expect(engine.scored()).toEqual([]); // still the opening: sampled, no scoring
    await pick(engine, PROFILE, bridge.length); // the raw list would already lean
    expect(engine.scored()).not.toEqual([]);
  });
});

describe('human net selector: handing over and passing', () => {
  it("leaves the pass to the main net's policy", async () => {
    const human = policy([[C7, 1.0]], 0.0);
    expect(await pick(new FakeEngine(human, { main: policy([], 0.9) }))).toEqual({ handled: true, move: null });
    // the human net wanting to pass is not enough
    const wants = new FakeEngine(policy([[C7, 0.2]], 0.8), { main: policy([], 0.1) });
    expect(await pick(wants)).toEqual({ handled: true, move: C7 });
  });

  it('needs more than half the main policy on pass to pass', async () => {
    expect(await pick(new FakeEngine(policy([[G7, 1.0]]), { main: policy([], 0.5) }))).toEqual({
      handled: true,
      move: G7,
    });
  });

  it('hands over to the standard selector with no human policy or a failed query', async () => {
    const off = { handled: false, move: null };
    expect(await pick(new FakeEngine(null))).toEqual(off);
    expect(await pick(new FakeEngine(policy([[C7, 1.0]]), { fail: true }))).toEqual(off);
    // a main policy missing, or either policy without its pass entry
    const noMain: HumanNetEngine = {
      humanPolicy: async () => ({ humanPolicy: policy([[C7, 1.0]]), policy: null, scoreLead: 0 }),
      scoreAfter: async () => ({ scoreLead: 0, winrate: 0.5 }),
    };
    expect(await pick(noMain)).toEqual(off);
    expect(await pick(new FakeEngine(policy([[C7, 1.0]]).slice(0, N)))).toEqual(off);
    expect(await pick(new FakeEngine(policy([[C7, 1.0]]), { main: policy([]).slice(0, N) }))).toEqual(off);
  });

  it('logs a missing human policy apart from a failed query', async () => {
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    const noMain: HumanNetEngine = {
      humanPolicy: async () => ({ humanPolicy: policy([[C7, 1.0]]), policy: undefined, scoreLead: 0 }),
      scoreAfter: async () => ({ scoreLead: 0, winrate: 0.5 }),
    };
    await pick(new FakeEngine(null), PROFILE, EARLY, Color.Black, { log });
    await pick(noMain, PROFILE, EARLY, Color.Black, { log });
    await pick(new FakeEngine(policy([[C7, 1.0]]), { fail: true }), PROFILE, EARLY, Color.Black, { log });
    expect(lines.map((l) => (l.includes('no human policy') ? 'none' : l.includes('failed') ? 'failed' : l))).toEqual([
      'none',
      'none',
      'failed',
    ]);
  });

  it('hands over when a scoring query fails', async () => {
    const engine = new FakeEngine(policy([[C7, 1.0]]));
    engine.scoreAfter = async () => {
      throw new Error('engine down');
    };
    expect(await pick(engine, PROFILE, LATE)).toEqual({ handled: false, move: null });
  });

  it('passes when no candidate gains over passing', async () => {
    const human = policy([[G7, 0.6], [C3, 0.4]]);
    const passed = { handled: true, move: null };
    // Black to move; after either move Black leads by 20, and by 20 after a pass too
    let engine = new FakeEngine(human, { leads: { G7: 20.0, C3: 19.5, pass: 20.0 } });
    expect(await pick(engine, PROFILE, LATE)).toEqual(passed);
    // half a point is under the margin, a whole point is not
    engine = new FakeEngine(human, { leads: { G7: 20.5, C3: 19.5, pass: 20.0 } });
    expect(await pick(engine, PROFILE, LATE)).toEqual(passed);
    engine = new FakeEngine(human, { leads: { G7: 21.0, C3: 21.0, pass: 20.0 } });
    const played = await pick(engine, PROFILE, LATE);
    expect(played.handled && played.move !== null).toBe(true);
    // the margin is the profile's
    engine = new FakeEngine(human, { leads: { G7: 21.0, C3: 21.0, pass: 20.0 } });
    expect(await pick(engine, { ...PROFILE, human_pass_margin: 2.0 }, LATE)).toEqual(passed);
    // with no margin at all, moves that lose against passing are still a pass
    engine = new FakeEngine(human, { leads: { G7: 19.0, C3: 18.0, pass: 20.0 } });
    expect(await pick(engine, { ...PROFILE, human_pass_margin: 0 }, LATE)).toEqual(passed);
  });

  it("judges the pass from the mover's side", async () => {
    const human = policy([[G7, 1.0]]);
    // White to move: a Black-perspective lead of -20 after the move against -17 after a pass is a gain
    let engine = new FakeEngine(human, { leads: { G7: -20.0, pass: -17.0 } });
    expect(await pick(engine, PROFILE, LATE + 1, Color.White)).toEqual({ handled: true, move: G7 });
    engine = new FakeEngine(human, { leads: { G7: -17.0, pass: -20.0 } });
    expect(await pick(engine, PROFILE, LATE + 1, Color.White)).toEqual({ handled: true, move: null });
  });

  it("weighs passing after the opponent's pass, even in the opening", async () => {
    const human = policy([[G7, 0.6], [C3, 0.4]]);
    const quiet = new FakeEngine(human); // nothing gains
    expect(await pick(quiet, PROFILE, EARLY, Color.Black, { opponentPassed: true })).toEqual({
      handled: true,
      move: null,
    });
    const live = new FakeEngine(human, { leads: { G7: 6.0, C3: 1.0 } });
    const tilted = { ...PROFILE, human_tilt: 1.0 };
    const moves = await sweep(live, tilted, EARLY, Color.Black, { opponentPassed: true });
    expect(keys(moves)).toEqual(new Set(['G7', 'C3'])); // by probability: the lean waits for human_tilt_from
    const at = (x: number) => pick(live, tilted, EARLY, Color.Black, { opponentPassed: true, rng: fixed(x) });
    expect((await at(0.59)).move).toEqual(G7);
    expect((await at(0.61)).move).toEqual(C3);
  });

  it('passes when the human policy has no legal move', async () => {
    expect(await pick(new FakeEngine(policy([], 0, -1.0)))).toEqual({ handled: true, move: null });
    // nor does a zero count as a move
    expect(await pick(new FakeEngine(policy([], 0, 0)))).toEqual({ handled: true, move: null });
  });
});

describe('human net selector: points, legality and candidates', () => {
  it('keeps each point its row and column through sampling and scoring', async () => {
    let engine = new FakeEngine(policy([[G7, 1.0]]));
    expect((await pick(engine)).move).toEqual(G7);

    // scoring names each candidate by its own point
    engine = new FakeEngine(policy([[G7, 0.6], [C3, 0.4]]), { leads: { G7: 5.0, C3: -7.0 } });
    const moves = await sweep(engine, { ...PROFILE, human_tilt: 1.0 }, LATE);
    expect(keys(moves)).toEqual(new Set(['C3'])); // Black to move: C3 is the loser
    expect(new Set(engine.scored())).toEqual(new Set(['G7', 'C3', 'pass']));
  });

  it('never plays a point our rules refuse', async () => {
    const board = new Board(SIZE);
    board.tryPlay(Color.White, G7); // occupied: KataGo may not know (ko, superko)
    const engine = new FakeEngine(policy([[G7, 0.9], [C3, 0.1]]));
    expect(keys(await sweep(engine, PROFILE, EARLY, Color.Black, {}, board))).toEqual(new Set(['C3']));
  });

  it('takes as candidates the likeliest few at or above the floor', async () => {
    const points: Array<[Point, number]> = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) points.push([pt(r, c), 0.05]); // nine at 5%
    points.push([pt(8, 8), 0.03]); // at the floor: a candidate
    points.push([pt(8, 0), 0.029]); // under it: never scored
    let engine = new FakeEngine(policy(points));
    await pick(engine, PROFILE, LATE);
    let scored = engine.scored().filter((m) => m !== 'pass');
    expect(scored.length).toBe(8);
    expect(scored).not.toContain('J1');
    expect(scored).not.toContain('A1');
    engine = new FakeEngine(policy([[pt(0, 0), 0.5], [pt(8, 8), 0.03], [pt(8, 0), 0.029]]));
    await pick(engine, PROFILE, LATE);
    scored = engine.scored().filter((m) => m !== 'pass');
    expect(new Set(scored)).toEqual(new Set(['A9', 'J1']));
  });

  it('ranks candidates by probability, and falls back to the likeliest move', async () => {
    // A9 comes first on the board but last by probability
    let engine = new FakeEngine(policy([[pt(0, 0), 0.1], [pt(0, 1), 0.2], [pt(8, 8), 0.5]]));
    await pick(engine, { ...PROFILE, human_cand_max: 2 }, LATE);
    expect(new Set(engine.scored())).toEqual(new Set(['J1', 'B9', 'pass']));
    // nothing at the floor: the single likeliest move is still weighed against passing
    engine = new FakeEngine(policy([[pt(0, 0), 0.01], [pt(8, 8), 0.02]]));
    await pick(engine, PROFILE, LATE);
    expect(engine.scored().sort()).toEqual(['J1', 'pass']);
  });

  it('never picks a candidate losing more than the cap', async () => {
    const human = policy([[G7, 0.5], [C3, 0.5]]);
    const leads = { G7: 30.0, C3: 18.0, pass: 10.0 }; // C3 loses 12 against G7
    const capped = { ...PROFILE, human_tilt: 1.0, human_loss_cap: 10.0 };
    expect(keys(await sweep(new FakeEngine(human, { leads }), capped, LATE))).toEqual(new Set(['G7']));
    const uncapped = { ...PROFILE, human_tilt: 1.0 };
    expect(keys(await sweep(new FakeEngine(human, { leads }), uncapped, LATE))).toEqual(new Set(['C3']));
    // a loss right at the cap stays in
    const atCap = new FakeEngine(human, { leads: { G7: 30.0, C3: 20.0, pass: 10.0 } });
    expect(keys(await sweep(atCap, capped, LATE))).toEqual(new Set(['C3']));
    // the dropped candidate can be the human net's first choice
    const likelyLoser = new FakeEngine(policy([[G7, 0.6], [C3, 0.4]]), { leads: { G7: 18.0, C3: 30.0, pass: 10.0 } });
    expect(keys(await sweep(likelyLoser, capped, LATE))).toEqual(new Set(['C3']));
  });
});

describe('human net selector: self-atari and own eyes', () => {
  it('calls self-atari a move that leaves one liberty and takes nothing', () => {
    let board = new Board(SIZE);
    board.tryPlay(Color.White, pt(0, 1));
    expect(isSelfAtari(board, Color.Black, pt(0, 0))).toBe(true); // corner stone, one liberty left
    expect(isSelfAtari(board, Color.Black, pt(4, 4))).toBe(false); // open board
    // taking stones with the move is not self-atari, even if one liberty remains
    board = new Board(SIZE);
    board.tryPlay(Color.Black, pt(0, 2));
    board.tryPlay(Color.Black, pt(1, 1));
    board.tryPlay(Color.White, pt(0, 1)); // one liberty left: the corner
    board.tryPlay(Color.White, pt(1, 0));
    const after = board.clone();
    expect(after.tryPlay(Color.Black, pt(0, 0)).result).toBe('ok');
    expect(after.get(pt(0, 1))).toBe(Color.Empty); // it captured
    expect(after.countLiberties(after.getGroup(pt(0, 0)))).toBe(1); // and has one liberty
    expect(isSelfAtari(board, Color.Black, pt(0, 0))).toBe(false);
    // a move that cannot be played is not one: here an occupied point whose stone has one liberty
    board = new Board(SIZE);
    board.tryPlay(Color.White, pt(0, 0));
    board.tryPlay(Color.Black, pt(0, 1));
    expect(isSelfAtari(board, Color.Black, pt(0, 0))).toBe(false);
  });

  it('leaves self-atari out while anything else is on offer', async () => {
    const board = new Board(SIZE);
    board.tryPlay(Color.White, pt(0, 1));
    const engine = new FakeEngine(policy([[pt(0, 0), 0.9], [C3, 0.1]]));
    expect(keys(await sweep(engine, PROFILE, EARLY, Color.Black, {}, board))).toEqual(new Set(['C3']));
    const only = new FakeEngine(policy([[pt(0, 0), 1.0]]));
    expect((await pick(only, PROFILE, EARLY, Color.Black, {}, board)).move).toEqual(pt(0, 0));
  });

  it('leaves the fill of its own eye out while anything else is on offer', async () => {
    const board = new Board(SIZE);
    for (const p of [pt(0, 1), pt(1, 0), pt(1, 1)]) board.tryPlay(Color.Black, p); // an eye at A9
    const engine = new FakeEngine(policy([[pt(0, 0), 0.9], [C3, 0.1]]));
    expect(keys(await sweep(engine, PROFILE, EARLY, Color.Black, {}, board))).toEqual(new Set(['C3']));
    const only = new FakeEngine(policy([[pt(0, 0), 1.0]]));
    expect((await pick(only, PROFILE, EARLY, Color.Black, {}, board)).move).toEqual(pt(0, 0));
  });
});

describe('human net selector: evalOut', () => {
  it('carries the root lead and the scored candidates', async () => {
    const engine = new FakeEngine(policy([[C7, 0.6], [G3, 0.4]]), {
      leads: { C7: 5.0, G3: -7.0 },
      winrates: { C7: 0.8, G3: 0.3 },
    });
    const out: HumanNetEval = { scoreLeadBefore: null, candidates: null };
    await pick(engine, PROFILE, LATE, Color.Black, { evalOut: out });
    expect(out.scoreLeadBefore).toBe(1.5);
    expect(out.candidates).toEqual([
      { move: C7, visits: 4, winrate: 0.8, scoreLead: 5.0, prior: 0.6, order: 0 },
      { move: G3, visits: 4, winrate: 0.3, scoreLead: -7.0, prior: 0.4, order: 1 },
    ]);
  });

  it('keeps the first root lead', async () => {
    const out: HumanNetEval = { scoreLeadBefore: -3.0, candidates: null };
    await pick(new FakeEngine(policy([[G7, 1.0]])), PROFILE, EARLY, Color.Black, { evalOut: out });
    expect(out.scoreLeadBefore).toBe(-3.0);
    // a sampled move scored nothing
    expect(out.candidates).toEqual([]);
  });
});

describe('human net selector: the last small endgame moves', () => {
  const ENDGAME: HumanNetProfile = {
    ...PROFILE,
    human_pass_margin: 1.0,
    human_small_gain: 2.0,
    human_confirm_visits: 12,
    human_confirm_margin: 0.75,
  };

  it('reads a small gain again and plays it straight when it holds', async () => {
    const human = policy([[G7, 0.7], [C3, 0.3]]);
    // at 4 visits C3 gains 1.5 over a pass and G7 gains 0.5; at 12 visits C3 still gains 1.2
    const engine = new FakeEngine(human, {
      leads: { G7: 10.5, C3: 11.5, pass: 10.0 },
      deepLeads: { C3: 11.2, pass: 10.0 },
    });
    const moves = await sweep(engine, { ...ENDGAME, human_tilt: 1.0 }, LATE);
    expect(keys(moves)).toEqual(new Set(['C3'])); // the best move, not the lean's pick
    expect([...new Set(engine.scored(12))].sort()).toEqual(['C3', 'pass']);
  });

  it('passes on a small gain that does not hold', async () => {
    const human = policy([[G7, 0.7], [C3, 0.3]]);
    let engine = new FakeEngine(human, {
      leads: { G7: 10.5, C3: 11.5, pass: 10.0 },
      deepLeads: { C3: 10.5, pass: 10.0 },
    });
    expect(await pick(engine, ENDGAME, LATE)).toEqual({ handled: true, move: null });
    // exactly at the confirm margin it plays
    engine = new FakeEngine(human, {
      leads: { G7: 10.5, C3: 11.5, pass: 10.0 },
      deepLeads: { C3: 10.75, pass: 10.0 },
    });
    expect(await pick(engine, ENDGAME, LATE)).toEqual({ handled: true, move: C3 });
  });

  it('does not read a clear gain again', async () => {
    const human = policy([[G7, 0.7], [C3, 0.3]]);
    let engine = new FakeEngine(human, { leads: { G7: 14.0, C3: 12.0, pass: 10.0 } });
    const played = await pick(engine, ENDGAME, LATE);
    expect(played.handled && played.move !== null).toBe(true);
    expect(engine.scored(12)).toEqual([]);
    // a gain of exactly human_small_gain is already clear
    engine = new FakeEngine(human, { leads: { G7: 12.0, C3: 11.0, pass: 10.0 } });
    expect((await pick(engine, ENDGAME, LATE)).move).not.toBeNull();
    expect(engine.scored(12)).toEqual([]);
    // nor a gain under the pass margin: that is a pass at once
    engine = new FakeEngine(human, { leads: { G7: 10.9, C3: 10.2, pass: 10.0 } });
    expect(await pick(engine, ENDGAME, LATE)).toEqual({ handled: true, move: null });
    expect(engine.scored(12)).toEqual([]);
  });

  it("takes the second look from the mover's side", async () => {
    const human = policy([[G7, 1.0]]);
    // White: -11.5 after the move against -10 after a pass is a gain of 1.5; deeper, 1.0
    let engine = new FakeEngine(human, {
      leads: { G7: -11.5, pass: -10.0 },
      deepLeads: { G7: -11.0, pass: -10.0 },
    });
    expect(await pick(engine, ENDGAME, LATE + 1, Color.White)).toEqual({ handled: true, move: G7 });
    engine = new FakeEngine(human, {
      leads: { G7: -11.5, pass: -10.0 },
      deepLeads: { G7: -9.0, pass: -10.0 },
    });
    expect(await pick(engine, ENDGAME, LATE + 1, Color.White)).toEqual({ handled: true, move: null });
  });
});

describe("human net selector: the Python's defaults", () => {
  const BARE: HumanNetProfile = { human_sl_profile: 'rank_20k' };

  it('does not lean without human_tilt', async () => {
    const engine = new FakeEngine(policy([[C7, 0.6], [G3, 0.4]]), { leads: { C7: 5.0, G3: -7.0 } });
    await pick(engine, BARE, LATE);
    expect(engine.scored()).toEqual([]);
  });

  it('leans from move 12, scoring at 4 visits, likeliest 8 at 3% or more', async () => {
    const tilted = { ...BARE, human_tilt: 1.0 };
    let engine = new FakeEngine(policy([[C7, 0.6], [G3, 0.4]]), { leads: { C7: 5.0, G3: -7.0 } });
    await pick(engine, tilted, 11);
    expect(engine.scored()).toEqual([]);
    await pick(engine, tilted, 12);
    expect(new Set(engine.scored(4))).toEqual(new Set(['C7', 'G3', 'pass']));
    expect(engine.scored().length).toBe(3);

    const points: Array<[Point, number]> = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) points.push([pt(r, c), 0.05]);
    points.push([pt(8, 8), 0.03]);
    engine = new FakeEngine(policy(points));
    await pick(engine, tilted, LATE);
    expect(engine.scored().filter((m) => m !== 'pass').length).toBe(8);
    engine = new FakeEngine(policy([[pt(0, 0), 0.5], [pt(8, 8), 0.03], [pt(8, 0), 0.029]]));
    await pick(engine, tilted, LATE);
    expect(new Set(engine.scored())).toEqual(new Set(['A9', 'J1', 'pass']));
  });

  it('passes under a 0.75-point gain and plays at it', async () => {
    const human = policy([[G7, 1.0]]);
    const tilted = { ...BARE, human_tilt: 1.0 };
    expect(await pick(new FakeEngine(human, { leads: { G7: 20.74, pass: 20.0 } }), tilted, LATE)).toEqual({
      handled: true,
      move: null,
    });
    expect(await pick(new FakeEngine(human, { leads: { G7: 20.75, pass: 20.0 } }), tilted, LATE)).toEqual({
      handled: true,
      move: G7,
    });
  });

  it('reads a small gain again at 12 visits against the pass margin', async () => {
    const human = policy([[C3, 1.0]]);
    const profile = { ...BARE, human_tilt: 1.0, human_pass_margin: 1.0, human_small_gain: 2.0 };
    const leads = { C3: 11.5, pass: 10.0 };
    let engine = new FakeEngine(human, { leads, deepLeads: { C3: 10.9, pass: 10.0 } });
    expect(await pick(engine, profile, LATE)).toEqual({ handled: true, move: null });
    expect(engine.scored(12).sort()).toEqual(['C3', 'pass']);
    engine = new FakeEngine(human, { leads, deepLeads: { C3: 11.0, pass: 10.0 } });
    expect(await pick(engine, profile, LATE)).toEqual({ handled: true, move: C3 });
  });

  it("reads whole-number knobs as Python's int() does", async () => {
    const profile = {
      ...PROFILE,
      human_tilt: 1.0,
      human_tilt_from: 12.9,
      human_score_visits: 4.9,
      human_pass_margin: 1.0,
      human_small_gain: 2.0,
      human_confirm_visits: 12.9,
    };
    const engine = new FakeEngine(policy([[C3, 1.0]]), {
      leads: { C3: 11.5, pass: 10.0 },
      deepLeads: { C3: 11.2, pass: 10.0 },
    });
    expect(await pick(engine, profile, 12)).toEqual({ handled: true, move: C3 });
    expect(engine.calls.filter((c) => c.kind === 'after').map((c) => c.visits)).toEqual([4, 4, 12, 12]);
  });
});

/**
 * The lean at a negative or infinite `human_tilt`, ported from
 * backend/tests/test_human_net_tilt.py (one test here per test there, same
 * scenarios and numbers): past `human_tilt_from` the candidates are scored
 * as for a positive tilt, and a negative tilt leans toward the candidates
 * that lose less. A tilt of 0, or none, keeps the unscored path.
 */
describe('human net selector: a negative tilt leans toward the better candidates', () => {
  it('scores past tilt_from and picks the better move', async () => {
    // G3 is the human net's first choice and loses 12 against C7.
    const engine = new FakeEngine(policy([[C7, 0.4], [G3, 0.6]]), { leads: { C7: 5.0, G3: -7.0 } });
    expect(keys(await sweep(engine, { ...PROFILE, human_tilt: -0.25 }, LATE))).toEqual(new Set(['C7']));
    expect(new Set(engine.scored())).toEqual(new Set(['C7', 'G3', 'pass']));
  });

  it('gives the better candidate more than its probability', async () => {
    // G7 (p 0.7) loses 6 against C3 (p 0.3)
    const engine = new FakeEngine(policy([[G7, 0.7], [C3, 0.3]]), { leads: { G7: 4.0, C3: 10.0 } });
    const worse = 0.7 * Math.exp(6.0 / -4.0);
    await expectWeights(engine, { ...PROFILE, human_tilt: -4.0 }, LATE, [
      [G7, worse],
      [C3, 0.3],
    ]);
    expect(0.3 / (0.3 + worse)).toBeGreaterThan(0.3);
  });

  it('lets the weight fall with the loss past fifteen points', async () => {
    // equal probabilities; losses 0, 5, 14, 20, 40 in the candidates' order
    const human = policy([[C7, 0.2], [G7, 0.2], [E5, 0.2], [C3, 0.2], [G3, 0.2]]);
    const leads = { C7: 40.0, G7: 35.0, E5: 26.0, C3: 20.0, G3: 0.0, pass: 0.0 };
    const w = [0, 5, 14, 20, 40].map((loss) => 0.2 * Math.exp(loss / -8.0)); // no 15-point cap on this side
    expect(w.every((x, i) => i === 0 || w[i - 1] > x)).toBe(true);
    await expectWeights(new FakeEngine(human, { leads }), { ...PROFILE, human_tilt: -8.0 }, LATE, [
      [C7, w[0]],
      [G7, w[1]],
      [E5, w[2]],
      [C3, w[3]],
      [G3, w[4]],
    ]);
  });

  it('keeps the weights finite at extreme losses', async () => {
    const human = policy([[C7, 0.5], [G7, 0.3], [C3, 0.2]]);
    // an infinite loss (the leads' difference overflows) and a huge one, at a moderate and a tiny tilt
    const leads = { C7: 1e308, G7: -1e308, C3: -1e300, pass: -1e308 };
    for (const tilt of [-2.0, -1e-300]) {
      const profile = { ...PROFILE, human_tilt: tilt };
      await expectWeights(new FakeEngine(human, { leads }), profile, LATE, [
        [C7, 0.5],
        [G7, 0],
        [C3, 0],
      ]);
      expect(keys(await sweep(new FakeEngine(human, { leads }), profile, LATE))).toEqual(new Set(['C7']));
    }
  });

  it('keeps the loss cap, the pass check and the self-atari filter', async () => {
    const capped = { ...PROFILE, human_tilt: -4.0, human_loss_cap: 10.0 };
    // E5 loses 12: over the cap, dropped before the lean
    let engine = new FakeEngine(policy([[C7, 0.4], [G7, 0.35], [E5, 0.25]]), {
      leads: { C7: 20.0, G7: 15.0, E5: 8.0 },
    });
    await expectWeights(engine, capped, LATE, [
      [C7, 0.4],
      [G7, 0.35 * Math.exp(5.0 / -4.0)],
    ]);
    // nothing gains over passing: a pass
    engine = new FakeEngine(policy([[C7, 0.6], [G7, 0.4]]), { leads: { C7: 20.0, G7: 19.5, pass: 20.0 } });
    expect(await pick(engine, capped, LATE)).toEqual({ handled: true, move: null });
    // a self-atari is never a candidate
    const board = new Board(SIZE);
    board.tryPlay(Color.White, pt(0, 1));
    engine = new FakeEngine(policy([[pt(0, 0), 0.9], [C3, 0.1]]), { leads: { C3: 5.0 } });
    expect((await pick(engine, capped, LATE, Color.Black, {}, board)).move).toEqual(C3);
    expect(new Set(engine.scored())).toEqual(new Set(['C3', 'pass']));
  });

  it('gets the second look on a small gain', async () => {
    const endgame: HumanNetProfile = {
      ...PROFILE,
      human_tilt: -4.0,
      human_pass_margin: 1.0,
      human_small_gain: 2.0,
      human_confirm_visits: 12,
      human_confirm_margin: 0.75,
    };
    const human = policy([[G7, 0.7], [C3, 0.3]]);
    const leads = { G7: 10.5, C3: 11.5, pass: 10.0 };
    const held = new FakeEngine(human, { leads, deepLeads: { C3: 11.2, pass: 10.0 } });
    expect(await pick(held, endgame, LATE)).toEqual({ handled: true, move: C3 });
    expect(new Set(held.scored(12))).toEqual(new Set(['C3', 'pass']));
    const faded = new FakeEngine(human, { leads, deepLeads: { C3: 10.5, pass: 10.0 } });
    expect(await pick(faded, endgame, LATE)).toEqual({ handled: true, move: null });
  });

  it("reads the loss from White's side", async () => {
    // For White a Black-perspective lead of -7 after G3 is the better result.
    const engine = new FakeEngine(policy([[C7, 0.6], [G3, 0.4]]), { leads: { C7: 5.0, G3: -7.0 } });
    const moves = await sweep(engine, { ...PROFILE, human_tilt: -0.25 }, LATE + 1, Color.White);
    expect(keys(moves)).toEqual(new Set(['G3']));
  });
});

describe('human net selector: an infinite tilt scores with no lean', () => {
  it('samples by probability among the kept candidates, either sign', async () => {
    const leads = { C7: 20.0, G7: 15.0, E5: 8.0 }; // E5 loses 12: over the cap
    for (const tilt of [Infinity, -Infinity]) {
      const engine = new FakeEngine(policy([[C7, 0.4], [G7, 0.35], [E5, 0.25]]), { leads });
      await expectWeights(engine, { ...PROFILE, human_tilt: tilt, human_loss_cap: 10.0 }, LATE, [
        [C7, 0.4],
        [G7, 0.35],
      ]);
      expect(new Set(engine.scored())).toEqual(new Set(['C7', 'G7', 'E5', 'pass']));
    }
  });
});

describe('human net selector: where the tilt starts and stops', () => {
  it('does not score before tilt_from, whatever the tilt', async () => {
    for (const tilt of [-0.25, -8.0, 0.0, -Infinity]) {
      const engine = new FakeEngine(policy([[C7, 0.6], [G3, 0.4]]), { leads: { C7: 5.0, G3: -7.0 } });
      await sweep(engine, { ...PROFILE, human_tilt: tilt }, EARLY);
      expect(engine.calls.every((c) => c.kind === 'human')).toBe(true);
    }
  });

  it('stays unscored past tilt_from at a zero tilt or with no tilt', async () => {
    const noTilt: HumanNetProfile = { ...PROFILE };
    delete noTilt.human_tilt;
    for (const profile of [{ ...PROFILE, human_tilt: 0 }, { ...PROFILE, human_tilt: -0 }, noTilt]) {
      const engine = new FakeEngine(policy([[C7, 0.6], [G3, 0.4]]), { leads: { C7: 5.0, G3: -7.0 } });
      expect(keys(await sweep(engine, profile, LATE))).toEqual(new Set(['C7', 'G3']));
      expect(engine.calls.every((c) => c.kind === 'human')).toBe(true);
    }
  });

  it("does not lean after the opponent's pass in the opening, and does past tilt_from", async () => {
    const engine = new FakeEngine(policy([[G7, 0.6], [C3, 0.4]]), { leads: { G7: 1.0, C3: 6.0 } });
    const leaning = { ...PROFILE, human_tilt: -1.0 };
    const passed = { opponentPassed: true };
    await expectWeights(engine, leaning, EARLY, [[G7, 0.6], [C3, 0.4]], passed);
    // past tilt_from the same pass does lean
    await expectWeights(engine, leaning, LATE, [[G7, 0.6 * Math.exp(5.0 / -1.0)], [C3, 0.4]], passed);
  });
});

describe('human net selector: the locked 18k', () => {
  /** The cloud 9×9 18k, read from b20.yaml as the Python test reads it. */
  const locked18k = (): HumanNetProfile =>
    (b20Yaml as { profiles: Record<string, Record<string, HumanNetProfile>> }).profiles['9x9']['18k'];

  it('keeps its positive lean', async () => {
    const profile = locked18k();
    expect(profile.human_tilt).toBe(8.0);
    // losses 0, 4, 9 kept; 12 over the 18k's cap of 10; best gains 10 over a pass (no second look)
    const human = policy([[C7, 0.4], [G7, 0.3], [E5, 0.2], [C3, 0.1]]);
    const leads = { C7: 10.0, G7: 6.0, E5: 1.0, C3: -2.0, pass: 0.0 };
    await expectWeights(new FakeEngine(human, { leads }), profile, LATE, [
      [C7, 0.4 * Math.exp(0.0 / 8.0)],
      [G7, 0.3 * Math.exp(4.0 / 8.0)],
      [E5, 0.2 * Math.exp(9.0 / 8.0)],
    ]);
    // a loss past 15 still counts as 15 (no cap on the profile here)
    const uncapped: HumanNetProfile = { ...profile };
    delete uncapped.human_loss_cap;
    const engine = new FakeEngine(policy([[C7, 0.5], [G7, 0.5]]), { leads: { C7: 40.0, G7: 0.0, pass: 0.0 } });
    await expectWeights(engine, uncapped, LATE, [
      [C7, 0.5],
      [G7, 0.5 * Math.exp(15.0 / 8.0)],
    ]);
  });
});
