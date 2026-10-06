/**
 * Selector parity, the TypeScript side: the cases in data/selector_parity/,
 * recorded from the Python selectors (backend/app/ai/move_selector.py, the
 * spec), replayed here against moveSelector.ts and humanNetSelector.ts. Each
 * case gives both sides the same profile knobs, position, engine answers and
 * random draws; the TypeScript must pick the Python's move, ask the engine
 * the same questions, and consume exactly the same draws.
 *
 * Divergence is a bug: change one selector, port the other, regenerate
 * (data/selector_parity/generate.py), both suites green. The standard path's
 * known disagreements are pinned case by case in
 * data/selector_parity/expected_failures.json, by class, each class with its
 * reason and an expected failure (it.fails) here. A disagreement outside its
 * list fails, and so does a listed case that starts agreeing; closing one
 * changes how a device rung plays, so it is the maintainer's call. After a
 * deliberate change, SELECTOR_PARITY_WRITE=1 rewrites the lists of the classes
 * already in the file (never an unexplained disagreement), and the file's diff
 * is the review.
 *
 * The engine's answers are fed in the order recorded, and each request must
 * match: on the standard path the analysis, then (when it is about to pass)
 * the border check's ownership read and its scoring queries.
 *
 * How the draws are fed (backend/tests/selector_parity_harness.py has the
 * Python half): `u` is one uniform per Math.random() call (the injected
 * RandomSource's `random`); `g` is one standard normal per gaussian() call
 * (its `gaussian`). Python's random.gauss caches the second normal of each
 * pair and the TypeScript's Box-Muller drops it, so the cases record normals,
 * not the uniforms behind them.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Color, type Point, type Stone } from '../../engine/types';
import {
  boardFromGrid,
  selectAiMove,
  _resetReadCooldowns,
  _setRandomSource,
  _setReadCooldown,
  type AnalyzeOpts,
  type BorderEngine,
  type PositionAnalysis,
} from '../moveSelector';
import { selectWithHumanNet, type HumanNetEngine, type HumanNetProfile } from '../humanNetSelector';
import type { RankProfile } from '../profileLoader';

// selectAiMove looks its rung up by name; here it gets the case's knobs.
const mocked = vi.hoisted(() => ({ profile: null as RankProfile | null }));
vi.mock('../profileLoader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../profileLoader')>();
  return {
    ...actual,
    getProfile: (rank: string, size: number) => mocked.profile ?? actual.getProfile(rank, size),
  };
});

type Pick = [number, number] | null;
interface Answer {
  kind: string;
  [key: string]: unknown;
}
interface BaseCase {
  id: string;
  rung: string;
  variant: string;
  profile: Record<string, unknown>;
  size: number;
  board: string;
  color: 'B' | 'W';
  komi: number;
  opponent_passed: boolean;
  scenario: string;
  answers: Answer[];
  u: number[];
  pick: Pick;
}
interface StandardCase extends BaseCase {
  stones: number;
  last_opp: [number, number] | null;
  cooldown: number;
  g: number[];
  trace: string[];
}
interface HumanCase extends BaseCase {
  moves_played: number;
  handled: boolean;
}

const OWN_LEVELS = [-1.0, -0.6, -0.3, -0.1, 0.0, 0.1, 0.3, 0.6, 1.0];

function load<T>(name: string): T[] {
  const url = new URL(`../../../../data/selector_parity/${name}.json.gz`, import.meta.url);
  return JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(url)))).cases as T[];
}

function profileOf(c: BaseCase): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c.profile)) {
    out[k] = v === 'Infinity' ? Infinity : v === '-Infinity' ? -Infinity : v;
  }
  return out;
}

function boardOf(c: BaseCase) {
  const grid: number[][] = [];
  for (let r = 0; r < c.size; r++) {
    grid.push(
      [...c.board.slice(r * c.size, (r + 1) * c.size)].map((ch) =>
        ch === 'X' ? Color.Black : ch === 'O' ? Color.White : Color.Empty,
      ),
    );
  }
  return boardFromGrid(grid, c.size);
}

const colorOf = (c: BaseCase): Stone => (c.color === 'B' ? Color.Black : Color.White);
const pickOf = (p: Point | null): Pick => (p ? [p.row, p.col] : null);
const gtp = (p: Point, size: number) => `${'ABCDEFGHJKLMNOPQRST'[p.col]}${size - p.row}`;

/** Recorded draws, in order; past the end it returns a spare and counts it. */
class Feed {
  used = 0;
  overrun = 0;
  constructor(private readonly values: number[]) {}
  next = (): number => {
    if (this.used >= this.values.length) {
      this.overrun += 1;
      return 0.5;
    }
    return this.values[this.used++];
  };
  get exact(): boolean {
    return this.used === this.values.length && this.overrun === 0;
  }
}

