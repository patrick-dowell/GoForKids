/**
 * Human-style bots on the device: which selector plays a bot move.
 *
 * The human path plays only when all of these hold: the "Human-style bots"
 * setting is on, the human set (b28_human.yaml) has a rung for the rank and
 * board size, and the bridge reported the human model at start. Then the
 * move comes from humanNetSelector.ts through the bridge's humanPolicy and
 * scoreAfter; if that path declines or fails, the standard selector plays
 * with the b28.yaml rung. In every other case the bridge sees exactly the
 * calls it sees without the feature. "Bot plays online" still wins.
 *
 * Runs through client.ts (api.getAIMove) against a fake bridge and a real
 * on-device game from localGameRouter. vitest's env is 'node': localStorage
 * and window are shimmed as in cloudBot.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function installLocalStorage() {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

const N = 81;

/** A 9×9 policy (row-major from the top-left, pass last) with mass on the given indexes. */
function policy(points: Record<number, number>, pass = 0): number[] {
  const pol = new Array<number>(N + 1).fill(0);
  for (const [i, p] of Object.entries(points)) pol[Number(i)] = p;
  pol[N] = pass;
  return pol;
}

const C7 = 2 * 9 + 2; // row 2, col 2

interface FakeOpts {
  /** capabilities(): absent, resolving with these, or rejecting. */
  caps?: { localBots: boolean; evalsPerSecond: number; humanModel: boolean } | 'reject';
  /** Leave humanPolicy / scoreAfter off the bridge (an inconsistent build). */
  noHumanCalls?: boolean;
  humanPolicyFails?: boolean;
  humanPolicyNull?: boolean;
  scoreAfterFails?: boolean;
  /** An engine call that never answers. */
  hang?: 'humanPolicy' | 'scoreAfter' | 'ownership';
  /** The main net's pass weight in humanPolicy's answer (default 0). */
  mainPass?: number;
  /** scoreAfter's lead after a move, Black's frame (default 5; the pass reads 0). */
  afterLead?: number;
  /** analyze's ownership when asked for it, Black's frame (sent from the
   *  side to move's, as KataGo's GTP layer does); 'fail' rejects. */
  ownership?: number[] | 'fail';
}

/** Fake `window.kataGo`: analyze always offers E5 (the standard path's
 *  move, prior 0.95, so every branch of the standard 9×9 rungs plays it);
 *  the human net puts all its weight on C7. */
function installBridge(opts: FakeOpts = {}) {
  const analyze = vi.fn(async (params: Record<string, unknown>) => {
    if (params.ownership && opts.ownership === 'fail') throw new Error('engine busy');
    if (params.ownership && opts.hang === 'ownership') return new Promise<never>(() => {});
    const own = params.ownership && opts.ownership !== 'fail' ? opts.ownership : undefined;
    return {
      candidates: [{ move: 'E5', visits: 16, winrate: 0.5, scoreLead: 0.5, prior: 0.95, order: 0 }],
      rootVisits: Number(params.maxVisits),
      kataGoPlayedMove: 'E5',
      ...(own ? { ownership: params.color === 'W' ? own.map((v) => -v) : own } : {}),
    };
  });
  const humanPolicy = vi.fn(async (params: Record<string, unknown>) => {
    // As the native bridge does: the visits are required, an integer of 1 or more.
    const visits = params.visits ?? params.maxVisits;
    if (!Number.isInteger(visits) || (visits as number) < 1) throw new Error('invalid params: visits');
    if (opts.humanPolicyFails) throw new Error('human net not loaded');
    if (opts.hang === 'humanPolicy') return new Promise<never>(() => {});
    return {
      humanPolicy: opts.humanPolicyNull ? null : policy({ [C7]: 1.0 }),
      policy: policy({ [C7]: 0.5 }, opts.mainPass ?? 0),
      scoreLead: 1.25,
    };
  });
  const scoreAfter = vi.fn(async (params: Record<string, unknown>) => {
    if (opts.scoreAfterFails) throw new Error('engine busy');
    if (opts.hang === 'scoreAfter') return new Promise<never>(() => {});
    return { scoreLead: params.move === 'pass' ? 0 : (opts.afterLead ?? 5), winrate: 0.6 };
  });
  const capabilities = vi.fn(async () => {
    if (opts.caps === 'reject') throw new Error('no probe');
    return opts.caps as { localBots: boolean; evalsPerSecond: number; humanModel: boolean };
  });
  const bridge: Record<string, unknown> = { ping: async () => ({ pong: true }), analyze };
  if (!opts.noHumanCalls) Object.assign(bridge, { humanPolicy, scoreAfter });
  if (opts.caps !== undefined) bridge.capabilities = capabilities;
  (globalThis as { window?: unknown }).window = { kataGo: bridge };
  return { analyze, humanPolicy, scoreAfter, capabilities };
}

