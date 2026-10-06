import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  boardFromGrid,
  selectAiMove,
  _resetReadCooldowns,
  _setRandomSource,
  type MoveCandidate,
  type PositionAnalysis,
} from '../moveSelector';
import { Board } from '../../engine/Board';
import { Color, MoveResult, type Point, type Stone } from '../../engine/types';
import { getProfile, type RankProfile } from '../profileLoader';

/**
 * The standard selector's score comparisons, from the mover's side (ported
 * from backend/tests/test_standard_mover_side.py). Every lead the engine
 * reports is Black's, so a gap between two candidates is the mover's only
 * after the sign (+1 Black, -1 White): the pass check, the clarity gate's
 * score gap and the worse-than-pass filter.
 */

const holder = vi.hoisted(() => ({ profile: null as RankProfile | null }));
vi.mock('../profileLoader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../profileLoader')>();
  return { ...actual, getProfile: (rank: string, size: number) => holder.profile ?? actual.getProfile(rank, size) };
});

const SIZE = 9;

// A standard rung with every random branch closed unless a test opens one.
const BASE: RankProfile = {
  max_point_loss: 30,
  mistake_freq: 0,
  policy_weight: 1,
  randomness: 0,
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

/** A seeded uniform source (mulberry32). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PASS = { row: -1, col: -1 };
const cand = (move: Point, prior: number, scoreLead: number, visits = 20, order = 0): MoveCandidate => ({
  move, visits, winrate: 0.5, scoreLead, prior, order,
});
const at = (row: number, col: number): Point => ({ row, col });
const gtpPoint = (g: string): Point =>
  g === 'pass' ? PASS : { row: SIZE - Number(g.slice(1)), col: 'ABCDEFGHJ'.indexOf(g[0]) };

function analyzer(cands: MoveCandidate[]) {
  return async (): Promise<PositionAnalysis> => ({ rootVisits: 100, candidates: cands.map((c) => ({ ...c })) });
}

async function select(
  profile: RankProfile,
  cands: MoveCandidate[],
  color: Stone,
  board: Board = new Board(SIZE),
  opponentPassed = false,
  last: Point | null = null,
) {
  holder.profile = profile;
  _resetReadCooldowns();
  return selectAiMove(board, color, '9k', last, analyzer(cands), { opponentPassed });
}

afterEach(() => {
  holder.profile = null;
  _setRandomSource(null);
  _resetReadCooldowns();
});

// Two wrongful White settle passes from recorded 9x9 games (the standard 9k
// White, komi 6.5, after Black's pass): the engine's answers at the settle
// query (100 visits), as (move, visits, prior, Black-side lead).
const REAL: Record<string, [string, Array<[string, number, number, number]>, string]> = {
  '12-point': [
    'F5 E5 F4 E6 D3 C4 F6 E7 F7 D4 C3 F3 E2 E3 F2 G3 E4 G4 F8 G2 B3 B4 D8 E8 C6 ' +
      'F9 G9 E9 H8 G7 G6 H7 H6 H5 D5',
    [['J6', 35, 0.4382, 29.45], ['A3', 10, 0.0894, 30.42], ['C8', 9, 0.099, 32.37],
      ['D7', 7, 0.052, 31.6], ['F1', 7, 0.0464, 29.79], ['D2', 6, 0.0453, 30.72],
      ['A4', 8, 0.0245, 29.86], ['B2', 6, 0.034, 31.89], ['pass', 4, 0.0575, 41.22],
      ['B6', 2, 0.0182, 30.65], ['J8', 3, 0.0253, 37.27], ['A2', 2, 0.0118, 32.15]],
    'J6',
  ],
  '1-point': [
    'G7 F4 E5 G5 C3 D7 F3 E4 E3 C4 D4 F6 F5 G4 C5 D3 D2 E6 D5 H7 G6 H6 F8 G8 F7 ' +
      'F9 E9 H8 G9 D8 D6 E7 G3 B8 H4 H5 C7 B7 C8 C9 C6 D9 B6 B9 A7 H3 A8 H9 A6 F9 ' +
      'H2 G9 J3',
    [['J5', 67, 0.6844, 7.22], ['E8', 11, 0.0985, 8.23], ['J6', 6, 0.0528, 8.19],
      ['pass', 6, 0.039, 8.23], ['J2', 7, 0.0309, 7.82], ['J4', 2, 0.0113, 8.88]],
    'J5',
  ],
};

function replay(history: string): Board {
  const board = new Board(SIZE);
  history.split(' ').forEach((g, i) => {
    expect(board.tryPlay(i % 2 === 0 ? Color.Black : Color.White, gtpPoint(g)).result).toBe(MoveResult.Ok);
  });
  return board;
}

describe("the standard selector's comparisons, from the mover's side", () => {
  for (const [name, [history, rows, top]] of Object.entries(REAL)) {
    it(`real ${name} settle position: White plays on where its top move gains on the pass`, async () => {
      const cands = rows.map(([g, v, p, s], j) => cand(gtpPoint(g), p, s, v, j));
      const move = await select(BASE, cands, Color.White, replay(history), true);
      expect(move).toEqual(gtpPoint(top));
    });
  }

  it('pass check: White passes when the pass is better for White', async () => {
    // Black-side leads: top 5.0, pass 3.0 -> the pass is 2 points better for White.
    const cands = [cand(at(4, 4), 0.5, 5.0, 60), cand(PASS, 0.1, 3.0, 30)];
    for (let i = 0; i < 5; i++) expect(await select(BASE, cands, Color.White, undefined, true)).toBeNull();
  });

  it('pass check: White plays on when its move beats the pass', async () => {
    const cands = [cand(at(4, 4), 0.5, 3.0, 60), cand(PASS, 0.1, 5.0, 30)];
    for (let i = 0; i < 5; i++) expect(await select(BASE, cands, Color.White, undefined, true)).toEqual(at(4, 4));
  });

  it("clarity gate: White's forced move is played", async () => {
    // White's top is 10 points better for White than the next move: forced.
    // With the gate shut the profile plays a random legal move.
    const profile = { ...BASE, clarity_score_gap: 5.0, random_move_chance: 1.0 };
    const cands = [cand(at(2, 2), 0.3, -10.0, 40), cand(at(6, 6), 0.3, 0.0, 30), cand(at(2, 6), 0.2, 0.5, 20)];
    _setRandomSource({ random: seeded(7) });
    const picks = [];
    for (let i = 0; i < 20; i++) picks.push(await select(profile, cands, Color.White));
    expect(picks).toEqual(new Array(20).fill(at(2, 2)));
  });

  it('clarity gate: does not fire on a top move 10 points worse for White', async () => {
    const profile = { ...BASE, clarity_score_gap: 5.0, random_move_chance: 1.0 };
    const cands = [cand(at(2, 2), 0.3, 10.0, 40), cand(at(6, 6), 0.3, 0.0, 30), cand(at(2, 6), 0.2, 0.5, 20)];
    _setRandomSource({ random: seeded(7) });
    const picks = [];
    for (let i = 0; i < 20; i++) picks.push(await select(profile, cands, Color.White));
    expect(picks).not.toEqual(new Array(20).fill(at(2, 2)));
  });

  it('worse-than-pass filter: White never picks a move worse than its pass', async () => {
    // For White: (2,2) gains 4 on the pass, (6,6) gains 2, (2,6) loses 5.
    const profile = { ...BASE, mistake_freq: 1.0, policy_weight: 0.0, randomness: 1.0 };
    const cands = [
      cand(at(2, 2), 0.4, -6.0, 40), cand(PASS, 0.1, -2.0, 30),
      cand(at(6, 6), 0.2, -4.0, 20), cand(at(2, 6), 0.3, 3.0, 20),
    ];
    _setRandomSource({ random: seeded(11) });
    const picks: Array<Point | null> = [];
    for (let i = 0; i < 40; i++) picks.push(await select(profile, cands, Color.White));
    expect(picks).not.toContain(null);
    expect(picks).not.toContainEqual(at(2, 6));
    expect(picks).toContainEqual(at(2, 2));
    expect(picks).toContainEqual(at(6, 6));
  });
});

// Property: colour symmetry. A generated position, engine answer and profile,
// decided for Black, then for the colour-swapped mirror (stones swapped, leads
// negated, the bot White), on the same random draws: the decision must be the
// same. score_noise is left out: pickNoisyBest maximises Black's lead in both
// selectors (a dormant asymmetry no live rung reaches).

const LIVE_9X9 = ['18k', '15k', '12k', '9k', '6k', '3k', '1d'];

function genProfile(rng: () => number): RankProfile {
  const pick = <T>(xs: T[]): T => xs[Math.floor(rng() * xs.length)];
  const uni = (lo: number, hi: number) => lo + (hi - lo) * rng();
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  holder.profile = null; // the live rung, through the mock
  const p: RankProfile = { ...getProfile(pick(LIVE_9X9), SIZE) };
  delete p.score_noise;
  p.clarity_score_gap = pick([uni(0.5, 25.0), 999.0]);
  p.clarity_prior = pick([uni(0.2, 1.0), 1.1]);
  p.pass_threshold = pick([0.1, 0.3, uni(0.0, 2.0)]);
  p.opening_moves = int(0, 8);
  p.random_move_chance = pick([0.0, uni(0.0, 0.3)]);
  p.local_bias = pick([0.0, uni(0.0, 1.0)]);
  p.local_bias_in_opening = rng() < 0.5;
  p.local_bias_from_candidates = rng() < 0.5;
  p.mistake_freq = uni(0.0, 1.0);
  p.max_point_loss = uni(1.0, 30.0);
  p.min_candidates = int(1, 12);
  if (rng() < 0.5) {
    p.reading_rate = uni(0.0, 1.0);
    p.read_cooldown = int(0, 2);
    p.sample_loss_cap = rng() < 0.5 ? uni(0.5, 10.0) : undefined;
    p.sample_min_loss = rng() < 0.5 ? uni(0.0, 3.0) : undefined;
  } else {
    delete p.reading_rate;
  }
  return p;
}

interface MirrorCase {
  seq: Array<[Stone, Point]>;
  cands: Array<[Point, number, number, number]>; // move, prior, Black-side lead, visits
  profile: RankProfile;
  opponentPassed: boolean;
  last: number | null;
}

function genCase(rng: () => number): MirrorCase {
  const pick = <T>(xs: T[]): T => xs[Math.floor(rng() * xs.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  const board = new Board(SIZE);
  const seq: Array<[Stone, Point]> = [];
  for (let k = pick([0, 3, 10, 25, 45, 60]); k > 0; k--) {
    const color = rng() < 0.5 ? Color.Black : Color.White;
    const p = at(int(0, SIZE - 1), int(0, SIZE - 1));
    if (board.tryPlay(color, p).result === MoveResult.Ok) seq.push([color, p]);
  }
  const empty: Point[] = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (board.get(at(r, c)) === Color.Empty) empty.push(at(r, c));
  const n = empty.length ? int(1, Math.min(12, empty.length)) : 0;
  const base = -40 + 80 * rng();
  const spread = pick([0.2, 1.0, 4.0, 12.0]);
  const pool = [...empty];
  const cands: MirrorCase['cands'] = [];
  for (let k = 0; k < n; k++) {
    const p = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    cands.push([p, rng(), base + gauss() * spread, int(1, 80)]);
  }
  if (rng() < 0.7 || cands.length === 0) {
    cands.splice(int(0, cands.length), 0, [PASS, rng() * 0.2, base + gauss() * spread, int(0, 40)]);
  }
  const last = seq.length && rng() < 0.7 ? int(0, seq.length - 1) : null;
  return { seq, cands, profile: genProfile(rng), opponentPassed: rng() < 0.4, last };
}

async function decide(c: MirrorCase, mirror: boolean, seed: number): Promise<Point | null> {
  const swap = (s: Stone): Stone => (s === Color.Black ? Color.White : Color.Black);
  const grid = Array.from({ length: SIZE }, () => new Array<number>(SIZE).fill(0));
  const board = boardFromGrid(grid, SIZE);
  for (const [color, p] of c.seq) expect(board.tryPlay(mirror ? swap(color) : color, p).result).toBe(MoveResult.Ok);
  const sign = mirror ? -1 : 1;
  const cands = c.cands.map(([m, pr, lead, v], j) => cand(m, pr, sign * lead, v, j));
  _setRandomSource({ random: seeded(seed) });
  try {
    return await select(c.profile, cands, mirror ? Color.White : Color.Black, board, c.opponentPassed,
      c.last === null ? null : c.seq[c.last][1]);
  } finally {
    _setRandomSource(null);
  }
}

describe('colour symmetry of the standard selector', () => {
  it('a colour-swapped mirror gets the same decision as Black', async () => {
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const rng = seeded(20261005);
      const bad: string[] = [];
      for (let i = 0; i < 400; i++) {
        const c = genCase(rng);
        const asBlack = await decide(c, false, 1000 + i);
        const asWhite = await decide(c, true, 1000 + i);
        if (JSON.stringify(asBlack) !== JSON.stringify(asWhite)) {
          bad.push(`case ${i}: Black ${JSON.stringify(asBlack)}, mirrored White ${JSON.stringify(asWhite)}`);
        }
      }
      expect(bad.slice(0, 5)).toEqual([]);
    } finally {
      quiet.mockRestore();
    }
  });
});