interface Outcome {
  id: string;
  label: string;
  ok: boolean;
  problems: string[];
}

/** The case's recorded answers, in order; a request that differs from the
 *  recorded one (or runs past them) is a problem, and throws. */
function answerFeed(c: BaseCase, problems: string[]) {
  let asked = 0;
  const next = (kind: string, req: Record<string, unknown>): Answer => {
    const a = c.answers[asked];
    const want = a ? Object.fromEntries(Object.keys(req).map((k) => [k, a[k]])) : null;
    if (!a || a.kind !== kind || JSON.stringify(want) !== JSON.stringify(req)) {
      problems.push(`asked ${kind} ${JSON.stringify(req)}, recorded ${a ? `${a.kind} ${JSON.stringify(want)}` : 'nothing'}`);
      throw new Error('answer mismatch');
    }
    asked += 1;
    return a;
  };
  return { next, asked: () => asked };
}

const ownershipOf = (a: Answer) => [...(a.own as string)].map((ch) => OWN_LEVELS[Number(ch)]);

async function runStandard(c: StandardCase): Promise<Outcome & { cls: string; ts: Pick }> {
  const color = colorOf(c);
  const u = new Feed(c.u);
  const g = new Feed(c.g);
  const problems: string[] = [];
  const feed = answerFeed(c, problems);
  const analyze = async (visits: number, opts?: AnalyzeOpts): Promise<PositionAnalysis> => {
    const a = feed.next('analysis', { visits, wrn: opts?.wideRootNoise ?? null });
    const rows = a.cands as [number, number, number, number, number, number][];
    return {
      rootVisits: 0,
      candidates: rows.map(([row, col, v, w, s, p], order) => ({
        move: { row, col }, visits: v, winrate: w, scoreLead: s, prior: p, order,
      })),
    };
  };
  const border: BorderEngine = {
    ownership: async () => ownershipOf(feed.next('ownership', {})),
    scoreAfter: async (move, visits) => {
      const a = feed.next('score', { move: move === 'pass' ? 'pass' : gtp(move, c.size), visits });
      return { scoreLead: a.lead as number, winrate: 0.5 };
    },
  };
  mocked.profile = profileOf(c) as unknown as RankProfile;
  _setRandomSource({ random: u.next, gaussian: g.next });
  _resetReadCooldowns();
  if (c.cooldown) _setReadCooldown(color, c.cooldown);
  let ts: Pick;
  try {
    const last = c.last_opp ? { row: c.last_opp[0], col: c.last_opp[1] } : null;
    ts = pickOf(await selectAiMove(boardOf(c), color, c.rung, last, analyze, {
      opponentPassed: c.opponent_passed,
      border,
    }));
  } finally {
    _setRandomSource(null);
    _resetReadCooldowns();
    mocked.profile = null;
  }
  if (JSON.stringify(ts) !== JSON.stringify(c.pick)) {
    problems.push(`picked ${JSON.stringify(ts)}, the Python ${JSON.stringify(c.pick)}`);
  }
  if (!u.exact) problems.push(`uniforms used ${u.used + u.overrun} of ${c.u.length}`);
  if (!g.exact) problems.push(`normals used ${g.used + g.overrun} of ${c.g.length}`);
  if (feed.asked() !== c.answers.length) problems.push(`answers asked ${feed.asked()} of ${c.answers.length}`);
  const ok = problems.length === 0;
  return {
    id: c.id,
    label: `${c.id} ${c.size}x${c.size} ${c.rung} ${c.variant} ${c.color}${c.opponent_passed ? ' after a pass' : ''}`,
    ok,
    problems,
    ts,
    cls: ok ? '' : classifyStandard(c),
  };
}