const HUMAN = { localBots: true, evalsPerSecond: 40, humanModel: true };
const NO_HUMAN = { localBots: true, evalsPerSecond: 40, humanModel: false };

/** Fresh modules, then: read the capabilities as main.tsx does at start,
 *  set the toggles, start an on-device 9×9 game. */
async function start(o: { humanBots?: boolean; cloudBot?: boolean } = {}) {
  const caps = await import('../../store/capabilitiesStore');
  await caps.readDeviceCapabilities();
  const { useSettingsStore } = await import('../../store/settingsStore');
  useSettingsStore.getState().setHumanBots(o.humanBots ?? false);
  useSettingsStore.getState().setCloudBot(o.cloudBot ?? false);
  const { api } = await import('../client');
  const log = await import('../../ai/selectorLog');
  const game = await api.createGame({ board_size: 9, target_rank: '15k', komi: 6.5 });
  return { api, gameId: game.game_id, log };
}

const at = (p: { row: number; col: number }) => [p.row, p.col];

/** Twelve moves on the game's board (no captures), Black to move: past the
 *  human path's opening (human_tilt_from 12). Returns them as bridge moves. */
async function twelveMoves(api: Awaited<ReturnType<typeof start>>['api'], gameId: string) {
  const black = [[0, 0], [0, 2], [0, 4], [0, 6], [0, 8], [1, 1]];
  const white = [[8, 0], [8, 2], [8, 4], [8, 6], [8, 8], [7, 1]];
  const moves: Array<{ color: 'B' | 'W'; point: string }> = [];
  const { toGtp } = await import('../nativeKataGo');
  for (let i = 0; i < 6; i++) {
    for (const [color, [row, col]] of [['B', black[i]], ['W', white[i]]] as const) {
      await api.playMove(gameId, row, col);
      moves.push({ color, point: toGtp({ row, col }, 9) });
    }
  }
  return moves;
}

beforeEach(() => {
  vi.resetModules();
  installLocalStorage();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { window?: unknown }).window;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the routing matrix: setting × human rung × human model', () => {
  // rung present: the 9×9 15k, 9k and 6k; rung absent: the 9×9 3k (the human set has none)
  const cases = [
    { humanBots: false, rank: '15k', caps: HUMAN, human: false },
    { humanBots: false, rank: '15k', caps: NO_HUMAN, human: false },
    { humanBots: false, rank: '3k', caps: HUMAN, human: false },
    { humanBots: false, rank: '3k', caps: NO_HUMAN, human: false },
    { humanBots: true, rank: '15k', caps: HUMAN, human: true },
    { humanBots: true, rank: '15k', caps: NO_HUMAN, human: false },
    { humanBots: true, rank: '3k', caps: HUMAN, human: false },
    { humanBots: true, rank: '3k', caps: NO_HUMAN, human: false },
    { humanBots: false, rank: '9k', caps: HUMAN, human: false },
    { humanBots: false, rank: '6k', caps: HUMAN, human: false },
    { humanBots: true, rank: '9k', caps: HUMAN, human: true },
    { humanBots: true, rank: '6k', caps: HUMAN, human: true },
  ];

  for (const c of cases) {
    it(`setting ${c.humanBots ? 'on' : 'off'}, ${c.rank}, human model ${c.caps.humanModel ? 'yes' : 'no'}: ${c.human ? 'the human path' : 'the standard path'}`, async () => {
      const b = installBridge({ caps: c.caps });
      const { api, gameId } = await start({ humanBots: c.humanBots });
      const move = await api.getAIMove(gameId, c.rank, { movesForBridge: [], handicap: 0 });
      if (c.human) {
        expect(at(move.point)).toEqual([2, 2]); // C7, the human net's move
        expect(b.humanPolicy).toHaveBeenCalledTimes(1);
        expect(b.analyze).not.toHaveBeenCalled();
      } else {
        expect(at(move.point)).toEqual([4, 4]); // E5, the standard path's
        expect(b.humanPolicy).not.toHaveBeenCalled();
        expect(b.scoreAfter).not.toHaveBeenCalled();
        expect(b.analyze).toHaveBeenCalledTimes(1);
      }
    });
  }
});