/** The cause of a standard-path disagreement, from what the Python's run saw. */
function classifyStandard(c: StandardCase): string {
  if (c.trace.includes('no-candidates')) return 'no-candidates';
  if (c.trace.includes('top-pass')) return 'top-pass';
  return 'unexplained';
}

declare const process: { env: Record<string, string | undefined> };
interface ExpectedFailures {
  about: string;
  classes: Record<string, { reason: string; cases: string[] }>;
}
const EXPECTED_URL = new URL('../../../../data/selector_parity/expected_failures.json', import.meta.url);
const EXPECTED = JSON.parse(new TextDecoder().decode(readFileSync(EXPECTED_URL))) as ExpectedFailures;
const LISTED = new Map<string, string>();
for (const [cls, { cases }] of Object.entries(EXPECTED.classes)) {
  for (const id of cases) LISTED.set(id, cls);
}

async function runHuman(c: HumanCase): Promise<Outcome> {
  const color = colorOf(c);
  const u = new Feed(c.u);
  const problems: string[] = [];
  const n = c.size * c.size;
  const { next, asked } = answerFeed(c, problems);
  const own = ownershipOf(c.answers[0]);
  const engine: HumanNetEngine = {
    humanPolicy: async (name, visits) => {
      const a = next('human', { name, visits });
      const human = new Array<number>(n + 1).fill(0);
      for (const [i, p] of a.human as [number, number][]) human[i] = p;
      const policy = new Array<number>(n + 1).fill(0);
      policy[n] = a.main_pass as number;
      return { humanPolicy: human, policy, scoreLead: a.lead as number };
    },
    scoreAfter: async (move, visits) => {
      const a = next('score', { move: move === 'pass' ? 'pass' : gtp(move, c.size), visits });
      return { scoreLead: a.lead as number, winrate: a.winrate as number };
    },
    ownership: async () => own,
  };
  const res = await selectWithHumanNet(
    engine, boardOf(c), color, profileOf(c) as unknown as HumanNetProfile, c.moves_played,
    { opponentPassed: c.opponent_passed, rng: u.next },
  );
  const got = JSON.stringify([res.handled, pickOf(res.move)]);
  const want = JSON.stringify([c.handled, c.pick]);
  if (got !== want) problems.push(`got ${got}, the Python ${want}`);
  if (!u.exact) problems.push(`uniforms used ${u.used + u.overrun} of ${c.u.length}`);
  if (asked() !== c.answers.length) problems.push(`answers asked ${asked()} of ${c.answers.length}`);
  return {
    id: c.id,
    label: `${c.id} ${c.rung} ${c.variant} ${c.color}${c.opponent_passed ? ' after a pass' : ''}`,
    ok: problems.length === 0,
    problems,
  };
}

const show = (o: Outcome) => `${o.label}: ${o.problems.join('; ')}`;