describe('the standard path is what it was', () => {
  /** The bridge calls of one bot move on a bridge that has never heard of
   *  the human net (no capabilities, humanPolicy or scoreAfter). */
  async function baseline(rank: string) {
    const b = installBridge({ noHumanCalls: true });
    const { api, gameId } = await start();
    await api.getAIMove(gameId, rank, { movesForBridge: [], handicap: 0 });
    vi.resetModules();
    installLocalStorage();
    return b.analyze.mock.calls;
  }

  for (const [label, opts, settings, rank] of [
    ['setting off', { caps: HUMAN }, { humanBots: false }, '15k'],
    ['setting off, 9k', { caps: HUMAN }, { humanBots: false }, '9k'],
    ['setting off, 6k', { caps: HUMAN }, { humanBots: false }, '6k'],
    ['no human rung', { caps: HUMAN }, { humanBots: true }, '3k'],
    ['human model false', { caps: NO_HUMAN }, { humanBots: true }, '15k'],
    ['a build without capabilities()', {}, { humanBots: true }, '15k'],
    ['capabilities() failing', { caps: 'reject' as const }, { humanBots: true }, '15k'],
  ] as const) {
    it(`${label}: the same analyze call as a bridge without the feature`, async () => {
      const expected = await baseline(rank);
      const b = installBridge(opts);
      const { api, gameId } = await start(settings);
      await api.getAIMove(gameId, rank, { movesForBridge: [], handicap: 0 });
      expect(b.analyze.mock.calls).toEqual(expected);
      expect(b.humanPolicy).not.toHaveBeenCalled();
      expect(b.scoreAfter).not.toHaveBeenCalled();
    });
  }
});

describe('the 9×9 9k and 6k on the human path', () => {
  afterEach(() => {
    vi.doUnmock('../../ai/humanNetSelector');
  });

  /** The human selector, wrapped so a test can see the profile it was given. */
  async function spySelector() {
    vi.doMock('../../ai/humanNetSelector', async (importOriginal) => {
      const m = await importOriginal<typeof import('../../ai/humanNetSelector')>();
      return { ...m, selectWithHumanNet: vi.fn(m.selectWithHumanNet) };
    });
    return (await import('../../ai/humanNetSelector')).selectWithHumanNet as unknown as ReturnType<typeof vi.fn>;
  }

  for (const [rank, knobs] of [
    ['9k', { human_tilt: -4.0, human_loss_cap: 4.0 }],
    ['6k', { human_tilt: -0.5, human_loss_cap: 1.0 }],
  ] as const) {
    it(`setting on: the ${rank} plays through the human selector with its own rung (rank_9k)`, async () => {
      const select = await spySelector();
      const b = installBridge({ caps: HUMAN });
      const { api, gameId } = await start({ humanBots: true });
      const { getHumanProfile } = await import('../../ai/profileLoader');
      const move = await api.getAIMove(gameId, rank, { movesForBridge: [], handicap: 0 });
      expect(at(move.point)).toEqual([2, 2]);
      expect(b.humanPolicy.mock.calls[0][0]).toMatchObject({ profile: 'rank_9k', maxVisits: 1 });
      expect(select).toHaveBeenCalledTimes(1);
      const profile = select.mock.calls[0][3];
      expect(profile).toBe(getHumanProfile(rank, 9));
      expect(profile).toMatchObject({ human_sl_profile: 'rank_9k', ...knobs });
      expect(b.analyze).not.toHaveBeenCalled();
    });

    it(`setting off: the ${rank} never reaches the human selector`, async () => {
      const select = await spySelector();
      const b = installBridge({ caps: HUMAN });
      const { api, gameId } = await start({ humanBots: false });
      const move = await api.getAIMove(gameId, rank, { movesForBridge: [], handicap: 0 });
      expect(at(move.point)).toEqual([4, 4]);
      expect(select).not.toHaveBeenCalled();
      expect(b.humanPolicy).not.toHaveBeenCalled();
    });
  }
});

describe('the human path through the bridge', () => {
  it("asks humanPolicy with the analyze call's position and the rung's human profile", async () => {
    const b = installBridge({ caps: HUMAN });
    const { api, gameId } = await start({ humanBots: true });
    await api.getAIMove(gameId, '15k', { movesForBridge: [], handicap: 0 });
    expect(b.humanPolicy).toHaveBeenCalledWith({
      boardSize: 9,
      komi: 6.5,
      rules: 'japanese',
      moves: [],
      color: 'B',
      profile: 'rank_20k',
      maxVisits: 1,
    });
  });

  it('sends the visits the native humanPolicy requires, so the human selector plays', async () => {
    const b = installBridge({ caps: HUMAN });
    const { api, gameId, log } = await start({ humanBots: true });
    log.clearSelectorLog();
    const move = await api.getAIMove(gameId, '15k', { movesForBridge: [], handicap: 0 });
    expect(at(move.point)).toEqual([2, 2]);
    expect(b.humanPolicy.mock.calls[0][0]).toMatchObject({ maxVisits: 1 });
    expect(b.analyze).not.toHaveBeenCalled();
    expect(log.snapshotSelectorLog().some((l) => l.includes('standard selector'))).toBe(false);
  });

  it('scores the candidates through scoreAfter past move 12, and feeds the score graph', async () => {
    const b = installBridge({ caps: HUMAN });
    const { api, gameId } = await start({ humanBots: true });
    const moves = await twelveMoves(api, gameId);
    const move = await api.getAIMove(gameId, '15k', { movesForBridge: moves, handicap: 0 });
    expect(at(move.point)).toEqual([2, 2]);
    const asked = b.scoreAfter.mock.calls.map(([p]) => p);
    expect(asked).toEqual([
      { boardSize: 9, komi: 6.5, rules: 'japanese', moves, color: 'B', move: 'C7', maxVisits: 4 },
      { boardSize: 9, komi: 6.5, rules: 'japanese', moves, color: 'B', move: 'pass', maxVisits: 4 },
    ]);
    // the root lead before the move, and the lead read after C7
    expect(move.score_lead_before).toBe(1.25);
    expect(move.score_lead).toBe(5);
    expect(b.analyze).not.toHaveBeenCalled();
  });

  it('counts moves without the handicap stones, as the server does', async () => {
    const b = installBridge({ caps: HUMAN });
    const { api, gameId } = await start({ humanBots: true });
    const moves = await twelveMoves(api, gameId);
    // the same twelve entries, two of them handicap stones: ten moves played, still the opening
    const move = await api.getAIMove(gameId, '15k', { movesForBridge: moves, handicap: 2 });
    expect(at(move.point)).toEqual([2, 2]);
    expect(b.scoreAfter).not.toHaveBeenCalled();
    expect(move.score_lead).toBe(1.25); // sampled: the root lead carries
  });

  it("weighs passing after the opponent's pass, before move 12", async () => {
    const b = installBridge({ caps: HUMAN });
    const { api, gameId } = await start({ humanBots: true });
    // nine moves, then White passes: Black to move, ten entries, still the opening
    const moves = (await twelveMoves(api, gameId)).slice(0, 9);
    const fresh = (await api.createGame({ board_size: 9, target_rank: '15k', komi: 6.5 })).game_id;
    const { fromGtp } = await import('../nativeKataGo');
    for (const m of moves) {
      const p = fromGtp(m.point, 9) as { row: number; col: number };
      await api.playMove(fresh, p.row, p.col);
    }
    await api.pass(fresh);
    b.scoreAfter.mockClear();
    const withPass = [...moves, { color: 'W' as const, point: 'pass' }];
    await api.getAIMove(fresh, '15k', { movesForBridge: withPass, handicap: 0 });
    expect(b.scoreAfter.mock.calls.map(([p]) => [p.color, p.move])).toEqual([
      ['B', 'C7'],
      ['B', 'pass'],
    ]);
  });

  describe('the border check before a pass', () => {
    // After twelveMoves Black's stones on the top edge leave one-point gaps
    // whose closing (D8, F8, H8; A7) each gains a point by the game's count.
    const ownershipOf = (grid: number[][]) =>
      grid.flat().map((c) => (c === 1 ? 0.9 : c === 2 ? -0.9 : 0));

    it("reads the ownership the device's scorer reads, and closes a border instead of passing", async () => {
      installBridge({ caps: HUMAN });
      const { api, gameId } = await start({ humanBots: true });
      const moves = await twelveMoves(api, gameId);
      const grid = (await api.getGame(gameId)).board;
      const b = installBridge({ caps: HUMAN, mainPass: 0.9, ownership: ownershipOf(grid) });
      const move = await api.getAIMove(gameId, '15k', { movesForBridge: moves, handicap: 0 });
      // the first of the one-point moves in index order (the human net puts nothing on them)
      expect(at(move.point)).toEqual([1, 3]);
      const { boardToMoves } = await import('../nativeKataGo');
      expect(b.analyze.mock.calls.map(([p]) => p)).toEqual([
        {
          boardSize: 9,
          komi: 6.5,
          rules: 'tromp-taylor',
          moves: boardToMoves(grid, 9),
          color: 'B',
          maxVisits: 200,
          ownership: true,
        },
      ]);
    });

    it("asks from White's side when White is to move", async () => {
      installBridge({ caps: HUMAN });
      const { api, gameId } = await start({ humanBots: true });
      const moves = [...(await twelveMoves(api, gameId)), { color: 'B' as const, point: 'E5' }];
      await api.playMove(gameId, 4, 4);
      const grid = (await api.getGame(gameId)).board;
      // every move reads five better than the pass from White's side: a border move loses nothing against it
      const b = installBridge({ caps: HUMAN, mainPass: 0.9, ownership: ownershipOf(grid), afterLead: -5 });
      const move = await api.getAIMove(gameId, '15k', { movesForBridge: moves, handicap: 0 });
      // White's first one-point move in index order: A3 closes A2
      expect(at(move.point)).toEqual([6, 0]);
      expect(b.analyze.mock.calls.map(([p]) => [p.color, p.rules, p.maxVisits])).toEqual([['W', 'tromp-taylor', 200]]);
    });

    it('passes as before when the read fails or sends no ownership', async () => {
      for (const ownership of ['fail', undefined] as const) {
        installBridge({ caps: HUMAN });
        const { api, gameId } = await start({ humanBots: true });
        const moves = await twelveMoves(api, gameId);
        const b = installBridge({ caps: HUMAN, mainPass: 0.9, ownership });
        const move = await api.getAIMove(gameId, '15k', { movesForBridge: moves, handicap: 0 });
        expect(at(move.point)).toEqual([-1, -1]);
        expect(b.analyze).toHaveBeenCalledTimes(1);
        expect(b.scoreAfter).not.toHaveBeenCalled();
      }
    });

    it('a move the path plays reads no ownership', async () => {
      installBridge({ caps: HUMAN });
      const { api, gameId } = await start({ humanBots: true });
      const moves = await twelveMoves(api, gameId);
      const grid = (await api.getGame(gameId)).board;
      const b = installBridge({ caps: HUMAN, ownership: ownershipOf(grid) });
      const move = await api.getAIMove(gameId, '15k', { movesForBridge: moves, handicap: 0 });
      expect(at(move.point)).toEqual([2, 2]);
      expect(b.analyze).not.toHaveBeenCalled();
    });
  });

  it('logs its decisions to the game log', async () => {
    installBridge({ caps: HUMAN });
    const { api, gameId, log } = await start({ humanBots: true });
    log.clearSelectorLog();
    await api.getAIMove(gameId, '15k', { movesForBridge: [], handicap: 0 });
    expect(log.snapshotSelectorLog().some((l) => l.includes('[human] human net rank_20k: sampled C7'))).toBe(true);
  });
});