describe('selector parity: standard path (moveSelector.ts against _select_with_katago)', () => {
  const results: Awaited<ReturnType<typeof runStandard>>[] = [];
  beforeAll(async () => {
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      for (const c of load<StandardCase>('standard')) results.push(await runStandard(c));
    } finally {
      quiet.mockRestore();
    }
  });

  it('every disagreement is a listed expected failure of its class', () => {
    expect(results.length).toBeGreaterThan(2000);
    const bad = results
      .filter((r) => !r.ok && LISTED.get(r.id) !== r.cls)
      .map((r) => `${show(r)} [cause ${r.cls}, listed ${LISTED.get(r.id) ?? 'nowhere'}]`);
    expect({ count: bad.length, first: bad.slice(0, 15) }).toEqual({ count: 0, first: [] });
  });

  it('every listed case still disagrees', () => {
    const byId = new Map(results.map((r) => [r.id, r]));
    const stale = [...LISTED]
      .filter(([id]) => byId.get(id)?.ok !== false)
      .map(([id, cls]) => `${id} (listed ${cls}) ${byId.has(id) ? 'now agrees' : 'is not a case'}`);
    expect({ count: stale.length, first: stale.slice(0, 15) }).toEqual({ count: 0, first: [] });
  });

  for (const [cls, { reason, cases }] of Object.entries(EXPECTED.classes)) {
    // Expected to fail while the class's disagreements stand; passes (and so
    // turns red) the day they are all closed.
    it.fails(`expected failure, ${cls} (${cases.length} cases): ${reason}`, () => {
      const listed = new Set(cases);
      const bad = results.filter((r) => listed.has(r.id) && !r.ok);
      expect(bad.slice(0, 3).map(show)).toEqual([]);
    });
  }

  it.runIf(Boolean(process.env.SELECTOR_PARITY_WRITE))('rewrites the expected failures', () => {
    for (const [cls, entry] of Object.entries(EXPECTED.classes)) {
      entry.cases = results.filter((r) => !r.ok && r.cls === cls).map((r) => r.id);
    }
    writeFileSync(EXPECTED_URL, `${JSON.stringify(EXPECTED, null, 1)}\n`);
  });
});

describe('the parity harness itself', () => {
  const fake = { answers: [{ kind: 'analysis', visits: 16, wrn: null }, { kind: 'ownership' }] } as unknown as BaseCase;

  it('answers a request that matches the recorded one, and refuses one that does not', () => {
    for (const [kind, req] of [
      ['ownership', {}],
      ['analysis', { visits: 17, wrn: null }],
      ['analysis', { visits: 16, wrn: 0.5 }],
    ] as Array<[string, Record<string, unknown>]>) {
      const problems: string[] = [];
      expect(() => answerFeed(fake, problems).next(kind, req)).toThrow();
      expect(problems).toHaveLength(1);
    }
    const problems: string[] = [];
    const feed = answerFeed(fake, problems);
    expect(feed.next('analysis', { visits: 16, wrn: null }).kind).toBe('analysis');
    expect(feed.next('ownership', {}).kind).toBe('ownership');
    expect(() => feed.next('score', { move: 'pass', visits: 4 })).toThrow(); // past the recorded ones
    expect([feed.asked(), problems.length]).toEqual([2, 1]);
  });

  it('a disagreement outside the pinned causes is unexplained', () => {
    const cls = (trace: string[]) => classifyStandard({ trace } as StandardCase);
    expect(cls([])).toBe('unexplained');
    expect(cls(['border-closed'])).toBe('unexplained');
    expect(cls(['border-closed', 'top-pass'])).toBe('top-pass');
    expect(cls(['border-closed', 'no-candidates'])).toBe('no-candidates');
  });
});

describe('selector parity: human path (humanNetSelector.ts against _select_with_human_net)', () => {
  const results: Outcome[] = [];
  beforeAll(async () => {
    for (const c of load<HumanCase>('human')) results.push(await runHuman(c));
  });

  it('agrees on every case', () => {
    expect(results.length).toBeGreaterThan(2000);
    expect(results.filter((r) => !r.ok).slice(0, 15).map(show)).toEqual([]);
  });
});