describe('a failing human path hands the move to the standard selector', () => {
  for (const [label, opts, late, why] of [
    ['humanPolicy throws', { caps: HUMAN, humanPolicyFails: true }, false, 'human net not loaded'],
    ['the human policy is missing', { caps: HUMAN, humanPolicyNull: true }, false, 'no human policy'],
    ['a build that reports the model but lacks the calls', { caps: HUMAN, noHumanCalls: true }, false, 'this native build has no humanPolicy'],
    ['scoreAfter throws', { caps: HUMAN, scoreAfterFails: true }, true, 'engine busy'],
  ] as const) {
    it(`${label}: the b28.yaml rung plays`, async () => {
      const b = installBridge(opts);
      const { api, gameId, log } = await start({ humanBots: true });
      const moves = late ? await twelveMoves(api, gameId) : [];
      log.clearSelectorLog();
      const move = await api.getAIMove(gameId, '15k', { movesForBridge: moves, handicap: 0 });
      expect(at(move.point)).toEqual([4, 4]);
      expect(b.analyze).toHaveBeenCalledTimes(1);
      expect(b.analyze.mock.calls[0][0]).toMatchObject({ maxVisits: 16, wideRootNoise: 0.7 });
      const lines = log.snapshotSelectorLog().filter((l) => l.includes('[human]'));
      expect(lines.some((l) => l.includes(why) && l.includes('standard selector'))).toBe(true);
    });
  }
});

describe('games the human path does not take', () => {
  it('"Bot plays online" wins: the move goes to the server and the bridge is not asked', async () => {
    const b = installBridge({ caps: HUMAN });
    const dto = { point: { row: 2, col: 3 }, captures: [], score_lead: 1.5 };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => dto }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await start({ humanBots: true, cloudBot: true });
    expect(await api.getAIMove('g1', '15k', { movesForBridge: [], handicap: 0 })).toEqual(dto);
    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls.filter((u) => u.includes('/ai-move'))).toEqual([expect.stringContaining('/games/g1/ai-move')]);
    expect(b.humanPolicy).not.toHaveBeenCalled();
    expect(b.analyze).not.toHaveBeenCalled();
  });

  it('a lesson move that must not pass stays standard', async () => {
    const b = installBridge({ caps: HUMAN });
    const { api, gameId } = await start({ humanBots: true });
    await api.getAIMove(gameId, '15k', { movesForBridge: [], handicap: 0, neverPass: true });
    expect(b.humanPolicy).not.toHaveBeenCalled();
    expect(b.analyze).toHaveBeenCalledTimes(1);
  });

  it('a move sent without its game history stays standard (bot-vs-bot)', async () => {
    const b = installBridge({ caps: HUMAN });
    const { api, gameId } = await start({ humanBots: true });
    await api.getAIMove(gameId, '15k');
    expect(b.humanPolicy).not.toHaveBeenCalled();
    expect(b.analyze).toHaveBeenCalledTimes(1);
  });

  it('the setting takes effect on the next move, no reload', async () => {
    const b = installBridge({ caps: HUMAN });
    const { api, gameId } = await start({ humanBots: false });
    const { useSettingsStore } = await import('../../store/settingsStore');
    await api.getAIMove(gameId, '15k', { movesForBridge: [], handicap: 0 });
    expect(b.humanPolicy).not.toHaveBeenCalled();
    useSettingsStore.getState().setHumanBots(true);
    const game2 = await api.createGame({ board_size: 9, target_rank: '15k', komi: 6.5 });
    await api.getAIMove(game2.game_id, '15k', { movesForBridge: [], handicap: 0 });
    expect(b.humanPolicy).toHaveBeenCalledTimes(1);
  });
});

describe('an engine call on the human path that never answers', () => {
  // The move's deadline (client.ts DEVICE_MOVE_DEADLINE_MS) covers every
  // engine call: the move fails then, with nothing played or passed for it,
  // even where the path itself would answer a failed call with a pass.
  for (const hang of ['humanPolicy', 'scoreAfter', 'ownership'] as const) {
    it(`${hang}: the move fails at the deadline and commits nothing`, async () => {
      installBridge({ caps: HUMAN });
      const { api, gameId } = await start({ humanBots: true });
      const moves = await twelveMoves(api, gameId);
      installBridge({ caps: HUMAN, hang, ...(hang === 'ownership' ? { mainPass: 0.9 } : {}) });
      const { DEVICE_MOVE_DEADLINE_MS } = await import('../client');
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      let failed: unknown = null;
      const move = api.getAIMove(gameId, '15k', { movesForBridge: moves, handicap: 0 }).catch((e) => (failed = e));
      await vi.advanceTimersByTimeAsync(DEVICE_MOVE_DEADLINE_MS);
      await move;
      expect(String(failed)).toContain(`did not answer in ${DEVICE_MOVE_DEADLINE_MS}ms`);
      const state = await api.getGame(gameId);
      expect(state.move_number).toBe(13); // twelve played; the bot's is still to come
      expect(state.current_color).toBe('black');
    });
  }
});
